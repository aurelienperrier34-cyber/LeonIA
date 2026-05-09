"""
regenerate_narrators.py
========================
Régénère uniquement les voix NARRATEUR (pas Léon) pour un chapitre donné,
en utilisant la config ElevenLabs corrigée (eleven_turbo_v2_5 + language_code fr + stability 0.8).

Usage :
    python regenerate_narrators.py 3
    python regenerate_narrators.py 3 --keep   # ne pas écraser si le fichier existe déjà

Le JSON source attendu est scenar_chap{N}_json.txt à la racine du projet.
Les MP3 sont écrits dans assets/chapitre_{N}/t{i}_narrateur.mp3
"""

import argparse
import json
import os
import sys
from agent import generer_voix, VOICE_ID_NARRATEUR


def main():
    parser = argparse.ArgumentParser(description="Régénère les voix narrateur d'un chapitre.")
    parser.add_argument("chapitre", type=int, help="Numéro du chapitre (ex: 3)")
    parser.add_argument("--keep", action="store_true",
                        help="Ne pas écraser les fichiers existants.")
    parser.add_argument("--only", help="Filtre tableaux (ex: 1,3,5).")
    args = parser.parse_args()

    json_path = f"scenar_chap{args.chapitre}_json.txt"
    if not os.path.exists(json_path):
        json_path = f"scenar_chap{args.chapitre}.json"
    if not os.path.exists(json_path):
        print(f"ERREUR : ni scenar_chap{args.chapitre}_json.txt ni .json trouvé")
        sys.exit(1)

    dossier_cible = f"assets/chapitre_{args.chapitre}"
    os.makedirs(dossier_cible, exist_ok=True)

    if not VOICE_ID_NARRATEUR:
        print("ERREUR : VOICE_ID_NARRATEUR manquant dans .env")
        sys.exit(1)

    with open(json_path, encoding="utf-8") as f:
        tableaux = json.load(f)

    only = set(int(x) for x in args.only.split(",")) if args.only else None

    n_done = 0
    for t in tableaux:
        tid = t.get("tableau")
        narrateur = t.get("narrateur", "").strip()
        if not narrateur:
            continue
        if only and tid not in only:
            continue
        nom = f"t{tid}_narrateur.mp3"
        chemin = os.path.join(dossier_cible, nom)
        if args.keep and os.path.exists(chemin):
            print(f"⏭️  T{tid} : conservé ({nom} existe déjà)")
            continue
        if os.path.exists(chemin):
            os.remove(chemin)
            print(f"🗑️  T{tid} : ancien fichier supprimé")
        generer_voix(narrateur, VOICE_ID_NARRATEUR, nom, dossier_cible)
        n_done += 1

    print(f"\n✅ Terminé : {n_done} narrateur(s) régénéré(s) dans {dossier_cible}")


if __name__ == "__main__":
    main()
