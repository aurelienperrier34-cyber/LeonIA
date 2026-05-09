"""
generate_c5s3_photo.py
======================
Génère 4 variations d'image pour c5s3 avec DreamShaper v7 sur Leonardo.
Modèle SD 1.5 (résolution modeste = peu cher) sans Alchemy ni Photo Real,
pour préserver les "erreurs naturelles" (mains 6 doigts, lettres absurdes...).

Coût estimé : ~20-32 crédits pour 4 variations 768x432 (16:9).

Usage:
  # 1. D'abord lister les modèles dispos pour vérifier l'ID DreamShaper
  python generate_c5s3_photo.py --list

  # 2. Lancer la génération (4 variations)
  python generate_c5s3_photo.py

  # 3. (Optionnel) Régénérer avec un autre prompt
  python generate_c5s3_photo.py --prompt "ton nouveau prompt"
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
    print("❌ LEONARDO_API_KEY manquante dans .env", file=sys.stderr)
    sys.exit(1)

BASE = "https://cloud.leonardo.ai/api/rest/v1"
HEADERS = {
    "accept": "application/json",
    "content-type": "application/json",
    "authorization": f"Bearer {API_KEY}",
}

# DreamShaper v7 sur Leonardo (community-finetuned SD 1.5).
DREAMSHAPER_V7_ID = "ac614f96-1082-45bf-be9d-757f2d31c174"

DEFAULT_PROMPT = (
    "photo of a friendly dad and his young child sitting at a kitchen table "
    "having breakfast together, pancakes on plates, glass of juice, morning "
    "sunlight through window, cozy kitchen setting, candid family moment, "
    "warm color tones, hands clearly visible holding utensils, faces with "
    "detailed eyes looking at each other, fridge magnets with text and a "
    "calendar on the wall in the background, photorealistic style, "
    "professional photography lighting, 16:9 aspect ratio"
)

NEGATIVE = "cartoon, anime, painting, illustration, low quality, watermark, blur, distorted face main subject"


def list_models():
    """Liste les modèles dispos sur ton compte Leonardo (gratuit, juste API call)."""
    print("📋 Récupération de la liste des modèles...\n")
    r = requests.get(f"{BASE}/platformModels", headers=HEADERS, timeout=30)
    if r.status_code != 200:
        # Endpoint alternatif pour les modèles custom/community
        r = requests.get(f"{BASE}/models", headers=HEADERS, timeout=30)
    if r.status_code != 200:
        print(f"❌ Erreur listage : {r.status_code} {r.text}")
        return
    data = r.json()
    models = data.get("custom_models") or data.get("models") or []
    if not models:
        print("⚠️  Aucun modèle retourné par l'API. Réponse brute :")
        print(data)
        return
    print(f"✅ {len(models)} modèles dispos :\n")
    for m in models:
        name = m.get("name", "?")
        mid = m.get("id", "?")
        desc = (m.get("description", "") or "")[:60]
        if "dream" in name.lower() or "shaper" in name.lower():
            print(f"  ⭐ {name}\n     id: {mid}\n     {desc}\n")
        else:
            print(f"     {name:<40} id: {mid}")


def generate(prompt, model_id=DREAMSHAPER_V7_ID, n=4):
    """Lance la génération de N variations et télécharge les images."""
    payload = {
        "modelId": model_id,
        "prompt": prompt,
        "negative_prompt": NEGATIVE,
        "width": 768,
        "height": 432,            # 16:9
        "num_images": n,
        "guidance_scale": 7,
        "num_inference_steps": 30,
        "alchemy": False,         # CRUCIAL : préserver les erreurs naturelles
        "photoReal": False,       # idem
        "promptMagic": False,     # idem
        "public": False,
    }
    print(f"🚀 Lancement génération {n}× ({768}x{432}) avec modelId={model_id[:8]}...")
    r = requests.post(f"{BASE}/generations", json=payload, headers=HEADERS, timeout=60)
    if r.status_code != 200:
        print(f"❌ Erreur init : {r.status_code} {r.text}")
        sys.exit(1)
    gen_id = r.json()["sdGenerationJob"]["generationId"]
    print(f"⏳ generationId : {gen_id}")

    # Polling
    while True:
        time.sleep(6)
        rs = requests.get(f"{BASE}/generations/{gen_id}", headers=HEADERS, timeout=30)
        data = rs.json().get("generations_by_pk") or {}
        status = data.get("status", "?")
        print(f"   status : {status}")
        if status == "COMPLETE":
            break
        if status == "FAILED":
            print(f"❌ Génération échouée : {data}")
            sys.exit(2)

    # Téléchargement des images
    images = data.get("generated_images", [])
    out_dir = Path("assets")
    out_dir.mkdir(exist_ok=True)
    cost = data.get("apiCreditCost") or 0
    print(f"\n💰 Coût total : {cost} crédits ({cost/n:.1f} par image)\n")
    for i, img in enumerate(images, 1):
        url = img.get("url")
        if not url:
            continue
        out = out_dir / f"c5s3_photo_v{i}.jpg"
        out.write_bytes(requests.get(url, timeout=60).content)
        print(f"✅ Sauvegardé : {out}")
    print(f"\n🎯 Choisis la meilleure image et renomme-la en c5s3_photo.jpg")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--list", action="store_true",
                        help="Liste les modèles dispos (vérifier l'ID DreamShaper)")
    parser.add_argument("--prompt", type=str, default=DEFAULT_PROMPT,
                        help="Prompt personnalisé")
    parser.add_argument("--model", type=str, default=DREAMSHAPER_V7_ID,
                        help="ID du modèle Leonardo à utiliser")
    parser.add_argument("-n", type=int, default=4,
                        help="Nombre de variations (default: 4)")
    args = parser.parse_args()

    if args.list:
        list_models()
    else:
        generate(args.prompt, args.model, args.n)
