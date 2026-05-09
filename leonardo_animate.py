#!/usr/bin/env python3
"""
leonardo_animate.py
===================
Agent CLI pour animer une image via l'API Leonardo Motion 2.0, avec :
  - suivi automatique des crédits sur un budget fixe (2366 par défaut)
  - double-check du prompt par Claude Haiku avant de payer Leonardo
    (évite de gâcher des crédits sur un prompt incompatible avec l'image)
  - mode batch lisant un JSON de scénario (ex: scenar_chap3_json.txt)

Usage rapide
------------
1) Variables d'environnement (une fois) :
   export LEONARDO_API_KEY="..."
   export ANTHROPIC_API_KEY="..."   # optionnel, pour --validate

2) Initialiser le budget :
   python leonardo_animate.py --reset-budget 2366

3) Animer une image (avec validation préalable) :
   python leonardo_animate.py --image perso.png \
       --prompt "subtle idle breathing, slight head sway" \
       --quality 480p --validate

4) Mode batch sur le JSON du chapitre 3 :
   python leonardo_animate.py --batch scenar_chap3_json.txt \
       --assets assets/chapitre_3 --quality 480p --validate

5) Limiter le batch à certains tableaux :
   python leonardo_animate.py --batch ... --only 1

6) Valider sans générer (zéro crédit Leonardo) :
   python leonardo_animate.py --batch ... --validate-only

7) Voir le budget et l'historique :
   python leonardo_animate.py --budget-status
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
import time
from datetime import datetime
import shutil
from pathlib import Path
from typing import Optional

try:
    import requests
except ImportError:
    print("ERREUR : 'requests' requis. Installe avec : pip install requests",
          file=sys.stderr)
    sys.exit(1)


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

API_BASE = "https://cloud.leonardo.ai/api/rest/v1"
ANTHROPIC_API = "https://api.anthropic.com/v1/messages"
SCRIPT_DIR = Path(__file__).resolve().parent
LEDGER_PATH = SCRIPT_DIR / "credits_ledger.json"
DEFAULT_BUDGET = 2366

# Charge automatiquement les clés API depuis .env (LEONARDO_API_KEY, ANTHROPIC_API_KEY)
try:
    from dotenv import load_dotenv
    env_path = SCRIPT_DIR / ".env"
    if env_path.exists():
        load_dotenv(env_path)
except ImportError:
    pass  # dotenv pas installé, on utilise os.environ tel quel

ESTIMATED_COST = {"480p": 25, "720p": 50}
RESOLUTION_MAP = {"480p": "RESOLUTION_480", "720p": "RESOLUTION_720"}

VALIDATOR_MODEL = "claude-haiku-4-5-20251001"
VALIDATOR_PROMPT = """You are validating an animation prompt for an image-to-video model (Leonardo Motion 2.0).

You will receive :
1. A SOURCE IMAGE
2. An ANIMATION PROMPT (what motion to apply)
3. Optionally, NARRATIVE CONTEXT (narrator text + character dialogue) describing what should happen in the scene

You must check THREE things :

CHECK 1 — FEASIBILITY (can Motion 2.0 do this?)
Motion 2.0 ANIMATES existing visual content. It CANNOT create new objects, characters, \
text, or scene elements that aren't already in the source image. It moves, deforms, \
pulses, drifts, and rotates what is already drawn.
  FAIL examples : "the word 'BONJOUR' writes itself letter by letter" when 'BONJOUR' is already fully \
visible / "a child runs into the scene" when no child is in the image / "sound waves transform into letters" \
when both already exist separately.
  PASS examples : "the word pulses and glows brighter" / "letters drift around the screen" / \
"Léon tilts his head".

CHECK 2 — NARRATIVE COVERAGE (only if narrative context is provided)
The prompt MUST cover the key concrete actions described in the narrator/dialogue. \
If the narrator says "Léon te fait signe de le suivre", the prompt must mention beckoning / \
waving / inviting gesture. If the narrator says "active une boîte", the prompt must mention \
pressing / activating. Generic ambiance ("fairy lights twinkle") is fine but NOT a substitute \
for the specific gesture.
  WARN if some actions are missing.
  FAIL if the prompt completely ignores the main narrative action.

CHECK 3 — LIP MOVEMENT FOR SPEAKING CHARACTERS (CRITICAL for this project)
Whenever the narrative context contains DIALOGUE from a character (Léon, Bot, etc.) \
in the same image — i.e. the character is speaking — the animation prompt MUST include \
mouth/lip movement for that character. This is NOT lip-sync (we don't need the lips to match \
specific phonemes), but the character's mouth must clearly OPEN and CLOSE in a generic \
talking motion so the viewer perceives the character as alive and speaking.
  Acceptable phrasings : "Léon's mouth opens and closes naturally as he talks", \
"his lips move gently in a speaking motion", "subtle mouth movement as if speaking".
  FAIL if the prompt has dialogue context but no mention of mouth/lips/talking motion at all.
  WARN if mouth movement is implied but not explicit.

Respond ONLY with valid JSON, no prose, no markdown :
{"verdict": "PASS" | "WARN" | "FAIL", "feasibility": "PASS|WARN|FAIL", "narrative_coverage": "PASS|WARN|FAIL|N/A", "lip_movement": "PASS|WARN|FAIL|N/A", "issues": ["short issue 1", "..."], "suggestion": "rewrite hint or empty string"}

Final verdict = the worst of feasibility, narrative_coverage and lip_movement.
"""


# ---------------------------------------------------------------------------
# Ledger crédits
# ---------------------------------------------------------------------------

def load_ledger() -> dict:
    if LEDGER_PATH.exists():
        try:
            return json.loads(LEDGER_PATH.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            print(f"WARN : ledger illisible, recréé.", file=sys.stderr)
    return {"budget": DEFAULT_BUDGET, "spent": 0, "history": []}


def save_ledger(ledger: dict) -> None:
    LEDGER_PATH.write_text(
        json.dumps(ledger, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def remaining(ledger: dict) -> int:
    return ledger["budget"] - ledger["spent"]


# ---------------------------------------------------------------------------
# Validation par Claude Haiku
# ---------------------------------------------------------------------------

def _image_media_type(path: Path) -> str:
    ext = path.suffix.lower().lstrip(".")
    return {"jpg": "image/jpeg", "jpeg": "image/jpeg",
            "png": "image/png", "webp": "image/webp"}.get(ext, "image/jpeg")


def validate_prompt(image_path: Path, animation_prompt: str,
                    anthropic_key: str,
                    narrative_context: Optional[str] = None) -> dict:
    """
    Demande à Claude Haiku si le prompt d'animation est réalisable
    sur cette image et s'il couvre les actions narratives.
    Renvoie {"verdict": "PASS"|"WARN"|"FAIL", "feasibility": ..., "narrative_coverage": ...,
             "issues": [...], "suggestion": "..."}
    """
    img_b64 = base64.standard_b64encode(image_path.read_bytes()).decode("utf-8")
    headers = {
        "x-api-key": anthropic_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    user_text = f"ANIMATION PROMPT to validate :\n\n{animation_prompt}"
    if narrative_context:
        user_text = (f"NARRATIVE CONTEXT (what should happen) :\n{narrative_context}\n\n"
                     + user_text)
    body = {
        "model": VALIDATOR_MODEL,
        "max_tokens": 500,
        "system": VALIDATOR_PROMPT,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "image", "source": {
                    "type": "base64",
                    "media_type": _image_media_type(image_path),
                    "data": img_b64,
                }},
                {"type": "text", "text": user_text},
            ],
        }],
    }
    r = requests.post(ANTHROPIC_API, json=body, headers=headers, timeout=60)
    r.raise_for_status()
    data = r.json()
    text = "".join(b.get("text", "") for b in data.get("content", []))
    # Récupère le premier bloc JSON dans la réponse.
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if not m:
        return {"verdict": "WARN",
                "issues": [f"Réponse Claude non-JSON : {text[:200]}"],
                "suggestion": ""}
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return {"verdict": "WARN",
                "issues": [f"JSON invalide dans la réponse : {text[:200]}"],
                "suggestion": ""}


def print_validation(v: dict) -> None:
    icon = {"PASS": "[OK]  ", "WARN": "[WARN]", "FAIL": "[FAIL]"}.get(
        v.get("verdict"), "[??]  ")
    print(f"  {icon} {v.get('verdict', '?')}")
    for issue in v.get("issues", []) or []:
        print(f"        - {issue}")
    if v.get("suggestion"):
        print(f"        Suggestion : {v['suggestion']}")


# ---------------------------------------------------------------------------
# Leonardo : upload + génération + polling
# ---------------------------------------------------------------------------

def _auth(api_key: str) -> dict:
    return {"accept": "application/json",
            "authorization": f"Bearer {api_key}",
            "content-type": "application/json"}


def request_init_image_upload(api_key: str, extension: str) -> dict:
    r = requests.post(f"{API_BASE}/init-image", json={"extension": extension},
                      headers=_auth(api_key), timeout=30)
    r.raise_for_status()
    return r.json()["uploadInitImage"]


def upload_image(image_path: Path, api_key: str) -> str:
    ext = image_path.suffix.lstrip(".").lower()
    if ext == "jpg":
        ext = "jpeg"
    if ext not in {"png", "jpeg", "webp"}:
        raise ValueError(f"Extension non supportée : .{ext}")
    upload_data = request_init_image_upload(api_key, ext)
    fields = json.loads(upload_data["fields"])
    with image_path.open("rb") as f:
        files = {"file": (image_path.name, f)}
        r = requests.post(upload_data["url"], data=fields, files=files, timeout=180)
        r.raise_for_status()
    return upload_data["id"]


def trigger_motion(api_key: str, image_id: str, prompt: str, quality: str,
                   frame_interpolation: bool = True,
                   prompt_enhance: bool = True) -> tuple[str, Optional[int]]:
    payload = {
        "imageId": image_id,
        "imageType": "UPLOADED",
        "prompt": prompt,
        "model": "MOTION2",
        "resolution": RESOLUTION_MAP[quality],
        "frameInterpolation": frame_interpolation,
        "promptEnhance": prompt_enhance,
    }
    r = requests.post(f"{API_BASE}/generations-image-to-video",
                      json=payload, headers=_auth(api_key), timeout=60)
    if r.status_code >= 400:
        raise RuntimeError(f"trigger_motion {r.status_code} : {r.text}")
    data = r.json()
    job = data.get("motionVideoGenerationJob") or data.get("sdGenerationJob") or data
    gen_id = job.get("generationId") or data.get("generationId")
    if not gen_id:
        raise RuntimeError(f"generationId absent : {data}")
    return gen_id, job.get("apiCreditCost") or data.get("apiCreditCost")


def poll_generation(api_key: str, gen_id: str, timeout_s: int = 900) -> dict:
    headers = {"accept": "application/json",
               "authorization": f"Bearer {api_key}"}
    start = time.time()
    last = None
    while time.time() - start < timeout_s:
        r = requests.get(f"{API_BASE}/generations/{gen_id}",
                         headers=headers, timeout=30)
        r.raise_for_status()
        data = r.json().get("generations_by_pk") or {}
        status = data.get("status")
        if status != last:
            print(f"  status : {status}", flush=True)
            last = status
        if status == "COMPLETE":
            return data
        if status == "FAILED":
            raise RuntimeError(f"Génération échouée : {data}")
        time.sleep(8)
    raise TimeoutError(f"Timeout après {timeout_s}s sur {gen_id}")


def extract_video_url(generation: dict) -> Optional[str]:
    for key in ("generated_videos", "videos"):
        for v in generation.get(key) or []:
            url = v.get("url") or v.get("videoUrl")
            if url:
                return url
    for img in generation.get("generated_images") or []:
        for k in ("motionMP4URL", "videoUrl"):
            if img.get(k):
                return img[k]
    return None


def download(url: str, dest: Path) -> None:
    r = requests.get(url, stream=True, timeout=180)
    r.raise_for_status()
    with dest.open("wb") as f:
        for chunk in r.iter_content(chunk_size=8192):
            if chunk:
                f.write(chunk)


# ---------------------------------------------------------------------------
# Helpers CLI
# ---------------------------------------------------------------------------

def safe_filename(prompt: str, n: int = 30) -> str:
    keep = "".join(c for c in prompt[:n] if c.isalnum() or c in " -_")
    return keep.strip().replace(" ", "_") or "anim"


def generate_one(image_path: Path, prompt: str, quality: str,
                 out_dir: Path, leonardo_key: str,
                 anthropic_key: Optional[str], validate: bool,
                 strict: bool, label: str = "",
                 narrative_context: Optional[str] = None) -> dict:
    """
    Pipeline : (validate) → upload → trigger → poll → download.
    Renvoie dict avec status / cost / file / validation.
    """
    result = {"label": label, "image": str(image_path),
              "prompt": prompt, "quality": quality,
              "validation": None, "status": "skipped",
              "cost": 0, "file": None, "generation_id": None}

    if validate:
        if not anthropic_key:
            print("  ! ANTHROPIC_API_KEY manquante, validation sautée.")
        else:
            print("  Validation Claude Haiku (faisabilité + couverture narrative)...")
            v = validate_prompt(image_path, prompt, anthropic_key,
                                narrative_context=narrative_context)
            print_validation(v)
            result["validation"] = v
            if v.get("verdict") == "FAIL" and strict:
                result["status"] = "blocked_by_validation"
                return result

    print(f"  [1/4] Upload : {image_path.name}")
    image_id = upload_image(image_path, leonardo_key)

    estimate = ESTIMATED_COST[quality]
    print(f"  [2/4] Motion 2.0 {quality} (~{estimate} cr)")
    gen_id, real_cost = trigger_motion(leonardo_key, image_id, prompt, quality)
    print(f"        generationId : {gen_id}"
          + (f"  ({real_cost} cr)" if real_cost else ""))

    print(f"  [3/4] Polling...")
    gen = poll_generation(leonardo_key, gen_id)
    video_url = extract_video_url(gen)
    if not video_url:
        result["status"] = "no_video_url"
        return result

    out_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    name = f"{ts}_{label or safe_filename(prompt)}_{quality}.mp4"
    dest = out_dir / name
    print(f"  [4/4] Download : {dest.name}")
    download(video_url, dest)

    result["status"] = "ok"
    result["cost"] = real_cost or estimate
    result["file"] = str(dest)
    result["generation_id"] = gen_id
    return result


# ---------------------------------------------------------------------------
# Sous-commandes
# ---------------------------------------------------------------------------

def cmd_status(ledger: dict) -> int:
    print(f"Budget    : {ledger['budget']} crédits")
    print(f"Dépensé   : {ledger['spent']}")
    print(f"Restant   : {remaining(ledger)}")
    if ledger["history"]:
        print("\n5 dernières générations :")
        for h in ledger["history"][-5:]:
            print(f"  {h['ts']}  {h['quality']:>5}  -{h['cost']:>3} cr  "
                  f"{h.get('label') or h.get('prompt', '')[:50]}")
    return 0


def cmd_animate(args, ledger: dict) -> int:
    if not args.api_key:
        print("ERREUR : LEONARDO_API_KEY manquant.", file=sys.stderr)
        return 2
    img = Path(args.image).expanduser().resolve()
    if not img.exists():
        print(f"ERREUR : image introuvable : {img}", file=sys.stderr)
        return 4
    if ESTIMATED_COST[args.quality] > remaining(ledger):
        print(f"ERREUR : budget insuffisant ({remaining(ledger)} restants).",
              file=sys.stderr)
        return 3

    if args.validate_only:
        if not args.anthropic_key:
            print("ERREUR : ANTHROPIC_API_KEY requis pour --validate-only.",
                  file=sys.stderr)
            return 2
        print(f"Validation : {img.name}")
        v = validate_prompt(img, args.prompt, args.anthropic_key)
        print_validation(v)
        return 0 if v.get("verdict") in ("PASS", "WARN") else 1

    out_dir = Path(args.out).expanduser().resolve()
    res = generate_one(
        img, args.prompt, args.quality, out_dir,
        args.api_key, args.anthropic_key,
        args.validate, args.strict, label=safe_filename(args.prompt))

    if res["status"] == "ok":
        ledger["spent"] += res["cost"]
        ledger["history"].append({
            "ts": datetime.now().strftime("%Y%m%d-%H%M%S"),
            "label": safe_filename(args.prompt),
            "prompt": args.prompt,
            "quality": args.quality,
            "cost": res["cost"],
            "file": res["file"],
            "generation_id": res["generation_id"],
        })
        save_ledger(ledger)
        print(f"\nOK. -{res['cost']} cr | {ledger['spent']}/{ledger['budget']} "
              f"| restant {remaining(ledger)}")
        return 0
    print(f"\nÉchec : {res['status']}", file=sys.stderr)
    return 5


def cmd_batch(args, ledger: dict) -> int:
    if not args.api_key:
        print("ERREUR : LEONARDO_API_KEY manquant.", file=sys.stderr)
        return 2
    json_path = Path(args.batch).expanduser().resolve()
    if not json_path.exists():
        print(f"ERREUR : JSON introuvable : {json_path}", file=sys.stderr)
        return 4

    # Auto-détection du dossier d'assets si non précisé : on cherche un nombre
    # dans le nom du JSON (scenar_chap4_json.txt → assets/chapitre_4/).
    if args.assets is None:
        m = re.search(r"chap(?:itre)?[_-]?(\d+)", json_path.name)
        if m:
            args.assets = f"assets/chapitre_{m.group(1)}"
            print(f"INFO : --assets auto-détecté = {args.assets} (depuis {json_path.name})")
        else:
            args.assets = "assets/chapitre_3"  # fallback historique
            print(f"WARN : --assets non précisé et nom JSON non parsable → défaut {args.assets}")
    assets_dir = Path(args.assets).expanduser().resolve()
    if not assets_dir.exists():
        print(f"ERREUR : dossier assets introuvable : {assets_dir}", file=sys.stderr)
        return 4

    scenario = json.loads(json_path.read_text(encoding="utf-8"))
    only = set(int(x) for x in args.only.split(",")) if args.only else None

    jobs = []
    for t in scenario:
        if t.get("format") != "video":
            continue
        if only and t["tableau"] not in only:
            continue
        if "prompt_animation" not in t:
            print(f"  T{t['tableau']} : pas de prompt_animation, ignoré.")
            continue
        img_candidates = [
            assets_dir / f"t{t['tableau']}_bg.jpg",
            assets_dir / f"t{t['tableau']}_bg.png",
        ]
        img = next((p for p in img_candidates if p.exists()), None)
        if not img:
            print(f"  T{t['tableau']} : image introuvable dans {assets_dir}")
            continue
        # Contexte narratif pour le validateur : narrateur + dialogue Léon.
        narrative = ""
        if t.get("narrateur"):
            narrative += f"Narrator: {t['narrateur']}\n"
        if t.get("leon"):
            narrative += f"Léon dialogue: {t['leon']}"
        jobs.append((t["tableau"], img, t["prompt_animation"], narrative.strip() or None))

    if not jobs:
        print("Aucun job à traiter.")
        return 0

    total_estimate = ESTIMATED_COST[args.quality] * len(jobs)
    print(f"\n=== BATCH : {len(jobs)} job(s), ~{total_estimate} cr estimés "
          f"(restant : {remaining(ledger)}) ===\n")
    if total_estimate > remaining(ledger):
        print(f"ERREUR : budget insuffisant pour le batch entier.",
              file=sys.stderr)
        return 3

    # Mode validate-only : on passe juste tout par Claude Haiku, zéro Leonardo.
    if args.validate_only:
        if not args.anthropic_key:
            print("ERREUR : ANTHROPIC_API_KEY requis pour --validate-only.",
                  file=sys.stderr)
            return 2
        verdicts = []
        for tab, img, prompt, narrative in jobs:
            print(f"T{tab} | {img.name}")
            v = validate_prompt(img, prompt, args.anthropic_key,
                                narrative_context=narrative)
            print_validation(v)
            verdicts.append((tab, v))
            print()
        n_pass = sum(1 for _, v in verdicts if v.get("verdict") == "PASS")
        n_warn = sum(1 for _, v in verdicts if v.get("verdict") == "WARN")
        n_fail = sum(1 for _, v in verdicts if v.get("verdict") == "FAIL")
        print(f"=== Récap : {n_pass} PASS, {n_warn} WARN, {n_fail} FAIL ===")
        return 0 if n_fail == 0 else 1

    out_dir = Path(args.out).expanduser().resolve()
    summary = []
    for tab, img, prompt, narrative in jobs:
        print(f"\n--- T{tab} | {img.name} ---")
        try:
            res = generate_one(img, prompt, args.quality, out_dir,
                               args.api_key, args.anthropic_key,
                               args.validate, args.strict, label=f"T{tab}",
                               narrative_context=narrative)
        except Exception as e:
            print(f"  ERREUR : {e}", file=sys.stderr)
            res = {"label": f"T{tab}", "status": "exception", "cost": 0,
                   "error": str(e)}
        summary.append((tab, res))
        if res.get("status") == "ok":
            ledger["spent"] += res["cost"]
            ledger["history"].append({
                "ts": datetime.now().strftime("%Y%m%d-%H%M%S"),
                "label": f"T{tab}",
                "prompt": prompt,
                "quality": args.quality,
                "cost": res["cost"],
                "file": res["file"],
                "generation_id": res["generation_id"],
            })
            save_ledger(ledger)
            if args.install and res.get("file"):
                # Auto : si --install-dir non précisé, on prend le même dossier
                # que --assets (= assets/chapitre_N/) pour ne PAS écraser la
                # racine assets/ et mélanger les chapitres.
                install_dir_path = args.install_dir if args.install_dir else args.assets
                install_dir = Path(install_dir_path).expanduser().resolve()
                install_dir.mkdir(parents=True, exist_ok=True)
                dst = install_dir / f"t{tab}_bg.mp4"
                try:
                    shutil.copy2(res["file"], dst)
                    print(f"  Installe : {dst}")
                except Exception as e:
                    print(f"  WARN install : {e}")

    print(f"\n=== Résumé batch ===")
    for tab, res in summary:
        print(f"  T{tab}: {res.get('status')}  -{res.get('cost', 0)} cr  "
              f"{res.get('file') or res.get('error', '')}")
    print(f"\nDépensé total : {ledger['spent']}/{ledger['budget']} "
          f"| restant : {remaining(ledger)}")
    return 0


# ---------------------------------------------------------------------------
# Main / parsing args
# ---------------------------------------------------------------------------

def main() -> int:
    p = argparse.ArgumentParser(
        description="Animer une image (ou un batch d'images) avec Leonardo "
                    "Motion 2.0, en validant chaque prompt par Claude Haiku.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument("--image", help="Image source (mode single).")
    p.add_argument("--prompt", help="Prompt d'animation (mode single).")
    p.add_argument("--batch", help="Chemin vers le JSON scénario "
                                   "(ex: scenar_chap3_json.txt).")
    p.add_argument("--assets", default=None,
                   help="Dossier des images (mode batch). Si omis, auto-détecté "
                        "depuis le nom du JSON : scenar_chapN_* → assets/chapitre_N/. "
                        "Cherche tN_bg.jpg ou tN_bg.png.")
    p.add_argument("--only", help="Filtre tableaux (ex: 1,3,5).")

    p.add_argument("--quality", choices=["480p", "720p"], default="480p")
    p.add_argument("--out", default=str(SCRIPT_DIR / "animations"))
    p.add_argument("--timeout", type=int, default=900)
    p.add_argument("--no-interp", action="store_true")
    p.add_argument("--no-enhance", action="store_true")

    p.add_argument("--validate", action="store_true",
                   help="Valide chaque prompt par Claude Haiku avant Leonardo.")
    p.add_argument("--validate-only", action="store_true",
                   help="Valide uniquement, n'appelle PAS Leonardo (zéro crédit).")
    p.add_argument("--strict", action="store_true", default=True,
                   help="(defaut) Bloque la generation si validation = FAIL.")
    p.add_argument("--no-strict", dest="strict", action="store_false",
                   help="Continue meme si validation = FAIL.")

    p.add_argument("--api-key", default=os.environ.get("LEONARDO_API_KEY"))
    p.add_argument("--anthropic-key",
                   default=os.environ.get("ANTHROPIC_API_KEY"))

    p.add_argument("--install", action="store_true",
                   help="Apres chaque generation reussie, copie la video vers <install-dir>/tN_bg.mp4")
    p.add_argument("--install-dir", default=None,
                   help="Dossier cible du --install. Si omis : meme dossier que --assets "
                        "(donc assets/chapitre_N/ via auto-detection). Avant: defaut a assets/.")
    p.add_argument("--budget-status", action="store_true")
    p.add_argument("--reset-budget", type=int, metavar="N")

    args = p.parse_args()
    ledger = load_ledger()

    if args.reset_budget is not None:
        ledger = {"budget": args.reset_budget, "spent": 0, "history": []}
        save_ledger(ledger)
        print(f"Budget reinitialise : {args.reset_budget} credits.")
        return 0

    if args.budget_status:
        return cmd_status(ledger)

    try:
        if args.batch:
            return cmd_batch(args, ledger)
        if args.image and args.prompt:
            return cmd_animate(args, ledger)
        
        p.error("Specifie --image+--prompt OU --batch (ou --budget-status).")
    except KeyboardInterrupt:
        print("\nInterrompu.", file=sys.stderr)
        return 130
    except requests.HTTPError as e:
        print(f"HTTP {e}\n{e.response.text if e.response else ''}", file=sys.stderr)
        return 6


if __name__ == "__main__":
    sys.exit(main())
