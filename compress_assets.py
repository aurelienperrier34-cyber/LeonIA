# -*- coding: utf-8 -*-
"""
compress_assets.py
==================
Compresse les images JPG des stories et des items pour reduire la taille
totale avant push GitHub.

Target :
  - JPG quality 82 (qualite quasi identique a l oeil nu)
  - Resize si > 1600px de large (pour le livre on n'a pas besoin de 4k)
  - Mode RGB (drop alpha si JPG)

Gain typique :
  - Image 1.7 MB (1344x768) -> ~250 KB (85% gain)
  - 243 stories * 7 pages * 250 KB = ~425 MB au lieu de 2.4 GB

Audio MP3 : pas touche, deja bien compresse.

Usage :
  python compress_assets.py                    # compresse tout in-place
  python compress_assets.py --dry-run          # affiche les gains potentiels sans modifier
  python compress_assets.py --quality 88       # plus haute qualite (gain moindre)
  python compress_assets.py --max-width 1280   # resize plus agressif
  python compress_assets.py --only assets/stories/courte_dragon_planete_guitare_monstre

Recommandation : lancer une 1ere fois avec --dry-run pour voir les gains.
"""

import argparse
import sys
import time
from pathlib import Path


def _check_pillow():
    try:
        from PIL import Image
        return Image
    except ImportError:
        sys.exit("ERREUR : Pillow non installe. Lance : pip install pillow")


def compress_jpg(path, Image, quality=82, max_width=1600, dry_run=False):
    """Compresse une image JPG in-place. Retourne (before_size, after_size)."""
    before = path.stat().st_size
    if dry_run:
        # Estimation grossiere : compression a 82 + resize ~= /6 pour images 1344x768
        return before, max(50_000, before // 6)
    img = Image.open(path)
    if img.width > max_width:
        ratio = max_width / img.width
        new_h = int(img.height * ratio)
        img = img.resize((max_width, new_h), Image.LANCZOS)
    if img.mode in ("RGBA", "LA", "P"):
        # Crée fond blanc pour les images avec alpha
        bg = Image.new("RGB", img.size, (255, 255, 255))
        if img.mode == "P":
            img = img.convert("RGBA")
        if img.mode in ("RGBA", "LA"):
            bg.paste(img, mask=img.split()[-1])
        img = bg
    elif img.mode != "RGB":
        img = img.convert("RGB")
    img.save(path, "JPEG", quality=quality, optimize=True, progressive=True)
    after = path.stat().st_size
    return before, after


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--quality", type=int, default=82,
                   help="Qualite JPG (60-95, defaut 82)")
    p.add_argument("--max-width", type=int, default=1600,
                   help="Largeur max (resize si plus grand, defaut 1600)")
    p.add_argument("--dry-run", action="store_true",
                   help="Affiche les gains potentiels sans modifier les fichiers")
    p.add_argument("--only", help="Compresse uniquement les images sous ce dossier")
    p.add_argument("--skip-recent", type=int, default=10,
                   help="Skip les fichiers modifies dans les N dernieres secondes "
                        "(evite de toucher aux fichiers en cours d'ecriture par "
                        "le pipeline overnight). Defaut 10s.")
    args = p.parse_args()

    Image = _check_pillow()

    # Collecte les targets
    targets = []
    if args.only:
        root = Path(args.only)
        if root.is_file() and root.suffix.lower() in (".jpg", ".jpeg"):
            targets = [root]
        elif root.is_dir():
            targets = sorted(root.rglob("*.jpg"))
    else:
        for d in [Path("assets/stories"), Path("assets/items")]:
            if d.exists():
                targets.extend(sorted(d.rglob("*.jpg")))

    print(f"\nTrouve {len(targets)} fichiers JPG")
    if args.dry_run:
        print("MODE DRY-RUN : aucun fichier ne sera modifie\n")

    # Skip recent files (en cours d'ecriture)
    now = time.time()
    skipped_recent = []
    if args.skip_recent > 0 and not args.dry_run:
        kept = []
        for t in targets:
            age = now - t.stat().st_mtime
            if age < args.skip_recent:
                skipped_recent.append(t)
            else:
                kept.append(t)
        targets = kept

    total_before = 0
    total_after = 0
    n_ok = 0
    n_fail = 0
    for path in targets:
        try:
            before, after = compress_jpg(path, Image,
                                          quality=args.quality,
                                          max_width=args.max_width,
                                          dry_run=args.dry_run)
            total_before += before
            total_after += after
            n_ok += 1
            if before < after:
                # Recompression n'a pas reduit (probablement deja compressee)
                continue
            saved_pct = (1 - after / before) * 100
            print(f"  {path}: {before//1024} KB -> {after//1024} KB ({saved_pct:.0f}% saved)")
        except Exception as e:
            n_fail += 1
            print(f"  WARN {path}: {e}")

    if skipped_recent:
        print(f"\n{len(skipped_recent)} fichiers skip (modifies < {args.skip_recent}s)")

    if n_ok:
        gain_mb = (total_before - total_after) / (1024 * 1024)
        pct = (1 - total_after / total_before) * 100 if total_before else 0
        print(f"\n{'PROJECTION' if args.dry_run else 'BILAN'} :")
        print(f"  Avant : {total_before / (1024*1024):.1f} MB")
        print(f"  Apres : {total_after / (1024*1024):.1f} MB")
        print(f"  Gain  : {gain_mb:.1f} MB ({pct:.0f}%)")
    if n_fail:
        print(f"\n{n_fail} erreur(s)")


if __name__ == "__main__":
    main()
