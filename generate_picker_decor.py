# -*- coding: utf-8 -*-
"""
generate_picker_decor.py
========================
Genere 3 mini-illustrations decoratives pour la page de sélection
du TYPE D'HISTOIRE dans le picker (Courte / Soir / Aventure).

Output : assets/picker/level_courte.png
         assets/picker/level_soir.png
         assets/picker/level_aventure.png

Format square 1:1, ~300-500 KB chacune.

Usage :
  python generate_picker_decor.py
  python generate_picker_decor.py --only soir --force
"""

import argparse
import base64
import sys
import time
from pathlib import Path
from dotenv import load_dotenv
import requests

for c in [Path(__file__).parent / ".env", Path.cwd() / ".env"]:
    if c.exists():
        load_dotenv(c); break

# Reuse l auth du service account deja en place
_SA_FILE = Path("service-account.json")
if not _SA_FILE.exists():
    sys.exit("ERREUR : service-account.json introuvable")

import json
from google.oauth2 import service_account as _sa
from google.auth.transport.requests import Request as _AuthRequest
_SCOPES = ["https://www.googleapis.com/auth/cloud-platform"]
_SA_CREDS = _sa.Credentials.from_service_account_file(str(_SA_FILE), scopes=_SCOPES)
_SA_PROJECT = json.loads(_SA_FILE.read_text(encoding="utf-8"))["project_id"]

VERTEX_REGION = "us-central1"
URL_TPL = ("https://{r}-aiplatform.googleapis.com/v1/projects/{p}/locations/{r}/"
           "publishers/google/models/{m}:generateContent")


def _token():
    if _SA_CREDS.expired or not _SA_CREDS.token:
        _SA_CREDS.refresh(_AuthRequest())
    return _SA_CREDS.token


STYLE_PREFIX = (
    "Watercolor children's book illustration, soft Pixar painterly style, "
    "centered subject on aged ivory parchment background with subtle texture, "
    "soft warm lighting, dreamy magical atmosphere, single subject only, "
    "no text in image, no watermark, square 1:1 composition. "
)

DECORS = {
    "courte": (
        "A glowing magical pocket watch hovering with golden sparkles, "
        "small clock face with stars, surrounded by soft motion blur lines "
        "suggesting speed and brevity, warm amber and gold tones."
    ),
    "soir": (
        "A serene crescent moon in deep blue night sky, with twinkling stars "
        "and a small open storybook below emitting a soft golden glow, dreamy "
        "bedtime atmosphere, deep navy and silver tones with warm honey accents."
    ),
    "aventure": (
        "An old treasure map scroll partially unrolled, with a small antique "
        "compass and tiny adventure icons (a sailboat, a mountain, a star) "
        "scattered around, warm sepia and emerald tones, evocative of long journey."
    ),
    # Icone pour le bouton "Ecrire mon histoire"
    "write_btn": (
        "A magical golden quill pen mid-flight writing on a glowing open "
        "parchment scroll, with bright golden sparkles trailing the quill tip, "
        "calligraphic flourishes, warm amber and gold tones, magical aura. "
        "The icon should feel inviting and exciting, like a 'start your adventure' button."
    ),
}


def gen(level, prompt, dest, model="gemini-2.5-flash-image"):
    payload = {
        "contents": [{"role": "user", "parts": [{"text": STYLE_PREFIX + prompt}]}],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
            "temperature": 0.5,
            "imageConfig": {"aspectRatio": "1:1"},
        },
    }
    url = URL_TPL.format(r=VERTEX_REGION, p=_SA_PROJECT, m=model)
    headers = {"Authorization": f"Bearer {_token()}", "Content-Type": "application/json"}
    print(f"  Gemini {model} -> {dest.name}")
    for attempt in range(3):
        try:
            r = requests.post(url, json=payload, headers=headers, timeout=120)
        except Exception as e:
            print(f"    EXC {e}, retry...")
            time.sleep(20); continue
        if r.status_code == 429:
            wait = 15 + attempt * 15
            print(f"    429 rate limit, wait {wait}s...")
            time.sleep(wait); continue
        if r.status_code >= 400:
            print(f"    ERREUR {r.status_code}: {r.text[:300]}")
            return False
        rj = r.json()
        try:
            parts = rj["candidates"][0]["content"]["parts"]
            for p in parts:
                d = p.get("inlineData") or p.get("inline_data")
                if d and d.get("data"):
                    img = base64.standard_b64decode(d["data"])
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    dest.write_bytes(img)
                    print(f"    OK {len(img)//1024} KB")
                    return True
            print(f"    Pas d image: {str(rj)[:300]}")
        except Exception as e:
            print(f"    Parsing: {e}")
        return False
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="Generer uniquement ce niveau (courte/soir/aventure)")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    out = Path("assets/picker")
    out.mkdir(parents=True, exist_ok=True)
    todo = [(lvl, p) for lvl, p in DECORS.items()
            if not args.only or args.only == lvl]
    for lvl, prompt in todo:
        # le 'write_btn' n'est pas un niveau d'histoire, naming different
        filename = f"{lvl}.png" if lvl == "write_btn" else f"level_{lvl}.png"
        dest = out / filename
        if dest.exists() and not args.force:
            print(f"[{lvl}] existe deja (--force pour regenerer)")
            continue
        print(f"\n[{lvl}]")
        gen(lvl, prompt, dest)
        time.sleep(35)  # respect rate-limit, on partage le quota avec overnight


if __name__ == "__main__":
    main()
