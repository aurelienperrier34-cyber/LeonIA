"""
crop_c1s4_features.py
=====================
Recadre les images c1s4_features en zoomant sur la zone pertinente.
Garde l'original sous {nom}_full.png et écrase {nom}.png par la version cropped.

Usage:
  python crop_c1s4_features.py
  python crop_c1s4_features.py --only pattes
"""

import argparse
from pathlib import Path
from PIL import Image

SRC_DIR = Path("assets/c1s4_features")

# Box (left%, top%, right%, bottom%) calibrés visuellement sur les images générées.
# On garde ratio 1:1 (carré) pour rester compatible avec les .s4-card.
CROPS = {
    "pattes":     (0.30, 0.40, 0.70, 0.80),  # coussinet rose au centre-bas
    "moustaches": (0.18, 0.20, 0.82, 0.60),  # visage du chat = nez + moustaches
    "oreilles":   (0.18, 0.05, 0.82, 0.45),  # haut de la tête (les 2 oreilles)
    "queue":      (0.00, 0.45, 0.40, 0.95),  # queue rayée à gauche
    "plumes":     (0.00, 0.15, 0.45, 0.75),  # plumes étalées à gauche
    "ecailles":   (0.20, 0.20, 0.80, 0.80),  # placeholder si on l'ajoute plus tard
}


def crop_one(name, box_pct):
    src = SRC_DIR / f"{name}.png"
    if not src.exists():
        print(f"  [{name}] {src} introuvable, skip")
        return False
    img = Image.open(src).convert("RGBA")
    W, H = img.size
    left   = int(box_pct[0] * W)
    top    = int(box_pct[1] * H)
    right  = int(box_pct[2] * W)
    bottom = int(box_pct[3] * H)
    # Force ratio 1:1 (carré) en prenant le min des deux côtés et en recentrant
    w = right - left
    h = bottom - top
    side = min(w, h)
    cx = (left + right) // 2
    cy = (top + bottom) // 2
    half = side // 2
    sq_left  = max(0, cx - half)
    sq_top   = max(0, cy - half)
    sq_right = min(W, sq_left + side)
    sq_bot   = min(H, sq_top  + side)
    cropped = img.crop((sq_left, sq_top, sq_right, sq_bot))
    # Backup de l'original
    backup = SRC_DIR / f"{name}_full.png"
    if not backup.exists():
        img.save(backup)
        print(f"  [{name}] Backup -> {backup.name}")
    # Sauvegarde cropped à la place de l'original
    cropped.save(src)
    print(f"  [{name}] Cropped {W}x{H} -> {cropped.size[0]}x{cropped.size[1]}")
    return True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", type=str, default=None)
    args = parser.parse_args()

    if args.only:
        if args.only not in CROPS:
            print(f"Inconnu : {args.only}. Disponibles : {list(CROPS.keys())}")
            return
        crop_one(args.only, CROPS[args.only])
    else:
        for name, box in CROPS.items():
            crop_one(name, box)


if __name__ == "__main__":
    main()
