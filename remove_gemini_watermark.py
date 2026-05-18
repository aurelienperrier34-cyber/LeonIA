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


def remove(path, corner_w=180, corner_h=120, blur_radius=30, method="clone"):
    """
    method = "blur" : blur gaussien (peut laisser des traces si symbole contraste)
    method = "clone" : copie une zone propre voisine A GAUCHE du watermark
                       et la blende par-dessus -> effacement complet
    """
    img = Image.open(path).convert("RGB")
    w, h = img.size
    margin_x = 6
    margin_y = 6
    x0 = w - corner_w - margin_x
    y0 = h - corner_h - margin_y
    x1 = w - margin_x
    y1 = h - margin_y

    if method == "clone":
        # On copie une zone equivalente positionnee a GAUCHE du watermark
        # (en supposant que c'est de l'arriere-plan propre)
        src_x0 = max(0, x0 - corner_w - 30)
        src_x1 = src_x0 + corner_w
        src_y0 = y0
        src_y1 = y1
        patch = img.crop((src_x0, src_y0, src_x1, src_y1))
        # Blur leger pour eviter une couture trop nette
        patch = patch.filter(ImageFilter.GaussianBlur(radius=4))
        img.paste(patch, (x0, y0))
        print(f"  Clone {corner_w}x{corner_h}px depuis x={src_x0} vers x={x0}")
    else:
        corner = img.crop((x0, y0, x1, y1))
        blurred = corner.filter(ImageFilter.GaussianBlur(radius=blur_radius))
        img.paste(blurred, (x0, y0))
        print(f"  Blur {corner_w}x{corner_h}px (radius={blur_radius})")

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
    ap.add_argument("--corner-w", type=int, default=180)
    ap.add_argument("--corner-h", type=int, default=120)
    ap.add_argument("--blur", type=int, default=30)
    ap.add_argument("--method", choices=["clone", "blur"], default="clone",
                    help="clone (defaut, recouvre par zone voisine) ou blur (flou simple)")
    args = ap.parse_args()
    p = Path(args.image)
    if not p.exists():
        sys.exit(f"introuvable : {p}")
    remove(p, args.corner_w, args.corner_h, args.blur, args.method)


if __name__ == "__main__":
    main()
