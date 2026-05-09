"""
prepare_bot_reference.py
========================
Extrait Bot du fond c4s2 (`assets/chapitre_4/t2_bg.jpg`) pour le donner
en référence à Nano Banana / Gemini Flash Image.

Usage:
  python prepare_bot_reference.py
  python prepare_bot_reference.py --src assets/chapitre_4/t1_bg.jpg --box 0.55 0.30 0.95 0.95
"""

import argparse
from pathlib import Path
from PIL import Image

DEFAULT_SRC = Path("assets/chapitre_4/t2_bg.jpg")
OUT_DIR = Path("assets/c4s2_bot")
# Box (left%, top%, right%, bottom%) — Bot est dans la moitié droite-basse de t2_bg.jpg
DEFAULT_BOX = (0.52, 0.27, 0.92, 0.92)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--src", type=str, default=str(DEFAULT_SRC))
    parser.add_argument("--box", nargs=4, type=float, default=list(DEFAULT_BOX),
                        help="left top right bottom en pourcentages (0..1)")
    args = parser.parse_args()

    src = Path(args.src)
    if not src.exists():
        print(f"Source introuvable : {src}")
        return

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    img = Image.open(src).convert("RGB")
    W, H = img.size
    L, T, R, B = args.box
    left, top, right, bottom = int(L * W), int(T * H), int(R * W), int(B * H)
    cropped = img.crop((left, top, right, bottom))
    out = OUT_DIR / "bot_reference.png"
    cropped.save(out)
    print(f"OK -> {out} ({cropped.size[0]}x{cropped.size[1]})")
    print("Si le crop n'est pas bon, relance avec --box L T R B (en %)")


if __name__ == "__main__":
    main()
