"""
build_chapter.py
=================
Génère TOUT pour un chapitre : images → vidéos → voix.
Enchaîne les 3 scripts existants en séquence.

Usage :
    python build_chapter.py 4
    python build_chapter.py 4 --only 2            # uniquement le tableau 2
    python build_chapter.py 4 --only 2,4          # tableaux 2 et 4
    python build_chapter.py 4 --skip-images       # si images déjà OK
    python build_chapter.py 4 --skip-videos       # si vidéos déjà OK
    python build_chapter.py 4 --refs references_leon
"""

import argparse
import subprocess
import sys
import time
from pathlib import Path


def run(cmd, label):
    print(f"\n{'='*60}")
    print(f"=== {label}")
    print(f"=== Commande : {' '.join(cmd)}")
    print('='*60)
    t0 = time.time()
    rc = subprocess.call(cmd)
    dt = time.time() - t0
    print(f"\n→ {label} : code {rc} en {dt:.0f}s")
    return rc == 0


def main():
    p = argparse.ArgumentParser(description="Build tout un chapitre")
    p.add_argument("chapitre", type=int)
    p.add_argument("--refs", default="references_leon",
                   help="Dossier des refs Léon (défaut: references_leon)")
    p.add_argument("--quality", default="480p", choices=["480p", "720p"])
    p.add_argument("--only", help="Filtre tableaux (ex: 2 ou 2,4) — propagé aux 3 sous-scripts")
    p.add_argument("--skip-images", action="store_true")
    p.add_argument("--skip-videos", action="store_true")
    p.add_argument("--skip-voices", action="store_true")
    p.add_argument("--no-validate", action="store_true",
                   help="Desactive la pre-validation Haiku des prompts d'animation "
                        "(par defaut activee — economise les credits Motion 2.0 si "
                        "le prompt contient une incoherence visuelle).")
    args = p.parse_args()

    chap = args.chapitre
    json_path = Path(f"scenar_chap{chap}_json.txt")
    if not json_path.exists():
        json_path = Path(f"scenar_chap{chap}.json")
    if not json_path.exists():
        sys.exit(f"❌ JSON introuvable pour chap {chap}")

    print(f"\n🚀 BUILD CHAPITRE {chap}")
    print(f"   JSON     : {json_path}")
    print(f"   Refs     : {args.refs}")
    print(f"   Quality  : {args.quality}")
    print(f"   Étapes   : "
          f"{'images=skip' if args.skip_images else 'images=oui'} | "
          f"{'videos=skip' if args.skip_videos else 'videos=oui'} | "
          f"{'voices=skip' if args.skip_voices else 'voices=oui'}")

    only_args = ["--only", args.only] if args.only else []

    # 1. Images via Nano Banana
    if not args.skip_images:
        ok = run([
            "python", "gen_image.py", str(chap),
            "--model", "nano-banana",
            "--ref-dir", args.refs,
            *only_args,
        ], f"ÉTAPE 1/3 — Génération des images chap {chap} (Nano Banana)")
        if not ok:
            print("⚠️  Images : code de retour non zéro. On continue quand même.")

    # 2. Animations Motion 2.0 (uniquement les format=video)
    if not args.skip_videos:
        animate_cmd = [
            "python", "leonardo_animate.py",
            "--batch", str(json_path),
            "--assets", f"assets/chapitre_{chap}",
            "--quality", args.quality,
            "--install",
            "--install-dir", f"assets/chapitre_{chap}",
        ]
        if not args.no_validate:
            animate_cmd.append("--validate")
        animate_cmd.extend(only_args)
        ok = run(animate_cmd, f"ÉTAPE 2/3 — Animations Motion 2.0 chap {chap}"
                              + (" (avec validation Haiku)" if not args.no_validate else ""))
        if not ok:
            print("⚠️  Vidéos : code de retour non zéro.")

    # 3. Voix (narrateur + Léon)
    if not args.skip_voices:
        ok = run([
            "python", "regenerate_all_narrators.py",
            "--chap", str(chap),
            *only_args,
        ], f"ÉTAPE 3/3 — Voix narrateur + Léon chap {chap}")
        if not ok:
            print("⚠️  Voix : code de retour non zéro.")

    print(f"\n{'='*60}")
    print(f"✅ BUILD CHAPITRE {chap} TERMINÉ")
    print(f"   Vérifie : assets/chapitre_{chap}/")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
