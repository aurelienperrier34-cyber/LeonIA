# -*- coding: utf-8 -*-
"""
crop_watermark.py
=================
Crop le bas et/ou la droite d'une image pour supprimer definitivement le
watermark (Gemini, ou autre).

L'image devient un peu plus petite mais reste utilisable comme background
(background-size: cover s'adapte).

Usage :
  python crop_watermark.py assets/leon_holds_book.png             # crop 60px en bas
  python crop_watermark.py assets/leon_holds_book.png --bottom 80
  python crop_watermark.py assets/leon_holds_book.png --bottom 60 --right 80
"""

import argparse
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("pip install pillow")


def crop(path, crop_bottom=60, crop_right=0):
    img = Image.open(path)
    w, h = img.size
    new_w = w - crop_right
    new_h = h - crop_bottom
    cropped = img.crop((0, 0, new_w, new_h))
    suffix = path.suffix.lower()
    if suffix == ".png":
        cropped.save(path, "PNG", optimize=True)
    else:
        cropped.save(path, "JPEG", quality=92, optimize=True)
    print(f"  {path} : {w}x{h} -> {new_w}x{new_h} (crop bas={crop_bottom}, droite={crop_right})")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("--bottom", type=int, default=60,
                    help="Pixels a retirer du bas (defaut 60)")
    ap.add_argument("--right", type=int, default=0,
                    help="Pixels a retirer de la droite (defaut 0)")
    args = ap.parse_args()
    p = Path(args.image)
    if not p.exists():
        sys.exit(f"introuvable : {p}")
    crop(p, args.bottom, args.right)


if __name__ == "__main__":
    main()
