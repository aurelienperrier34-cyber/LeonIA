# -*- coding: utf-8 -*-
"""
remove_gemini_watermark.py
==========================
Retire le watermark Gemini en bas-droite de assets/leon_holds_book.png
(et de tout autre image qu'on lui passe).

Methode : blur gaussien puissant sur le coin bas-droite.

Usage :
  python remove_gemini_watermark.py assets/leon_holds_book.png
  python remove_gemini_watermark.py path/to/image.png --corner-size 100
"""

import argparse
import sys
from pathlib import Path

try:
    from PIL import Image, ImageFilter
except ImportError:
    sys.exit("pip install pillow")


def remove(path, corner_w=140, corner_h=80, blur_radius=18):
    img = Image.open(path).convert("RGB")
    w, h = img.size
    # Marge depuis le coin
    margin_x = 12
    margin_y = 12
    x0 = w - corner_w - margin_x
    y0 = h - corner_h - margin_y
    x1 = w - margin_x
    y1 = h - margin_y

    # Crop la zone du coin
    corner = img.crop((x0, y0, x1, y1))
    # Blur gaussien fort
    blurred = corner.filter(ImageFilter.GaussianBlur(radius=blur_radius))
    # Re-paste
    img.paste(blurred, (x0, y0))

    # Sauve (on garde meme extension)
    suffix = path.suffix.lower()
    if suffix == ".png":
        img.save(path, "PNG", optimize=True)
    else:
        img.save(path, "JPEG", quality=92, optimize=True)
    print(f"  Blur zone {corner_w}x{corner_h}px en bas-droite de {path}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("image", help="Chemin de l'image a traiter (in-place)")
    ap.add_argument("--corner-w", type=int, default=140)
    ap.add_argument("--corner-h", type=int, default=80)
    ap.add_argument("--blur", type=int, default=18)
    args = ap.parse_args()
    p = Path(args.image)
    if not p.exists():
        sys.exit(f"introuvable : {p}")
    remove(p, args.corner_w, args.corner_h, args.blur)


if __name__ == "__main__":
    main()
