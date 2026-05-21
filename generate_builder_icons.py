# -*- coding: utf-8 -*-
"""
generate_builder_icons.py
=========================
Genere les icones watercolor du builder "Cree ton heros" (remplace les emojis).
Sortie : assets/ui/builder/<field>_<value>.jpg  (carre, fond sombre assorti
aux cartes du builder).

Usage :
  python generate_builder_icons.py
  python generate_builder_icons.py --force
  python generate_builder_icons.py --only type_fille
"""

import argparse
import time
from pathlib import Path

import generate_custom_hero as gch

STYLE = (
    "Simple bold app ICON, watercolor children's-book illustration, soft Pixar "
    "painterly style, CLOSE-UP that fills the frame, thick clean rounded shapes, "
    "warm soft colors, very readable at small size, centered on a deep dark "
    "navy-purple solid background, no text, no watermark, no border. Subject: "
)

ICONS = {
    # --- TYPE (visage/tete mignon) ---
    "type_fille":  "the cute smiling face and head of a cheerful young girl child",
    "type_garcon": "the cute smiling face and head of a cheerful young boy child",
    "type_animal": "an adorable friendly little fox-like animal character face",
    "type_robot":  "a cute friendly little robot head with a glowing happy screen-face",
    # --- CHEVEUX (tete d'enfant montrant la coiffure) ---
    "hair_court":    "a cute child's head with short neat hair",
    "hair_long":     "a cute child's head with long flowing hair",
    "hair_boucle":   "a cute child's head with curly hair",
    "hair_couettes": "a cute child's head with two pigtails",
    "hair_queue":    "a cute child's head with hair in a ponytail",
    "hair_tresse":   "a cute child's head with a long side braid",
    "hair_chauve":   "a cute child's smooth round bald head with no hair",
    # --- TENUE (le vetement) ---
    "outfit_cape":        "a flowing colorful hero cape",
    "outfit_robe":        "a pretty little dress",
    "outfit_salopette":   "blue denim overalls (dungarees)",
    "outfit_pull":        "a cozy knitted sweater",
    "outfit_combinaison": "an adventurer jumpsuit suit",
    "outfit_tshirt":      "a colorful t-shirt",
    "outfit_armure":      "shiny light toy-knight armor breastplate",
    # --- ACCESSOIRE (l'objet) ---
    "accessory_chapeau":   "a pointy magical hat",
    "accessory_couronne":  "a small golden crown",
    "accessory_lunettes":  "round cute eyeglasses",
    "accessory_echarpe":   "a long cozy striped scarf",
    "accessory_sac":       "a small cute explorer backpack",
    "accessory_casquette": "a colorful baseball cap",
    "accessory_noeud":     "a big cute ribbon bow",
    "accessory_aucun":     "a single soft glowing sparkle star (meaning none)",
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--only", help="genere une seule icone (ex: type_fille)")
    ap.add_argument("--delay", type=float, default=8.0)
    args = ap.parse_args()

    out = Path("assets/ui/builder")
    out.mkdir(parents=True, exist_ok=True)
    items = [(k, v) for k, v in ICONS.items() if not args.only or k == args.only]
    ok = fail = skip = 0
    first = True
    for name, subj in items:
        dest = out / (name + ".jpg")
        if dest.exists() and not args.force:
            print(f"[skip] {name}"); skip += 1; continue
        if not first and args.delay > 0:
            time.sleep(args.delay)
        first = False
        print(f"[gen] {name} ...")
        if gch.generate_portrait(STYLE + subj, dest):
            ok += 1
        else:
            fail += 1; print(f"   ECHEC {name}")
    print(f"\nBILAN icones : {ok} OK, {fail} echec(s), {skip} skip(s)")


if __name__ == "__main__":
    main()
