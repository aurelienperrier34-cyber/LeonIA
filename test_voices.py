# -*- coding: utf-8 -*-
"""
test_voices.py
==============
Genere des samples MP3 avec plusieurs voix Google TTS pour qu'on puisse
comparer et choisir la meilleure pour le Livre magique.

Usage :
  python test_voices.py
  python test_voices.py --text "Une autre phrase a tester"

Output : samples/<voice_id>.mp3
"""

import argparse
import sys
from pathlib import Path

# Reutilise tout l'ecosysteme existant
from generate_story_audio import synthesize_page, clean_html_for_tts

# Echantillon : le debut de l'histoire de Brio (ton de conte du soir)
SAMPLE_TEXT = (
    "Brio n'était pas un dragon comme les autres. D'abord, il avait à peine la taille "
    "d'un gros chat. Ensuite, ses écailles, au lieu d'être rouges ou vertes, brillaient "
    "d'un bleu très doux, comme le ciel juste après l'orage. Et surtout, surtout, Brio "
    "n'aimait pas cracher du feu. Cela faisait tousser les fleurs."
)

# Voix candidates a tester
VOICES_TO_TEST = [
    # Neural2 (qualite excellente, prix raisonnable)
    ("fr-FR-Neural2-A", "Femme chaleureuse - conte du soir"),
    ("fr-FR-Neural2-C", "Femme plus jeune - maman lectrice"),
    ("fr-FR-Neural2-D", "Homme grave - grand-pere conteur"),
    ("fr-FR-Neural2-B", "Homme neutre - narrateur radio"),
    ("fr-FR-Neural2-E", "Femme posee alternative"),
    # Studio (premium, 10x plus cher mais top qualite - decommenter pour test)
    # ("fr-FR-Studio-A", "Premium F (Studio - 10x plus cher)"),
    # ("fr-FR-Studio-D", "Premium M (Studio - 10x plus cher)"),
    # Chirp3 HD (derniere generation, qualite max)
    # ("fr-FR-Chirp3-HD-Aoede", "Chirp3 HD F - derniere generation"),
    # ("fr-FR-Chirp3-HD-Puck",  "Chirp3 HD M - derniere generation"),
]


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--text", default=SAMPLE_TEXT,
                   help="Texte a synthetiser (par defaut : debut histoire Brio)")
    p.add_argument("--rate", type=float, default=0.95,
                   help="Vitesse de parole (defaut 0.95)")
    p.add_argument("--pitch", type=float, default=0.0,
                   help="Pitch (defaut 0.0)")
    p.add_argument("--include-studio", action="store_true",
                   help="Inclure aussi les voix Studio (10x plus cher)")
    p.add_argument("--include-hd", action="store_true",
                   help="Inclure aussi Chirp3 HD")
    args = p.parse_args()

    voices = list(VOICES_TO_TEST)
    if args.include_studio:
        voices += [
            ("fr-FR-Studio-A", "Premium F (Studio)"),
            ("fr-FR-Studio-D", "Premium M (Studio)"),
        ]
    if args.include_hd:
        voices += [
            ("fr-FR-Chirp3-HD-Aoede", "Chirp3 HD F"),
            ("fr-FR-Chirp3-HD-Puck",  "Chirp3 HD M"),
        ]

    out_dir = Path("samples")
    out_dir.mkdir(exist_ok=True)

    text = clean_html_for_tts(args.text)
    print(f"\nTexte ({len(text)} chars) :")
    print(f"  \"{text[:120]}{'...' if len(text)>120 else ''}\"")
    print(f"\nGeneration de {len(voices)} samples dans {out_dir}/...\n")

    for voice_id, descr in voices:
        dest = out_dir / f"{voice_id}.mp3"
        print(f"  [{voice_id}] {descr}")
        ok = synthesize_page(text, dest, voice=voice_id,
                             speaking_rate=args.rate, pitch=args.pitch)
        if ok:
            print(f"    OK -> {dest} ({dest.stat().st_size // 1024} KB)")
        else:
            print(f"    ECHEC")

    print(f"\nDouble-clique sur les fichiers dans {out_dir}/ pour ecouter.")
    print(f"Choisis ta voix preferee et donne-moi son ID (ex: fr-FR-Neural2-A)")


if __name__ == "__main__":
    main()
