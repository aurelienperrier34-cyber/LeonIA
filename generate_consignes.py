"""
generate_consignes.py
=====================
Genere tous les MP3 des consignes des mini-jeux avec la voix du narrateur
(ElevenLabs). Sauvegarde dans assets/consignes/<id>.mp3

Usage :
  python generate_consignes.py            # genere tout
  python generate_consignes.py --only s4  # genere une seule consigne
"""

import argparse
import os
import sys
from pathlib import Path

# Reuse agent.py
sys.path.insert(0, str(Path(__file__).parent))
from agent import generer_voix, VOICE_ID_NARRATEUR

CONSIGNES = {
    # Chapitre 1
    's4':         "Pour reconnaître un chat, qu'a appris la machine ? Tape les bonnes caractéristiques !",
    's5':         "Appuie sur ce que l'IA ne peut PAS faire.",
    # Chapitre 2
    'c2s2':       "Inspecte la machine, trouve les 3 modules !",
    'c2s5':       "Trouve les 3 défauts dans les dessins de l'IA !",
    'c2s7':       "Compose ta phrase en cliquant sur les mots.",
    # Chapitre 3
    'c3s2':       "Attrape les mots qui dansent !",
    'c3s3':       "Aide la machine à écrire le mot !",
    'c3s5':       "Choisis 3 notes — l'IA va inventer une chanson !",
    'c3s7':       "À toi de jouer ! Clique sur un micro et écoute.",
    # Chapitre 4
    'c4s2':       "Pose 3 questions à Bot — tape ou parle !",
    'c4s3':       "Tape vite sur Bot pour qu'il lise 1 million de livres !",
    'c4s5':       "Trouve les 4 paires question / réponse de Bot.",
    'c4s6':       "Choisis une question parmi les 4 proposées.",
    # Chapitre 5
    'c5s2':       "Glisse chaque IA sur son super-pouvoir !",
    'c5s3_phase1':"Photo réelle ou créée par une IA ?",
    'c5s3_phase2':"Promène la loupe sur la photo pour trouver l'erreur.",
    'c5s4':       "Quand je serai grand, je veux inventer...",
    'c5s5':       "Choisis 3 modules pour ton robot.",
}

OUT_DIR = Path("assets/consignes")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", type=str, default=None,
                        help="Genere seulement cette consigne (ex: c4s2)")
    args = parser.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    if args.only:
        if args.only not in CONSIGNES:
            print(f"Consigne inconnue : {args.only}. Disponibles : {list(CONSIGNES.keys())}")
            return
        targets = {args.only: CONSIGNES[args.only]}
    else:
        targets = CONSIGNES

    print(f"Generation de {len(targets)} consigne(s) avec voix narrateur...")
    print(f"Output : {OUT_DIR}/")
    print()

    for cid, text in targets.items():
        filename = f"{cid}.mp3"
        print(f"  [{cid}] '{text[:60]}{'...' if len(text) > 60 else ''}'")
        generer_voix(text, VOICE_ID_NARRATEUR, filename, str(OUT_DIR))

    print()
    print(f"Termine. Fichiers dans {OUT_DIR}/")


if __name__ == "__main__":
    main()
