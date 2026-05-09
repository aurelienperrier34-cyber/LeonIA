"""
generate_c1s4_features.py
=========================
Génère 6 icônes "emoji custom" pour le mini-jeu c1s4 (reconnaître un chat).
Style cohérent : kawaii cartoon 3D Pixar, fond crème pastel uniforme.

Coût estimé : ~6×8 = 48 crédits avec Phoenix + Alchemy à 1024x1024.

Usage:
  python generate_c1s4_features.py
  python generate_c1s4_features.py --only pattes
  python generate_c1s4_features.py --model 5c232a9e-9061-4777-980a-ddc8e65647c6
"""

import os
import sys
import time
import argparse
import requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()
API_KEY = os.getenv("LEONARDO_API_KEY")
if not API_KEY:
    print("LEONARDO_API_KEY manquante dans .env", file=sys.stderr)
    sys.exit(1)

BASE = "https://cloud.leonardo.ai/api/rest/v1"
HEADERS = {
    "accept": "application/json",
    "content-type": "application/json",
    "authorization": f"Bearer {API_KEY}",
}

# Phoenix v1.0 — bon pour le rendu cartoon propre
PHOENIX_V1 = "5c232a9e-9061-4777-980a-ddc8e65647c6"

STYLE_BASE = (
    "cute kawaii cartoon icon, 3D Pixar-style render, soft rounded shapes, "
    "vibrant pastel colors, big chunky outlines, friendly child-friendly design, "
    "single object centered, isolated on solid pastel cream background, "
    "soft shadow underneath, glossy plastic toy feel, no text no logos, "
    "square 1:1 composition, padding 15% around the object"
)

NEGATIVE = "text, watermark, logo, multiple objects, photograph, realistic, scary, dark, blurry, low quality, deformed"

FEATURES = {
    "pattes": (
        "a single fluffy orange cat paw print stamped, 4 small toe beans in light pink, "
        "one large central pad in dark pink, soft fur texture around, viewed from front, "
        "plush cute icon"
    ),
    "moustaches": (
        "a cat's pink nose and snout close-up with 6 long curly white whiskers extending "
        "sideways, small pink nose triangle, fluffy white fur, no full face just the muzzle area, "
        "kawaii sticker style"
    ),
    "oreilles": (
        "two pointy fluffy cat ears, triangular shape, orange fur on outside, pink inside, "
        "slightly tilted forward like alert, no head visible just the ears floating, "
        "sparkles around"
    ),
    "queue": (
        "a single fluffy orange cat tail curled in a question-mark shape, striped with darker "
        "orange rings, white tip, soft fur texture, viewed from side, no body just the tail, "
        "dynamic curving pose"
    ),
    "plumes": (
        "three colorful bird feathers fanned out, blue cyan and yellow, soft barbs visible, "
        "light shimmer, no bird just feathers, lying flat, glossy iridescent edges"
    ),
    "coquille": (
        "a cute spiral seashell, pastel pink and cream stripes, glossy surface, small bubbles "
        "around, viewed from above, no creature inside, beach kawaii icon"
    ),
    "ecailles": (
        "a chubby cute cartoon fish, side view, body covered in big shiny iridescent scales "
        "in blue cyan and silver, scales clearly visible and detailed, small fins, pastel ocean "
        "blue background, kawaii ocean character"
    ),
}


def generate_one(name, subject_prompt, model_id, out_dir):
    """Lance la génération d'une image et la télécharge."""
    full_prompt = f"{STYLE_BASE}. {subject_prompt}"
    payload = {
        "modelId": model_id,
        "prompt": full_prompt,
        "negative_prompt": NEGATIVE,
        "width": 1024,
        "height": 1024,
        "num_images": 1,
        "guidance_scale": 7,
        "num_inference_steps": 30,
        "alchemy": True,         # rendu propre (on veut un bel icone)
        "photoReal": False,
        "promptMagic": False,
        "public": False,
    }
    print(f"  [{name}] Lancement...")
    r = requests.post(f"{BASE}/generations", json=payload, headers=HEADERS, timeout=60)
    if r.status_code != 200:
        print(f"  [{name}] Erreur init : {r.status_code} {r.text}")
        return False
    gen_id = r.json()["sdGenerationJob"]["generationId"]
    print(f"  [{name}] generationId : {gen_id[:8]}... polling")

    # Polling
    while True:
        time.sleep(6)
        rs = requests.get(f"{BASE}/generations/{gen_id}", headers=HEADERS, timeout=30)
        data = rs.json().get("generations_by_pk") or {}
        status = data.get("status", "?")
        if status == "COMPLETE":
            break
        if status == "FAILED":
            print(f"  [{name}] Génération échouée : {data}")
            return False

    images = data.get("generated_images", [])
    if not images:
        print(f"  [{name}] Aucune image renvoyée.")
        return False

    url = images[0].get("url")
    if not url:
        print(f"  [{name}] Pas d'URL dans la réponse.")
        return False

    out_path = out_dir / f"{name}.png"
    out_path.write_bytes(requests.get(url, timeout=60).content)
    cost = data.get("apiCreditCost") or 0
    print(f"  [{name}] OK -> {out_path} ({cost} crédits)")
    return True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", type=str, default=None,
                        help="Génère seulement une feature (ex: pattes)")
    parser.add_argument("--model", type=str, default=PHOENIX_V1,
                        help="ID du modèle Leonardo (default: Phoenix v1.0)")
    args = parser.parse_args()

    out_dir = Path("assets/c1s4_features")
    out_dir.mkdir(parents=True, exist_ok=True)

    if args.only:
        if args.only not in FEATURES:
            print(f"Feature inconnue : {args.only}. Disponibles : {list(FEATURES.keys())}")
            sys.exit(1)
        targets = {args.only: FEATURES[args.only]}
    else:
        targets = FEATURES

    print(f"Generation de {len(targets)} feature(s) dans {out_dir}/")
    print(f"Modele : {args.model}\n")

    success = 0
    for name, prompt in targets.items():
        if generate_one(name, prompt, args.model, out_dir):
            success += 1

    print(f"\nTermine : {success}/{len(targets)} reussies")


if __name__ == "__main__":
    main()
