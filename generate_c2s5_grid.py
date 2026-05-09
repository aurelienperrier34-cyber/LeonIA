"""
generate_c2s5_grid.py
=====================
Genere les 6 vignettes de l'ecran c2s5 ("Trouve les defauts !") puis les
assemble en une grille 2x3 avec cadres dores style galerie de l'atelier de Leon.

Pipeline :
  1. Pour chaque vignette du CONFIG : appel Leonardo Phoenix/Flux pour generer
     l'image (avec --candidates N pour generer plusieurs variantes des
     vignettes defectueuses, plus difficiles a obtenir correctement).
  2. Composite local via PIL : grille 2x3, fond bois chaud, cadres dores.
  3. Output final : assets/chapitre_2/t5_grid.png

Usage :
  # Squelette : voit les 6 prompts sans rien generer
  python generate_c2s5_grid.py --dry-run

  # Genere les 6 vignettes (1 candidate par slot) puis composite
  python generate_c2s5_grid.py

  # Genere 3 candidates pour les vignettes defectueuses (plus de chances
  # d'avoir au moins une image bien defectueuse)
  python generate_c2s5_grid.py --candidates 3

  # Re-composite uniquement (sans regenerer) — utile apres avoir choisi
  # manuellement les meilleures candidates dans le dossier raw/
  python generate_c2s5_grid.py --composite-only

  # Genere uniquement la vignette indiquee (pour iterer)
  python generate_c2s5_grid.py --only cat
  python generate_c2s5_grid.py --only cat,girl --candidates 4
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

try:
    import requests
except ImportError:
    sys.exit("ERREUR : 'requests' requis. pip install requests")

try:
    from PIL import Image, ImageDraw
except ImportError:
    sys.exit("ERREUR : 'Pillow' requis. pip install Pillow")

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

LEONARDO_API_KEY = os.getenv("LEONARDO_API_KEY")
BASE_V1 = "https://cloud.leonardo.ai/api/rest/v1"

MODEL_PHOENIX = "6b645e3a-d64f-4341-a6d8-7a3690fbf042"
MODEL_FLUX_DEV = "b2614463-296c-462a-9586-aafdb8f00e36"

NEGATIVE_BASE = (
    # Qualite
    "low quality, blurry, jpeg artifacts, "
    # Composition
    "multiple subjects, two characters, frame, border, background clutter, "
    # TEXTE — exclusion forte, sinon Phoenix hallucine des lettres
    "text, letters, words, captions, signage, watermark, signature, labels, "
    "numbers, fonts, typography, writing, alphabet, chinese characters, "
    "japanese characters, runes, symbols, logos, brand names, "
)


# Style commun a toutes les vignettes : minimal, plain background, single
# subject perfectly centered, child-friendly.
STYLE_COMMON = (
    "3D animated cartoon Pixar style, single subject perfectly centered, "
    "isolated on plain pastel background, child-friendly, soft warm lighting, "
    "absolutely NO TEXT, NO LETTERS, NO WORDS visible anywhere in the image, "
    "no border, square 1:1 aspect ratio, very clean composition. "
)

# Les 6 vignettes. Les 3 "defective" ont des instructions tres explicites
# sur le defaut a montrer — Leonardo a tendance a "lisser" sinon.
THUMBNAILS = [
    # ---- Layout final (2x3, mix correct/defectueuse pour pas spoiler) ----
    # Row 1 : sun (✓)   | cat (✗ 2 queues)   | puppy (✓)
    # Row 2 : girl (✗ 6 doigts)  | tulip(✓) | dog (✗ pattes en trop)
    {
        "id": "sun",
        "label": "Soleil classique (correcte)",
        "defective": False,
        "prompt": (
            "weather forecast sun icon in Material Design style, "
            "geometric flat yellow circle with 8 evenly-spaced triangular yellow rays around it, "
            "no face on the circle, no eyes on the circle, no mouth on the circle, "
            "blank smooth surface, like an iPhone weather app sunny icon, "
            "centered on plain pastel sky blue background. "
        ),
    },
    {
        "id": "cat",
        "label": "Chat à 2 queues (DEFECTUEUSE)",
        "defective": True,
        "expected_defect": "le chat doit avoir 2 queues clairement visibles",
        "prompt": (
            # Conserve pour reference / regeneration future
            "magical fantasy hybrid creature, cat-butterfly chimera, orange tabby cat "
            "body sitting on grass, facing viewer, friendly smiling face, two normal "
            "triangle ears, "
            "(((TWO LARGE BUTTERFLY WINGS visible on its back, colorful pastel wings "
            "with delicate patterns, wings fully spread and clearly visible behind/above "
            "the cat))), "
            "isolated on plain pastel pink background. "
        ),
    },
    {
        "id": "puppy",
        "label": "Chiot mignon (correcte)",
        "defective": False,
        "prompt": (
            "cute small golden retriever puppy sitting on grass, fluffy soft fur, "
            "big friendly round eyes, pink tongue lightly out, two floppy ears, "
            "cheerful happy expression, "
            "(((EXACTLY 4 legs visible : 2 front + 2 back, no extra legs, "
            "normal puppy anatomy))), "
            "isolated on plain pastel green background. "
        ),
    },
    {
        "id": "girl",
        "label": "Fille avec 6 doigts (DEFECTUEUSE)",
        "defective": True,
        "expected_defect": "la fille doit avoir 6 doigts par main",
        "prompt": (
            "smiling 7-year-old cartoon girl portrait, brown hair, "
            "waving both hands toward viewer, hands clearly visible in foreground, "
            "(((each visible hand has 6 fingers, not 5))), "
            "isolated on plain pastel yellow background. "
        ),
    },
    {
        "id": "tulip",
        "label": "Tulipe rouge classique (correcte)",
        "defective": False,
        "prompt": (
            "single bright red tulip flower with green stem and exactly 2 leaves, "
            "neat closed petals, simple botanical drawing, "
            "ABSOLUTELY NO FACE, NO EYES, NO MOUTH, NO ANTHROPOMORPHIC FEATURES, "
            "just a plain realistic tulip like a children's book botanical illustration, "
            "isolated on plain pastel green-grass background, flat 2D illustration style. "
        ),
    },
    {
        "id": "dog",
        "label": "Chien à pattes en trop (DEFECTUEUSE)",
        "defective": True,
        "expected_defect": "le chien doit avoir plus de 4 pattes visibles (anomalie AI typique)",
        "prompt": (
            # Pour future regeneration : note que ce defaut est dur a obtenir
            # avec Phoenix (cf. tentatives chat 5 pattes). Si tu regeneres, fais
            # plutot un chien-chimere (ex : chien avec ailes ou cornes).
            "magical hybrid creature, fantasy 5-legged puppy, "
            "(((this fantasy puppy has 5 visible legs))), "
            "isolated on plain pastel green background. "
        ),
    },
]


# Composite : grille 2x3 avec cadres dores style atelier de Leon
COMPOSITE = {
    "out_path": "assets/chapitre_2/t5_grid.png",
    "raw_dir": "assets/chapitre_2/t5_grid_raw",
    "thumb_size": 480,           # taille de chaque vignette dans la grille finale
    "cols": 3,
    "rows": 2,
    "padding": 30,               # espace entre les vignettes
    "frame_width": 14,
    "frame_color": (210, 165, 50),     # or chaud
    "frame_inner_shadow": (140, 100, 30, 200),  # interieur du cadre, plus sombre
    "background_color": (78, 50, 30),  # bois sombre chaud
}


# ---------------------------------------------------------------------------
# Generation Leonardo
# ---------------------------------------------------------------------------

def call_leonardo(prompt: str, model_id: str, width: int = 768, height: int = 768) -> str | None:
    """Lance une generation Leonardo, attend le resultat, renvoie l'URL."""
    if not LEONARDO_API_KEY:
        print("   ⚠️  LEONARDO_API_KEY absent — skip (mode --dry-run conseille)")
        return None
    headers = {
        "accept": "application/json",
        "content-type": "application/json",
        "authorization": f"Bearer {LEONARDO_API_KEY}",
    }
    payload = {
        "modelId": model_id,
        "prompt": STYLE_COMMON + prompt,
        "negative_prompt": NEGATIVE_BASE,
        "width": width,
        "height": height,
        "num_images": 1,
        "guidance_scale": 8,        # un peu plus pour mieux suivre le prompt
        "contrast": 3.5,
    }
    r = requests.post(f"{BASE_V1}/generations", json=payload, headers=headers)
    if r.status_code >= 400:
        print(f"   ❌ Erreur init : {r.status_code} {r.text[:200]}")
        return None
    rj = r.json()
    job = rj.get("sdGenerationJob") or {}
    gen_id = job.get("generationId")
    cost = job.get("apiCreditCost")
    print(f"   gen_id={gen_id} cout={cost}cr")
    if not gen_id:
        return None
    poll_url = f"{BASE_V1}/generations/{gen_id}"
    for _ in range(60):
        time.sleep(5)
        s = requests.get(poll_url, headers=headers).json()
        data = s.get("generations_by_pk") or {}
        status = data.get("status")
        if status in ("FAILED", "ERROR"):
            print(f"   ❌ FAILED")
            return None
        gens = data.get("generated_images") or []
        if gens and gens[0].get("url"):
            return gens[0]["url"]
    print("   ❌ Timeout")
    return None


def generate_one_thumbnail(thumb: dict, candidate_idx: int, model_id: str, raw_dir: Path) -> Path | None:
    """Genere une vignette (avec un index de candidat). Renvoie le chemin local."""
    raw_dir.mkdir(parents=True, exist_ok=True)
    suffix = "" if candidate_idx == 0 else f"_v{candidate_idx + 1}"
    out_path = raw_dir / f"{thumb['id']}{suffix}.png"
    if out_path.exists():
        print(f"   ↩️  Existe deja : {out_path.name} (skip — supprime le fichier pour regenerer)")
        return out_path
    print(f"\n🎨 [{thumb['label']}]{' candidate '+str(candidate_idx+1) if candidate_idx > 0 else ''}")
    url = call_leonardo(thumb["prompt"], model_id)
    if not url:
        return None
    # Telechargement
    img_data = requests.get(url).content
    out_path.write_bytes(img_data)
    print(f"   ✅ Sauve : {out_path}")
    return out_path


# ---------------------------------------------------------------------------
# Composite PIL (grille 2x3 + cadres dores)
# ---------------------------------------------------------------------------

def build_grid_composite(raw_dir: Path, out_path: Path) -> None:
    """Assemble les 6 vignettes (selectionnees auto = 1ere candidate de chaque)
    en une image 2x3 avec cadres dores et fond bois."""
    cfg = COMPOSITE
    thumb_size = cfg["thumb_size"]
    fw = cfg["frame_width"]

    # Selection : on prend le fichier <id>.png/.jpg/.jpeg (la 1ere extension
    # trouvee). Si l'utilisateur a renomme une variante en <id>.* manuellement,
    # ca bascule automatiquement.
    selected = []
    for t in THUMBNAILS:
        primary = None
        for ext in (".png", ".jpg", ".jpeg", ".webp"):
            candidate = raw_dir / f"{t['id']}{ext}"
            if candidate.exists():
                primary = candidate
                break
        if not primary:
            print(f"⚠️  Manquant : {raw_dir}/{t['id']}.png (ou .jpg/.jpeg/.webp). "
                  f"Renomme ton image en {t['id']}.<ext>")
            return
        selected.append((t, primary))

    # Dimensions du composite final
    total_w = cfg["cols"] * thumb_size + (cfg["cols"] + 1) * cfg["padding"]
    total_h = cfg["rows"] * thumb_size + (cfg["rows"] + 1) * cfg["padding"]
    composite = Image.new("RGB", (total_w, total_h), cfg["background_color"])
    draw = ImageDraw.Draw(composite)

    print(f"\n🖼️  Composite final : {total_w}x{total_h}")
    for idx, (t, path) in enumerate(selected):
        col = idx % cfg["cols"]
        row = idx // cfg["cols"]
        x = cfg["padding"] + col * (thumb_size + cfg["padding"])
        y = cfg["padding"] + row * (thumb_size + cfg["padding"])
        # Charge la vignette + resize au format final
        img = Image.open(path).convert("RGB")
        img = img.resize((thumb_size - 2 * fw, thumb_size - 2 * fw), Image.LANCZOS)
        # Cadre dore
        draw.rectangle(
            [x, y, x + thumb_size - 1, y + thumb_size - 1],
            fill=cfg["frame_color"],
        )
        # Inset shadow plus sombre (donne de la profondeur)
        draw.rectangle(
            [x + fw - 2, y + fw - 2, x + thumb_size - fw + 1, y + thumb_size - fw + 1],
            outline=(80, 50, 10),
            width=2,
        )
        # Vignette au centre du cadre
        composite.paste(img, (x + fw, y + fw))
        print(f"   [{t['id']}] @ ({col},{row}) → x={x},y={y}")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    composite.save(out_path, "PNG", optimize=True)
    print(f"\n✅ Composite final ecrit : {out_path}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--only", help="ID(s) de vignette a (re)generer, separes par virgule. Ex: cat,girl")
    p.add_argument("--candidates", type=int, default=1,
                   help="Nb de variantes a generer pour CHAQUE vignette defectueuse "
                        "(par defaut 1). Permet d'avoir plusieurs essais pour les "
                        "defauts subtils que Leonardo galere a faire.")
    p.add_argument("--composite-only", action="store_true",
                   help="Skip generation. Compose juste a partir des fichiers "
                        "existants dans raw/ (utile apres avoir choisi tes prefs).")
    p.add_argument("--model", choices=["phoenix", "flux-dev"], default="phoenix",
                   help="Modele Leonardo (phoenix par defaut)")
    p.add_argument("--dry-run", action="store_true",
                   help="N'appelle pas Leonardo. Affiche les 6 prompts.")
    args = p.parse_args()

    raw_dir = Path(COMPOSITE["raw_dir"])
    out_path = Path(COMPOSITE["out_path"])

    if args.dry_run:
        print(f"📋 DRY-RUN — aucun appel Leonardo. Voici les {len(THUMBNAILS)} prompts :\n")
        for t in THUMBNAILS:
            print(f"--- {t['label']} (id={t['id']}, defective={t['defective']}) ---")
            print(STYLE_COMMON + t["prompt"])
            if t.get("expected_defect"):
                print(f"  📌 Attendu : {t['expected_defect']}")
            print()
        return

    if args.composite_only:
        build_grid_composite(raw_dir, out_path)
        return

    only_ids = set((args.only or "").split(",")) if args.only else None
    only_ids = {x.strip() for x in only_ids if x.strip()} if only_ids else None

    model_id = MODEL_PHOENIX if args.model == "phoenix" else MODEL_FLUX_DEV

    for t in THUMBNAILS:
        if only_ids and t["id"] not in only_ids:
            continue
        # 1 candidate pour les correctes, args.candidates pour les defectueuses
        n_candidates = args.candidates if t["defective"] else 1
        for ci in range(n_candidates):
            generate_one_thumbnail(t, ci, model_id, raw_dir)

    # Composite final automatique apres generation
    print("\n" + "=" * 60)
    print("Generation terminee. Composite des images en grille 2x3...")
    print("=" * 60)
    build_grid_composite(raw_dir, out_path)
    print("\n💡 Si une vignette defectueuse n'est pas convaincante, tu peux :")
    print("   1. Regarder les variantes dans", raw_dir)
    print("   2. Renommer la meilleure en <id>.png (par ex. cat_v2.png → cat.png)")
    print("   3. Relancer : python generate_c2s5_grid.py --composite-only")


if __name__ == "__main__":
    main()
