# -*- coding: utf-8 -*-
"""
regen_page.py
=============
Regenere UNE image de page pour une histoire du CATALOGUE (lit story.json,
contrairement a generate_story_gemini.py qui lit l'ancien dict STORIES).

Reutilise la chaine Gemini Image + le canon + les portraits de reference.

Usage (PowerShell / terminal) :
  python regen_page.py soir_astronaute_planete_skateboard_robot 6
  python regen_page.py courte_dragon_chateau_guitare_fantome 3

La cle = <level>_<hero>_<place>_<item>_<villain>. Le numero de page commence a 1.
Si le quota Vertex est sature (reponse vide / 429), reessaie plus tard.
"""

import json
import sys
from pathlib import Path

from item_canon import get_canon_for_combo, get_exclusion_instruction, STORY_STYLE
from generate_story_gemini import (gen_image_gemini, collect_ref_portraits,
                                    auto_detect_refs_for_page)


def regen(key, page_no):
    parts = key.split("_")
    if len(parts) != 5:
        sys.exit(f"Cle invalide : {key} (attendu level_hero_place_item_villain)")
    level, hero, place, item, villain = parts
    d = Path("assets/stories") / key
    sp = d / "story.json"
    if not sp.exists():
        sys.exit(f"story.json introuvable : {sp}")
    story = json.loads(sp.read_text(encoding="utf-8"))
    pages = story.get("pages", [])
    if not (1 <= page_no <= len(pages)):
        sys.exit(f"Page {page_no} hors limites (1..{len(pages)})")
    prompt = pages[page_no - 1]["image_prompt"]

    roles = auto_detect_refs_for_page(prompt, hero, place, item, villain,
                                      always_include=["hero"])
    refs = collect_ref_portraits(hero, place, item, villain, roles)
    full = (STORY_STYLE
            + get_canon_for_combo(hero, place, item, villain, only_roles=roles)
            + get_exclusion_instruction(hero, place, item, villain, roles)
            + prompt)
    dest = d / f"page{page_no}.jpg"
    print(f"[{key}] page {page_no} | refs={list(refs.keys())}")
    ok = gen_image_gemini(full, dest, ref_images=refs)
    print("OK ->", dest if ok else "ECHEC (quota sature ? reessaie plus tard)")
    return ok


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("Usage : python regen_page.py <cle_histoire> <numero_page>")
    sys.exit(0 if regen(sys.argv[1], int(sys.argv[2])) else 1)
