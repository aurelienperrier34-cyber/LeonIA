# -*- coding: utf-8 -*-
"""
stories_db.py
=============
Module unique pour charger / sauver les stories du Livre magique.

Source de verite : assets/stories/<key>/story.json
ou key = "<level>_<hero>_<place>_<item>_<villain>"

Format JSON :
  {
    "key": "courte_dragon_chateau_guitare_fantome",
    "title": "Brio et la melodie...",
    "level": "courte",
    "hero": "dragon", "place": "chateau", "item": "guitare", "villain": "fantome",
    "pages": [
      {
        "text": "<p>Story content with HTML <em>formatting</em></p>",
        "image_prompt": "Detailed scene description for Gemini Image"
      },
      ...
    ]
  }

Fallback : si le JSON n'existe pas, on lit l'ancien dict STORIES dans
generate_story_images.py (pour Brio, hardcoded historique).
"""

import json
from pathlib import Path

STORIES_DIR = Path("assets/stories")

# Liste exhaustive des combos possibles (3 x 3 x 3 x 3 = 81)
HEROES = ["astronaute", "sorciere", "dragon"]
PLACES = ["planete", "chateau", "ocean"]
ITEMS = ["baguette", "skateboard", "guitare"]
VILLAINS = ["monstre", "robot", "fantome"]
LEVELS = ["courte", "soir", "aventure"]

# Nombre de pages par niveau
LEVEL_PAGES = {
    "courte":   5,   # 3-5 min de lecture
    "soir":     7,   # 7-10 min
    "aventure": 10,  # ~20 min
}


def all_combos():
    """Iterate sur les 81 combos (sans le level)."""
    for h in HEROES:
        for p in PLACES:
            for i in ITEMS:
                for v in VILLAINS:
                    yield (h, p, i, v)


def all_keys(levels=None):
    """Iterate sur toutes les cles (level_combo). 243 total."""
    levels = levels or LEVELS
    for level in levels:
        for h, p, i, v in all_combos():
            yield f"{level}_{h}_{p}_{i}_{v}"


def parse_key(key):
    """Decompose 'level_hero_place_item_villain' en dict."""
    parts = key.split("_")
    if len(parts) != 5:
        raise ValueError(f"Cle invalide : {key}")
    return {
        "key": key,
        "level": parts[0],
        "hero": parts[1], "place": parts[2],
        "item": parts[3], "villain": parts[4],
    }


def story_dir(key):
    return STORIES_DIR / key


def story_path(key):
    return story_dir(key) / "story.json"


def page_image_path(key, page_idx):
    """page_idx commence a 1."""
    return story_dir(key) / f"page{page_idx}.jpg"


def page_audio_path(key, page_idx):
    return story_dir(key) / f"page{page_idx}.mp3"


def load_story(key):
    """Charge une story depuis son JSON. Retourne None si absent."""
    path = story_path(key)
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def save_story(key, story_data):
    """Sauve une story en JSON. Cree le dossier si besoin."""
    d = story_dir(key)
    d.mkdir(parents=True, exist_ok=True)
    story_data["key"] = key
    # Ajoute les champs decomposes pour debug/lecture
    p = parse_key(key)
    for k, v in p.items():
        story_data.setdefault(k, v)
    story_path(key).write_text(
        json.dumps(story_data, indent=2, ensure_ascii=False),
        encoding="utf-8")


def story_exists(key):
    return story_path(key).exists()


def all_existing_keys():
    """Liste les cles dont le story.json existe."""
    if not STORIES_DIR.exists():
        return []
    return sorted([d.name for d in STORIES_DIR.iterdir()
                   if d.is_dir() and (d / "story.json").exists()])


def page_count(key):
    """Nombre de pages attendu pour ce niveau."""
    return LEVEL_PAGES.get(parse_key(key)["level"], 5)
