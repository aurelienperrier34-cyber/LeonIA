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

import requests as _rq

import generate_custom_hero as gch
import generate_custom_story as gcs
from stories_db import LEVEL_PAGES
from generate_story_audio import synthesize_page, clean_html_for_tts
from generate_story_text import _token as _mod_token, _vertex_url as _mod_url

CUSTOM_VOICE = "fr-FR-Studio-A"   # voix narration (comme le catalogue)


# ============================================================
# MODERATION (securite enfants) — classifieur Gemini sur le texte libre
# ============================================================
def moderate_kid_safe(text):
    """Classe un texte libre comme adapte (ou non) aux 5-9 ans via Gemini.
    Renvoie (ok: bool, message: str). Fail-open si l'appel echoue : les filtres
    natifs de Gemini Image/Texte restent une 2e barriere lors de la generation."""
    text = (text or "").strip()
    if not text:
        return True, ""
    # v678 : prompt assoupli. La version precedente bloquait "yeti", "monstre",
    # "vampire mignon" etc. par exces de prudence. On autorise EXPLICITEMENT les
    # creatures imaginaires inoffensives, qui sont au coeur des histoires jeunesse.
    prompt = (
        "Tu es un filtre de SECURITE pour une application d'histoires destinee a des "
        "ENFANTS de 5 a 9 ans. Un enfant a saisi le texte ci-dessous pour decrire "
        "son heros imaginaire. Reponds STRICTEMENT par un seul mot : 'OUI' ou 'NON'.\n\n"
        "AUTORISE (reponds OUI) : les creatures imaginaires inoffensives meme si "
        "elles peuvent sembler etranges (yeti, monstre mignon, dragon gentil, "
        "fantome rigolo, sorciere bienveillante, robot, alien, vampire chibi, "
        "loup-garou jouet, momie ridicule, etc.), les animaux fantastiques, les "
        "couleurs vives, les super-pouvoirs, les accessoires fantaisistes.\n\n"
        "REFUSE (reponds NON) uniquement si le texte contient EXPLICITEMENT : "
        "violence reelle (sang, mort, blessure, meurtre), arme reelle (fusil, "
        "couteau), sexualite ou nudite, drogue ou alcool, haine raciste ou "
        "discriminatoire, insultes ou grossieretes, contenu politique adulte, "
        "ou idees clairement effrayantes pour un jeune enfant (horreur, gore, "
        "demon malefique, torture).\n\nTEXTE: " + text
    )
    payload = {"contents": [{"role": "user", "parts": [{"text": prompt}]}],
               "generationConfig": {"temperature": 0, "maxOutputTokens": 10}}
    refus = "Cette idee n'est pas adaptee. Essaie quelque chose de plus rigolo !"
    try:
        # gemini-2.5-pro = seul modele texte accessible sur ce projet
        r = _rq.post(_mod_url("gemini-2.5-pro"), json=payload, timeout=30,
                     headers={"Authorization": f"Bearer {_mod_token()}",
                              "Content-Type": "application/json"})
        if r.status_code >= 400:
            print(f"[moderation] HTTP {r.status_code} -> fail-open"); return True, ""
        cand = (r.json().get("candidates") or [{}])[0]
        parts = cand.get("content", {}).get("parts", [])
        if not parts:
            # v678 : reponse vide (Gemini safety filter sur le prompt). Avant on
            # bloquait par prudence, mais ca produisait trop de faux positifs sur
            # des descriptions inoffensives (yeti, monstre mignon...). On passe
            # en FAIL-OPEN : les filtres natifs de Gemini Image (utilises lors de
            # la generation du portrait) restent la 2e barriere.
            fr = cand.get("finishReason", "")
            print(f"[moderation] reponse vide (finishReason={fr}) -> fail-open ; "
                  f"Gemini Image filtrera si vraiment problematique")
            return True, ""
        out = parts[0].get("text", "").strip().upper()
        if out.startswith("N"):       # NON (tronque possible)
            return False, refus
        return True, ""               # OUI / O
    except Exception as e:
        print(f"[moderation] exception {e} -> fail-open"); return True, ""

CUSTOM_DIR = ROOT / "assets" / "custom"
QUOTA_FILE = Path(__file__).resolve().parent / "quota.json"
# v676 : modele economique = 3 persos x 1 histoire par eleve (25 eleves/classe)
# -> 75 heros + 75 plumes par licence (au lieu de 6 + 30 historiques)
HEROES_MAX = 75
PLUMES_INIT = 75
# v680 : quota PAR PROFIL ELEVE (mode classe = 25 eleves, chacun a 3 heros et
# 3 histoires max). L'enseignant gere les prenoms via /teacher.html.
HEROES_PER_STUDENT = 3
STORIES_PER_STUDENT = 3
STUDENTS_PER_CLASS = 25
# Avatars par defaut quand une classe est initialisee (1 par eleve)
DEFAULT_AVATARS = [
    "🦊","🐻","🐰","🦁","🐼","🐸","🐵","🦉","🐯","🦄",
    "🐶","🐱","🐧","🐢","🦋","🐝","🐙","🦖","🐳","🦅",
    "🐞","🦒","🐨","🦔","🐺",
]
# Force le niveau "courte" (5 pages) pour les histoires custom des eleves
# -> economie d'images vs "soir" (7p) ou "aventure" (10p).
# Mettre False pour permettre les niveaux longs (pack rallonge futur).
FORCE_SHORT_STORY = True
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


def _teacher_code_to_license(code):
    """v680 : un code prof PROF-XXXX donne acces au dashboard de la licence
    ECOLE-XXXX correspondante. PROF-DEMO -> ECOLE-DEMO.
    Cas special : PROF-LEON est aussi un code prof autonome (debug)."""
    import re
    c = (code or "").strip().upper()
    if not c:
        return None
    if c == "PROF-DEMO":
        return "ECOLE-DEMO"
    if c == "PROF-LEON":
        return "ECOLE-DEMO"  # prof-leon = code maitre, voit la classe demo
    m = re.match(r"^PROF-([A-Z0-9]{4,})$", c)
    if m:
        return f"ECOLE-{m.group(1)}"
    return None


def _license_record(code):
    """Retourne (et cree si besoin) la fiche quota d'une licence valide.
    v680 : migration auto vers le format "profiles" (25 eleves) si pas encore
    present. Le quota plumes global est conserve pour retro-compat mais c'est
    maintenant le quota PAR PROFIL ELEVE qui fait foi."""
    code = (code or "").strip().upper()
    data = _load_quota()
    if code not in data:
        data[code] = {"plumes": PLUMES_INIT, "heroes_max": HEROES_MAX}
    # Migration : si profiles absent, initialise 25 eleves avec prenoms par defaut
    rec = data[code]
    if "profiles" not in rec or not isinstance(rec.get("profiles"), dict):
        rec["profiles"] = {}
        for i in range(1, STUDENTS_PER_CLASS + 1):
            rec["profiles"][f"e{i}"] = {
                "name": f"Élève {i}",
                "avatar": DEFAULT_AVATARS[(i - 1) % len(DEFAULT_AVATARS)],
                "heroes_max": HEROES_PER_STUDENT,
                "stories_max": STORIES_PER_STUDENT,
            }
        _save_quota(data)
    elif rec["profiles"]:
        # Met a jour les champs heroes_max/stories_max si manquants (anciens
        # profils avec juste plumes). On garde le name/avatar saisis par le prof.
        changed = False
        for sid, p in rec["profiles"].items():
            if "heroes_max" not in p:
                p["heroes_max"] = HEROES_PER_STUDENT; changed = True
            if "stories_max" not in p:
                p["stories_max"] = STORIES_PER_STUDENT; changed = True
        if changed:
            _save_quota(data)
    return data, code


def _student_stats(license_code, student_id):
    """Compte le nb de heros et histoires deja crees par cet eleve, en lisant
    les hero.json (assets/custom/<id>/hero.json) qui contiennent license +
    student_id."""
    heroes = 0
    stories = 0
    if not CUSTOM_DIR.exists():
        return {"heroes": 0, "stories": 0}
    for hdir in CUSTOM_DIR.iterdir():
        hj = hdir / "hero.json"
        if not hj.exists():
            continue
        try:
            h = json.loads(hj.read_text(encoding="utf-8"))
        except Exception:
            continue
        if h.get("license") != license_code:
            continue
        if h.get("student_id") != student_id:
            continue
        heroes += 1
        sdir = hdir / "stories"
        if sdir.exists():
            stories += sum(1 for s in sdir.iterdir() if s.is_dir())
    return {"heroes": heroes, "stories": stories}


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
    # v697 : si student_id fourni, filtre les heros DE cet eleve uniquement
    student_id = (request.args.get("student_id", "") or "").strip()
    heroes = _list_heroes(code)
    if student_id:
        # Filtre cote serveur en relisant le student_id de chaque hero.json
        filtered = []
        for h in heroes:
            try:
                hj = (CUSTOM_DIR / h["hero_id"] / "hero.json")
                if hj.exists():
                    meta = json.loads(hj.read_text(encoding="utf-8"))
                    if meta.get("student_id") == student_id:
                        filtered.append(h)
            except Exception:
                pass
        heroes = filtered
    return jsonify({
        "license": code,
        "plumes": data[code]["plumes"],
        "heroes_max": data[code].get("heroes_max", HEROES_MAX),
        "heroes": heroes,
    })


# v697 : endpoint PUBLIC pour la liste des prenoms de la classe (accessible
# sans code prof, depuis l'app eleve). Ne renvoie QUE prenom + avatar +
# quota restant -> assez pour le picker eleve, pas de donnees sensibles.
@app.get("/api/class/students")
def class_students():
    code = request.args.get("license", "")
    if not _valid_license(code):
        return jsonify({"error": "licence invalide"}), 403
    data, code = _license_record(code)
    profiles = data[code].get("profiles", {})
    students = []
    for sid, p in sorted(profiles.items(),
                         key=lambda x: int(x[0][1:]) if x[0][1:].isdigit() else 99):
        stats = _student_stats(code, sid)
        students.append({
            "id": sid,
            "name": p.get("name", sid),
            "avatar": p.get("avatar", "👤"),
            "heroes_left": max(0, p.get("heroes_max", HEROES_PER_STUDENT) - stats["heroes"]),
            "stories_left": max(0, p.get("stories_max", STORIES_PER_STUDENT) - stats["stories"]),
        })
    return jsonify({"license": code, "students": students})


@app.post("/api/create-hero")
def create_hero():
    body = request.get_json(force=True, silent=True) or {}
    code = body.get("license", "")
    if not _valid_license(code):
        return jsonify({"error": "licence invalide"}), 403
    data, code = _license_record(code)

    # v680 : quota PAR PROFIL ELEVE. student_id obligatoire pour les nouvelles
    # versions. Si absent (back-compat), on retombe sur le quota global classe.
    student_id = (body.get("student_id") or "").strip()
    if student_id:
        profiles = data[code].get("profiles", {})
        if student_id not in profiles:
            return jsonify({"error": "eleve_inconnu",
                            "message": "Profil eleve inconnu."}), 404
        stats = _student_stats(code, student_id)
        max_h = profiles[student_id].get("heroes_max", HEROES_PER_STUDENT)
        if stats["heroes"] >= max_h:
            return jsonify({"error": "limite_heros_eleve", "message":
                            f"Tu as deja {max_h} heros. Demande a ta maitresse "
                            "ou ton maitre d'en supprimer un."}), 409
    else:
        # Back-compat : sans student_id, quota global classe (ancien comportement)
        if len(_list_heroes(code)) >= data[code].get("heroes_max", HEROES_MAX):
            return jsonify({"error": "limite_heros", "message":
                            f"Limite de {HEROES_MAX} heros atteinte. Supprime-en un."}), 409

    params = {k: body.get(k, "") for k in
              ["type", "hair", "hair_color", "outfit", "outfit_color",
               "accessory", "name", "keyword"]}

    # Moderation IA (securite enfants) sur le texte libre : prenom + idee
    ok_mod, why = moderate_kid_safe((params.get("name", "") + " " + params.get("keyword", "")).strip())
    if not ok_mod:
        return jsonify({"error": "moderation", "message": why}), 400

    try:
        portrait_prompt, canon, hero_id, name = gch.build_prompts(params)
    except ValueError as e:   # liste de mots interdits (pre-filtre rapide)
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
        "license": code, "student_id": student_id, "created": int(time.time()),
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

    # v697 : quota PAR PROFIL ELEVE pour les histoires aussi
    student_id = (body.get("student_id") or "").strip()
    if student_id:
        profiles = data[code].get("profiles", {})
        if student_id not in profiles:
            return jsonify({"error": "eleve_inconnu",
                            "message": "Profil eleve inconnu."}), 404
        stats = _student_stats(code, student_id)
        max_s = profiles[student_id].get("stories_max", STORIES_PER_STUDENT)
        if stats["stories"] >= max_s:
            return jsonify({"error": "limite_histoires_eleve", "message":
                            f"Tu as deja vecu {max_s} histoires. Demande a ta "
                            "maitresse ou ton maitre de creer une autre classe."}), 409

    # Quota legacy classe (plumes) garde par retro-compat
    if data[code]["plumes"] < 1:
        return jsonify({"error": "plumes", "message": "Plus de plumes disponibles."}), 402

    hero_id = body.get("hero_id", "")
    place = body.get("place", ""); item = body.get("item", ""); villain = body.get("villain", "")
    level = body.get("level", "courte")
    if level not in LEVEL_PAGES:
        return jsonify({"error": "level invalide"}), 400
    # v676 : modele economique -> on force "courte" (5 pages) pour reduire les
    # couts d'images. Les niveaux longs restent dispo via pack rallonge futur.
    if FORCE_SHORT_STORY and level != "courte":
        print(f"[create-story] level={level} demande mais force a 'courte' (economie)")
        level = "courte"
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


# ============================================================
# v680 : ENDPOINTS MODE ENSEIGNANT
# Auth simple : un code PROF-XXXX donne acces au dashboard de la classe
# ECOLE-XXXX correspondante. Pas de session ; le code est envoye a chaque
# requete (suffisant pour usage en classe). Page UI : /teacher.html
# ============================================================
@app.post("/api/teacher/login")
def teacher_login():
    """Verifie qu'un code prof est valide. Renvoie la licence ecole associee."""
    body = request.get_json(force=True, silent=True) or {}
    teacher_code = body.get("teacher_code", "")
    license_code = _teacher_code_to_license(teacher_code)
    if not license_code or not _valid_license(license_code):
        return jsonify({"error": "code prof invalide"}), 403
    return jsonify({"ok": True, "license": license_code})


@app.get("/api/teacher/students")
def teacher_students():
    """Liste les 25 profils eleves de la classe + stats (heros, histoires)."""
    teacher_code = request.args.get("teacher_code", "")
    license_code = _teacher_code_to_license(teacher_code)
    if not license_code or not _valid_license(license_code):
        return jsonify({"error": "code prof invalide"}), 403
    data, license_code = _license_record(license_code)
    profiles = data[license_code].get("profiles", {})
    students = []
    for sid, p in sorted(profiles.items(), key=lambda x: int(x[0][1:]) if x[0][1:].isdigit() else 99):
        stats = _student_stats(license_code, sid)
        students.append({
            "id": sid,
            "name": p.get("name", sid),
            "avatar": p.get("avatar", "👤"),
            "heroes": stats["heroes"],
            "heroes_max": p.get("heroes_max", HEROES_PER_STUDENT),
            "stories": stats["stories"],
            "stories_max": p.get("stories_max", STORIES_PER_STUDENT),
        })
    return jsonify({
        "license": license_code,
        "students": students,
        "heroes_per_student": HEROES_PER_STUDENT,
        "stories_per_student": STORIES_PER_STUDENT,
    })


@app.put("/api/teacher/students/<sid>")
def teacher_update_student(sid):
    """Modifie le prenom (et eventuellement l'avatar) d'un eleve."""
    body = request.get_json(force=True, silent=True) or {}
    teacher_code = body.get("teacher_code", "")
    license_code = _teacher_code_to_license(teacher_code)
    if not license_code or not _valid_license(license_code):
        return jsonify({"error": "code prof invalide"}), 403
    data, license_code = _license_record(license_code)
    profiles = data[license_code].setdefault("profiles", {})
    if sid not in profiles:
        return jsonify({"error": "eleve introuvable"}), 404
    new_name = (body.get("name", "") or "").strip()[:24]
    if new_name:
        profiles[sid]["name"] = new_name
    new_avatar = (body.get("avatar", "") or "").strip()[:6]
    if new_avatar:
        profiles[sid]["avatar"] = new_avatar
    _save_quota(data)
    return jsonify({"ok": True, "student": profiles[sid]})


@app.delete("/api/teacher/students/<sid>/heroes")
def teacher_reset_student(sid):
    """Supprime tous les heros (et leurs histoires) d'un eleve. Le quota se
    recalcule automatiquement (basé sur les hero.json existants)."""
    teacher_code = request.args.get("teacher_code", "")
    license_code = _teacher_code_to_license(teacher_code)
    if not license_code or not _valid_license(license_code):
        return jsonify({"error": "code prof invalide"}), 403
    import shutil
    removed = 0
    if CUSTOM_DIR.exists():
        for hdir in list(CUSTOM_DIR.iterdir()):
            hj = hdir / "hero.json"
            if not hj.exists():
                continue
            try:
                h = json.loads(hj.read_text(encoding="utf-8"))
            except Exception:
                continue
            if h.get("license") == license_code and h.get("student_id") == sid:
                shutil.rmtree(hdir, ignore_errors=True)
                removed += 1
    return jsonify({"ok": True, "removed_heroes": removed})


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
