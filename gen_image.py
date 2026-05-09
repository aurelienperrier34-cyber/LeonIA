"""
gen_image.py
============
Génère les images fixes tN_bg.jpg d'un chapitre via Leonardo Phoenix 1.0.
Bien meilleur que Leonardo Diffusion XL (l'ancien modèle de agent.py) pour le style Pixar.

Usage :
    python gen_image.py 4 --only 1            # T1 uniquement (test)
    python gen_image.py 4 --only 1,3,5        # plusieurs tableaux
    python gen_image.py 4                     # tout le chapitre
"""
import argparse
import json
import os
import sys
import time
from pathlib import Path

import requests
from dotenv import load_dotenv

load_dotenv()
LEONARDO_API_KEY = os.getenv("LEONARDO_API_KEY")
if not LEONARDO_API_KEY:
    sys.exit("LEONARDO_API_KEY manquant dans .env")

BASE_V1 = "https://cloud.leonardo.ai/api/rest/v1"
BASE_V2 = "https://cloud.leonardo.ai/api/rest/v2"
BASE = BASE_V1  # défaut
HEADERS = {
    "accept": "application/json",
    "content-type": "application/json",
    "authorization": f"Bearer {LEONARDO_API_KEY}",
}

# Modèles Leonardo (mai 2026)
MODEL_PHOENIX_10 = "6b645e3a-d64f-4341-a6d8-7a3690fbf042"  # Phoenix 1.0
MODEL_FLUX_DEV = "b2614463-296c-462a-9586-aafdb8f00e36"     # Flux Dev (meilleur pour personnages)
MODEL_FLUX_SCHNELL = "1dd50843-d653-4516-a8e3-f0238ee453ff" # Flux Schnell (rapide, économique)

MODEL_NANO_BANANA = "gemini-2.5-flash-image"  # Nano Banana ORIGINAL (~40 cr)
MODEL_NANO_BANANA_PRO = "gemini-image-2"       # Nano Banana Pro (haute fidélité)

MODELS = {
    "phoenix": MODEL_PHOENIX_10,
    "flux-dev": MODEL_FLUX_DEV,
    "flux-schnell": MODEL_FLUX_SCHNELL,
    "nano-banana": MODEL_NANO_BANANA,           # original ~40 cr
    "nano-banana-2": "nano-banana-2",            # ~80 cr
    "nano-banana-pro": MODEL_NANO_BANANA_PRO,
}

# Description maître de Léon, version courte (limite Leonardo: 1500 chars total).
MASTER_LEON = (
    "Léon: elderly inventor with (((bushy white-grey beard))), "
    "(((round silver-rimmed clear eyeglasses))), "
    "(((dark navy newsboy cap with colorful patches))), "
    "(((bright orange knitted sweater with cog/lightbulb/star patterns))), "
    "(((brown leather apron with tool pockets))), "
    "rosy cheeks, blue eyes, warm smile. Match reference image. "
)

NEGATIVE = (
    "low quality, blurry, watermark, text artifacts, deformed, mutated, bad anatomy, "
    "extra limbs, multiple heads, distorted face, ugly, "
    "two characters that look the same, duplicate Léon, multiple wizards, "
    "different outfit, hood, hooded robe, monk robe, gnome hat, pointy hat, "
    "orange glasses, square glasses, sunglasses, "
    "floral pattern sweater, plain sweater, white sweater, blue sweater, "
    "naked beard man, shirt only, modern t-shirt, business suit, lab coat, "
    "young face, no glasses, no beard, dark beard, mustache only"
)



def upload_init_image(image_path: Path) -> str | None:
    """Upload une image vers Leonardo, retourne l'imageId."""
    ext = image_path.suffix.lstrip(".").lower()
    if ext == "jpg":
        ext = "jpeg"
    r = requests.post(f"{BASE}/init-image", json={"extension": ext}, headers=HEADERS)
    if r.status_code != 200:
        print(f"   ⚠️ Erreur upload init: {r.text[:200]}")
        return None
    data = r.json()["uploadInitImage"]
    fields = json.loads(data["fields"])
    with image_path.open("rb") as f:
        up = requests.post(data["url"], data=fields, files={"file": f})
    if up.status_code in (200, 204):
        return data["id"]
    print(f"   ⚠️ Erreur S3: {up.status_code}")
    return None


def generer_image(prompt, dest_path, ref_image_ids=None, model_key="flux-dev", ref_mode="character", ref_strength="High"):
    print(f"🎨 {model_key} → {dest_path.name}")
    is_nano = model_key.startswith("nano")
    if is_nano:
        # Payload v2 : { model, parameters:{...}, public }
        payload = {
            "model": MODELS[model_key],
            "parameters": {
                "prompt": MASTER_LEON + prompt,
                "width": 1344,
                "height": 768,
                "quantity": 1,
                "prompt_enhance": "OFF",
            },
            "public": False,
        }
        if ref_image_ids:
            # Format v2 officiel : guidances.image_reference est une liste
            # de {"image": {"id": "...", "type": "UPLOADED"}, "strength": "MID"}
            payload["parameters"]["guidances"] = {
                "image_reference": [
                    {
                        "image": {"id": img_id, "type": "UPLOADED"},
                        "strength": "MID",
                    }
                    for img_id in ref_image_ids[:8]  # Leonardo accepte max 8 refs
                ]
            }
            print(f"   🔄 Image reference (MID) avec {len(ref_image_ids[:8])} ref(s)")
    else:
        payload = {
            "modelId": MODELS[model_key],
            "prompt": MASTER_LEON + prompt,
            "negative_prompt": NEGATIVE,
            "width": 1344,
            "height": 768,
            "num_images": 1,
            "guidance_scale": 7,
            "contrast": 3.5,
        }
    if ref_image_ids and not is_nano:
        if ref_mode == "imageprompts":
            payload["imagePrompts"] = ref_image_ids
            print(f"   🔄 imagePrompts: {len(ref_image_ids)} ref(s) (soft guidance)")
        elif ref_mode == "character":
            # Character Reference fort. Une seule ref recommandée.
            payload["controlnets"] = [{
                "initImageId": ref_image_ids[0],
                "initImageType": "UPLOADED",
                "preprocessorId": 133,
                "strengthType": ref_strength,
            }]
            print(f"   🔄 Character Reference: {ref_strength} strength (1 ref utilisée)")
        elif ref_mode == "style":
            payload["controlnets"] = [{
                "initImageId": ref_image_ids[0],
                "initImageType": "UPLOADED",
                "preprocessorId": 67,
                "strengthType": ref_strength,
            }]
            print(f"   🔄 Style Reference: {ref_strength}")
        elif ref_mode == "char_style":
            # Combine Character Reference (visage) + Style Reference (vêtements/style)
            payload["controlnets"] = [
                {
                    "initImageId": ref_image_ids[0],
                    "initImageType": "UPLOADED",
                    "preprocessorId": 133,
                    "strengthType": ref_strength,
                },
                {
                    "initImageId": ref_image_ids[0],
                    "initImageType": "UPLOADED",
                    "preprocessorId": 67,
                    "strengthType": "Mid",
                },
            ]
            print(f"   🔄 Character ({ref_strength}) + Style (Mid) combinés")
    base_url = BASE_V2 if model_key.startswith("nano") else BASE_V1
    print(f"   📤 Endpoint: {base_url}/generations")
    print(f"   📦 Payload (clés): {list(payload.keys())}")
    r = requests.post(f"{base_url}/generations", json=payload, headers=HEADERS)
    if r.status_code >= 400:
        print(f"❌ Erreur init : {r.status_code} {r.text[:300]}")
        return False
    rj = r.json()
    if not isinstance(rj, dict):
        import json as _j
        print(f"   ❌ Réponse non-dict (type {type(rj).__name__}) :")
        print(f"   {_j.dumps(rj, indent=2)[:600]}")
        return False
    print(f"   📥 Réponse init (clés): {list(rj.keys())}")
    # v1 : sdGenerationJob.generationId | v2 : generate.generationId
    job = rj.get("sdGenerationJob") or rj.get("generate") or rj.get("generation") or rj.get("data") or rj
    gen_id = job.get("generationId") or job.get("id")
    cost = job.get("apiCreditCost") or job.get("creditCost")
    if isinstance(job.get("cost"), dict):
        amount = job["cost"].get("amount")
        unit = job["cost"].get("unit", "")
        print(f"   💰 Coût annoncé : {amount} {unit}")
    print(f"   gen_id : {gen_id}  (coût : {cost} cr)")
    if not gen_id:
        print(f"   ❌ Pas de generationId dans la réponse. Réponse complète :")
        import json as _j
        print(f"   {_j.dumps(rj, indent=2)[:600]}")
        return False

    print("   ⏳ Calcul de l'image...")
    # Pour Nano Banana, le polling se fait sur v1 même si la génération a été lancée en v2.
    poll_url = f"{BASE_V1}/generations/{gen_id}" if is_nano else f"{base_url}/generations/{gen_id}"
    print(f"   📡 Poll URL : {poll_url}")
    for i in range(60):
        time.sleep(5)
        s = requests.get(poll_url, headers=HEADERS).json()
        # v1 : generations_by_pk | v2 : generations_by_pk OU directement à la racine
        data = s.get("generations_by_pk") or s.get("generation") or s.get("data") or s
        if i == 0:
            import json as _j
            print(f"   📥 Poll réponse (clés): {list(s.keys())}")
            print(f"   📥 Poll réponse (extrait): {_j.dumps(s)[:400]}")
        status = data.get("status") or data.get("state")
        if status and status in ("FAILED", "ERROR"):
            print(f"   ❌ Generation FAILED : {data}")
            return False
        gens = (data.get("generated_images") or data.get("images")
                or data.get("generations") or [])
        if gens and (gens[0].get("url") or gens[0].get("imageUrl")):
            url = gens[0].get("url") or gens[0].get("imageUrl")
            dest_path.parent.mkdir(parents=True, exist_ok=True)
            dest_path.write_bytes(requests.get(url).content)
            print(f"   ✅ Sauvée : {dest_path}")
            return True
    print("   ❌ Timeout (5 min)")
    return False


def main():
    p = argparse.ArgumentParser()
    p.add_argument("chapitre", type=int)
    p.add_argument("--only", help="Filtre tableaux (ex: 1 ou 1,3,5)")
    p.add_argument("--ref", nargs="+", default=[],
                   help="Chemin(s) d'image(s) de référence Léon. Plusieurs séparées par espace. "
                        "Ex: --ref assets/Leon_debout.jpg assets/Leon_machine.jpg")
    p.add_argument("--model", choices=list(MODELS.keys()), default="nano-banana",
                   help="Modèle. nano-banana (~40 cr, default), nano-banana-2 (~80 cr), nano-banana-pro (~140-250 cr), flux-dev, phoenix, flux-schnell")
    p.add_argument("--ref-mode", choices=["character", "char_style", "imageprompts", "style"], default="char_style",
                   help="character (défaut, fort, 1 ref, preprocId 133) | imageprompts (multi, soft) | style (preprocId 67)")
    p.add_argument("--ref-strength", choices=["Low", "Mid", "High", "Max"], default="High",
                   help="Force du Character/Style Reference (défaut High)")
    p.add_argument("--ref-dir",
                   help="Dossier contenant les images de référence (toutes les .jpg/.png seront utilisées). "
                        "Ex: --ref-dir references_leon/")
    args = p.parse_args()

    json_path = Path(f"scenar_chap{args.chapitre}_json.txt")
    if not json_path.exists():
        json_path = Path(f"scenar_chap{args.chapitre}.json")
    if not json_path.exists():
        sys.exit(f"JSON introuvable pour chap {args.chapitre}")

    with json_path.open(encoding="utf-8") as f:
        scenario = json.load(f)

    only = set(int(x) for x in args.only.split(",")) if args.only else None
    out_dir = Path(f"assets/chapitre_{args.chapitre}")

    # Collecter toutes les images de référence
    ref_paths = list(args.ref or [])
    if args.ref_dir:
        d = Path(args.ref_dir)
        if d.exists():
            ref_paths += sorted(str(p) for p in d.iterdir()
                                if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"})
        else:
            print(f"⚠️ ref-dir introuvable: {d}")
    ref_paths = [Path(p) for p in ref_paths if Path(p).exists()]

    ref_ids = []
    for rp in ref_paths:
        print(f"📤 Upload référence: {rp.name}")
        rid = upload_init_image(rp)
        if rid:
            ref_ids.append(rid)
            print(f"   imageId: {rid}")
    if ref_ids:
        print(f"=> {len(ref_ids)} référence(s) prête(s) pour Phoenix imagePrompts\n")

    for t in scenario:
        tid = t["tableau"]
        if only and tid not in only:
            continue
        prompt = (t.get("prompt_image") or "").strip()
        if not prompt:
            print(f"T{tid}: pas de prompt_image, skip")
            continue
        dest = out_dir / f"t{tid}_bg.jpg"
        generer_image(prompt, dest, ref_image_ids=ref_ids if ref_ids else None, model_key=args.model, ref_mode=args.ref_mode, ref_strength=args.ref_strength)


if __name__ == "__main__":
    main()
