# -*- coding: utf-8 -*-
"""
generate_story_text.py
======================
Genere le TEXTE d'une story du Livre magique via Gemini 2.5 Pro sur
Vertex AI. Utilise le service account.

Pour chaque combo+niveau, ecrit une story.json contenant :
  - title
  - pages: [{text, image_prompt}]

Style :
  - Conte pour enfants 5-9 ans
  - Qualite Roald Dahl / Tomi Ungerer (poetique, captivant, jamais bebe)
  - Personnages noms canon (Brio le dragon, Maitre Otho, etc.)
  - Page = paragraphe richement decrit + prompt d'image specifique

Usage :
  python generate_story_text.py --key courte_dragon_chateau_guitare_fantome
  python generate_story_text.py --key soir_astronaute_planete_baguette_robot --force
"""

import argparse
import json
import sys
import re
from pathlib import Path
from dotenv import load_dotenv
import requests

# Charge .env
for c in [Path(__file__).parent / ".env", Path.cwd() / ".env"]:
    if c.exists():
        load_dotenv(c)
        break

from item_canon import ITEM_CANON
from stories_db import (parse_key, save_story, story_exists,
                        LEVEL_PAGES, story_path)

# Auth via service account (lazy : initialise au 1er appel)
_SA_FILE = Path("service-account.json")
_SA_CREDS = None
_SA_PROJECT = None


def _init_sa():
    global _SA_CREDS, _SA_PROJECT
    if _SA_CREDS is not None:
        return
    _SCOPES = ["https://www.googleapis.com/auth/cloud-platform"]
    from google.oauth2 import service_account as _sa
    if _SA_FILE.exists():
        _SA_CREDS = _sa.Credentials.from_service_account_file(str(_SA_FILE), scopes=_SCOPES)
        _SA_PROJECT = json.loads(_SA_FILE.read_text(encoding="utf-8"))["project_id"]
        return
    # v718 : Cloud Run -> ADC
    import google.auth as _gauth
    _SA_CREDS, _SA_PROJECT = _gauth.default(scopes=_SCOPES)
    if not _SA_PROJECT:
        import os as _os
        _SA_PROJECT = _os.getenv("GOOGLE_CLOUD_PROJECT", "livre-magique")

# Endpoint Vertex AI pour Gemini Pro text
VERTEX_REGION = "us-central1"
TEXT_MODELS = [
    "gemini-2.5-pro",       # Le meilleur pour creative writing
    "gemini-2.5-flash",     # Fallback rapide si Pro indispo / rate-limited
    "gemini-2.0-flash",
]


def _vertex_url(model):
    return (f"https://{VERTEX_REGION}-aiplatform.googleapis.com/v1/projects/"
            f"{_SA_PROJECT}/locations/{VERTEX_REGION}/publishers/google/models/"
            f"{model}:generateContent")


def _token():
    _init_sa()
    from google.auth.transport.requests import Request as _AuthRequest
    if _SA_CREDS.expired or not _SA_CREDS.token:
        _SA_CREDS.refresh(_AuthRequest())
    return _SA_CREDS.token


# ============================================================
# Template de prompt pour generation d'histoire
# ============================================================
LEVEL_DESCRIPTIONS = {
    "courte":   ("5 pages courtes (3-5 min de lecture). Histoire concentree avec "
                 "un seul rebondissement majeur."),
    "soir":     ("7 pages (7-10 min de lecture). Histoire poetique pour s'endormir, "
                 "rythme doux, fin apaisante."),
    "aventure": ("10 pages (~20 min de lecture). Veritable aventure avec arc "
                 "narratif complet, plusieurs rebondissements, fin emouvante."),
}


def build_prompt(level, hero, place, item, villain, n_pages):
    """Construit le mega-prompt pour Gemini."""
    h = ITEM_CANON["hero"][hero]
    p = ITEM_CANON["place"][place]
    i = ITEM_CANON["item"][item]
    v = ITEM_CANON["villain"][villain]

    return f"""Tu es un auteur de contes pour enfants de 5-9 ans, dans la veine de Roald Dahl, Antoine de Saint-Exupery et Tomi Ungerer.

ECRIS UNE HISTOIRE qui mette en scene :
- LE HEROS : {h['name']} - {h['canon'].strip()}
- LE LIEU : {p['name']} - {p['canon'].strip()}
- L'OBJET MAGIQUE : {i['name']} - {i['canon'].strip()}
- LE DEFI / VILLAIN : {v['name']} - {v['canon'].strip()}

CONTRAINTES :
- Niveau : {LEVEL_DESCRIPTIONS[level]}
- Exactement {n_pages} pages
- Langue : FRANCAIS de France, soutenu mais accessible aux enfants
- Aucune violence gratuite, aucune scene effrayante (mais le suspense est permis)
- Style : phrases courtes et longues alternees, vocabulaire riche, images poetiques
- Le defi/villain n'est PAS un mechant pur : il est mal compris, perdu, blesse...
- Fin : emouvante, lumineuse, jamais simpliste

POUR CHAQUE PAGE :
- Un texte d'environ 100-200 mots (selon le niveau : courte=80-120 mots, soir=100-150, aventure=150-200)
- Le texte peut contenir des balises HTML simples : <em>...</em> pour l'italique, <br><br> pour saut de paragraphe
- UN PROMPT D'IMAGE en anglais decrivant la scene a illustrer (precise quels personnages sont presents, l'ambiance, les couleurs, l'action)
  IMPORTANT : seuls les personnages explicitement presents sur cette page doivent etre dans le prompt d'image.
  Le hero peut etre present mais pas force, le villain peut etre absent sur certaines pages, etc.

REPONDS UNIQUEMENT EN JSON, sans markdown ni texte autour :
{{
  "title": "Titre de l'histoire (ex: 'Brio et la melodie oubliee')",
  "pages": [
    {{
      "text": "Texte de la page 1 avec mise en forme HTML legere",
      "image_prompt": "English description of page 1 scene for illustrator"
    }},
    ... ({n_pages} pages au total)
  ]
}}
"""


def generate_text(key, max_retries=2):
    """Genere le texte d'une story et le sauve dans story.json."""
    p = parse_key(key)
    n_pages = LEVEL_PAGES[p["level"]]
    prompt = build_prompt(p["level"], p["hero"], p["place"], p["item"], p["villain"], n_pages)

    payload = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.85,         # creatif
            "topP": 0.95,
            "maxOutputTokens": 8000,     # large pour aventure 10 pages
            "responseMimeType": "application/json",
        },
    }
    headers = {"Authorization": f"Bearer {_token()}",
               "Content-Type": "application/json"}

    last_err = None
    # Tente Pro puis fallback Flash si Pro indispo / rate-limited
    for attempt in range(max_retries):
        model = TEXT_MODELS[min(attempt, len(TEXT_MODELS) - 1)]
        try:
            r = requests.post(_vertex_url(model), json=payload, headers=headers, timeout=180)
        except Exception as e:
            last_err = str(e)
            continue
        if r.status_code == 404:
            print(f"    {model} introuvable, fallback")
            continue
        if r.status_code == 429:
            print(f"    Rate limit {model}, wait 30s...")
            import time; time.sleep(30)
            continue
        if r.status_code >= 400:
            last_err = f"HTTP {r.status_code} on {model}: {r.text[:400]}"
            print(f"    ERREUR {last_err}")
            continue
        try:
            rj = r.json()
            text_out = rj["candidates"][0]["content"]["parts"][0]["text"]
            # Strip eventuel markdown
            text_out = re.sub(r"^```(?:json)?\s*", "", text_out)
            text_out = re.sub(r"\s*```$", "", text_out)
            story_data = json.loads(text_out)
        except Exception as e:
            last_err = f"Parsing: {e}"
            print(f"    ERREUR parsing: {e}")
            continue

        # Validation : titre + N pages
        if not story_data.get("title"):
            last_err = "title manquant"; continue
        pages = story_data.get("pages", [])
        if len(pages) != n_pages:
            last_err = f"attendu {n_pages} pages, recu {len(pages)}"
            print(f"    WARN : {last_err}")
            # On accepte quand meme si proche
            if abs(len(pages) - n_pages) > 2:
                continue
        for pg in pages:
            if not pg.get("text") or not pg.get("image_prompt"):
                last_err = "page sans text ou image_prompt"; continue

        # OK : on sauve
        save_story(key, story_data)
        return story_data
    print(f"    ECHEC apres {max_retries} tentatives : {last_err}")
    return None


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--key", required=True,
                   help="Cle complete (ex: courte_dragon_chateau_guitare_fantome)")
    p.add_argument("--force", action="store_true",
                   help="Re-genere meme si story.json existe")
    args = p.parse_args()

    if story_exists(args.key) and not args.force:
        print(f"[{args.key}] story.json existe deja (--force pour regenerer)")
        return

    print(f"[{args.key}] generation texte via Gemini Pro...")
    story = generate_text(args.key)
    if story:
        print(f"[{args.key}] OK : '{story['title']}' ({len(story['pages'])} pages)")
        print(f"  -> {story_path(args.key)}")
    else:
        print(f"[{args.key}] ECHEC")
        sys.exit(1)


if __name__ == "__main__":
    main()
