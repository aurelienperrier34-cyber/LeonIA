# -*- coding: utf-8 -*-
"""
generate_custom_story.py
========================
ÉTAPE 3 — Génère une histoire CUSTOM : un héros créé par l'enfant
(generate_custom_hero.py) joué dans un combo lieu/objet/ennemi du CATALOGUE.

Réutilise toute la chaîne éprouvée :
  - TEXTE : Gemini 2.5 Pro (comme generate_story_text.py), mais le héros est
    injecté depuis hero.json (nom + canon custom) au lieu du catalogue.
  - IMAGES : gen_image_gemini() de generate_story_gemini.py, avec le PORTRAIT
    custom passé en référence visuelle du héros -> cohérence verrouillée.

Génération PROGRESSIVE : le texte (story.json) est écrit en premier (~15s),
puis chaque page d'image est écrite dès qu'elle est prête (page1.jpg, ...).
Le front peut donc afficher le texte immédiatement et les images au fil de
l'eau (l'enfant commence à lire sans attendre les 5 images).

Sortie :
  assets/custom/<hero_id>/stories/<level>_<place>_<item>_<villain>_<ts>/
    story.json   (title + pages[text,image_prompt] + hero/combo)
    page1.jpg ... pageN.jpg

>>> Conçu pour être réutilisé tel quel dans la Cloud Function.

Usage local :
  python generate_custom_story.py --hero-id zoe-272086 \
      --place chateau --item guitare --villain fantome
  python generate_custom_story.py --hero assets/custom/zoe-272086/hero.json \
      --place ocean --item baguette --villain monstre --level soir
  python generate_custom_story.py --hero-id zoe-272086 --place chateau \
      --item guitare --villain fantome --text-only   (debug : pas d'images)
"""

import argparse
import json
import random
import re
import sys
import time
from pathlib import Path

from item_canon import ITEM_CANON, get_exclusion_instruction, STORY_STYLE
from stories_db import LEVEL_PAGES
# logique texte (auth + endpoint Vertex + modeles)
from generate_story_text import _token, _vertex_url, TEXT_MODELS, LEVEL_DESCRIPTIONS
# logique image (reutilisee telle quelle)
from generate_story_gemini import (gen_image_gemini, collect_ref_portraits,
                                    auto_detect_refs_for_page)

CATALOG = {
    "place":   list(ITEM_CANON["place"].keys()),
    "item":    list(ITEM_CANON["item"].keys()),
    "villain": list(ITEM_CANON["villain"].keys()),
}


# ============================================================
# Chargement du heros custom
# ============================================================
def load_hero(hero_id=None, hero_path=None):
    if hero_path:
        p = Path(hero_path)
    elif hero_id:
        p = Path("assets/custom") / hero_id / "hero.json"
    else:
        raise ValueError("--hero-id ou --hero requis")
    if not p.exists():
        sys.exit(f"ERREUR : hero.json introuvable ({p})")
    data = json.loads(p.read_text(encoding="utf-8"))
    portrait = Path(data.get("portrait", ""))
    if not portrait.exists():
        # tente le portrait a cote du hero.json
        alt = p.parent / "portrait.jpg"
        if alt.exists():
            portrait = alt
        else:
            sys.exit(f"ERREUR : portrait du heros introuvable ({portrait})")
    data["_portrait_path"] = portrait
    data["_dir"] = p.parent
    return data


# ============================================================
# Variete narrative : graines d'intrigue tirees au hasard a chaque generation
# -> meme combo + heros different (ou meme heros rejoue) = histoire differente
# ============================================================
NARRATIVE_SEEDS = [
    "une QUETE pour retrouver quelque chose de precieux qui a disparu",
    "une ENIGME mysterieuse a resoudre, avec des indices semes en chemin",
    "une RENCONTRE inattendue qui bouleverse tout",
    "un SAUVETAGE courageux d'un personnage en difficulte",
    "une DECOUVERTE extraordinaire qui change la vision du monde du heros",
    "un MALENTENDU a reparer, ou personne n'etait vraiment mechant",
    "un SECRET enfin revele apres des annees",
    "une COURSE contre le temps avant que quelque chose ne disparaisse",
    "une AMITIE improbable qui se noue malgre les differences",
    "un DEFI a relever qui demande de l'astuce plutot que de la force",
    "un VOYAGE qui ne se passe pas du tout comme prevu",
    "une PROMESSE faite qu'il faut absolument tenir",
]


def build_custom_text_prompt(level, hero_name, hero_canon, place, item, villain,
                             n_pages, personality="", seed=""):
    pl = ITEM_CANON["place"][place]
    it = ITEM_CANON["item"][item]
    vl = ITEM_CANON["villain"][villain]
    perso_line = (f"\nPERSONNALITE DU HEROS : {personality}. Sa personnalite doit "
                  f"GUIDER ses choix, sa facon d'aborder le defi et le ton de l'aventure."
                  if personality else "")
    seed_line = (f"\nANGLE DE L'INTRIGUE (a suivre) : {seed}." if seed else "")
    return f"""Tu es un auteur de contes pour enfants de 5-9 ans, dans la veine de Roald Dahl, Antoine de Saint-Exupery et Tomi Ungerer.

ECRIS UNE HISTOIRE qui mette en scene :
- LE HEROS (cree par l'enfant) : {hero_name} - {hero_canon.strip()}
- LE LIEU : {pl['name']} - {pl['canon'].strip()}
- L'OBJET MAGIQUE : {it['name']} - {it['canon'].strip()}
- LE DEFI / VILLAIN : {vl['name']} - {vl['canon'].strip()}

IMPORTANT : le HEROS est {hero_name}, le personnage principal invente par l'enfant.
L'histoire tourne autour de LUI/ELLE. Utilise son prenom souvent.{perso_line}{seed_line}

ORIGINALITE : invente une intrigue VRAIMENT ORIGINALE et SURPRENANTE. Evite
l'histoire la plus evidente ou attendue pour ce decor. Le lieu, l'objet et le
defi sont des ingredients : c'est le HEROS et son caractere qui font l'histoire.

CONTRAINTES :
- Niveau : {LEVEL_DESCRIPTIONS[level]}
- Exactement {n_pages} pages
- Langue : FRANCAIS de France, soutenu mais accessible aux enfants
- Aucune violence gratuite, aucune scene effrayante (mais le suspense est permis)
- Style : phrases courtes et longues alternees, vocabulaire riche, images poetiques
- Le defi/villain n'est PAS un mechant pur : il est mal compris, perdu, blesse...
- Fin : emouvante, lumineuse, jamais simpliste

POUR CHAQUE PAGE :
- Un texte (courte=80-120 mots, soir=100-150, aventure=150-200)
- HTML simple autorise : <em>...</em>, <br><br>
- UN PROMPT D'IMAGE en anglais decrivant la scene (precise quels personnages
  sont presents). Pour le heros, ecris toujours "{hero_name}" pour le designer.
  Seuls les personnages explicitement presents sur la page doivent y figurer.

REPONDS UNIQUEMENT EN JSON, sans markdown ni texte autour :
{{
  "title": "Titre de l'histoire",
  "pages": [
    {{ "text": "Texte page 1 avec HTML leger", "image_prompt": "English scene description" }},
    ... ({n_pages} pages au total)
  ]
}}
"""


def generate_text(level, hero_name, hero_canon, place, item, villain, n_pages,
                  personality="", seed="", max_retries=2):
    prompt = build_custom_text_prompt(level, hero_name, hero_canon, place, item,
                                      villain, n_pages, personality, seed)
    payload = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.85, "topP": 0.95,
            "maxOutputTokens": 8000, "responseMimeType": "application/json",
        },
    }
    import requests
    headers = {"Authorization": f"Bearer {_token()}", "Content-Type": "application/json"}
    last_err = None
    for attempt in range(max_retries):
        model = TEXT_MODELS[min(attempt, len(TEXT_MODELS) - 1)]
        try:
            r = requests.post(_vertex_url(model), json=payload, headers=headers, timeout=180)
        except Exception as e:
            last_err = str(e); continue
        if r.status_code in (404,):
            print(f"    {model} introuvable, fallback"); continue
        if r.status_code == 429:
            print(f"    Rate limit {model}, wait 30s..."); time.sleep(30); continue
        if r.status_code >= 400:
            last_err = f"HTTP {r.status_code}: {r.text[:300]}"; print(f"    {last_err}"); continue
        try:
            rj = r.json()
            txt = rj["candidates"][0]["content"]["parts"][0]["text"]
            txt = re.sub(r"^```(?:json)?\s*", "", txt)
            txt = re.sub(r"\s*```$", "", txt)
            data = json.loads(txt)
        except Exception as e:
            last_err = f"parsing: {e}"; print(f"    {last_err}"); continue
        if not data.get("title") or not data.get("pages"):
            last_err = "title/pages manquant"; continue
        return data
    print(f"    ECHEC texte : {last_err}")
    return None


# ============================================================
# Generation des images (heros custom en reference)
# ============================================================
def build_canon_prefix(hero_name, hero_canon, place, item, villain, roles):
    parts = []
    if "hero" in roles and hero_canon:
        parts.append(hero_canon.strip() + " ")
    for role, val in [("place", place), ("item", item), ("villain", villain)]:
        if role in roles and val in ITEM_CANON.get(role, {}):
            parts.append(ITEM_CANON[role][val]["canon"])
    if not parts:
        return ""
    return "CHARACTER REFERENCE (must match exactly): " + " ".join(parts) + " "


def gen_page_image(page, idx, total, hero, place, item, villain, out_dir,
                   page_delay, force):
    dest = out_dir / f"page{idx}.jpg"
    if dest.exists() and not force:
        print(f"[{idx}/{total}] page{idx}.jpg existe (skip)")
        return True
    raw_prompt = page["image_prompt"]

    # Roles presents sur cette page : hero toujours, + detection lieu/objet/ennemi
    page_roles = auto_detect_refs_for_page(
        raw_prompt, hero["hero_id"], place, item, villain, always_include=["hero"])

    # Refs visuelles : portrait custom pour le hero + portraits catalogue
    ref_images = collect_ref_portraits(None, place, item, villain,
                                       [r for r in page_roles if r != "hero"])
    if "hero" in page_roles:
        ref_images = {f"hero ({hero['name']})": hero["_portrait_path"], **ref_images}

    canon_prefix = build_canon_prefix(hero["name"], hero["canon"],
                                      place, item, villain, page_roles)
    exclusion = get_exclusion_instruction(hero["hero_id"], place, item, villain, page_roles)
    full_prompt = STORY_STYLE + canon_prefix + exclusion + raw_prompt

    print(f"\n[{idx}/{total}] page{idx}.jpg  refs={list(ref_images.keys())}")
    ok = gen_image_gemini(full_prompt, dest, ref_images=ref_images)
    if page_delay > 0 and idx < total:
        time.sleep(page_delay)
    return ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hero-id", help="id du heros (assets/custom/<id>/hero.json)")
    ap.add_argument("--hero", help="chemin direct vers un hero.json")
    ap.add_argument("--place", required=True, choices=CATALOG["place"])
    ap.add_argument("--item", required=True, choices=CATALOG["item"])
    ap.add_argument("--villain", required=True, choices=CATALOG["villain"])
    ap.add_argument("--level", default="courte", choices=list(LEVEL_PAGES.keys()))
    ap.add_argument("--text-only", action="store_true", help="ne genere pas les images")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--page-delay", type=float, default=12.0,
                    help="delai entre pages (rate-limit Vertex ~5 req/min)")
    args = ap.parse_args()

    hero = load_hero(args.hero_id, args.hero)
    n_pages = LEVEL_PAGES[args.level]
    combo = f"{args.level}_{args.place}_{args.item}_{args.villain}"
    out_dir = hero["_dir"] / "stories" / f"{combo}_{str(int(time.time()))[-6:]}"
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n=== HISTOIRE CUSTOM ===")
    print(f"  Heros : {hero['name']} (id={hero['hero_id']})")
    print(f"  Combo : {args.level} | {args.place} / {args.item} / {args.villain}")
    print(f"  Sortie: {out_dir}\n")

    # Personnalite (mot-cle + type) + graine narrative aleatoire -> variete
    kw = (hero.get("params", {}) or {}).get("keyword", "").strip()
    htype = (hero.get("params", {}) or {}).get("type", "")
    personality = kw or {"fille": "curieuse et pleine d'entrain",
                         "garcon": "curieux et plein d'entrain",
                         "animal": "malicieux et attachant",
                         "robot": "logique mais plein de surprises"}.get(htype, "courageux")
    seed = random.choice(NARRATIVE_SEEDS)
    print(f"[variete] personnalite='{personality}' | graine='{seed[:40]}...'")

    # 1) TEXTE (rapide) -> story.json tout de suite (lecture immediate cote front)
    print("[texte] Gemini Pro...")
    story = generate_text(args.level, hero["name"], hero["canon"],
                          args.place, args.item, args.villain, n_pages,
                          personality=personality, seed=seed)
    if not story:
        sys.exit("ECHEC generation texte")
    story.update({
        "custom": True, "level": args.level,
        "hero_id": hero["hero_id"], "hero_name": hero["name"],
        "place": args.place, "item": args.item, "villain": args.villain,
        "portrait": str(hero["_portrait_path"]).replace("\\", "/"),
        "personality": personality, "seed": seed,
    })
    (out_dir / "story.json").write_text(
        json.dumps(story, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[texte] OK : '{story['title']}' ({len(story['pages'])} pages)")
    print(f"  -> {out_dir / 'story.json'}")

    if args.text_only:
        print("[--text-only] images non generees.")
        return

    # 2) IMAGES page par page (progressif : chaque pageN.jpg ecrite des que prete)
    total = len(story["pages"])
    ok_count = 0
    for idx, page in enumerate(story["pages"], 1):
        if gen_page_image(page, idx, total, hero, args.place, args.item,
                          args.villain, out_dir, args.page_delay, args.force):
            ok_count += 1
    print(f"\nBilan images : {ok_count}/{total} OK")
    print(f"Histoire prete : {out_dir}")


if __name__ == "__main__":
    main()
