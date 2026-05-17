# -*- coding: utf-8 -*-
"""
generate_story_images.py
========================
Genere les illustrations d une histoire du Livre magique via Leonardo (flux-dev
par defaut, modifiable). Reutilise generer_image de gen_image.py.

Les prompts par page sont definis dans STORIES dans ce fichier (ou plus tard,
chargees depuis assets/stories/<combo>.json).

Usage :
  python generate_story_images.py --story dragon_chateau_guitare_fantome
  python generate_story_images.py --story dragon_chateau_guitare_fantome --only 1,3
  python generate_story_images.py --story dragon_chateau_guitare_fantome --model flux-dev
"""

import argparse
import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# v502 : on utilise la bible visuelle commune (item_canon.py) pour
# auto-injecter les descriptions canoniques des 4 elements dans CHAQUE prompt
# de page. Garantit que Brio le dragon ressemble au dragon du picker.
from item_canon import get_canon_for_combo, STORY_STYLE as CANON_STORY_STYLE

# Charge .env du projet root
for candidate in [
    Path(__file__).parent / ".env",
    Path(__file__).parent.parent.parent.parent / ".env",
    Path.cwd() / ".env",
]:
    if candidate.exists():
        load_dotenv(candidate)
        print(f"[env] loaded {candidate}")
        break

if not os.getenv("LEONARDO_API_KEY"):
    sys.exit("ERREUR : LEONARDO_API_KEY introuvable dans .env")

# On adapte la fonction generer_image de gen_image.py SANS injecter MASTER_LEON
# (les illustrations d histoires de la Fabrique n ont pas Leon dedans, on a
# d autres heros : dragon, sorciere, astronaute).
import json
import time
import requests

BASE_V1 = "https://cloud.leonardo.ai/api/rest/v1"
LEONARDO_API_KEY = os.getenv("LEONARDO_API_KEY")
HEADERS = {
    "accept": "application/json",
    "content-type": "application/json",
    "authorization": f"Bearer {LEONARDO_API_KEY}",
}
MODELS = {
    "phoenix":      "6b645e3a-d64f-4341-a6d8-7a3690fbf042",  # Phoenix 1.0
    "flux-dev":     "b2614463-296c-462a-9586-aafdb8f00e36",  # Flux Dev
    "flux-schnell": "1dd50843-d653-4516-a8e3-f0238ee453ff",  # Flux Schnell (rapide)
}
STORY_NEGATIVE = (
    "low quality, blurry, watermark, text, letters, deformed, mutated, bad anatomy, "
    "extra limbs, distorted face, ugly, modern clothes, modern technology, no text overlay, "
    "different character design, inconsistent character"
)

def gen_image_story(prompt, dest_path, model_key="flux-dev"):
    print(f"  Leonardo {model_key} -> {dest_path.name}")
    payload = {
        "modelId": MODELS[model_key],
        "prompt": prompt,
        "negative_prompt": STORY_NEGATIVE,
        "width": 1344,
        "height": 768,
        "num_images": 1,
        "guidance_scale": 7,
        "contrast": 3.5,
    }
    r = requests.post(f"{BASE_V1}/generations", json=payload, headers=HEADERS)
    if r.status_code >= 400:
        print(f"  ERREUR init : {r.status_code} {r.text[:300]}")
        return False
    rj = r.json()
    job = rj.get("sdGenerationJob") or rj.get("generate") or rj
    gen_id = job.get("generationId") or job.get("id")
    if not gen_id:
        print(f"  Pas de gen_id : {rj}")
        return False
    print(f"  gen_id={gen_id}  cost={job.get('apiCreditCost')}cr, attente...")
    for i in range(60):
        time.sleep(5)
        s = requests.get(f"{BASE_V1}/generations/{gen_id}", headers=HEADERS).json()
        data = s.get("generations_by_pk") or s
        status = data.get("status") or data.get("state")
        if status in ("FAILED", "ERROR"):
            print(f"  FAILED : {data}")
            return False
        gens = data.get("generated_images") or []
        if gens and gens[0].get("url"):
            url = gens[0]["url"]
            dest_path.parent.mkdir(parents=True, exist_ok=True)
            dest_path.write_bytes(requests.get(url).content)
            print(f"  OK -> {dest_path}")
            return True
    print("  Timeout 5 min")
    return False

# ============================================================
# Style commun pour toutes les illustrations du Livre magique
# (importe depuis item_canon pour rester en phase avec les portraits)
# ============================================================
STORY_STYLE = CANON_STORY_STYLE

# ============================================================
# Catalog des histoires + prompts d images par page
# ============================================================
STORIES = {
    "dragon_chateau_guitare_fantome": [
        # Page 1 - Le chateau oublie
        "A tiny pale blue baby dragon (size of a large cat) with soft sky-blue scales, "
        "standing alone in a vast ruined castle gallery at night. Moonlight streams through "
        "broken windows, ivy climbs the crumbling stone walls. The dragon looks curious and "
        "lonely. Mysterious magical atmosphere. Cool blue and lavender tones with hints of "
        "moonlit silver.",

        # Page 2 - La guitare
        "Close-up of a magical crystal guitar resting on a red velvet cushion in an old "
        "castle hallway. The guitar's six strings shimmer with silver, violet and golden "
        "reflections, glowing softly. A small pale blue baby dragon approaches with wide "
        "curious blue eyes and outstretched paw. Old candles begin to light up in the "
        "background. Warm magical aura, golden particles in the air.",

        # Page 3 - La voix dans la nuit
        "Inside a moonlit stone room at midnight. A tiny pale blue baby dragon holds a "
        "glowing crystal guitar between its paws, eyes closed in concentration. One guitar "
        "string visibly vibrates with magical light waves. In the background, a heavy stone "
        "door slowly creaks open, revealing mysterious darkness beyond. Eerie magical "
        "atmosphere, deep purples and silvery blues.",

        # Page 4 - Le couloir des miroirs
        "Long stone corridor with seven tall ornate golden-framed mirrors along the walls. "
        "Each mirror shows a different scene: a workshop, flames, tools, an empty chair, a "
        "sleeping dog, a window over the sea, and the blurry face of a kind old man with "
        "long white hair and pale grey eyes. A small pale blue baby dragon stands in the "
        "middle of the corridor holding a crystal guitar. Mystical magical lighting.",

        # Page 5 - L atelier d autrefois
        "An old craftsman's workshop full of wood shavings on the floor, half-built lutes "
        "and violins hanging on the walls. A translucent ghostly figure of a young version "
        "of an old white-haired man planes a wooden plank at a workbench. A small pale blue "
        "baby dragon watches from the doorway with awe in its eyes. Warm oil lamp glow, "
        "warm wood tones with magical translucent green-blue ghost light.",

        # Page 6 - Le grand bal
        "A grand ballroom with a checkered black and white marble floor, hundreds of "
        "candles in chandeliers. Elegant ladies in long dresses and gentlemen in tailcoats "
        "waltz gracefully. On a small stage, the translucent ghostly old man plays a "
        "glowing crystal guitar. A tiny pale blue baby dragon watches from the edge of the "
        "dance floor. Festive magical atmosphere, warm golden candlelight reflecting on "
        "everything.",

        # Page 7 - L incendie
        "The castle of Belmondrie at night, engulfed in dramatic red and orange flames. "
        "Sparks rise into the dark sky. The translucent ghostly old white-haired man kneels "
        "outside in despair, his face anguished. Two firemen in old uniforms gently restrain "
        "him. A tiny pale blue baby dragon stands beside the old man, offering up a glowing "
        "crystal guitar with hopeful eyes. Emotional dramatic scene, smoky atmosphere, deep "
        "reds and warm oranges.",

        # Page 8 - Les sept silences
        "A mystical ethereal scene in the corridor of mirrors. A small pale blue baby "
        "dragon strums all seven strings of a glowing crystal guitar at once. All seven "
        "mirrors radiate soft golden light. The translucent ghostly old man stands beside "
        "him with closed eyes, peaceful expression, almost smiling. Floating particles of "
        "musical notes drift in the air. Magical revelatory moment, ethereal silvery-gold "
        "light filling the space.",

        # Page 9 - Le matin nouveau
        "Castle gallery at dawn. A small pale blue baby dragon just waking up on the stone "
        "floor, rubbing its eyes with a tiny paw. Warm sunlight streams through the broken "
        "windows. Tiny yellow flowers bloom on the ivy along the walls. A small braid of "
        "white hair shaped like a star lies on the stone beside the dragon. A crystal "
        "guitar rests nearby. Hopeful peaceful magical morning, warm soft sunlight, golden "
        "and green tones.",

        # Page 10 - Un chateau vivant
        "Cozy interior of the restored castle gallery at night. A small pale blue baby "
        "dragon plays a glowing crystal guitar by candlelight. A family of travelers in "
        "warm winter clothes sit around: two children peacefully asleep on wooden benches, "
        "parents dancing slowly together with tears of joy on their cheeks. Warm golden "
        "candlelight, snow visible falling outside the windows. Heartwarming magical "
        "atmosphere, warm reds, golds and soft browns.",
    ],
}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--story", required=True,
                   help="Nom du combo (sans niveau), ex: dragon_chateau_guitare_fantome")
    p.add_argument("--only", help="Filtre pages (ex: 1 ou 1,3,5)")
    p.add_argument("--model", default="flux-dev",
                   help="Modele Leonardo : flux-dev (defaut), flux-schnell, phoenix, nano-banana")
    args = p.parse_args()

    if args.story not in STORIES:
        sys.exit(f"Histoire inconnue : {args.story}. Disponibles : {list(STORIES.keys())}")

    prompts = STORIES[args.story]
    only = set(int(x) for x in args.only.split(",")) if args.only else None

    # v502 : decompose la cle hero_place_item_villain pour injecter le CANON
    # Les histoires sont nommees ex: "dragon_chateau_guitare_fantome"
    # ou eventuellement prefixees du niveau "aventure_dragon_chateau_..."
    parts = args.story.split("_")
    if len(parts) == 5 and parts[0] in ("courte", "soir", "aventure"):
        hero, place, item, villain = parts[1], parts[2], parts[3], parts[4]
    elif len(parts) == 4:
        hero, place, item, villain = parts
    else:
        print(f"WARN: impossible de decomposer '{args.story}' en (hero,place,item,villain). "
              f"Pas de canon injecte.")
        hero = place = item = villain = None

    canon_prefix = ""
    if hero:
        canon_prefix = get_canon_for_combo(hero, place, item, villain)
        print(f"\n[canon] Injecte pour {hero} + {place} + {item} + {villain}")
        print(f"        ({len(canon_prefix)} chars)")

    out_dir = Path("assets/stories") / args.story
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"\nGeneration de {len(prompts)} illustrations pour '{args.story}'")
    print(f"Modele : {args.model}")
    print(f"Output : {out_dir}/\n")

    success, fail, skipped = 0, 0, 0
    for idx, raw_prompt in enumerate(prompts, 1):
        if only and idx not in only:
            continue
        dest = out_dir / f"page{idx}.jpg"
        if dest.exists():
            print(f"[{idx}/{len(prompts)}] page{idx}.jpg : existe deja (skip)")
            skipped += 1
            continue
        # Ordre : STORY_STYLE -> CANON references -> prompt page-specifique
        full_prompt = STORY_STYLE + canon_prefix + raw_prompt
        print(f"\n[{idx}/{len(prompts)}] page{idx}.jpg")
        ok = gen_image_story(full_prompt, dest, model_key=args.model)
        if ok:
            success += 1
        else:
            fail += 1

    print(f"\nBilan : {success} OK, {fail} echec(s), {skipped} skip(s)")


if __name__ == "__main__":
    main()
