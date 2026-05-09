"""
generate_bot_nanobanana.py
==========================
Génère un portrait propre de Bot via Nano Banana (Gemini 2.5 Flash Image),
en utilisant assets/c4s2_bot/bot_reference.png comme référence pour garder
la même identité visuelle que dans les autres écrans.

Pré-requis :
  pip install google-genai pillow python-dotenv
  Dans .env : GEMINI_API_KEY=ton_api_key_google_ai_studio

Usage :
  # 1. Préparer la référence (à faire avant)
  python prepare_bot_reference.py

  # 2. Générer le portrait
  python generate_bot_nanobanana.py

  # Variantes :
  python generate_bot_nanobanana.py --n 4
  python generate_bot_nanobanana.py --prompt "ton prompt custom"
"""

import argparse
import os
import sys
from pathlib import Path

from PIL import Image
from dotenv import load_dotenv

load_dotenv()

API_KEY = os.getenv("GEMINI_API_KEY")
if not API_KEY:
    print("GEMINI_API_KEY manquante dans .env", file=sys.stderr)
    print("Obtiens-en une sur https://aistudio.google.com/apikey", file=sys.stderr)
    sys.exit(1)

try:
    from google import genai
    from google.genai import types
except ImportError:
    print("Installe le SDK : pip install google-genai", file=sys.stderr)
    sys.exit(1)

REF_PATH = Path("assets/c4s2_bot/bot_reference.png")
OUT_DIR  = Path("assets/c4s2_bot")
MODEL = "gemini-2.5-flash-image-preview"

DEFAULT_PROMPT = (
    "Same exact character as the reference image: a small white and teal cute "
    "cartoon robot with big round screen face showing colorful glowing pixels, "
    "rounded body, small antenna with glowing tip, friendly mascot style. "
    "Now show this character ISOLATED on a transparent or pure white background, "
    "framed CHEST UP centered (no scene, no books, no Léon, no other elements). "
    "The robot should be in a NEUTRAL idle pose facing the camera, screen face "
    "showing a soft happy expression with small abstract glowing dots. "
    "3D Pixar render style, soft warm rim lighting, ready to be animated as a "
    "talking head. High quality, sharp details, square 1:1 composition."
)


def load_reference():
    if not REF_PATH.exists():
        print(f"Reference introuvable : {REF_PATH}", file=sys.stderr)
        print("Lance d'abord : python prepare_bot_reference.py", file=sys.stderr)
        sys.exit(1)
    return Image.open(REF_PATH)


def generate(prompt, n, model_id):
    client = genai.Client(api_key=API_KEY)
    ref_img = load_reference()
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Modele : {model_id}")
    print(f"Reference : {REF_PATH}")
    print(f"Prompt : {prompt[:120]}...\n")

    for i in range(1, n + 1):
        print(f"[{i}/{n}] Generation...")
        try:
            response = client.models.generate_content(
                model=model_id,
                contents=[prompt, ref_img],
            )
        except Exception as e:
            print(f"  Erreur API : {e}")
            continue

        # Parcourt les parts de la réponse pour trouver l'image
        saved = False
        for cand in response.candidates or []:
            for part in cand.content.parts or []:
                if hasattr(part, "inline_data") and part.inline_data and part.inline_data.data:
                    out = OUT_DIR / f"bot_portrait_v{i}.png"
                    out.write_bytes(part.inline_data.data)
                    print(f"  OK -> {out}")
                    saved = True
                elif hasattr(part, "text") and part.text:
                    print(f"  [texte] {part.text[:120]}")
        if not saved:
            print(f"  [{i}] Aucune image dans la reponse.")

    print("\nChoisis la meilleure et renomme-la en bot_portrait.png :")
    print(f"  ren {OUT_DIR}\\bot_portrait_v1.png bot_portrait.png")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--prompt", type=str, default=DEFAULT_PROMPT)
    parser.add_argument("--n", type=int, default=2,
                        help="Nombre de variations (default: 2)")
    parser.add_argument("--model", type=str, default=MODEL)
    args = parser.parse_args()

    generate(args.prompt, args.n, args.model)


if __name__ == "__main__":
    main()
