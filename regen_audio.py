# -*- coding: utf-8 -*-
"""
regen_audio.py
==============
Re-genere la narration MP3 des histoires du CATALOGUE (lit story.json) avec
une voix au choix. Sert a uniformiser/upgrader la voix (ex: Chirp3-HD).

Contrairement a generate_story_audio.py (qui lit l'ancien dict STORIES),
celui-ci lit les story.json -> marche sur les 243 histoires du catalogue.

Usage :
  python regen_audio.py --dir assets/stories --all --voice fr-FR-Chirp3-HD-Aoede --force
  python regen_audio.py --story courte_dragon_chateau_guitare_fantome --force
  python regen_audio.py --level soir --force
"""

import argparse
import json
import sys
import time
from pathlib import Path

from generate_story_audio import synthesize_page, clean_html_for_tts


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default="assets/stories", help="dossier des histoires")
    ap.add_argument("--voice", default="fr-FR-Chirp3-HD-Aoede")
    ap.add_argument("--story", help="re-genere une seule histoire (nom de dossier)")
    ap.add_argument("--level", help="filtre par niveau (courte/soir/aventure)")
    ap.add_argument("--all", action="store_true", help="toutes les histoires")
    ap.add_argument("--rate", type=float, default=0.95)
    ap.add_argument("--force", action="store_true",
                    help="re-genere meme si le mp3 existe (necessaire pour changer de voix)")
    ap.add_argument("--delay", type=float, default=0.25,
                    help="delai entre 2 appels TTS")
    args = ap.parse_args()

    base = Path(args.dir)
    if not base.exists():
        sys.exit(f"dossier introuvable : {base}")

    if args.story:
        dirs = [base / args.story]
    else:
        dirs = sorted([d for d in base.iterdir() if (d / "story.json").exists()])
        if args.level:
            dirs = [d for d in dirs if d.name.startswith(args.level + "_")]
        if not args.all and not args.level:
            sys.exit("Precise --story, --level ou --all")

    print(f"Voix : {args.voice} | {len(dirs)} histoire(s) | force={args.force}")
    total = ok = fail = chars = 0
    for di, d in enumerate(dirs, 1):
        sj = d / "story.json"
        if not sj.exists():
            continue
        try:
            story = json.loads(sj.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"  [skip] {d.name}: {e}"); continue
        for i, p in enumerate(story.get("pages", []), 1):
            dest = d / f"page{i}.mp3"
            if dest.exists() and not args.force:
                continue
            txt = clean_html_for_tts(p.get("text", ""))
            if not txt:
                continue
            total += 1
            chars += len(txt)
            if synthesize_page(txt, dest, voice=args.voice, speaking_rate=args.rate):
                ok += 1
            else:
                fail += 1
                print(f"  ECHEC {d.name} page{i}")
            time.sleep(args.delay)
        if di % 10 == 0:
            print(f"  ...{di}/{len(dirs)} histoires, {ok} mp3, {chars:,} chars")

    print(f"\nBILAN : {ok}/{total} mp3 OK, {fail} echec(s), {chars:,} caracteres "
          f"(~{chars/1_000_000*30:.2f} USD avant tier gratuit 1M/mois)")


if __name__ == "__main__":
    main()
