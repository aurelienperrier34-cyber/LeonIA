# -*- coding: utf-8 -*-
"""
generate_item_portraits.py
==========================
Genere les 12 portraits canoniques du picker "Livre magique de Leon" via
Leonardo Flux Dev. Format carre 768x768 (card pour l'UI).

Source unique de verite : item_canon.py (descriptions canoniques).

Output : assets/items/<categorie>_<value>.jpg
  ex: assets/items/hero_dragon.jpg
      assets/items/place_chateau.jpg
      assets/items/item_guitare.jpg
      assets/items/villain_fantome.jpg

Usage :
  python generate_item_portraits.py                    # genere les 12
  python generate_item_portraits.py --only dragon      # seulement dragon
  python generate_item_portraits.py --only dragon,fantome
  python generate_item_portraits.py --model flux-schnell  # 2x plus rapide
  python generate_item_portraits.py --force            # regenere meme si existe
"""

import argparse
import os
import sys
import time
import requests
from pathlib import Path
from dotenv import load_dotenv

from item_canon import ITEM_CANON, PORTRAIT_STYLE, PORTRAIT_NEGATIVE

# ============================================================
# Setup .env + API
# ============================================================
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

BASE_V1 = "https://cloud.leonardo.ai/api/rest/v1"
HEADERS = {
    "accept": "application/json",
    "content-type": "application/json",
    "authorization": f"Bearer {os.getenv('LEONARDO_API_KEY')}",
}
MODELS = {
    "phoenix":      "6b645e3a-d64f-4341-a6d8-7a3690fbf042",
    "flux-dev":     "b2614463-296c-462a-9586-aafdb8f00e36",
    "flux-schnell": "1dd50843-d653-4516-a8e3-f0238ee453ff",
}


def gen_portrait(prompt, dest_path, model_key="flux-dev"):
    """Genere un portrait carre 768x768 et l'enregistre."""
    print(f"  Leonardo {model_key} -> {dest_path.name}")
    payload = {
        "modelId": MODELS[model_key],
        "prompt": prompt,
        "negative_prompt": PORTRAIT_NEGATIVE,
        "width": 768,
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


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--only", help="Filtre values (ex: dragon ou dragon,fantome)")
    p.add_argument("--cat", help="Filtre categories (hero,place,item,villain)")
    p.add_argument("--model", default="flux-dev",
                   help="Modele Leonardo : flux-dev (defaut), flux-schnell, phoenix")
    p.add_argument("--force", action="store_true",
                   help="Regenere meme si le fichier existe deja")
    args = p.parse_args()

    only_vals = set(v.strip() for v in args.only.split(",")) if args.only else None
    only_cats = set(c.strip() for c in args.cat.split(",")) if args.cat else None

    out_dir = Path("assets/items")
    out_dir.mkdir(parents=True, exist_ok=True)

    # Construit la liste des items a generer
    todo = []
    for category, items in ITEM_CANON.items():
        if only_cats and category not in only_cats:
            continue
        for value, data in items.items():
            if only_vals and value not in only_vals:
                continue
            todo.append((category, value, data))

    print(f"\nGeneration de {len(todo)} portrait(s) - modele {args.model}")
    print(f"Output : {out_dir}/\n")

    success, fail, skipped = 0, 0, 0
    for idx, (cat, val, data) in enumerate(todo, 1):
        dest = out_dir / f"{cat}_{val}.jpg"
        if dest.exists() and not args.force:
            print(f"[{idx}/{len(todo)}] {dest.name} : existe (skip, --force pour regenerer)")
            skipped += 1
            continue
        full_prompt = PORTRAIT_STYLE + data["portrait"]
        print(f"\n[{idx}/{len(todo)}] {cat}/{val} ({data['label']})")
        ok = gen_portrait(full_prompt, dest, model_key=args.model)
        if ok:
            success += 1
        else:
            fail += 1

    print(f"\nBilan : {success} OK, {fail} echec(s), {skipped} skip(s)")
    if success > 0:
        print(f"\nLes portraits sont dans {out_dir}/")
        print("Pense a commit + push pour les voir dans l'app.")


if __name__ == "__main__":
    main()
