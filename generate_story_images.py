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
# v503 : validateur Gemini optionnel (si GEMINI_API_KEY dans .env)
try:
    from verify_story_image import verify_image, auto_portraits
    _HAS_VERIFIER = True
except Exception as _e:
    print(f"[verify] module verifier indisponible : {_e}")
    _HAS_VERIFIER = False

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
    # Qualite et coherence visuelle
    "low quality, blurry, watermark, text, letters, deformed, mutated, "
    "bad anatomy, extra limbs, distorted face, ugly, modern clothes, "
    "modern technology, no text overlay, "
    "different character design, inconsistent character, character drift, "
    # Anti-scary (livre pour enfants 5-9 ans)
    "scary face, sharp fangs, glowing red eyes, threatening pose, "
    "horror, terrifying, nightmare fuel, dark threatening atmosphere, "
    "blood, weapons, gore, evil expression, demonic, sinister, "
    # Anti-drift dragon specifique (corrige Brio v1)
    "dragon with hair, dragon with beard, grey scales, white scales, "
    "old dragon, elderly dragon, large adult dragon, fire-breathing"
)

def upload_init_image(image_path):
    """Upload une image vers Leonardo, retourne l'imageId (pour reference)."""
    ext = image_path.suffix.lstrip(".").lower()
    if ext == "jpg":
        ext = "jpeg"
    r = requests.post(f"{BASE_V1}/init-image", json={"extension": ext}, headers=HEADERS)
    if r.status_code != 200:
        print(f"   WARN upload init: {r.text[:200]}")
        return None
    data = r.json()["uploadInitImage"]
    fields = json.loads(data["fields"])
    with image_path.open("rb") as f:
        up = requests.post(data["url"], data=fields, files={"file": f})
    if up.status_code in (200, 204):
        return data["id"]
    print(f"   WARN S3: {up.status_code}")
    return None


def gen_image_story(prompt, dest_path, model_key="flux-dev",
                    char_ref_ids=None, char_ref_strength="High",
                    extra_negative=""):
    """
    Genere une illustration de story.
    char_ref_ids : LISTE d'image_ids deja uploades sur Leonardo (portraits canon).
                   - Pour Flux : utilise imagePrompts (soft guidance multi-ref)
                   - Pour Phoenix : utilise controlnets Character Reference (1 ref)
    """
    print(f"  Leonardo {model_key} -> {dest_path.name}")
    full_neg = STORY_NEGATIVE + (" " + extra_negative if extra_negative else "")
    payload = {
        "modelId": MODELS[model_key],
        "prompt": prompt,
        "negative_prompt": full_neg,
        "width": 1344,
        "height": 768,
        "num_images": 1,
        "guidance_scale": 7,
        "contrast": 3.5,
    }
    if char_ref_ids:
        # Normalise en liste (compat avec ancien arg single)
        if isinstance(char_ref_ids, str):
            char_ref_ids = [char_ref_ids]
        is_flux = model_key.startswith("flux")
        if is_flux:
            # Flux Dev/Schnell : imagePrompts (soft image guidance, multi-ref OK)
            payload["imagePrompts"] = char_ref_ids[:4]  # max 4 raisonnable
            print(f"   imagePrompts (Flux soft guidance): {len(char_ref_ids[:4])} ref(s)")
        else:
            # Phoenix : Character Reference fort (1 ref seulement)
            payload["controlnets"] = [{
                "initImageId": char_ref_ids[0],
                "initImageType": "UPLOADED",
                "preprocessorId": 133,   # Character Reference (Phoenix)
                "strengthType": char_ref_strength,
            }]
            print(f"   Character Reference (Phoenix): {char_ref_strength}")
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
                   help="Modele Leonardo : flux-dev (defaut), flux-schnell, phoenix")
    p.add_argument("--charref-strength", default="High",
                   choices=["Low", "Mid", "High", "Max"],
                   help="Force de la Character Reference (defaut: High)")
    p.add_argument("--no-charref", action="store_true",
                   help="Desactive la Character Reference meme si le portrait existe")
    p.add_argument("--force", action="store_true",
                   help="Regenere meme si la page existe deja")
    p.add_argument("--verify", action="store_true",
                   help="Active la validation Gemini Vision apres chaque generation")
    p.add_argument("--max-retries", type=int, default=3,
                   help="Nombre max de tentatives par page si verify echoue (defaut 3)")
    p.add_argument("--lax", action="store_true",
                   help="Mode laxe : accepte tant que kid_safe meme si character drift")
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

    # v502+v504 : upload les portraits canon (hero + villain + item + place)
    # et les passe TOUS en reference soft (Flux imagePrompts) ou la seule premiere
    # en Character Reference fort (Phoenix). Verrouille l'apparence sur le canon.
    char_ref_ids = []
    if not args.no_charref:
        roles = [("hero", hero), ("villain", villain), ("item", item), ("place", place)]
        for role, val in roles:
            if not val:
                continue
            pp = Path("assets/items") / f"{role}_{val}.jpg"
            if not pp.exists():
                print(f"[charref] WARN portrait {pp} introuvable - skip")
                continue
            print(f"[charref] Upload {pp.name}...")
            uid = upload_init_image(pp)
            if uid:
                char_ref_ids.append(uid)
                print(f"[charref]   OK imageId={uid}")
            else:
                print(f"[charref]   WARN upload echoue pour {role}/{val}")
    if not char_ref_ids:
        print("[charref] Aucun portrait charge -> generation sans reference visuelle (drift possible)")

    print(f"\nGeneration de {len(prompts)} illustrations pour '{args.story}'")
    print(f"Modele : {args.model}")
    print(f"Output : {out_dir}/")
    print(f"Image References: {len(char_ref_ids)} portrait(s) canon en guidance\n")

    # Setup portraits canon a passer au verifier pour comparaison directe
    verify_portraits = None
    if args.verify and _HAS_VERIFIER and hero:
        verify_portraits = auto_portraits(hero, place, item, villain)
        if verify_portraits:
            print(f"[verify] Portraits canon disponibles pour comparaison: "
                  f"{list(verify_portraits.keys())}")

    success, fail, skipped, retried = 0, 0, 0, 0
    for idx, raw_prompt in enumerate(prompts, 1):
        if only and idx not in only:
            continue
        dest = out_dir / f"page{idx}.jpg"
        if dest.exists() and not args.force:
            print(f"[{idx}/{len(prompts)}] page{idx}.jpg : existe deja (skip, --force pour regenerer)")
            skipped += 1
            continue

        # Ordre : STORY_STYLE -> CANON references -> prompt page-specifique
        full_prompt = STORY_STYLE + canon_prefix + raw_prompt
        print(f"\n[{idx}/{len(prompts)}] page{idx}.jpg")

        # Boucle generate -> verify -> retry-with-corrected-negative
        attempt = 0
        page_ok = False
        extra_neg = ""
        max_tries = args.max_retries if args.verify and _HAS_VERIFIER else 1
        while attempt < max_tries:
            attempt += 1
            if attempt > 1:
                print(f"   --- TENTATIVE {attempt}/{max_tries} ---")
                # Si le fichier existe d'un essai precedent, on le supprime
                if dest.exists():
                    dest.unlink()
            ok = gen_image_story(full_prompt, dest, model_key=args.model,
                                 char_ref_ids=char_ref_ids,
                                 char_ref_strength=args.charref_strength,
                                 extra_negative=extra_neg)
            if not ok:
                print(f"   Generation echec (tentative {attempt})")
                continue

            # Verification optionnelle
            if not args.verify or not _HAS_VERIFIER:
                page_ok = True
                break

            print(f"   [verify] Gemini Vision...")
            vr = verify_image(dest, hero=hero, place=place,
                              item=item, villain=villain,
                              prompt=raw_prompt,
                              portrait_paths=verify_portraits,
                              strict=not args.lax)
            if vr.get("skipped"):
                print(f"   [verify] skipped: {vr.get('reason')}")
                page_ok = True
                break
            if vr.get("error"):
                print(f"   [verify] ERREUR: {vr['error']} (on garde l'image quand meme)")
                page_ok = True
                break
            if vr.get("ok"):
                print(f"   [verify] OK -> canon:{vr.get('matches_canon')} "
                      f"prompt:{vr.get('matches_prompt')} kid_safe:{vr.get('kid_safe')}")
                page_ok = True
                break
            # KO : on REMPLACE le negative (pas accumulation -> overflow 1000 chars)
            # Chaque retry repart sur les nouveaux problemes observes par Gemini.
            issues = vr.get("issues", [])
            print(f"   [verify] KO ({len(issues)} probleme(s)) :")
            for iss in issues:
                print(f"           - {iss}")
            extra_neg = vr.get("extra_negative", "")
            # Garde anti-overflow : Leonardo plafonne a 1000 chars (STORY_NEGATIVE
            # fait deja ~700 chars, donc extra_neg max ~250 chars)
            if len(extra_neg) > 250:
                extra_neg = extra_neg[:250].rsplit(",", 1)[0]
            if extra_neg:
                print(f"   [verify] negative remplace par : {extra_neg}")
            retried += 1

        if page_ok:
            success += 1
        else:
            print(f"   [{idx}] ECHEC apres {max_tries} tentatives - log pour review manuelle")
            fail += 1

    print(f"\nBilan : {success} OK, {fail} echec(s), {skipped} skip(s), {retried} retry(s)")


if __name__ == "__main__":
    main()
