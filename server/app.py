# -*- coding: utf-8 -*-
"""
server/app.py
=============
Backend de generation custom (heros + histoires) — ETAPE 4.

Conçu pour tourner EN LOCAL d'abord (pilote de classe, zero deploiement, zero
cout d'infra), puis se deployer tel quel sur Cloud Run plus tard.

Reutilise la chaine deja validee :
  - generate_custom_hero.py   (portrait canonique)
  - generate_custom_story.py  (texte + images, heros custom)

Sécurité / quotas (source de verite = SERVEUR, pas le navigateur) :
  - licence ecole (code) -> quota de plumes + max 6 heros
  - 1 plume = 1 histoire ; debit cote serveur
  - moderation du mot-cle (heritee de generate_custom_hero)
  - la cle service-account reste cote serveur, jamais exposee

Endpoints :
  GET  /api/health
  GET  /api/state?license=CODE              -> { plumes, heroes:[...] }
  POST /api/create-hero    {license, ...params}     -> hero
  POST /api/create-story   {license, hero_id, place, item, villain, level}
  GET  /custom/<path>                        -> sert les fichiers generes

Lancement (local) :
  pip install flask flask-cors
  python server/app.py            # http://localhost:8787
"""

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent          # racine du projet
# Les modules de generation sont a la racine -> on l'ajoute au path AVANT import.
sys.path.insert(0, str(ROOT))

from flask import Flask, request, jsonify, send_from_directory, abort
from flask_cors import CORS

import threading

import generate_custom_hero as gch
import generate_custom_story as gcs
from stories_db import LEVEL_PAGES
from generate_story_audio import synthesize_page, clean_html_for_tts

CUSTOM_VOICE = "fr-FR-Studio-A"   # voix narration (comme le catalogue)

CUSTOM_DIR = ROOT / "assets" / "custom"
QUOTA_FILE = Path(__file__).resolve().parent / "quota.json"
HEROES_MAX = 6
PORT = 8787

# Projet PRINCIPAL (le worktree est sous <main>/.claude/worktrees/<id>).
# Sert de REPLI pour les assets presents seulement cote main (ex: catalogue
# des 243 histoires) -> evite de dupliquer 765 Mo dans le worktree.
try:
    _maybe_main = ROOT.parents[2]
    MAIN_DIR = _maybe_main if (_maybe_main / "assets" / "stories").exists() else None
except Exception:
    MAIN_DIR = None

app = Flask(__name__)
CORS(app)   # autorise le front (autre origine/port) a appeler l'API


# ============================================================
# Licence + quota (stockage local JSON ; -> Firestore en prod)
# ============================================================
def _load_quota():
    if QUOTA_FILE.exists():
        try:
            return json.loads(QUOTA_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def _save_quota(data):
    QUOTA_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _valid_license(code):
    """Mirroir de la validation front (MVP). -> Firestore 'licenses' en prod."""
    import re
    c = (code or "").strip().upper()
    if not c:
        return False
    if c in ("ECOLE-DEMO", "PROF-LEON", "CLASSE-2026"):
        return True
    return bool(re.match(r"^ECOLE-[A-Z0-9]{4,}$", c))


def _license_record(code):
    """Retourne (et cree si besoin) la fiche quota d'une licence valide."""
    code = (code or "").strip().upper()
    data = _load_quota()
    if code not in data:
        # nouvelle licence ecole : quota de demarrage
        data[code] = {"plumes": 30, "heroes_max": HEROES_MAX}
        _save_quota(data)
    return data, code


# ============================================================
# Helpers heros (lecture du disque)
# ============================================================
def _list_heroes(code):
    """Liste les heros crees pour cette licence (dossiers sous assets/custom)."""
    heroes = []
    if not CUSTOM_DIR.exists():
        return heroes
    for d in sorted(CUSTOM_DIR.iterdir()):
        hj = d / "hero.json"
        if not hj.exists():
            continue
        try:
            h = json.loads(hj.read_text(encoding="utf-8"))
        except Exception:
            continue
        if h.get("license") != code:
            continue
        heroes.append({
            "hero_id": h["hero_id"],
            "name": h.get("name", ""),
            "portrait_url": f"/custom/{h['hero_id']}/portrait.jpg",
        })
    return heroes


# ============================================================
# Endpoints
# ============================================================
@app.get("/api/health")
def health():
    return jsonify({"ok": True, "service": "leon-backend", "ts": int(time.time())})


@app.get("/api/state")
def state():
    code = request.args.get("license", "")
    if not _valid_license(code):
        return jsonify({"error": "licence invalide"}), 403
    data, code = _license_record(code)
    return jsonify({
        "license": code,
        "plumes": data[code]["plumes"],
        "heroes_max": data[code].get("heroes_max", HEROES_MAX),
        "heroes": _list_heroes(code),
    })


@app.post("/api/create-hero")
def create_hero():
    body = request.get_json(force=True, silent=True) or {}
    code = body.get("license", "")
    if not _valid_license(code):
        return jsonify({"error": "licence invalide"}), 403
    data, code = _license_record(code)

    # Limite de 6 heros par licence
    if len(_list_heroes(code)) >= data[code].get("heroes_max", HEROES_MAX):
        return jsonify({"error": "limite_heros", "message":
                        f"Limite de {HEROES_MAX} heros atteinte. Supprime-en un."}), 409

    params = {k: body.get(k, "") for k in
              ["type", "hair", "hair_color", "outfit", "outfit_color",
               "accessory", "name", "keyword"]}
    try:
        portrait_prompt, canon, hero_id, name = gch.build_prompts(params)
    except ValueError as e:   # moderation du mot-cle
        return jsonify({"error": "moderation", "message": str(e)}), 400

    out_dir = CUSTOM_DIR / hero_id
    dest = out_dir / "portrait.jpg"
    ok = gch.generate_portrait(portrait_prompt, dest)
    if not ok:
        return jsonify({"error": "generation",
                        "message": "Generation du portrait impossible (quota Gemini ?). Reessaie."}), 502

    meta = {
        "hero_id": hero_id, "name": name, "params": params,
        "portrait_prompt": portrait_prompt, "canon": canon,
        "portrait": str(dest).replace("\\", "/"),
        "license": code, "created": int(time.time()),
    }
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "hero.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    return jsonify({"hero_id": hero_id, "name": name,
                    "portrait_url": f"/custom/{hero_id}/portrait.jpg", "canon": canon})


def _generate_assets_bg(story, out_dir, hero, place, item, villain):
    """Thread de fond : genere image + narration MP3 pour chaque page."""
    pages = story.get("pages", [])
    for idx, page in enumerate(pages, 1):
        try:
            gcs.gen_page_image(page, idx, len(pages), hero, place, item, villain,
                               out_dir, page_delay=8.0, force=False)
        except Exception as e:
            print(f"[bg] image page{idx} err: {e}")
        try:
            txt = clean_html_for_tts(page.get("text", ""))
            if txt:
                synthesize_page(txt, out_dir / f"page{idx}.mp3",
                                voice=CUSTOM_VOICE, speaking_rate=0.95)
        except Exception as e:
            print(f"[bg] audio page{idx} err: {e}")
    print(f"[bg] termine : {out_dir.name}")


@app.post("/api/create-story")
def create_story():
    body = request.get_json(force=True, silent=True) or {}
    code = body.get("license", "")
    if not _valid_license(code):
        return jsonify({"error": "licence invalide"}), 403
    data, code = _license_record(code)

    # Quota : 1 plume requise
    if data[code]["plumes"] < 1:
        return jsonify({"error": "plumes", "message": "Plus de plumes disponibles."}), 402

    hero_id = body.get("hero_id", "")
    place = body.get("place", ""); item = body.get("item", ""); villain = body.get("villain", "")
    level = body.get("level", "courte")
    if level not in LEVEL_PAGES:
        return jsonify({"error": "level invalide"}), 400
    for role, val, cat in [("place", place, gcs.CATALOG["place"]),
                           ("item", item, gcs.CATALOG["item"]),
                           ("villain", villain, gcs.CATALOG["villain"])]:
        if val not in cat:
            return jsonify({"error": f"{role} invalide"}), 400

    try:
        hero = gcs.load_hero(hero_id, None)
    except SystemExit:
        return jsonify({"error": "hero introuvable"}), 404
    if hero.get("license") != code:
        return jsonify({"error": "hero non autorise"}), 403

    n_pages = LEVEL_PAGES[level]
    import random
    kw = (hero.get("params", {}) or {}).get("keyword", "").strip()
    htype = (hero.get("params", {}) or {}).get("type", "")
    personality = kw or {"fille": "curieuse et pleine d'entrain",
                         "garcon": "curieux et plein d'entrain",
                         "animal": "malicieux et attachant",
                         "robot": "logique mais plein de surprises"}.get(htype, "courageux")
    seed = random.choice(gcs.NARRATIVE_SEEDS)

    story = gcs.generate_text(level, hero["name"], hero["canon"],
                              place, item, villain, n_pages,
                              personality=personality, seed=seed)
    if not story:
        return jsonify({"error": "generation", "message": "Texte non genere (quota ?)."}), 502

    combo = f"{level}_{place}_{item}_{villain}"
    # IMPORTANT : chemin ABSOLU (sous CUSTOM_DIR) pour que relative_to() marche
    # plus bas (hero["_dir"] est relatif et fait planter relative_to).
    out_dir = CUSTOM_DIR / hero["hero_id"] / "stories" / f"{combo}_{str(int(time.time()))[-6:]}"
    out_dir.mkdir(parents=True, exist_ok=True)
    story.update({"custom": True, "level": level, "hero_id": hero["hero_id"],
                  "hero_name": hero["name"], "place": place, "item": item,
                  "villain": villain, "personality": personality, "seed": seed})
    (out_dir / "story.json").write_text(
        json.dumps(story, ensure_ascii=False, indent=2), encoding="utf-8")

    # Debit d'une plume des que le TEXTE est pret (la partie garantie/utile)
    data, code = _license_record(code)
    data[code]["plumes"] = max(0, data[code]["plumes"] - 1)
    _save_quota(data)

    # Images + audio EN TACHE DE FOND -> le front affiche le texte immediatement
    # et charge chaque page (image + narration) au fur et a mesure (progressif).
    threading.Thread(
        target=_generate_assets_bg,
        args=(story, out_dir, hero, place, item, villain),
        daemon=True,
    ).start()

    rel = str(out_dir.relative_to(CUSTOM_DIR)).replace("\\", "/")
    return jsonify({
        "status": "generating",
        "story_dir": rel,
        "story_url": f"/custom/{rel}/story.json",
        "title": story["title"],
        "pages_total": len(story["pages"]),
        "plumes_left": data[code]["plumes"],
    })


@app.get("/api/stories")
def list_stories():
    """Liste les histoires deja generees pour cette licence (relecture gratuite)."""
    code = request.args.get("license", "")
    if not _valid_license(code):
        return jsonify({"error": "licence invalide"}), 403
    _license_record(code)
    hero_ids = {h["hero_id"] for h in _list_heroes(code)}
    out = []
    for hid in hero_ids:
        sdir = CUSTOM_DIR / hid / "stories"
        if not sdir.exists():
            continue
        for d in sorted(sdir.iterdir()):
            sj = d / "story.json"
            if not sj.exists():
                continue
            try:
                s = json.loads(sj.read_text(encoding="utf-8"))
            except Exception:
                continue
            rel = str(d.relative_to(CUSTOM_DIR)).replace("\\", "/")
            out.append({
                "story_dir": rel,
                "title": s.get("title", "Mon histoire"),
                "hero_name": s.get("hero_name", ""),
                "level": s.get("level", ""),
                "story_url": f"/custom/{rel}/story.json",
                "cover_url": f"/custom/{rel}/page1.jpg",
            })
    out.sort(key=lambda x: x["story_dir"], reverse=True)   # plus recentes d'abord
    return jsonify({"stories": out})


@app.delete("/api/hero/<hero_id>")
def delete_hero(hero_id):
    """Supprime un heros (et ses histoires) pour liberer un slot."""
    code = request.args.get("license", "")
    if not _valid_license(code):
        return jsonify({"error": "licence invalide"}), 403
    d = CUSTOM_DIR / hero_id
    hj = d / "hero.json"
    if not hj.exists():
        return jsonify({"error": "hero introuvable"}), 404
    try:
        h = json.loads(hj.read_text(encoding="utf-8"))
    except Exception:
        h = {}
    if h.get("license") != code:
        return jsonify({"error": "hero non autorise"}), 403
    import shutil
    shutil.rmtree(d, ignore_errors=True)
    return jsonify({"ok": True, "deleted": hero_id})


@app.get("/custom/<path:subpath>")
def serve_custom(subpath):
    """Sert les fichiers generes (portraits, images, story.json)."""
    full = (CUSTOM_DIR / subpath).resolve()
    if not str(full).startswith(str(CUSTOM_DIR.resolve())) or not full.exists():
        abort(404)
    return send_from_directory(CUSTOM_DIR, subpath)


# ============================================================
# Sert AUSSI l'app statique (index.html, game.js, assets...) -> une seule
# commande, une seule URL (http://localhost:8787), pas de souci de CORS.
# Les routes /api/* et /custom/* sont prioritaires (plus specifiques).
# ============================================================
@app.get("/")
def _index():
    return send_from_directory(ROOT, "index.html")


@app.get("/<path:p>")
def _static_app(p):
    full = (ROOT / p).resolve()
    if str(full).startswith(str(ROOT.resolve())) and full.is_file():
        return send_from_directory(ROOT, p)
    # Repli sur le projet principal (catalogue des 243 histoires, etc.)
    if MAIN_DIR is not None:
        mfull = (MAIN_DIR / p).resolve()
        if str(mfull).startswith(str(MAIN_DIR.resolve())) and mfull.is_file():
            return send_from_directory(MAIN_DIR, p)
    abort(404)


if __name__ == "__main__":
    print(f"[backend] Leon — http://localhost:{PORT}")
    print(f"[backend] Ouvre l'app : http://localhost:{PORT}/")
    print(f"[backend] custom dir : {CUSTOM_DIR}")
    app.run(host="0.0.0.0", port=PORT, threaded=True)
