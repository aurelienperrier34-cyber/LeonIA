# -*- coding: utf-8 -*-
"""
generate_story_audio.py
=======================
Genere la narration MP3 d'une histoire du Livre magique via Google Cloud
Text-to-Speech (Neural2/Studio/Chirp), avec le SERVICE ACCOUNT deja en place.

Output : assets/stories/<combo>/pageN.mp3  (1 fichier par page)

Voix recommandees (francais France) :
  - fr-FR-Neural2-A : F, chaleureuse, posee     (default - conte du soir)
  - fr-FR-Neural2-C : F, plus jeune, douce
  - fr-FR-Neural2-D : M, grave, paternel        (grand-pere conteur)
  - fr-FR-Neural2-B : M, neutre, narrateur
  - fr-FR-Studio-A  : F premium (10x plus cher)
  - fr-FR-Chirp3-HD-Aoede : F, derniere generation (qualite max)

Usage :
  python generate_story_audio.py --story dragon_chateau_guitare_fantome
  python generate_story_audio.py --story dragon_chateau_guitare_fantome --only 1,2
  python generate_story_audio.py --story dragon_chateau_guitare_fantome --voice fr-FR-Neural2-D
  python generate_story_audio.py --story dragon_chateau_guitare_fantome --rate 0.9 --pitch -2.0

Requiert :
  - service-account.json a la racine du projet
  - API Cloud Text-to-Speech activee sur le projet
  - pip install google-auth google-auth-httplib2 (deja installe)
"""

import argparse
import base64
import os
import re
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

from generate_story_images import STORIES

# ============================================================
# Auth : on reutilise le service account utilise pour Gemini Image
# ============================================================
_SA_FILE = Path("service-account.json")
if not _SA_FILE.exists():
    sys.exit("ERREUR : service-account.json introuvable a la racine du projet")

try:
    from google.oauth2 import service_account as _sa
    from google.auth.transport.requests import Request as _AuthRequest
    import json as _json
except ImportError:
    sys.exit("ERREUR : pip install google-auth google-auth-httplib2")

_SCOPES = ["https://www.googleapis.com/auth/cloud-platform"]
_SA_CREDS = _sa.Credentials.from_service_account_file(str(_SA_FILE), scopes=_SCOPES)
_SA_PROJECT = _json.loads(_SA_FILE.read_text(encoding="utf-8")).get("project_id")
print(f"[auth] Service Account (project={_SA_PROJECT})")


def _get_token():
    if _SA_CREDS.expired or not _SA_CREDS.token:
        _SA_CREDS.refresh(_AuthRequest())
    return _SA_CREDS.token


# ============================================================
# Cloud Text-to-Speech REST API
# ============================================================
TTS_URL = "https://texttospeech.googleapis.com/v1/text:synthesize"


def clean_html_for_tts(text):
    """Enleve les balises HTML (le texte des stories a des <em>, <br>...)
    et normalise pour TTS."""
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    # Decode quelques entites HTML communes
    text = text.replace("&nbsp;", " ").replace("&amp;", "&")
    text = text.replace("&lt;", "<").replace("&gt;", ">")
    # Compresse espaces multiples
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def synthesize_page(text, dest_path, voice="fr-FR-Neural2-A",
                    speaking_rate=0.95, pitch=0.0, audio_encoding="MP3"):
    """Synthese vocale pour le texte d'une page. Sauvegarde en MP3."""
    payload = {
        "input": {"text": text},
        "voice": {
            "languageCode": "fr-FR",
            "name": voice,
        },
        "audioConfig": {
            "audioEncoding": audio_encoding,  # MP3 ou OGG_OPUS
            "speakingRate": speaking_rate,    # 0.25 - 4.0 (1.0 = normal)
            "pitch": pitch,                   # -20 a +20 (0 = normal)
            "effectsProfileId": ["small-bluetooth-speaker-class-device"],
        },
    }
    headers = {"Authorization": f"Bearer {_get_token()}",
               "Content-Type": "application/json"}
    r = requests.post(TTS_URL, json=payload, headers=headers, timeout=120)
    if r.status_code != 200:
        print(f"  ERREUR {r.status_code}: {r.text[:300]}")
        return False
    try:
        audio_b64 = r.json()["audioContent"]
    except KeyError:
        print(f"  Reponse inattendue : {r.text[:300]}")
        return False
    audio_bytes = base64.standard_b64decode(audio_b64)
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    dest_path.write_bytes(audio_bytes)
    return True


# ============================================================
# Main
# ============================================================
def main():
    p = argparse.ArgumentParser()
    p.add_argument("--story", required=True,
                   help="Combo (ex: dragon_chateau_guitare_fantome)")
    p.add_argument("--only", help="Filtre pages (ex: 1 ou 1,3,5)")
    p.add_argument("--voice", default="fr-FR-Studio-A",
                   help="Voice ID Google TTS (defaut: fr-FR-Studio-A premium)")
    p.add_argument("--rate", type=float, default=0.95,
                   help="Vitesse de parole (0.25-4.0, defaut 0.95 = doux pour enfants)")
    p.add_argument("--pitch", type=float, default=0.0,
                   help="Pitch -20.0 a +20.0 (defaut 0.0)")
    p.add_argument("--force", action="store_true",
                   help="Regenere meme si le MP3 existe deja")
    args = p.parse_args()

    if args.story not in STORIES:
        sys.exit(f"Histoire inconnue : {args.story}. Disponibles : {list(STORIES.keys())}")

    pages = STORIES[args.story]
    only = set(int(x) for x in args.only.split(",")) if args.only else None

    out_dir = Path("assets/stories") / args.story
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"\nGeneration audio pour '{args.story}' ({len(pages)} pages)")
    print(f"Voix : {args.voice}  | rate={args.rate}  pitch={args.pitch}")
    print(f"Output : {out_dir}/page*.mp3\n")

    # Les pages dans STORIES ont la forme {"text": "...", "image": "..."}
    success, fail, skipped = 0, 0, 0
    for idx, page in enumerate(pages, 1):
        if only and idx not in only:
            continue
        dest = out_dir / f"page{idx}.mp3"
        if dest.exists() and not args.force:
            print(f"[{idx}/{len(pages)}] page{idx}.mp3 : existe (skip, --force pour regenerer)")
            skipped += 1
            continue
        raw_text = page.get("text") if isinstance(page, dict) else page
        clean_text = clean_html_for_tts(raw_text)
        chars = len(clean_text)
        print(f"[{idx}/{len(pages)}] page{idx}.mp3 ({chars} chars)")
        ok = synthesize_page(clean_text, dest, voice=args.voice,
                             speaking_rate=args.rate, pitch=args.pitch)
        if ok:
            size_kb = dest.stat().st_size // 1024
            print(f"  OK -> {dest} ({size_kb} KB)")
            success += 1
        else:
            fail += 1

    print(f"\nBilan : {success} OK, {fail} echec(s), {skipped} skip(s)")
    if success > 0:
        # Estimation cout (Neural2 = $16/1M chars)
        total_chars = sum(
            len(clean_html_for_tts(p.get("text", "") if isinstance(p, dict) else p))
            for idx, p in enumerate(pages, 1)
            if not only or idx in only
        )
        # Studio = $160/M, Neural2/Wavenet = $16/M
        rate_per_m = 160 if "Studio" in args.voice else 16
        cost_usd = total_chars / 1_000_000 * rate_per_m
        print(f"Cout estime : ~${cost_usd:.3f} ({total_chars} chars x ${rate_per_m}/M)")


if __name__ == "__main__":
    main()
