# -*- coding: utf-8 -*-
"""
verify_story_image.py
=====================
Validateur d'image generee via Gemini Vision (gemini-1.5-flash, gratuit).

Compare une image generee a :
  - le portrait canonique du heros (et villain) -> coherence visuelle
  - le prompt de la page -> respect du contenu
  - une checklist anti-effrayant pour enfants 5-9 ans

Retourne un JSON structure :
  {
    "ok": bool,
    "matches_canon": bool,
    "matches_prompt": bool,
    "kid_safe": bool,
    "issues": ["dragon has grey hair instead of blue scales", ...],
    "extra_negative": "long hair, grey scales, beard on dragon"
  }

Usage standalone :
  python verify_story_image.py assets/stories/.../page1.jpg --hero dragon --villain fantome
  python verify_story_image.py img.jpg --hero dragon --prompt "Brio in castle"

Usage comme module :
  from verify_story_image import verify_image
  result = verify_image(img_path, hero='dragon', villain='fantome',
                        prompt="...", strict=True)
"""

import argparse
import base64
import json
import os
import sys
from pathlib import Path
from dotenv import load_dotenv
import requests

from item_canon import ITEM_CANON

# Charge .env
for candidate in [
    Path(__file__).parent / ".env",
    Path(__file__).parent.parent.parent.parent / ".env",
    Path.cwd() / ".env",
]:
    if candidate.exists():
        load_dotenv(candidate)
        break

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
# Modeles tentes dans l'ordre (le 1er dispo gagne).
GEMINI_MODELS = [
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-2.5-flash-lite",
    "gemini-flash-latest",
]
GEMINI_MODEL = os.getenv("GEMINI_MODEL", GEMINI_MODELS[0])
GEMINI_URL_TPL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "{model}:generateContent"
)

# v510 : support service account (priorite sur cle API)
_SA_FILE = Path("service-account.json")
_USE_SA = _SA_FILE.exists()
_SA_CREDS = None
if _USE_SA:
    try:
        from google.oauth2 import service_account as _sa
        from google.auth.transport.requests import Request as _AuthRequest
        _SCOPES = ["https://www.googleapis.com/auth/cloud-platform",
                   "https://www.googleapis.com/auth/generative-language"]
        _SA_CREDS = _sa.Credentials.from_service_account_file(
            str(_SA_FILE), scopes=_SCOPES)
        print(f"[verify auth] Service Account detecte")
    except ImportError:
        print("[verify auth] google-auth manquant : pip install google-auth google-auth-httplib2")
        _USE_SA = False
    except Exception as e:
        print(f"[verify auth] Erreur SA : {e}")
        _USE_SA = False


def _auth_headers():
    if not _USE_SA:
        return None
    if _SA_CREDS.expired or not _SA_CREDS.token:
        _SA_CREDS.refresh(_AuthRequest())
    return {"Authorization": f"Bearer {_SA_CREDS.token}",
            "Content-Type": "application/json"}


def _call(url, payload, timeout=60):
    if _USE_SA:
        return requests.post(url, json=payload, headers=_auth_headers(), timeout=timeout)
    return requests.post(f"{url}?key={GEMINI_API_KEY}", json=payload, timeout=timeout)


def _b64(image_path: Path) -> str:
    return base64.standard_b64encode(image_path.read_bytes()).decode("utf-8")


def _mime(image_path: Path) -> str:
    ext = image_path.suffix.lower().lstrip(".")
    return {"jpg": "image/jpeg", "jpeg": "image/jpeg",
            "png": "image/png", "webp": "image/webp"}.get(ext, "image/jpeg")


def verify_image(image_path, hero=None, place=None, item=None, villain=None,
                 prompt="", portrait_paths=None, strict=True):
    """
    Verifie une image via Gemini Vision.

    image_path : Path | str -> image generee a verifier
    hero/place/item/villain : keys du ITEM_CANON (ex: 'dragon')
    prompt : prompt original de la page (pour verif contenu)
    portrait_paths : dict optionnel {role: Path} pour passer aussi les
                    portraits canon a Gemini en comparaison directe
                    ex: {'hero': Path('assets/items/hero_dragon.jpg'),
                         'villain': Path('assets/items/villain_fantome.jpg')}

    Retourne un dict (voir docstring du fichier).
    """
    if not GEMINI_API_KEY and not _USE_SA:
        return {"ok": True, "skipped": True,
                "reason": "Ni service-account.json ni GEMINI_API_KEY dispo"}

    image_path = Path(image_path)
    if not image_path.exists():
        return {"ok": False, "error": f"Image introuvable: {image_path}"}

    # Construit les descriptions canoniques
    canon_lines = []
    for role, key in [("hero", hero), ("place", place),
                       ("item", item), ("villain", villain)]:
        if key and key in ITEM_CANON[role]:
            data = ITEM_CANON[role][key]
            canon_lines.append(f"- {role.upper()} ({data.get('name', key)}): {data['canon'].strip()}")

    canon_block = "\n".join(canon_lines) if canon_lines else "(no canon provided)"

    instruction = f"""You are a quality controller for a children's picture book (ages 5-9).

I will give you a generated illustration. You must check:

1. CHARACTER CONSISTENCY: each character must match its canonical description EXACTLY (colors, age, distinguishing features). List any differences.

2. CONTENT MATCH: does the image illustrate the scene described in the page prompt?

3. KID-SAFETY: is this image appropriate for a 5-9 year old? Specifically reject if you see:
   - Scary or threatening faces (sharp fangs, glowing red eyes, demonic expressions)
   - Disturbing or horror atmosphere
   - Blood, gore, weapons
   - Anything that could cause nightmares

CANONICAL CHARACTERS THAT MUST APPEAR:
{canon_block}

PAGE PROMPT (describes the scene):
"{prompt[:1000]}"

You MUST reply with ONLY a JSON object (no markdown, no commentary), in this exact format:
{{
  "matches_canon": true/false,
  "matches_prompt": true/false,
  "kid_safe": true/false,
  "issues": ["specific issue 1", "specific issue 2", ...],
  "extra_negative": "comma-separated terms to add to negative prompt for retry, focused on visible problems (ex: 'grey hair, long beard, dark atmosphere')"
}}
"""

    parts = [{"text": instruction}]
    # Ajoute l'image a verifier
    parts.append({"inline_data": {"mime_type": _mime(image_path),
                                    "data": _b64(image_path)}})
    # Ajoute les portraits canon comme reference visuelle
    if portrait_paths:
        for role, pp in portrait_paths.items():
            pp = Path(pp)
            if pp.exists():
                parts.append({"text": f"\nReference portrait for {role}:"})
                parts.append({"inline_data": {"mime_type": _mime(pp),
                                                "data": _b64(pp)}})

    payload = {
        "contents": [{"parts": parts}],
        "generationConfig": {
            "temperature": 0.1,
            "response_mime_type": "application/json",
        },
    }

    # On essaie le modele courant, puis fallback sur la liste si 404
    models_to_try = [GEMINI_MODEL] + [m for m in GEMINI_MODELS if m != GEMINI_MODEL]
    last_err = None
    rj = None
    for mdl in models_to_try:
        url = GEMINI_URL_TPL.format(model=mdl)
        try:
            r = _call(url, payload, timeout=60)
            if r.status_code == 404:
                last_err = f"404 {mdl}"
                continue  # essaie le suivant
            if r.status_code >= 400:
                return {"ok": False,
                        "error": f"Gemini {mdl} HTTP {r.status_code}: {r.text[:300]}"}
            rj = r.json()
            if mdl != GEMINI_MODEL:
                print(f"[verify] fallback model utilise: {mdl}")
            break
        except Exception as e:
            last_err = str(e)
            continue
    if rj is None:
        return {"ok": False,
                "error": f"Aucun modele Gemini dispo (dernier essai: {last_err}). "
                         f"Modeles tentes: {models_to_try}"}
    try:
        text = rj["candidates"][0]["content"]["parts"][0]["text"]
        result = json.loads(text)
    except Exception as e:
        return {"ok": False, "error": f"Parsing reponse Gemini: {e} -> {str(rj)[:400]}"}

    # Synthese
    if strict:
        result["ok"] = bool(result.get("matches_canon") and
                            result.get("matches_prompt") and
                            result.get("kid_safe"))
    else:
        # En mode laxe, on accepte tant que c'est kid_safe
        result["ok"] = bool(result.get("kid_safe"))
    return result


def auto_portraits(hero, place, item, villain):
    """Retourne le dict portrait_paths attendu par verify_image."""
    paths = {}
    for role, key in [("hero", hero), ("place", place),
                       ("item", item), ("villain", villain)]:
        if not key:
            continue
        p = Path(f"assets/items/{role}_{key}.jpg")
        if p.exists():
            paths[role] = p
    return paths


def main():
    p = argparse.ArgumentParser()
    p.add_argument("image", help="Chemin de l'image a verifier")
    p.add_argument("--hero", help="value du heros (ex: dragon)")
    p.add_argument("--place", help="value du lieu")
    p.add_argument("--item", help="value de l'objet")
    p.add_argument("--villain", help="value du defi")
    p.add_argument("--prompt", default="", help="Prompt de la page")
    p.add_argument("--no-portraits", action="store_true",
                   help="Ne pas passer les portraits canon en reference visuelle")
    p.add_argument("--lax", action="store_true",
                   help="Mode laxe : ok=true si kid_safe seulement")
    args = p.parse_args()

    portraits = None if args.no_portraits else auto_portraits(
        args.hero, args.place, args.item, args.villain)
    if portraits:
        print(f"[verify] Portraits canon utilises: {list(portraits.keys())}")

    result = verify_image(args.image,
                          hero=args.hero, place=args.place,
                          item=args.item, villain=args.villain,
                          prompt=args.prompt,
                          portrait_paths=portraits,
                          strict=not args.lax)

    print(json.dumps(result, indent=2, ensure_ascii=False))
    if not result.get("ok"):
        sys.exit(1)


if __name__ == "__main__":
    main()
