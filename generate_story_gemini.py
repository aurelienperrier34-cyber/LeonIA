# -*- coding: utf-8 -*-
"""
generate_story_gemini.py
========================
Genere les illustrations d'une histoire du Livre magique via Gemini 2.5
Flash Image (alias "Nano Banana"), avec les portraits canon des
personnages passes comme references visuelles directes -> coherence
verrouillee de maniere native par Gemini.

Workflow par page :
  1. Lit le prompt de la page (importe depuis generate_story_images.STORIES)
  2. Charge les portraits canon (hero + villain + item par defaut)
  3. Appel Gemini Image avec [refs + prompt enrichi du canon textuel]
  4. Decode l'image base64 et l'enregistre en JPG
  5. Optionnel : --verify -> Gemini Vision check le resultat (retry max 3)

Avantages vs Leonardo :
  - Multi-ref visuelle native (jusqu'a 3-4 images en input)
  - Suivi du prompt enormement meilleur sur scenes complexes
  - Une seule cle API (GEMINI_API_KEY deja dans .env)
  - Free tier confortable (15 req/min sur gemini-2.5-flash-image)

Usage :
  python generate_story_gemini.py --story dragon_chateau_guitare_fantome
  python generate_story_gemini.py --story dragon_chateau_guitare_fantome --only 1
  python generate_story_gemini.py --story dragon_chateau_guitare_fantome --verify --force
  python generate_story_gemini.py --story dragon_chateau_guitare_fantome --refs hero,villain,item,place
"""

import argparse
import base64
import os
import sys
import time
from pathlib import Path
from dotenv import load_dotenv
import requests

# Charge .env
for candidate in [
    Path(__file__).parent / ".env",
    Path(__file__).parent.parent.parent.parent / ".env",
    Path.cwd() / ".env",
]:
    if candidate.exists():
        load_dotenv(candidate)
        print(f"[env] loaded {candidate}")
        break

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

# v510 : support service account (preferable a la cle API simple si on est
# bloque par une policy d'organisation Google Workspace). Si service-account.json
# existe a la racine du projet, on l'utilise. Sinon fallback sur la cle API.
_SA_FILE = Path("service-account.json")
_USE_SA = _SA_FILE.exists()
_SA_CREDS = None
_SA_PROJECT = None
if _USE_SA:
    try:
        from google.oauth2 import service_account as _sa
        from google.auth.transport.requests import Request as _AuthRequest
        _SCOPES = ["https://www.googleapis.com/auth/cloud-platform",
                   "https://www.googleapis.com/auth/generative-language"]
        _SA_CREDS = _sa.Credentials.from_service_account_file(
            str(_SA_FILE), scopes=_SCOPES)
        # Recupere project_id depuis le JSON
        import json as _json
        _SA_PROJECT = _json.loads(_SA_FILE.read_text(encoding="utf-8")).get("project_id")
        print(f"[auth] Service Account detecte (project={_SA_PROJECT})")
    except ImportError:
        print("[auth] google-auth manquant. Installe : pip install google-auth google-auth-httplib2")
        _USE_SA = False
    except Exception as e:
        print(f"[auth] Erreur chargement service account : {e}")
        _USE_SA = False

if not _USE_SA and not GEMINI_API_KEY:
    sys.exit("ERREUR : ni service-account.json ni GEMINI_API_KEY dispo")


def _get_auth_token():
    """Retourne un access token frais depuis le service account."""
    if _SA_CREDS.expired or not _SA_CREDS.token:
        _SA_CREDS.refresh(_AuthRequest())
    return _SA_CREDS.token


def _api_call(url_tpl, model, payload, timeout=120):
    """Wrapper requests.post qui ajoute auth SA ou ?key=API_KEY selon dispo."""
    url = url_tpl.format(model=model)
    if _USE_SA:
        headers = {"Authorization": f"Bearer {_get_auth_token()}",
                   "Content-Type": "application/json"}
        return requests.post(url, json=payload, headers=headers, timeout=timeout)
    else:
        return requests.post(f"{url}?key={GEMINI_API_KEY}", json=payload, timeout=timeout)

# On reutilise tout l'ecosysteme deja construit pour Leonardo
from item_canon import ITEM_CANON, get_canon_for_combo, STORY_STYLE
from generate_story_images import STORIES
try:
    from verify_story_image import verify_image, auto_portraits
    _HAS_VERIFIER = True
except Exception as _e:
    print(f"[verify] module verifier indisponible : {_e}")
    _HAS_VERIFIER = False

# ============================================================
# Modeles Gemini Image (Nano Banana) - tente dans l'ordre
# ============================================================
GEMINI_IMAGE_MODELS = [
    "gemini-2.5-flash-image",
    "gemini-2.5-flash-image-preview",
    "gemini-2.0-flash-preview-image-generation",
    "gemini-2.0-flash-exp",
]
API_URL_TPL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"


# ============================================================
# Helpers
# ============================================================
def _b64(p):
    return base64.standard_b64encode(Path(p).read_bytes()).decode("utf-8")


def _mime(p):
    ext = Path(p).suffix.lower().lstrip(".")
    return {"jpg": "image/jpeg", "jpeg": "image/jpeg",
            "png": "image/png", "webp": "image/webp"}.get(ext, "image/jpeg")


def collect_ref_portraits(hero, place, item, villain, ref_roles):
    """
    Recupere les chemins des portraits canon pour les roles demandes.
    Renvoie un dict {label_descriptif: Path}.
    """
    role_to_val = {"hero": hero, "place": place, "item": item, "villain": villain}
    refs = {}
    for role in ref_roles:
        val = role_to_val.get(role)
        if not val:
            continue
        p = Path("assets/items") / f"{role}_{val}.jpg"
        if not p.exists():
            print(f"  [refs] WARN {p} introuvable - skip {role}")
            continue
        # Label lisible : "hero (Brio the dragon)"
        canon_data = ITEM_CANON.get(role, {}).get(val, {})
        name = canon_data.get("name", val)
        label = f"{role} ({name})"
        refs[label] = p
    return refs


# ============================================================
# Generation via Gemini Image
# ============================================================
def gen_image_gemini(prompt, dest_path, ref_images=None,
                     model=None, extra_instruction=""):
    """
    Appelle Gemini Image avec un prompt + N images de reference.
    ref_images : dict {label: Path}
    Renvoie True/False.
    """
    parts = []

    # 1. Description des refs en amont pour que Gemini sache leur role
    if ref_images:
        intro = (
            "I am giving you canonical character/object references for an "
            "illustration. You MUST keep these characters/objects EXACTLY "
            "as shown in the reference images (same colors, same proportions, "
            "same expressions, same distinctive features). Only the scene "
            "and the pose may change. Do not redesign them.\n\n"
        )
        parts.append({"text": intro})
        for label, p in ref_images.items():
            parts.append({"text": f"\n-- Reference: this is the canonical {label} --"})
            parts.append({"inline_data": {"mime_type": _mime(p), "data": _b64(p)}})

    # 2. Le prompt principal de la scene
    full_text = "\nNow generate ONE illustration matching this description:\n\n" + prompt
    if extra_instruction:
        full_text += "\n\nADDITIONAL CONSTRAINTS:\n" + extra_instruction
    parts.append({"text": full_text})

    payload = {
        "contents": [{"parts": parts}],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
            "temperature": 0.5,
        },
    }

    models_to_try = [model] if model else GEMINI_IMAGE_MODELS
    last_err = None
    for mdl in models_to_try:
        print(f"  Gemini {mdl} -> {dest_path.name}")
        try:
            r = _api_call(API_URL_TPL, mdl, payload, timeout=180)
        except requests.exceptions.Timeout:
            print(f"    timeout, on essaie modele suivant")
            last_err = "timeout"
            continue
        if r.status_code == 404:
            last_err = f"404 {mdl}"
            continue
        if r.status_code == 429:
            # Quota depassee sur CE modele : tente le suivant
            last_err = f"429 quota {mdl}"
            print(f"    QUOTA 429 sur {mdl}, body:")
            print(f"    {r.text[:600]}")
            print(f"    on essaie modele suivant...")
            continue
        if r.status_code == 403:
            # Probleme d'autorisation (API non activee, role insuffisant...)
            print(f"    FORBIDDEN 403 sur {mdl}, body:")
            print(f"    {r.text[:600]}")
            return False
        if r.status_code >= 400:
            print(f"    ERREUR {r.status_code}: {r.text[:400]}")
            return False
        rj = r.json()

        # Extrait l'image dans la reponse
        try:
            cand = rj.get("candidates", [{}])[0]
            content = cand.get("content", {})
            for part in content.get("parts", []):
                # Gemini retourne soit "inlineData" soit "inline_data"
                data = part.get("inlineData") or part.get("inline_data")
                if data and data.get("data"):
                    img_bytes = base64.standard_b64decode(data["data"])
                    dest_path.parent.mkdir(parents=True, exist_ok=True)
                    dest_path.write_bytes(img_bytes)
                    print(f"    OK -> {dest_path} ({mdl}, {len(img_bytes)//1024} KB)")
                    return True
            # Pas d'image trouvee : log la reponse
            text_parts = [p.get("text", "") for p in content.get("parts", [])]
            print(f"    Pas d'image dans la reponse. Texte recu: "
                  f"{' | '.join(text_parts)[:300]}")
            # Si le modele a refuse pour cause de safety, log explicite
            if cand.get("finishReason") == "IMAGE_SAFETY":
                print(f"    REFUS Gemini safety filter (IMAGE_SAFETY)")
                return False
            if cand.get("finishReason") == "SAFETY":
                print(f"    REFUS Gemini safety filter (SAFETY)")
                return False
            return False
        except Exception as e:
            print(f"    Parsing reponse: {e} -> {str(rj)[:400]}")
            return False
    print(f"  Aucun modele Gemini Image dispo (dernier: {last_err})")
    return False


# ============================================================
# Main
# ============================================================
def main():
    p = argparse.ArgumentParser()
    p.add_argument("--story", required=True,
                   help="Combo (ex: dragon_chateau_guitare_fantome)")
    p.add_argument("--only", help="Filtre pages (ex: 1 ou 1,3,5)")
    p.add_argument("--model", help="Forcer un modele Gemini precis "
                                     "(defaut: cascade gemini-2.5-flash-image puis fallback)")
    p.add_argument("--refs", default="hero,villain,item",
                   help="Roles a passer comme refs visuelles (defaut: hero,villain,item)")
    p.add_argument("--force", action="store_true",
                   help="Regenere meme si la page existe deja")
    p.add_argument("--verify", action="store_true",
                   help="Active la validation Gemini Vision apres chaque generation")
    p.add_argument("--max-retries", type=int, default=3,
                   help="Max tentatives par page si verify echoue (defaut 3)")
    p.add_argument("--lax", action="store_true",
                   help="Mode laxe : ok=true si kid_safe seulement (ignore drift)")
    args = p.parse_args()

    if args.story not in STORIES:
        sys.exit(f"Histoire inconnue : {args.story}. Disponibles : {list(STORIES.keys())}")

    prompts = STORIES[args.story]
    only = set(int(x) for x in args.only.split(",")) if args.only else None
    ref_roles = [r.strip() for r in args.refs.split(",") if r.strip()]

    # Decompose la cle hero_place_item_villain
    parts = args.story.split("_")
    if len(parts) == 5 and parts[0] in ("courte", "soir", "aventure"):
        hero, place, item, villain = parts[1:]
    elif len(parts) == 4:
        hero, place, item, villain = parts
    else:
        sys.exit(f"Impossible de decomposer '{args.story}' en (hero,place,item,villain)")

    # Construit la liste des portraits a passer en reference
    ref_images = collect_ref_portraits(hero, place, item, villain, ref_roles)
    canon_prefix = get_canon_for_combo(hero, place, item, villain)

    print(f"\n[canon] Decompose : hero={hero}, place={place}, item={item}, villain={villain}")
    print(f"[refs]  Portraits passes a Gemini : {list(ref_images.keys())}")
    if not ref_images:
        print("[refs]  AUCUN portrait trouve - genere d'abord generate_item_portraits.py")

    out_dir = Path("assets/stories") / args.story
    out_dir.mkdir(parents=True, exist_ok=True)
    print(f"\nGeneration de {len(prompts)} illustrations pour '{args.story}'")
    print(f"Output : {out_dir}/")
    print(f"Verify : {'ON' if args.verify and _HAS_VERIFIER else 'OFF'}\n")

    verify_portraits = None
    if args.verify and _HAS_VERIFIER and hero:
        verify_portraits = auto_portraits(hero, place, item, villain)

    success, fail, skipped, retried = 0, 0, 0, 0
    for idx, raw_prompt in enumerate(prompts, 1):
        if only and idx not in only:
            continue
        dest = out_dir / f"page{idx}.jpg"
        if dest.exists() and not args.force:
            print(f"[{idx}/{len(prompts)}] page{idx}.jpg : existe (skip, --force pour regenerer)")
            skipped += 1
            continue

        # STORY_STYLE + CANON textuel + page-specific
        full_prompt = STORY_STYLE + canon_prefix + raw_prompt
        print(f"\n[{idx}/{len(prompts)}] page{idx}.jpg")

        attempt = 0
        page_ok = False
        extra_instruction = ""
        max_tries = args.max_retries if args.verify and _HAS_VERIFIER else 1
        while attempt < max_tries:
            attempt += 1
            if attempt > 1:
                print(f"  --- TENTATIVE {attempt}/{max_tries} ---")
                if dest.exists():
                    dest.unlink()
            ok = gen_image_gemini(full_prompt, dest, ref_images=ref_images,
                                   model=args.model,
                                   extra_instruction=extra_instruction)
            if not ok:
                print(f"  Generation echec (tentative {attempt})")
                # Petit delai avant retry pour eviter rate-limit
                time.sleep(2)
                continue

            if not args.verify or not _HAS_VERIFIER:
                page_ok = True
                break

            print(f"  [verify] Gemini Vision...")
            vr = verify_image(dest, hero=hero, place=place,
                              item=item, villain=villain,
                              prompt=raw_prompt,
                              portrait_paths=verify_portraits,
                              strict=not args.lax)
            if vr.get("skipped") or vr.get("ok"):
                if vr.get("skipped"):
                    print(f"  [verify] skipped: {vr.get('reason')}")
                else:
                    print(f"  [verify] OK -> canon:{vr.get('matches_canon')} "
                          f"prompt:{vr.get('matches_prompt')} kid_safe:{vr.get('kid_safe')}")
                page_ok = True
                break
            if vr.get("error"):
                print(f"  [verify] ERREUR: {vr['error']} (on garde l'image)")
                page_ok = True
                break
            issues = vr.get("issues", [])
            print(f"  [verify] KO ({len(issues)} probleme(s)) :")
            for iss in issues:
                print(f"          - {iss}")
            # Pour Gemini, on enrichit comme INSTRUCTION (pas negative_prompt)
            extra_instruction = "Fix these issues from the previous attempt: " + \
                                "; ".join(issues[:8])
            if len(extra_instruction) > 800:
                extra_instruction = extra_instruction[:800]
            retried += 1
            time.sleep(2)

        if page_ok:
            success += 1
        else:
            print(f"  [{idx}] ECHEC apres {max_tries} tentatives - log pour review manuelle")
            fail += 1

    print(f"\nBilan : {success} OK, {fail} echec(s), {skipped} skip(s), {retried} retry(s)")


if __name__ == "__main__":
    main()
