# -*- coding: utf-8 -*-
"""
generate_stories.py
===================
Genere des histoires pour "Le livre magique de Leon" via Claude 3.5 Sonnet.
Combinaisons : 3 heros x 3 lieux x 3 objets x 3 mechants = 81 contes.

Output : assets/stories/<key>.json
Format JSON :
{
  "title": "...",
  "pages": [
    { "text": "...", "image_prompt": "..." },
    ...
  ]
}

Usage :
  python generate_stories.py --combo astronaute_planete_baguette_monstre   # 1 combo
  python generate_stories.py                                                # tous (81)
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path
from dotenv import load_dotenv

# Cherche .env dans plusieurs emplacements possibles (worktree, project root)
for candidate in [
    Path(__file__).parent / ".env",
    Path(__file__).parent.parent.parent.parent / ".env",  # projetappIA/.env
    Path.cwd() / ".env",
]:
    if candidate.exists():
        load_dotenv(candidate)
        print(f"[env] loaded {candidate}")
        break
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
if not ANTHROPIC_API_KEY:
    print("ERREUR : ANTHROPIC_API_KEY introuvable dans .env")
    sys.exit(1)

try:
    from anthropic import Anthropic
except ImportError:
    print("Module 'anthropic' manquant. Installe avec : pip install anthropic")
    sys.exit(1)

client = Anthropic(api_key=ANTHROPIC_API_KEY)
MODEL = "claude-3-5-sonnet-20241022"

HEROS = {
    "astronaute": "une astronaute (donne-lui un prenom comme Mila, Sami ou Yuna)",
    "sorciere":   "une sorciere (donne-lui un prenom comme Lila, Nour ou Ines)",
    "dragon":     "un jeune dragon (donne-lui un prenom comme Tao, Brio ou Kibo)",
}
LIEUX = {
    "planete": "une planete lointaine aux paysages etranges et merveilleux",
    "chateau": "un grand chateau plein de couloirs secrets et de tours",
    "ocean":   "le fond de l'ocean, peuple de creatures fascinantes",
}
OBJETS = {
    "baguette":   "une baguette magique aux pouvoirs surprenants",
    "skateboard": "un skateboard magique qui peut faire des choses extraordinaires",
    "guitare":    "une guitare magique dont la musique a des effets surnaturels",
}
MECHANTS = {
    "monstre": "un monstre intimidant",
    "robot":   "un robot devenu fou",
    "fantome": "un fantome facetieux",
}

def make_prompt(hero_key, place_key, item_key, villain_key):
    hero = HEROS[hero_key]
    place = LIEUX[place_key]
    item = OBJETS[item_key]
    villain = MECHANTS[villain_key]
    return f"""Tu es un auteur jeunesse francophone reconnu, dans le style de Roald Dahl
et Susie Morgenstern. Tu ecris pour des enfants de 5 a 9 ans.

Ecris un conte court avec ces ingredients :
- Heros : {hero}
- Lieu  : {place}
- Objet magique : {item}
- Defi / mechant : {villain}

EXIGENCES NARRATIVES :
- Structure classique en 6 pages : situation initiale, element declencheur,
  premiere peripetie, climax, resolution, conclusion satisfaisante.
- Vraie intrigue avec une emotion (peur, courage, amitie, decouverte de soi).
- Le "mechant" peut etre nuance : pas forcement mauvais, peut-etre incompris.
- Au moins UN dialogue par page.
- Vocabulaire riche mais accessible (eviter mots techniques sans explication).
- Phrases variees (courtes punchy, longues descriptives, exclamations).
- Aucune morale plaquee a la fin ; le message doit emerger naturellement.
- Eviter les cliches eculees ("Il etait une fois...", "ils vecurent heureux...").
- Le heros a une personnalite, des doutes, pas un super-heros parfait.

LONGUEUR : ~120-180 mots par page (texte denser que pour les tout-petits).

POUR CHAQUE PAGE, FOURNIR AUSSI :
- "image_prompt" : description visuelle precise et evocatrice pour generer
  une illustration style aquarelle/Pixar enfantine (~30-50 mots, en anglais).

FORMAT DE SORTIE STRICT (JSON valide, RIEN d'autre, pas de markdown) :
{{
  "title": "Titre original de l'histoire (pas commence par 'Il etait...')",
  "pages": [
    {{
      "text": "Page 1 du conte...",
      "image_prompt": "Watercolor illustration, ..."
    }},
    ... 6 pages au total
  ]
}}
"""

def generate_story(combo_key):
    parts = combo_key.split("_")
    if len(parts) != 4:
        print(f"  cle invalide : {combo_key}")
        return None
    h, p, i, v = parts
    if h not in HEROS or p not in LIEUX or i not in OBJETS or v not in MECHANTS:
        print(f"  composant invalide dans {combo_key}")
        return None

    prompt = make_prompt(h, p, i, v)
    print(f"  -> generation Claude...")
    try:
        msg = client.messages.create(
            model=MODEL,
            max_tokens=4000,
            messages=[{"role": "user", "content": prompt}]
        )
        raw = msg.content[0].text.strip()
        # Strip markdown code fences si presents
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.strip()
        data = json.loads(raw)
        if "title" not in data or "pages" not in data:
            print(f"  format inattendu : {list(data.keys())}")
            return None
        if len(data["pages"]) != 6:
            print(f"  ATTENTION : {len(data['pages'])} pages au lieu de 6")
        return data
    except json.JSONDecodeError as e:
        print(f"  ERREUR JSON : {e}")
        print(f"  raw (debut): {raw[:300]}")
        return None
    except Exception as e:
        print(f"  ERREUR API : {e}")
        return None

def save_story(combo_key, data):
    out_dir = Path("assets/stories")
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{combo_key}.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"  OK -> {out_path}")
    return out_path

def all_combos():
    combos = []
    for h in HEROS:
        for p in LIEUX:
            for i in OBJETS:
                for v in MECHANTS:
                    combos.append(f"{h}_{p}_{i}_{v}")
    return combos

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--combo", type=str, default=None,
                        help="1 seule combinaison (ex: astronaute_planete_baguette_monstre)")
    parser.add_argument("--skip-existing", action="store_true",
                        help="Skip les histoires deja generees (assets/stories/<key>.json existe)")
    args = parser.parse_args()

    if args.combo:
        targets = [args.combo]
    else:
        targets = all_combos()

    print(f"Generation de {len(targets)} histoire(s) avec Claude 3.5 Sonnet...")
    print()

    success, fail, skipped = 0, 0, 0
    for idx, combo in enumerate(targets, 1):
        out_path = Path("assets/stories") / f"{combo}.json"
        if args.skip_existing and out_path.exists():
            print(f"[{idx}/{len(targets)}] {combo} : skip (existe deja)")
            skipped += 1
            continue
        print(f"[{idx}/{len(targets)}] {combo}")
        data = generate_story(combo)
        if data:
            save_story(combo, data)
            success += 1
        else:
            fail += 1
        time.sleep(1)  # politesse API

    print()
    print(f"Bilan : {success} OK, {fail} echec(s), {skipped} skip(s)")

if __name__ == "__main__":
    main()
