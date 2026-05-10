"""
regenerate_all_narrators.py
============================
Regenere TOUTES les voix narrateur du jeu (chap 1 + chap 3) avec la nouvelle
config ElevenLabs (eleven_turbo_v2_5 + language_code fr + stability 0.8).

Le chapitre 2 n'a pas de voix narrateur, on l'ignore.

Usage :
    python regenerate_all_narrators.py            # tout regenerer
    python regenerate_all_narrators.py --chap 1   # uniquement chapitre 1
    python regenerate_all_narrators.py --chap 3   # uniquement chapitre 3
    python regenerate_all_narrators.py --dry-run  # liste sans appeler ElevenLabs
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
from agent import generer_voix, VOICE_ID_NARRATEUR, VOICE_ID_LEON


def trim_trailing_silence(mp3_path):
    """Coupe le silence en fin de fichier mp3 (>0.4s sous -40dB) via ffmpeg.
    Empeche le bug 'la video demarre trop tard apres le narrateur' qui arrive
    quand ElevenLabs ajoute du silence en queue de fichier."""
    if not os.path.exists(mp3_path):
        return
    if shutil.which("ffmpeg") is None:
        print(f"     WARN trim : ffmpeg pas trouve, silence garde sur {mp3_path}")
        return
    tmp = mp3_path + ".trimmed.mp3"
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", mp3_path,
             "-af", "silenceremove=stop_periods=-1:stop_duration=0.4:stop_threshold=-40dB",
             tmp],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            check=True
        )
        os.replace(tmp, mp3_path)
        print(f"     OK trim silence final sur {os.path.basename(mp3_path)}")
    except subprocess.CalledProcessError as e:
        print(f"     WARN trim KO : {e}")
        if os.path.exists(tmp):
            os.remove(tmp)


# Chapitre 1 : fichiers individuels avec textes hardcodes (extraits de index.html)
CHAP1_NARRATORS = [
    {
        "fichier": "ce_matin.mp3",
        "dossier": "assets",
        "texte": "Ce matin, tu te promènes dans la ville... Au bout de la rue, tu aperçois une étrange boutique magique : l'Atelier de Léon. Et si tu allais voir de plus près ?"
    },
    {
        "fichier": "voix_narrateur_3.mp3",
        "dossier": "assets",
        "texte": "Derrière le comptoir, voici Léon. Son atelier magique fabrique des choses grâce à l'IA !"
    },
    {
        "fichier": "au_coeur.mp3",
        "dossier": "assets",
        "texte": "Au cœur de l'atelier, Léon s'approche de sa machine mystérieuse."
    },
]

# Voix Léon du chap 1 (S3 = rencontre, S4 = machine mystérieuse).
# Pas de scenar_chap1_json.txt → on stocke les textes ici.
CHAP1_LEON = [
    {
        "fichier": "Voix_leon_3.mp3",
        "dossier": "assets",
        "texte": "Ah, un explorateur ! Veux-tu savoir ce que c'est, l'IA ?"
    },
    {
        "fichier": "Voix_leon_4.mp3",
        "dossier": "assets",
        "texte": "L'IA, c'est une machine qui apprend. On lui montre plein d'exemples... et après, elle t'aide à créer ! Pour reconnaître un chat, qu'a appris la machine ? Tape les bonnes caractéristiques !"
    },
]


def regen_chap1(dry_run=False, include_leon=True):
    print("\n=== CHAPITRE 1 ===")
    n = 0
    # Narrateurs
    for item in CHAP1_NARRATORS:
        chemin = os.path.join(item["dossier"], item["fichier"])
        print(f"  -> {chemin}  (narrateur)")
        print(f"     texte: {item['texte'][:70]}...")
        if dry_run:
            continue
        if os.path.exists(chemin):
            os.remove(chemin)
        generer_voix(item["texte"], VOICE_ID_NARRATEUR, item["fichier"], item["dossier"])
        trim_trailing_silence(chemin)
        n += 1
    # Voix Léon (S3, S4)
    if include_leon and VOICE_ID_LEON:
        for item in CHAP1_LEON:
            chemin = os.path.join(item["dossier"], item["fichier"])
            print(f"  -> {chemin}  (Léon)")
            print(f"     texte: {item['texte'][:70]}...")
            if dry_run:
                continue
            if os.path.exists(chemin):
                os.remove(chemin)
            generer_voix(item["texte"], VOICE_ID_LEON, item["fichier"], item["dossier"])
            trim_trailing_silence(chemin)
            n += 1
    return n



def regen_chap_json(chapitre_num, dry_run=False, only=None, include_leon=True):
    """Régénère narrateurs (et Léon si include_leon) pour un chapitre lu depuis son JSON."""
    print(f"\n=== CHAPITRE {chapitre_num} ===")
    json_path = f"scenar_chap{chapitre_num}_json.txt"
    if not os.path.exists(json_path):
        json_path = f"scenar_chap{chapitre_num}.json"
    if not os.path.exists(json_path):
        print(f"  /!\\ scenar_chap{chapitre_num}_json.txt introuvable, ignoré.")
        return 0
    with open(json_path, encoding="utf-8") as f:
        tableaux = json.load(f)
    dossier = f"assets/chapitre_{chapitre_num}"
    os.makedirs(dossier, exist_ok=True)
    n = 0
    # NB : ne JAMAIS recopier vers assets/ — chaque chapitre a son propre dossier
    # assets/chapitre_N/, app.js référence directement ces dossiers. Une copie
    # plate vers assets/tN_*.mp3 écraserait silencieusement les autres chapitres.
    for t in tableaux:
        tid = t["tableau"]
        if only and tid not in only:
            continue
        # Narrateur
        narr_text = (t.get("narrateur") or "").strip()
        if narr_text:
            nom = f"t{tid}_narrateur.mp3"
            chemin = os.path.join(dossier, nom)
            print(f"  -> {chemin}  (narrateur)")
            if not dry_run:
                if os.path.exists(chemin):
                    try: os.remove(chemin)
                    except OSError: pass  # sera écrasé en write binaire ensuite
                generer_voix(narr_text, VOICE_ID_NARRATEUR, nom, dossier)
                trim_trailing_silence(chemin)
                n += 1
        # Léon
        if include_leon:
            leon_text = (t.get("leon") or "").strip()
            if leon_text:
                # Retire les guillemets «» pour TTS plus propre
                leon_text = leon_text.replace("«", "").replace("»", "").strip()
                nom = f"t{tid}_leon.mp3"
                chemin = os.path.join(dossier, nom)
                print(f"  -> {chemin}  (Léon)")
                if not dry_run:
                    if os.path.exists(chemin):
                        try: os.remove(chemin)
                        except OSError: pass  # sera écrasé en write binaire ensuite
                    generer_voix(leon_text, VOICE_ID_LEON, nom, dossier)
                    trim_trailing_silence(chemin)
                    n += 1
    return n


def regen_chap3(dry_run=False, only=None):
    """Régénère narrateur ET Léon pour chap 3 (lecture du JSON)."""
    print("\n=== CHAPITRE 3 ===")
    json_path = "scenar_chap3_json.txt"
    if not os.path.exists(json_path):
        print(f"  /!\\ {json_path} introuvable, chapitre 3 saute.")
        return 0
    with open(json_path, encoding="utf-8") as f:
        tableaux = json.load(f)
    dossier = "assets/chapitre_3"
    os.makedirs(dossier, exist_ok=True)
    n = 0
    for t in tableaux:
        if only and t["tableau"] not in only:
            continue
        # Narrateur
        narr_text = (t.get("narrateur") or "").strip()
        if narr_text:
            nom = f"t{t['tableau']}_narrateur.mp3"
            chemin = os.path.join(dossier, nom)
            print(f"  -> {chemin}")
            print(f"     texte: {narr_text[:70]}...")
            if not dry_run:
                if os.path.exists(chemin):
                    try: os.remove(chemin)
                    except OSError: pass
                generer_voix(narr_text, VOICE_ID_NARRATEUR, nom, dossier)
                trim_trailing_silence(chemin)
                n += 1
        # Léon
        leon_text = (t.get("leon") or "").strip()
        if leon_text and VOICE_ID_LEON:
            # Retire les guillemets «» pour TTS plus propre
            leon_text = leon_text.replace("«", "").replace("»", "").strip()
            nom = f"t{t['tableau']}_leon.mp3"
            chemin = os.path.join(dossier, nom)
            print(f"  -> {chemin}  (Léon)")
            print(f"     texte: {leon_text[:70]}...")
            if not dry_run:
                if os.path.exists(chemin):
                    try: os.remove(chemin)
                    except OSError: pass
                generer_voix(leon_text, VOICE_ID_LEON, nom, dossier)
                trim_trailing_silence(chemin)
                n += 1
    return n


def main():
    parser = argparse.ArgumentParser(description="Regenere les voix narrateur")
    parser.add_argument("--chap", type=int, choices=[1, 2, 3, 4, 5],
                        help="Filtre par chapitre (1, 2, 3, 4 ou 5). Defaut : tous.")
    parser.add_argument("--dry-run", action="store_true",
                        help="Affiche ce qui serait fait sans appeler ElevenLabs.")
    parser.add_argument("--only", help="Filtre tableaux chap 3 (ex: 2 ou 1,3,5)")
    args = parser.parse_args()

    if not VOICE_ID_NARRATEUR:
        print("ERREUR : VOICE_ID_NARRATEUR manquant dans .env")
        sys.exit(1)

    total = 0
    if args.chap is None or args.chap == 1:
        total += regen_chap1(dry_run=args.dry_run)
    only = set(int(x) for x in args.only.split(",")) if args.only else None
    if args.chap is None or args.chap == 3:
        total += regen_chap3(dry_run=args.dry_run, only=only)
    if args.chap == 2:
        total += regen_chap_json(2, dry_run=args.dry_run, only=only, include_leon=True)
    if args.chap == 4:
        total += regen_chap_json(4, dry_run=args.dry_run, only=only, include_leon=True)
    if args.chap == 5:
        total += regen_chap_json(5, dry_run=args.dry_run, only=only, include_leon=True)

    suffix = " (dry-run)" if args.dry_run else ""
    print(f"\nOK. {total} narrateurs regeneres{suffix}.")


if __name__ == "__main__":
    main()
