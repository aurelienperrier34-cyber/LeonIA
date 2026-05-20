# -*- coding: utf-8 -*-
"""
generate_custom_hero.py
=======================
COEUR de la creation de heros personnalise (modele 1 : heros custom seul).

A partir des choix du builder enfant (type, cheveux, couleur, tenue, prenom +
petit mot-cle libre), construit :
  1. un PROMPT de portrait (style watercolor coherent avec le reste de l'app)
  2. une description CANON compacte (a injecter dans les prompts d'histoire,
     exactement comme les heros du catalogue dans item_canon.py)
puis genere le PORTRAIT CANONIQUE via Gemini 2.5 Flash Image (Vertex AI).

Ce portrait devient la REFERENCE passee a chaque page de l'histoire -> coherence
du personnage garantie (meme mecanisme que generate_story_gemini.py).

>>> Ce fichier est concu pour etre reutilise TEL QUEL dans la Cloud Function.
    Les params arrivent en JSON (du builder front) ; en local on peut aussi
    passer des flags CLI pour tester.

Sortie :
  assets/custom/<hero_id>/portrait.jpg
  assets/custom/<hero_id>/hero.json   (params + canon + prompt + chemin portrait)

Usage local :
  python generate_custom_hero.py --type fille --hair couettes --hair-color roux \
      --outfit cape --outfit-color violet --name "Zoe" --keyword "exploratrice"
  python generate_custom_hero.py --json hero_params.json
  python generate_custom_hero.py --print-only ...   (n'appelle pas Gemini : debug prompt)
"""

import argparse
import base64
import json
import re
import sys
import time
import unicodedata
from pathlib import Path

from item_canon import PORTRAIT_STYLE, PORTRAIT_NEGATIVE

# --- auth Vertex (meme pattern que generate_game_cards.py) -------------------
try:
    from dotenv import load_dotenv
    for c in [Path(__file__).parent / ".env", Path.cwd() / ".env"]:
        if c.exists():
            load_dotenv(c); break
except Exception:
    pass

VERTEX_REGION = "us-central1"
URL_TPL = ("https://{r}-aiplatform.googleapis.com/v1/projects/{p}/locations/{r}/"
           "publishers/google/models/{m}:generateContent")


def _lazy_auth():
    """Charge la service account a la demande (evite l'erreur en --print-only)."""
    import requests  # noqa
    from google.oauth2 import service_account as _sa
    from google.auth.transport.requests import Request as _AuthRequest
    sa_file = Path("service-account.json")
    if not sa_file.exists():
        sys.exit("ERREUR : service-account.json introuvable")
    scopes = ["https://www.googleapis.com/auth/cloud-platform"]
    creds = _sa.Credentials.from_service_account_file(str(sa_file), scopes=scopes)
    project = json.loads(sa_file.read_text(encoding="utf-8"))["project_id"]
    return creds, project, _AuthRequest


# ============================================================
# VOCABULAIRE BUILDER  (choix FR de l'enfant -> fragments EN pour Gemini)
# ============================================================
# Chaque entree : "fragment de prompt portrait" + "fragment canon compact".
# Les valeurs inconnues retombent sur un defaut neutre (jamais d'erreur).

V_TYPE = {
    "fille":  ("a cheerful young girl child (around 7 years old)", "young girl child"),
    "garcon": ("a cheerful young boy child (around 7 years old)",  "young boy child"),
    "animal": ("a cute friendly little animal character",          "cute little animal"),
    "robot":  ("a cute friendly little robot character",           "cute little robot"),
}

V_HAIR = {
    "court":    ("short neat hair",                "short hair"),
    "long":     ("long flowing hair",              "long hair"),
    "boucle":   ("curly hair",                     "curly hair"),
    "couettes": ("hair in two cute pigtails",      "hair in two pigtails"),
    "queue":    ("hair in a ponytail",             "ponytail"),
    "tresse":   ("hair in a long braid",           "long braid"),
    "chauve":   ("no hair (bald), round head",     "bald"),
}

V_COLOR = {  # sert pour cheveux ET tenue
    "brun":   "brown", "blond": "golden blonde", "roux": "ginger red",
    "noir":   "black", "rose": "bright pink", "bleu": "sky blue",
    "violet": "purple", "vert": "green", "blanc": "white",
    "orange": "orange", "turquoise": "turquoise", "arc-en-ciel": "rainbow-colored",
}

# fragments SANS article : l'article est ajoute par build_prompts ("wearing a ...")
V_OUTFIT = {
    "cape":       ("flowing hero cape",     "hero cape"),
    "robe":       ("pretty dress",          "dress"),
    "salopette":  ("denim overalls",        "overalls"),
    "pull":       ("cozy knitted sweater",  "knitted sweater"),
    "combinaison":("adventurer jumpsuit",   "adventurer jumpsuit"),
    "tshirt":     ("colorful t-shirt",      "t-shirt"),
    "armure":     ("light shiny toy-knight armor", "light toy-knight armor"),
}

V_ACCESSORY = {
    "chapeau":   ("a pointy magical hat",        "a pointy hat"),
    "couronne":  ("a small golden crown",        "a golden crown"),
    "lunettes":  ("round cute glasses",          "round glasses"),
    "echarpe":   ("a long striped scarf",        "a striped scarf"),
    "sac":       ("a small explorer backpack",   "an explorer backpack"),
    "casquette": ("a colorful cap",              "a cap"),
    "noeud":     ("a big ribbon bow",            "a ribbon bow"),
    "aucun":     ("", ""),
}


def _slug(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return s or "hero"


# --- moderation MINIMALE du mot-cle libre ------------------------------------
# NB : en production la VRAIE moderation se fait cote serveur (safety Gemini +
# liste etendue). Ici on bloque juste l'evident pour les tests locaux.
_BLOCKLIST = {
    "sang", "blood", "gun", "arme", "kill", "tuer", "mort", "death", "drogue",
    "drug", "sexe", "sex", "nu", "naked", "nazi", "hitler", "guerre", "war",
}


def _clean_keyword(kw):
    if not kw:
        return ""
    low = kw.lower().strip()
    for bad in _BLOCKLIST:
        if bad in low:
            raise ValueError(f"mot-cle refuse (moderation) : contient '{bad}'")
    # garde lettres/espaces/tirets, max 40 caracteres
    cleaned = re.sub(r"[^\w\s\-àâäéèêëïîôöùûüç']", "", kw, flags=re.UNICODE)
    return cleaned.strip()[:40]


def build_prompts(params):
    """params (dict) -> (portrait_prompt, canon_text, hero_id, name)."""
    name = (params.get("name") or "Mon heros").strip()[:24] or "Mon heros"
    type_p, type_c = V_TYPE.get(params.get("type", "fille"), V_TYPE["fille"])

    is_creature = params.get("type") in ("animal", "robot")

    bits_p, bits_c = [], []
    if not is_creature:
        hair_p, hair_c = V_HAIR.get(params.get("hair", "court"), V_HAIR["court"])
        hc = V_COLOR.get(params.get("hair_color", "brun"), "brown")
        if params.get("hair") != "chauve":
            bits_p.append(f"{hc} {hair_p}")
            bits_c.append(f"{hc} {hair_c}")
        else:
            bits_p.append(hair_p); bits_c.append(hair_c)

    out_p, out_c = V_OUTFIT.get(params.get("outfit", "tshirt"), V_OUTFIT["tshirt"])
    oc = V_COLOR.get(params.get("outfit_color", "bleu"), "blue")
    bits_p.append(f"wearing a {oc} {out_p}")
    bits_c.append(f"{oc} {out_c}")

    acc_p, acc_c = V_ACCESSORY.get(params.get("accessory", "aucun"), V_ACCESSORY["aucun"])
    if acc_p:
        bits_p.append(f"and {acc_p}")
        bits_c.append(acc_c)

    kw = _clean_keyword(params.get("keyword", ""))
    if kw:
        bits_p.append(f"themed as {kw}")
        bits_c.append(f"{kw} theme")

    descr_p = ", ".join(b for b in bits_p if b)
    portrait_prompt = (
        PORTRAIT_STYLE +
        f"Portrait of {name}, {type_p}, {descr_p}, "
        "big bright friendly smile, rosy cheeks, looking warmly at the viewer, "
        "full upper body shot, adorable and kid-friendly."
    )
    canon_text = (
        f"{name}: {type_c}, " + ", ".join(b for b in bits_c if b) +
        ", friendly cheerful expression. "
    )
    hero_id = _slug(name) + "-" + str(int(time.time()))[-6:]
    return portrait_prompt, canon_text, hero_id, name


def generate_portrait(portrait_prompt, dest, model="gemini-2.5-flash-image"):
    import requests
    creds, project, AuthRequest = _lazy_auth()
    if creds.expired or not creds.token:
        creds.refresh(AuthRequest())
    payload = {
        "contents": [{"role": "user", "parts": [{"text": portrait_prompt}]}],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
            "temperature": 0.5,
            "imageConfig": {"aspectRatio": "1:1"},
        },
    }
    url = URL_TPL.format(r=VERTEX_REGION, p=project, m=model)
    headers = {"Authorization": f"Bearer {creds.token}", "Content-Type": "application/json"}
    print(f"  Gemini {model} -> {dest.name}")
    for attempt in range(3):
        try:
            r = requests.post(url, json=payload, headers=headers, timeout=120)
        except Exception as e:
            print(f"    EXC {e}, retry..."); time.sleep(15); continue
        if r.status_code == 429:
            wait = 15 + attempt * 15
            print(f"    429, wait {wait}s..."); time.sleep(wait); continue
        if r.status_code >= 400:
            print(f"    ERREUR {r.status_code}: {r.text[:300]}"); return False
        rj = r.json()
        try:
            for p in rj["candidates"][0]["content"]["parts"]:
                d = p.get("inlineData") or p.get("inline_data")
                if d and d.get("data"):
                    img = base64.standard_b64decode(d["data"])
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    dest.write_bytes(img)
                    print(f"    OK {len(img)//1024} KB"); return True
            print(f"    Pas d'image: {str(rj)[:200]}")
        except Exception as e:
            print(f"    Parsing: {e}")
        return False
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", help="fichier JSON de params (prioritaire)")
    ap.add_argument("--type", default="fille")
    ap.add_argument("--hair", default="court")
    ap.add_argument("--hair-color", dest="hair_color", default="brun")
    ap.add_argument("--outfit", default="tshirt")
    ap.add_argument("--outfit-color", dest="outfit_color", default="bleu")
    ap.add_argument("--accessory", default="aucun")
    ap.add_argument("--name", default="Mon heros")
    ap.add_argument("--keyword", default="")
    ap.add_argument("--print-only", action="store_true",
                    help="affiche prompt + canon sans appeler Gemini")
    args = ap.parse_args()

    if args.json:
        params = json.loads(Path(args.json).read_text(encoding="utf-8"))
    else:
        params = {k: getattr(args, k) for k in
                  ["type", "hair", "hair_color", "outfit", "outfit_color",
                   "accessory", "name", "keyword"]}

    try:
        portrait_prompt, canon_text, hero_id, name = build_prompts(params)
    except ValueError as e:
        sys.exit(f"REFUSE : {e}")

    print(f"\n[custom hero] {name}  (id={hero_id})")
    print(f"  PORTRAIT PROMPT:\n    {portrait_prompt}\n")
    print(f"  CANON:\n    {canon_text}\n")

    if args.print_only:
        print("(--print-only : pas d'appel Gemini)")
        return

    out_dir = Path("assets/custom") / hero_id
    dest = out_dir / "portrait.jpg"
    ok = generate_portrait(portrait_prompt, dest)
    meta = {
        "hero_id": hero_id, "name": name, "params": params,
        "portrait_prompt": portrait_prompt, "canon": canon_text,
        "portrait": str(dest).replace("\\", "/"),
        "negative": PORTRAIT_NEGATIVE, "ok": ok,
    }
    (out_dir).mkdir(parents=True, exist_ok=True)
    (out_dir / "hero.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  hero.json ecrit. {'OK' if ok else 'ECHEC portrait'}")


if __name__ == "__main__":
    main()
