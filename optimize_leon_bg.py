# -*- coding: utf-8 -*-
"""
optimize_leon_bg.py
===================
Convertit l'image de fond leon_holds_book.png (PNG lourd ~6MB) en JPEG
optimise (~400-600 KB) avec progressive encoding pour affichage rapide.

Usage :
  python optimize_leon_bg.py
"""

import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("pip install pillow")

src = Path("assets/leon_holds_book.png")
dst = Path("assets/leon_holds_book.jpg")

if not src.exists():
    sys.exit(f"introuvable : {src}")

img = Image.open(src).convert("RGB")
# Resize si trop grand : 1600px max width est largement suffisant pour fond
MAX_WIDTH = 1600
if img.width > MAX_WIDTH:
    ratio = MAX_WIDTH / img.width
    new_h = int(img.height * ratio)
    img = img.resize((MAX_WIDTH, new_h), Image.LANCZOS)
    print(f"  Resize {MAX_WIDTH}x{new_h}")

img.save(dst, "JPEG", quality=85, optimize=True, progressive=True)
before = src.stat().st_size
after = dst.stat().st_size
print(f"  {src.name} ({before//1024} KB) -> {dst.name} ({after//1024} KB)")
print(f"  Gain : {(1 - after/before)*100:.0f}%")
