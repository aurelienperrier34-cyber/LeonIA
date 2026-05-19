# -*- coding: utf-8 -*-
"""
generate_chibi_cards.py
=======================
Genere des versions CHIBI (style japonais kawaii, grosse tete / petit corps)
des personnages, a partir de leurs images de reference, pour des cartes a
collectionner premium "alternatives".

Output : assets/cards/chibi_<id>.jpg (carre 1:1)

Usage :
  python generate_chibi_cards.py
  python generate_chibi_cards.py --only fille --force
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


def _b64(p):
    return base64.standard_b64encode(Path(p).read_bytes()).decode("utf-8")


def _mime(p):
    ext = Path(p).suffix.lower().lstrip(".")
    return {"jpg": "image/jpeg", "jpeg": "image/jpeg",
            "png": "image/png", "webp": "image/webp"}.get(ext, "image/jpeg")


CHIBI_STYLE = (
    "Adorable CHIBI style illustration (Japanese kawaii): big oversized head, "
    "tiny cute body, huge sparkling expressive eyes, super deformed proportions, "
    "rounded soft shapes. Centered single character on a magical glowing "
    "background with golden sparkles and soft bokeh, vibrant joyful colors, "
    "thick clean outlines, cel-shaded soft lighting, sticker-like finish, "
    "square 1:1 composition, no text, no watermark. "
)

# refs = images de reference pour garder l'identite du perso
CHIBI = {
    "fille":  {
        "refs": ["assets/fille_face-removebg-preview.png"],
        "prompt": "Chibi version of this little girl explorer, keeping her hair, "
                  "face and outfit recognizable. Cheerful pose, big smile.",
    },
    "garcon": {
        "refs": ["assets/garcon_de_face-removebg-preview.png"],
        "prompt": "Chibi version of this little boy explorer, keeping his hair, "
                  "face and outfit recognizable. Adventurous cheerful pose.",
    },
    "remi":   {
        "refs": ["assets/remi_face-removebg-preview.png"],
        "prompt": "Chibi version of Rémi the clever little fox, keeping his orange "
                  "fur and mischievous look. Playful pose, big sparkly eyes.",
    },
    "pixel":  {
        "refs": ["assets/pixel_face-removebg-preview.png"],
        "prompt": "Chibi version of Pixel the cute little robot, keeping its colorful "
                  "screen-face and round body. Happy pose, glowing details.",
    },
    "leon":   {
        "refs": ["assets/leon_inventeur_1776108970406.png"],
        "prompt": "Chibi version of Léon the elderly inventor, keeping his white "
                  "beard, round glasses, navy cap with patches and orange sweater. "
                  "Tiny body, giant kind smiling head.",
    },
}


def gen(name, dest, model="gemini-2.5-flash-image"):
    data = CHIBI[name]
    parts = []
    for rp in data["refs"]:
        rpath = Path(rp)
        if rpath.exists():
            parts.append({"text": f"Reference image of {name}:"})
            parts.append({"inline_data": {"mime_type": _mime(rpath), "data": _b64(rpath)}})
    parts.append({"text": CHIBI_STYLE + data["prompt"]})
    payload = {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
            "temperature": 0.6,
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
            print(f"    EXC {e}, retry..."); time.sleep(20); continue
        if r.status_code == 429:
            wait = 15 + attempt * 15
            print(f"    429, wait {wait}s..."); time.sleep(wait); continue
        if r.status_code >= 400:
            print(f"    ERREUR {r.status_code}: {r.text[:300]}"); return False
        rj = r.json()
        try:
            for p in rj["candidates"][0]["content"]["parts"]:
                d = p.get("inlineData") or p.get("inline_data")
                if d and d.get("data"):
                    img = base64.standard_b64decode(d["data"])
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    dest.write_bytes(img)
                    print(f"    OK {len(img)//1024} KB"); return True
            print(f"    Pas d image: {str(rj)[:200]}")
        except Exception as e:
            print(f"    Parsing: {e}")
        return False
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="fille/garcon/remi/pixel/leon")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    out = Path("assets/cards")
    out.mkdir(parents=True, exist_ok=True)
    todo = [n for n in CHIBI if not args.only or args.only == n]
    for name in todo:
        dest = out / f"chibi_{name}.jpg"
        if dest.exists() and not args.force:
            print(f"[chibi_{name}] existe (--force)"); continue
        print(f"\n[chibi_{name}]")
        gen(name, dest)
        time.sleep(35)


if __name__ == "__main__":
    main()
