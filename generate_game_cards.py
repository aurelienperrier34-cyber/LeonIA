# -*- coding: utf-8 -*-
"""
generate_game_cards.py
======================
Genere les 4 cartes a collectionner du jeu (Léon, Bot, Pixel, Echo).
Format carre 768x768, style watercolor coherent avec le reste de l'app.

Output : assets/cards/<id>.jpg

Usage :
  python generate_game_cards.py
  python generate_game_cards.py --only leon --force
"""

import argparse
import base64
import json
import sys
import time
from pathlib import Path
from dotenv import load_dotenv
import requests

for c in [Path(__file__).parent / ".env", Path.cwd() / ".env"]:
    if c.exists():
        load_dotenv(c); break

_SA_FILE = Path("service-account.json")
if not _SA_FILE.exists():
    sys.exit("ERREUR : service-account.json introuvable")

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
    "single subject perfectly centered on aged ivory parchment background with "
    "subtle texture, soft warm lighting, magical atmosphere, no text in image, "
    "no watermark, square 1:1 composition. "
)

# Images de reference (passees en input a Gemini pour matcher le perso exact)
CARD_REFS = {
    "leon": [
        "assets/leon_inventeur_1776108970406.png",
        "assets/Léon_debout_sans_fond.jpg",
    ],
}

CARDS = {
    "leon": (
        "Using the attached reference images of Léon, create a clean card "
        "portrait of him KEEPING HIS EXACT APPEARANCE: bushy white-grey beard, "
        "round silver-rimmed clear eyeglasses, dark navy newsboy cap decorated "
        "with colorful patches, bright orange knitted sweater with "
        "cog/lightbulb/star patterns, brown leather apron, rosy cheeks, blue "
        "eyes, warm grandfatherly smile. Head and shoulders shot, looking "
        "warmly at viewer, centered."
    ),
    "bot": (
        "Portrait of Bot, a friendly talking robot: round silver metallic body "
        "with rivets, two glowing soft blue LED eyes forming a smile, a curved "
        "antenna with a small glowing bulb on top, holding a tiny stack of books, "
        "warm friendly expression, sitting upright, head and shoulders shot."
    ),
    "pixel": (
        "Portrait of Pixel, a friendly magical artist character: a small "
        "cute creature with rainbow-colored hair, holding a glowing paint palette "
        "and a brush trailing colorful sparkles, dressed in a painter's smock "
        "splattered with rainbow paint, joyful smile, head and shoulders shot."
    ),
    "echo": (
        "Portrait of Echo, a friendly magical sound character: a small cute "
        "creature with large soft purple headphones, eyes closed in musical bliss, "
        "musical notes and gentle sound waves floating around, dressed in a "
        "shimmery turquoise hoodie, head and shoulders shot."
    ),
}


def _b64(p):
    return base64.standard_b64encode(Path(p).read_bytes()).decode("utf-8")


def _mime(p):
    ext = Path(p).suffix.lower().lstrip(".")
    return {"jpg": "image/jpeg", "jpeg": "image/jpeg",
            "png": "image/png", "webp": "image/webp"}.get(ext, "image/jpeg")


def gen(name, prompt, dest, model="gemini-2.5-flash-image"):
    parts = []
    # Images de reference si definies (pour matcher le perso exact)
    refs = CARD_REFS.get(name, [])
    for rp in refs:
        rpath = Path(rp)
        if rpath.exists():
            parts.append({"text": f"Reference image of {name}:"})
            parts.append({"inline_data": {"mime_type": _mime(rpath), "data": _b64(rpath)}})
    parts.append({"text": STYLE_PREFIX + prompt})
    payload = {
        "contents": [{"role": "user", "parts": parts}],
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
    ap.add_argument("--only", help="Genere uniquement cette carte (leon/bot/pixel/echo)")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    out = Path("assets/cards")
    out.mkdir(parents=True, exist_ok=True)
    todo = [(n, p) for n, p in CARDS.items() if not args.only or args.only == n]
    for name, prompt in todo:
        dest = out / f"{name}.jpg"
        if dest.exists() and not args.force:
            print(f"[{name}] existe (--force pour regenerer)")
            continue
        print(f"\n[{name}]")
        gen(name, prompt, dest)
        time.sleep(35)


if __name__ == "__main__":
    main()
