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
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent          # racine du projet
# Les modules de generation sont a la racine -> on l'ajoute au path AVANT import.
sys.path.insert(0, str(ROOT))

from flask import Flask, request, jsonify, send_from_directory, abort
from flask_cors import CORS

import threading
import secrets as _secrets
import hashlib
import bcrypt as _bcrypt

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

# v703 : pour la phase test collegues, certaines licences sont marquees
# test_mode=true et ont des quotas REDUITS (1 perso + 1 histoire par profil).
# Permet de bornier le cout IA pendant les retours pilotes.
HEROES_PER_STUDENT_TEST = 1
STORIES_PER_STUDENT_TEST = 1
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

# v701 : configuration auth enseignant (Brevo + sessions cookie)
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "")  # protege /api/admin/* (a definir en prod)
BREVO_API_KEY = os.getenv("BREVO_API_KEY", "")
BREVO_SENDER_EMAIL = os.getenv("BREVO_SENDER_EMAIL", "aurelienperrier34@gmail.com")
BREVO_SENDER_NAME = os.getenv("BREVO_SENDER_NAME", "IA — Le monde de Léon")
SESSION_DURATION_S = 24 * 3600          # 24h
INVITE_DURATION_S = 24 * 3600           # 24h pour activer un invite
RESET_DURATION_S = 3600                 # 1h pour reset le password

# Rate limit en memoire : {ip: [timestamps]}
_RATELIMIT_LOGIN = {}
_RATELIMIT_FORGOT = {}

# Sessions actives en memoire : {session_token: {license, expires_at}}
_SESSIONS = {}

# v702 : code classe court (4 chars) pour l'eleve qui n'a pas son QR code.
# Alphabet sans caracteres ambigus (pas de O/0, I/1, L) -> dictee facile.
CLASS_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
CLASS_CODE_LENGTH = 4

# Projet PRINCIPAL (le worktree est sous <main>/.claude/worktrees/<id>).
# Sert de REPLI pour les assets presents seulement cote main (ex: catalogue
# des 243 histoires) -> evite de dupliquer 765 Mo dans le worktree.
try:
    _maybe_main = ROOT.parents[2]
    MAIN_DIR = _maybe_main if (_maybe_main / "assets" / "stories").exists() else None
except Exception:
    MAIN_DIR = None

app = Flask(__name__)
# v704 : CORS avec credentials (cookies de session) -> on doit lister les
# origines AUTORISEES explicitement (impossible d'avoir Allow-Origin:* avec
# credentials:include cote navigateur). On accepte :
#  - GitHub Pages (prod statique)
#  - localhost (dev local)
#  - URL ngrok actuelle (test collegues)
# CORS_ORIGINS dans .env pour surcharger (ex: prod Cloud Run)
_cors_origins_env = os.getenv("CORS_ORIGINS", "")
if _cors_origins_env:
    _cors_origins = [o.strip() for o in _cors_origins_env.split(",") if o.strip()]
else:
    _cors_origins = [
        "https://aurelienperrier34-cyber.github.io",
        "http://localhost:8787",
        "http://127.0.0.1:8787",
        "https://marauding-tree-calamari.ngrok-free.dev",
    ]
CORS(app, origins=_cors_origins, supports_credentials=True)
print(f"[CORS] origines autorisees : {_cors_origins}")


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


# ============================================================
# v701 : auth enseignant (bcrypt + tokens + sessions + rate limit + emails)
# ============================================================
def _hash_password(password):
    """Hash bcrypt (12 rounds) du mot de passe en clair."""
    return _bcrypt.hashpw(password.encode("utf-8"), _bcrypt.gensalt(rounds=12)).decode("utf-8")


def _verify_password(password, hash_str):
    """Verifie un mot de passe contre le hash bcrypt stocke."""
    try:
        return _bcrypt.checkpw(password.encode("utf-8"), hash_str.encode("utf-8"))
    except Exception:
        return False


def _gen_token(nbytes=24):
    """Genere un token URL-safe (~32 chars)."""
    return _secrets.token_urlsafe(nbytes)


def _gen_class_code(length=CLASS_CODE_LENGTH):
    """Genere un code classe court (ex: K7H2) avec un alphabet sans
    caracteres ambigus -> facile a dicter et a taper par les eleves."""
    return "".join(_secrets.choice(CLASS_CODE_ALPHABET) for _ in range(length))


def _find_license_by_class_code(class_code):
    """Cherche la licence ayant ce code classe court."""
    if not class_code: return None
    c = class_code.strip().upper()
    data = _load_quota()
    for code, rec in data.items():
        if (rec.get("class_code") or "").upper() == c:
            return code
    return None


def _ensure_class_code(rec, data):
    """Garantit qu'un class_code existe pour cette licence. Gere la collision
    (cas extrêmement rare avec 923k combinaisons mais robustesse)."""
    if rec.get("class_code"):
        return rec["class_code"]
    existing = {r.get("class_code") for r in data.values() if r.get("class_code")}
    for _ in range(20):
        cc = _gen_class_code()
        if cc not in existing:
            rec["class_code"] = cc
            return cc
    # Fallback (statistiquement impossible)
    rec["class_code"] = _gen_class_code(6)
    return rec["class_code"]


def _client_ip():
    """Recupere l'IP client (gere les proxies via X-Forwarded-For)."""
    fwd = request.headers.get("X-Forwarded-For", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.remote_addr or "unknown"


def _rate_limit(bucket, ip, max_attempts, window_s):
    """Limite (max_attempts) par IP sur (window_s). Renvoie True si AUTORISE."""
    now = int(time.time())
    arr = bucket.get(ip, [])
    arr = [t for t in arr if now - t < window_s]
    if len(arr) >= max_attempts:
        bucket[ip] = arr
        return False
    arr.append(now)
    bucket[ip] = arr
    return True


def _find_license_by_email(email):
    """Cherche la 1re licence ayant cet email comme teacher_email."""
    if not email: return None
    email = email.strip().lower()
    data = _load_quota()
    for code, rec in data.items():
        if (rec.get("teacher_email") or "").lower() == email:
            return code
    return None


def _find_license_by_token(token_field, token_value):
    """Cherche la licence ayant tel invite_token / reset_token."""
    if not token_value: return None
    data = _load_quota()
    for code, rec in data.items():
        if rec.get(token_field) == token_value:
            return code
    return None


def _create_session(license_code):
    """Cree une session pour cette licence, renvoie le token."""
    token = _gen_token(32)
    _SESSIONS[token] = {
        "license": license_code,
        "expires_at": int(time.time()) + SESSION_DURATION_S,
    }
    return token


def _get_session(token):
    """Renvoie la session si valide, sinon None (et purge si expiree)."""
    if not token: return None
    sess = _SESSIONS.get(token)
    if not sess: return None
    if sess["expires_at"] < int(time.time()):
        _SESSIONS.pop(token, None)
        return None
    return sess


def _destroy_session(token):
    _SESSIONS.pop(token, None)


def _session_cookie_kwargs():
    """Cookie session.
    v708 : SameSite=None+Secure en HTTPS (autorise cross-origin necessaire
    pour github.io front -> ngrok/cloud-run API). En HTTP local, on garde
    SameSite=Lax (cross-origin GET autorise, suffisant car on est meme origine
    sur localhost). Strict bloquait les sessions en cross-origin = NetworkError."""
    is_https = request.is_secure or request.headers.get("X-Forwarded-Proto") == "https"
    return {
        "max_age": SESSION_DURATION_S,
        "httponly": True,
        "samesite": "None" if is_https else "Lax",
        "secure": is_https,
        "path": "/",
    }


def _send_email_brevo(to_email, to_name, subject, html_body):
    """Envoie un email via Brevo API. Renvoie (ok, error_msg)."""
    if not BREVO_API_KEY:
        # Mode dev sans Brevo : on log dans la console
        print(f"\n[email DEV - Brevo non configure]\n  TO: {to_email}\n  SUBJECT: {subject}\n  BODY (extrait): {html_body[:200]}...\n")
        return True, "DEV mode (no Brevo)"
    try:
        r = _rq.post("https://api.brevo.com/v3/smtp/email",
                     json={
                         "sender": {"email": BREVO_SENDER_EMAIL, "name": BREVO_SENDER_NAME},
                         "to": [{"email": to_email, "name": to_name or to_email}],
                         "subject": subject,
                         "htmlContent": html_body,
                     },
                     headers={"api-key": BREVO_API_KEY,
                              "Content-Type": "application/json",
                              "accept": "application/json"},
                     timeout=15)
        if 200 <= r.status_code < 300:
            return True, ""
        return False, f"Brevo {r.status_code}: {r.text[:200]}"
    except Exception as e:
        return False, str(e)


def _email_invite_html(teacher_name, class_name, invite_url):
    """Template HTML de l'email d'invitation."""
    name = teacher_name or "Madame, Monsieur"
    cn = class_name or "votre classe"
    return f"""
<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#3a2a1a;">
  <div style="background:linear-gradient(160deg,#FFE166,#F0B848);padding:24px;text-align:center;border-radius:12px 12px 0 0;">
    <h1 style="margin:0;color:#7a4a10;font-size:1.6rem;">IA : Le monde de Léon</h1>
    <p style="margin:6px 0 0;color:#7a4a10;opacity:.85;">Bienvenue dans l'aventure pédagogique</p>
  </div>
  <div style="background:#fff;padding:28px 24px;border-radius:0 0 12px 12px;border:1px solid #e0d8c0;">
    <p>Bonjour {name},</p>
    <p>Votre compte enseignant pour la classe <b>{cn}</b> est prêt à être activé.</p>
    <p>Cliquez sur le bouton ci-dessous pour <b>choisir votre mot de passe</b> et accéder à votre tableau de bord :</p>
    <div style="text-align:center;margin:28px 0;">
      <a href="{invite_url}" style="display:inline-block;background:linear-gradient(160deg,#7ec850,#4ca22f);color:#fff;text-decoration:none;font-weight:700;padding:14px 32px;border-radius:10px;font-size:1rem;">Activer mon compte</a>
    </div>
    <p style="font-size:.85rem;opacity:.7;">Ce lien est valable <b>24 heures</b>. Passé ce délai, vous pourrez en demander un nouveau.</p>
    <hr style="border:none;border-top:1px solid #e0d8c0;margin:24px 0;">
    <p style="font-size:.8rem;opacity:.6;">Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet email.</p>
  </div>
</div>
"""


def _email_reset_html(reset_url):
    """Template HTML de l'email de reset password."""
    return f"""
<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#3a2a1a;">
  <div style="background:linear-gradient(160deg,#FFE166,#F0B848);padding:24px;text-align:center;border-radius:12px 12px 0 0;">
    <h1 style="margin:0;color:#7a4a10;font-size:1.6rem;">Réinitialisation de mot de passe</h1>
  </div>
  <div style="background:#fff;padding:28px 24px;border-radius:0 0 12px 12px;border:1px solid #e0d8c0;">
    <p>Bonjour,</p>
    <p>Vous avez demandé à réinitialiser le mot de passe de votre compte enseignant <b>IA : Le monde de Léon</b>.</p>
    <p>Cliquez ci-dessous pour choisir un nouveau mot de passe :</p>
    <div style="text-align:center;margin:28px 0;">
      <a href="{reset_url}" style="display:inline-block;background:linear-gradient(160deg,#7ec850,#4ca22f);color:#fff;text-decoration:none;font-weight:700;padding:14px 32px;border-radius:10px;">Choisir un nouveau mot de passe</a>
    </div>
    <p style="font-size:.85rem;opacity:.7;">Ce lien est valable <b>1 heure</b>.</p>
    <hr style="border:none;border-top:1px solid #e0d8c0;margin:24px 0;">
    <p style="font-size:.8rem;opacity:.6;">Si vous n'êtes pas à l'origine de cette demande, ignorez cet email. Votre mot de passe actuel reste inchangé.</p>
  </div>
</div>
"""


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
    maintenant le quota PAR PROFIL ELEVE qui fait foi.
    v698 : ajout du champ class_name (nom de la classe, modifiable par le prof)."""
    code = (code or "").strip().upper()
    data = _load_quota()
    if code not in data:
        data[code] = {"plumes": PLUMES_INIT, "heroes_max": HEROES_MAX, "class_name": ""}
    # Migration : si profiles absent, initialise 25 eleves avec prenoms par defaut
    rec = data[code]
    # v702 : code classe court (genere a la migration si absent)
    if not rec.get("class_code"):
        _ensure_class_code(rec, data)
        _save_quota(data)
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
        # v703 : si test_mode active, applique les quotas test reduits.
        is_test = bool(rec.get("test_mode", False))
        h_max = HEROES_PER_STUDENT_TEST if is_test else HEROES_PER_STUDENT
        s_max = STORIES_PER_STUDENT_TEST if is_test else STORIES_PER_STUDENT
        changed = False
        for sid, p in rec["profiles"].items():
            if p.get("heroes_max") != h_max:
                p["heroes_max"] = h_max; changed = True
            if p.get("stories_max") != s_max:
                p["stories_max"] = s_max; changed = True
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


# v702 : endpoint PUBLIC pour resoudre un code classe court -> licence.
# L'eleve tape K7H2 dans l'app -> on lui renvoie le license_code complet
# (ECOLE-XXX) qu'il pourra utiliser ensuite avec /api/class/students.
@app.get("/api/class/by-code")
def class_by_code():
    code = (request.args.get("code", "") or "").strip().upper()
    if len(code) < 3:
        return jsonify({"error": "invalid_format"}), 400
    license_code = _find_license_by_class_code(code)
    if not license_code:
        return jsonify({"error": "not_found",
                        "message": "Code classe inconnu. Vérifie auprès de ton "
                                   "maître ou ta maîtresse."}), 404
    data, license_code = _license_record(license_code)
    return jsonify({
        "license": license_code,
        "class_name": data[license_code].get("class_name", ""),
        "class_code": data[license_code].get("class_code", ""),
    })


@app.post("/api/teacher/regenerate-class-code")
def teacher_regenerate_class_code():
    """v702 : regenere le code classe court (au cas ou il aurait fuite)."""
    license_code = _resolve_teacher_license()
    if not license_code:
        return jsonify({"error": "non_authentifie"}), 403
    data, license_code = _license_record(license_code)
    rec = data[license_code]
    # Force la regeneration meme si un code existe deja
    rec["class_code"] = ""
    new_code = _ensure_class_code(rec, data)
    _save_quota(data)
    return jsonify({"ok": True, "class_code": new_code})


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
    """v701 : login enseignant en 2 modes.
       - Mode v2 (production) : email + password -> cree une session cookie 24h
       - Mode legacy (tests/dev) : teacher_code (PROF-XXX) sans password
                                   -> mappe sur licence ECOLE-XXX (PROF-DEMO)
    Rate limit : 5 essais / 15 min par IP."""
    body = request.get_json(force=True, silent=True) or {}
    ip = _client_ip()
    if not _rate_limit(_RATELIMIT_LOGIN, ip, 5, 15 * 60):
        return jsonify({"error": "rate_limit",
                        "message": "Trop d'essais. Réessayez dans quelques minutes."}), 429

    email = (body.get("email", "") or "").strip().lower()
    password = body.get("password", "") or ""
    teacher_code = body.get("teacher_code", "") or ""

    # Mode v2 : email + password
    if email and password:
        license_code = _find_license_by_email(email)
        if not license_code:
            return jsonify({"error": "invalid", "message": "Email ou mot de passe incorrect."}), 403
        data, license_code = _license_record(license_code)
        rec = data[license_code]
        h = rec.get("teacher_password_hash", "")
        if not h or not _verify_password(password, h):
            return jsonify({"error": "invalid", "message": "Email ou mot de passe incorrect."}), 403
        # Cree session + pose cookie
        tok = _create_session(license_code)
        resp = jsonify({"ok": True, "license": license_code,
                        "class_name": rec.get("class_name", "")})
        resp.set_cookie("teacher_session", tok, **_session_cookie_kwargs())
        return resp

    # Mode legacy : teacher_code (sans mdp), backward-compat avec PROF-DEMO
    if teacher_code:
        license_code = _teacher_code_to_license(teacher_code)
        if not license_code or not _valid_license(license_code):
            return jsonify({"error": "code prof invalide"}), 403
        tok = _create_session(license_code)
        resp = jsonify({"ok": True, "license": license_code, "mode": "legacy"})
        resp.set_cookie("teacher_session", tok, **_session_cookie_kwargs())
        return resp

    return jsonify({"error": "missing_credentials",
                    "message": "Email + mot de passe (ou code enseignant) requis."}), 400


@app.post("/api/teacher/logout")
def teacher_logout():
    """v701 : detruit la session cookie."""
    tok = request.cookies.get("teacher_session", "")
    _destroy_session(tok)
    resp = jsonify({"ok": True})
    resp.set_cookie("teacher_session", "", max_age=0, path="/")
    return resp


@app.post("/api/teacher/forgot-password")
def teacher_forgot_password():
    """v701 : envoie un email de reset (token 1h). Reponse standardisee
    pour eviter l'enumeration des comptes."""
    body = request.get_json(force=True, silent=True) or {}
    ip = _client_ip()
    if not _rate_limit(_RATELIMIT_FORGOT, ip, 3, 3600):
        return jsonify({"error": "rate_limit",
                        "message": "Trop de demandes. Réessayez dans une heure."}), 429
    email = (body.get("email", "") or "").strip().lower()
    if not email:
        return jsonify({"error": "missing_email"}), 400

    license_code = _find_license_by_email(email)
    if license_code:
        data, license_code = _license_record(license_code)
        rec = data[license_code]
        token = _gen_token(24)
        rec["reset_token"] = token
        rec["reset_expires_at"] = int(time.time()) + RESET_DURATION_S
        _save_quota(data)
        # URL de reset : pointe sur teacher.html
        base = (body.get("base_url", "") or "").strip().rstrip("/") or \
               request.url_root.rstrip("/")
        reset_url = f"{base}/teacher.html?reset={token}"
        ok, err = _send_email_brevo(email, "", "Réinitialisation de mot de passe — Léon",
                                    _email_reset_html(reset_url))
        if not ok:
            print(f"[forgot-password] envoi email echoue : {err}")
    # Reponse identique que l'email existe ou non (anti-enumeration)
    return jsonify({"ok": True,
                    "message": "Si cet email correspond à un compte enseignant, "
                               "un email de réinitialisation vient d'être envoyé."})


@app.post("/api/teacher/reset-password")
def teacher_reset_password():
    """v701 : finalise le reset avec le token + nouveau mot de passe."""
    body = request.get_json(force=True, silent=True) or {}
    token = body.get("reset_token", "") or ""
    new_password = body.get("password", "") or ""
    if not token or not new_password:
        return jsonify({"error": "missing"}), 400
    if len(new_password) < 8:
        return jsonify({"error": "weak", "message":
                        "Le mot de passe doit faire au moins 8 caractères."}), 400
    license_code = _find_license_by_token("reset_token", token)
    if not license_code:
        return jsonify({"error": "invalid_token", "message":
                        "Lien invalide ou expiré. Demandez un nouveau lien."}), 403
    data, license_code = _license_record(license_code)
    rec = data[license_code]
    if rec.get("reset_expires_at", 0) < int(time.time()):
        return jsonify({"error": "expired", "message":
                        "Le lien a expiré. Demandez un nouveau lien."}), 403
    rec["teacher_password_hash"] = _hash_password(new_password)
    rec["reset_token"] = None
    rec["reset_expires_at"] = None
    _save_quota(data)
    return jsonify({"ok": True, "message": "Mot de passe mis à jour. Vous pouvez vous connecter."})


@app.post("/api/teacher/accept-invite")
def teacher_accept_invite():
    """v701 : finalise l'invitation = activation du compte avec mdp choisi."""
    body = request.get_json(force=True, silent=True) or {}
    token = body.get("invite_token", "") or ""
    password = body.get("password", "") or ""
    if not token or not password:
        return jsonify({"error": "missing"}), 400
    if len(password) < 8:
        return jsonify({"error": "weak", "message":
                        "Le mot de passe doit faire au moins 8 caractères."}), 400
    license_code = _find_license_by_token("invite_token", token)
    if not license_code:
        return jsonify({"error": "invalid_token", "message":
                        "Lien invalide ou expiré. Contactez l'éditeur pour un nouveau."}), 403
    data, license_code = _license_record(license_code)
    rec = data[license_code]
    if rec.get("invite_expires_at", 0) < int(time.time()):
        return jsonify({"error": "expired", "message":
                        "Lien expiré. Contactez l'éditeur pour un nouveau."}), 403
    rec["teacher_password_hash"] = _hash_password(password)
    rec["teacher_activated_at"] = int(time.time())
    rec["invite_token"] = None
    rec["invite_expires_at"] = None
    _save_quota(data)
    # Cree directement une session : l'enseignant est connecte
    tok = _create_session(license_code)
    resp = jsonify({"ok": True, "license": license_code,
                    "class_name": rec.get("class_name", "")})
    resp.set_cookie("teacher_session", tok, **_session_cookie_kwargs())
    return resp


@app.post("/api/admin/create-license")
def admin_create_license():
    """v701 : ADMIN. Cree une licence + invite enseignant + envoie email.
    Protege par ADMIN_TOKEN (header X-Admin-Token)."""
    if not ADMIN_TOKEN:
        return jsonify({"error": "admin_token_not_configured",
                        "message": "Le serveur n'a pas de ADMIN_TOKEN configure (.env)."}), 503
    sent = request.headers.get("X-Admin-Token", "")
    if sent != ADMIN_TOKEN:
        return jsonify({"error": "forbidden"}), 403

    body = request.get_json(force=True, silent=True) or {}
    teacher_email = (body.get("email", "") or "").strip().lower()
    teacher_name = (body.get("name", "") or "").strip()
    class_name = (body.get("class_name", "") or "").strip()
    force = bool(body.get("force_duplicate", False))   # v707 : override anti-doublon
    if not teacher_email:
        return jsonify({"error": "missing_email"}), 400

    # v707 : check anti-doublon par email (sauf si force=True)
    existing_code = _find_license_by_email(teacher_email)
    if existing_code and not force:
        data_check, _ = _license_record(existing_code)
        rec_existing = data_check[existing_code]
        return jsonify({
            "error": "email_already_exists",
            "message": "Cet email est déjà associé à une licence active.",
            "existing_license": existing_code,
            "existing_class_code": rec_existing.get("class_code", ""),
            "existing_activated": bool(rec_existing.get("teacher_activated_at")),
        }), 409

    # Genere un code licence pseudo-aleatoire (8 chars)
    suffix = _gen_token(6).upper().replace("-", "").replace("_", "")[:8]
    license_code = f"ECOLE-{suffix}"
    data = _load_quota()
    if license_code in data:
        return jsonify({"error": "collision"}), 500
    # v703 : test_mode optionnel (bornier les couts pendant la phase test collegues)
    test_mode = bool(body.get("test_mode", False))
    data[license_code] = {
        "plumes": PLUMES_INIT, "heroes_max": HEROES_MAX,
        "class_name": class_name,
        "teacher_email": teacher_email,
        "teacher_name": teacher_name,
        "teacher_password_hash": "",
        "test_mode": test_mode,
        "invite_token": _gen_token(24),
        "invite_expires_at": int(time.time()) + INVITE_DURATION_S,
        "teacher_invited_at": int(time.time()),
    }
    _save_quota(data)
    # Force migration profiles
    _license_record(license_code)

    # Email d'invitation
    base = (body.get("base_url", "") or "").strip().rstrip("/") or \
           request.url_root.rstrip("/")
    invite_url = f"{base}/teacher.html?invite={data[license_code]['invite_token']}"
    ok, err = _send_email_brevo(teacher_email, teacher_name,
                                "Activez votre compte — IA : Le monde de Léon",
                                _email_invite_html(teacher_name, class_name, invite_url))
    return jsonify({
        "ok": True,
        "license": license_code,
        "invite_url": invite_url,
        "email_sent": ok,
        "email_error": err if not ok else "",
    })


@app.get("/api/teacher/me")
def teacher_me():
    """v701 : info de session courante (license + class_name + teacher_email)."""
    tok = request.cookies.get("teacher_session", "")
    sess = _get_session(tok)
    if not sess:
        return jsonify({"error": "not_authenticated"}), 401
    data, license_code = _license_record(sess["license"])
    rec = data[license_code]
    return jsonify({
        "license": license_code,
        "class_name": rec.get("class_name", ""),
        "teacher_email": rec.get("teacher_email", ""),
        "teacher_name": rec.get("teacher_name", ""),
        "expires_at": sess["expires_at"],
    })


def _resolve_teacher_license():
    """v701 : helper pour les endpoints teacher.
    Renvoie license_code si auth OK, sinon None.
    Accepte 2 modes :
      - session cookie (v2, prefere)
      - teacher_code dans query/body (legacy, retro-compat avec PROF-DEMO)"""
    tok = request.cookies.get("teacher_session", "")
    sess = _get_session(tok)
    if sess:
        return sess["license"]
    # Fallback legacy : teacher_code
    teacher_code = (request.args.get("teacher_code", "") or "")
    if not teacher_code and request.method != "GET":
        body = request.get_json(silent=True) or {}
        teacher_code = body.get("teacher_code", "") or ""
    license_code = _teacher_code_to_license(teacher_code)
    if license_code and _valid_license(license_code):
        return license_code
    return None


@app.get("/api/teacher/students")
def teacher_students():
    """Liste les 25 profils eleves de la classe + stats (heros, histoires).
    v698 : renvoie aussi le nom de la classe.
    v701 : accepte session cookie OU teacher_code legacy."""
    license_code = _resolve_teacher_license()
    if not license_code:
        return jsonify({"error": "non_authentifie"}), 403
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
        "class_name": data[license_code].get("class_name", ""),
        "class_code": data[license_code].get("class_code", ""),
        "students": students,
        "heroes_per_student": HEROES_PER_STUDENT,
        "stories_per_student": STORIES_PER_STUDENT,
    })


@app.put("/api/teacher/class")
def teacher_class_update():
    """v698 : modifie le nom de la classe (ex: 'CE1 Madame Dupont').
    v701 : accepte session cookie OU teacher_code legacy."""
    license_code = _resolve_teacher_license()
    if not license_code:
        return jsonify({"error": "non_authentifie"}), 403
    body = request.get_json(force=True, silent=True) or {}
    data, license_code = _license_record(license_code)
    new_name = (body.get("class_name", "") or "").strip()[:60]
    data[license_code]["class_name"] = new_name
    _save_quota(data)
    return jsonify({"ok": True, "class_name": new_name})


@app.put("/api/teacher/students/<sid>")
def teacher_update_student(sid):
    """Modifie le prenom (et eventuellement l'avatar) d'un eleve.
    v701 : accepte session cookie OU teacher_code legacy."""
    license_code = _resolve_teacher_license()
    if not license_code:
        return jsonify({"error": "non_authentifie"}), 403
    body = request.get_json(force=True, silent=True) or {}
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


@app.get("/api/teacher/qrcodes.pdf")
def teacher_qrcodes_pdf():
    """v698 : genere une planche A4 de 25 QR codes (1 par eleve) a imprimer.
    Chaque QR code encode l'URL :
      <origin>/?student=<sid>&license=<code>
    Quand l'eleve scanne, il est identifie automatiquement -> entree directe
    dans le Livre Magique.
    v701 : accepte session cookie OU teacher_code legacy."""
    license_code = _resolve_teacher_license()
    if not license_code:
        return jsonify({"error": "non_authentifie"}), 403
    # Base URL : par defaut l'origine de la requete (utile en local).
    # En prod, le prof peut surcharger via ?base_url=https://iamondedeleon.fr
    base_url = (request.args.get("base_url", "") or "").strip().rstrip("/")
    if not base_url:
        base_url = request.url_root.rstrip("/")

    data, license_code = _license_record(license_code)
    profiles = data[license_code].get("profiles", {})
    class_name = data[license_code].get("class_name", "") or license_code

    from io import BytesIO
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import cm, mm
    from reportlab.lib.colors import HexColor
    from reportlab.pdfgen import canvas as pdfcanvas
    from reportlab.lib.utils import ImageReader
    import qrcode

    buf = BytesIO()
    c = pdfcanvas.Canvas(buf, pagesize=A4)
    W, H = A4   # 595 x 842 pt

    # En-tete
    c.setFillColor(HexColor("#7A4A10"))
    c.setFont("Helvetica-Bold", 14)
    c.drawString(1.5*cm, H - 1.5*cm, "Cartes d'accès — " + class_name)
    c.setFont("Helvetica", 9)
    c.setFillColor(HexColor("#888888"))
    c.drawString(1.5*cm, H - 2*cm,
        "Découpez et plastifiez chaque carte. L'élève la scanne avec la caméra "
        "pour entrer directement dans son espace.")

    # Grille 5 x 5
    COLS, ROWS = 5, 5
    PAGE_MARGIN_X = 1.5*cm
    PAGE_MARGIN_TOP = 2.6*cm
    PAGE_MARGIN_BOTTOM = 1.5*cm
    cell_w = (W - 2 * PAGE_MARGIN_X) / COLS
    cell_h = (H - PAGE_MARGIN_TOP - PAGE_MARGIN_BOTTOM) / ROWS

    # Tri des profils par index numerique
    sorted_profiles = sorted(profiles.items(),
                             key=lambda x: int(x[0][1:]) if x[0][1:].isdigit() else 99)
    for i, (sid, p) in enumerate(sorted_profiles[:COLS*ROWS]):
        col = i % COLS
        row = i // COLS
        x = PAGE_MARGIN_X + col * cell_w
        y_top = H - PAGE_MARGIN_TOP - row * cell_h
        y_bottom = y_top - cell_h

        # Cadre carte (pointilles pour decoupage)
        c.setStrokeColor(HexColor("#CCCCCC"))
        c.setDash(2, 2)
        c.rect(x + 2*mm, y_bottom + 2*mm, cell_w - 4*mm, cell_h - 4*mm)
        c.setDash()

        # Genere QR code
        url = f"{base_url}/?student={sid}&license={license_code}"
        qr = qrcode.QRCode(version=1, error_correction=qrcode.constants.ERROR_CORRECT_M,
                           box_size=10, border=2)
        qr.add_data(url); qr.make(fit=True)
        img = qr.make_image(fill_color="#1A0D2E", back_color="white")
        # Sauve en buffer PIL -> ImageReader
        img_buf = BytesIO()
        img.save(img_buf, format="PNG")
        img_buf.seek(0)
        qr_img = ImageReader(img_buf)

        # Place le QR (centre haut de la cellule)
        qr_size = min(cell_w - 8*mm, cell_h - 22*mm)
        qr_x = x + (cell_w - qr_size) / 2
        qr_y = y_top - 4*mm - qr_size
        c.drawImage(qr_img, qr_x, qr_y, qr_size, qr_size)

        # Avatar (en haut a droite) + prenom (centre bas)
        c.setFillColor(HexColor("#1A0D2E"))
        c.setFont("Helvetica", 14)
        c.drawString(x + cell_w - 9*mm, y_top - 5*mm, p.get("avatar", "👤"))

        c.setFillColor(HexColor("#1A0D2E"))
        c.setFont("Helvetica-Bold", 11)
        name = p.get("name", sid)[:18]
        # Centre le prenom
        from reportlab.pdfbase.pdfmetrics import stringWidth
        tw = stringWidth(name, "Helvetica-Bold", 11)
        c.drawString(x + (cell_w - tw) / 2, qr_y - 6*mm, name)

    # Pied de page
    c.setFont("Helvetica-Oblique", 7)
    c.setFillColor(HexColor("#AAAAAA"))
    c.drawCentredString(W/2, 1*cm,
        f"IA : Le monde de Léon — Cartes d'accès — {license_code} — {base_url}")

    c.save()
    buf.seek(0)
    fname = f"cartes_QR_{license_code}.pdf"
    from flask import Response
    return Response(buf.getvalue(), mimetype="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{fname}"'})


@app.get("/api/teacher/student/<sid>/stories.pdf")
def teacher_student_pdf(sid):
    """v698 : exporte en PDF toutes les histoires d'un eleve.
    Format : couverture (nom classe + prenom + avatar + date) + pour chaque
    histoire titre + pages avec image + texte.
    v701 : accepte session cookie OU teacher_code legacy."""
    license_code = _resolve_teacher_license()
    if not license_code:
        return jsonify({"error": "non_authentifie"}), 403
    data, license_code = _license_record(license_code)
    profiles = data[license_code].get("profiles", {})
    if sid not in profiles:
        return jsonify({"error": "eleve inconnu"}), 404
    profile = profiles[sid]
    class_name = data[license_code].get("class_name", "") or license_code

    # Collecte les heros + histoires de cet eleve
    heroes_data = []
    for hdir in sorted(CUSTOM_DIR.iterdir()) if CUSTOM_DIR.exists() else []:
        hj = hdir / "hero.json"
        if not hj.exists():
            continue
        try:
            meta = json.loads(hj.read_text(encoding="utf-8"))
        except Exception:
            continue
        if meta.get("license") != license_code or meta.get("student_id") != sid:
            continue
        stories = []
        sdir = hdir / "stories"
        if sdir.exists():
            for st in sorted(sdir.iterdir()):
                if not st.is_dir(): continue
                sj = st / "story.json"
                if not sj.exists(): continue
                try:
                    s = json.loads(sj.read_text(encoding="utf-8"))
                    s["_dir"] = st
                    stories.append(s)
                except Exception:
                    pass
        heroes_data.append({
            "hero_id": meta["hero_id"],
            "name": meta.get("name", ""),
            "portrait": hdir / "portrait.jpg",
            "stories": stories,
        })

    # Genere le PDF
    from io import BytesIO
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import cm
    from reportlab.lib.colors import HexColor
    from reportlab.pdfgen import canvas as pdfcanvas
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfbase.pdfmetrics import stringWidth

    buf = BytesIO()
    c = pdfcanvas.Canvas(buf, pagesize=A4)
    W, H = A4

    def wrap_text(text, font, size, max_w):
        words = (text or "").split()
        lines, cur = [], ""
        for w in words:
            test = (cur + " " + w).strip()
            if stringWidth(test, font, size) <= max_w:
                cur = test
            else:
                if cur: lines.append(cur)
                cur = w
        if cur: lines.append(cur)
        return lines

    # === COUVERTURE ===
    c.setFillColor(HexColor("#2A1850"))
    c.rect(0, 0, W, H, stroke=0, fill=1)
    c.setFillColor(HexColor("#FFE166"))
    c.setFont("Helvetica-Bold", 36)
    c.drawCentredString(W/2, H - 5*cm, "IA : Le monde de Léon")
    c.setFillColor(HexColor("#FFF8EE"))
    c.setFont("Helvetica", 22)
    c.drawCentredString(W/2, H - 7*cm, "Histoires de " + (profile.get("name", "") or sid))
    c.setFont("Helvetica", 80)
    c.drawCentredString(W/2, H/2 + 1*cm, profile.get("avatar", "👤"))
    c.setFont("Helvetica", 16)
    c.drawCentredString(W/2, H/2 - 3*cm, class_name)
    c.setFont("Helvetica-Oblique", 12)
    c.setFillColor(HexColor("#B0A0D0"))
    nb_h = len(heroes_data); nb_s = sum(len(h["stories"]) for h in heroes_data)
    c.drawCentredString(W/2, 3*cm, f"{nb_h} héros · {nb_s} histoires")
    c.showPage()

    # === HISTOIRES ===
    for hero in heroes_data:
        for story in hero["stories"]:
            # Page titre de l'histoire
            c.setFillColor(HexColor("#FFF8EE"))
            c.rect(0, 0, W, H, stroke=0, fill=1)
            c.setFillColor(HexColor("#7A4A10"))
            c.setFont("Helvetica-Bold", 28)
            for li, ln in enumerate(wrap_text(story.get("title", "Histoire"), "Helvetica-Bold", 28, W - 4*cm)):
                c.drawCentredString(W/2, H/2 + 3*cm - li*1.2*cm, ln)
            c.setFillColor(HexColor("#A07050"))
            c.setFont("Helvetica-Oblique", 13)
            c.drawCentredString(W/2, H/2 - 2*cm,
                "Une aventure de " + hero["name"] + " — " + (profile.get("name") or sid))
            c.showPage()

            # Pages de l'histoire (image + texte)
            for idx, page in enumerate(story.get("pages", []), 1):
                img_path = story["_dir"] / f"page{idx}.jpg"
                if img_path.exists():
                    try:
                        img = ImageReader(str(img_path))
                        # Image en haut, 16:9, occupe ~45% de la hauteur
                        img_w, img_h = W - 4*cm, (W - 4*cm) * 9 / 16
                        c.drawImage(img, 2*cm, H - 2*cm - img_h, img_w, img_h, preserveAspectRatio=True)
                        text_y = H - 2*cm - img_h - 1.5*cm
                    except Exception:
                        text_y = H - 4*cm
                else:
                    text_y = H - 4*cm
                # Texte sous l'image
                c.setFillColor(HexColor("#3A2A1A"))
                c.setFont("Helvetica", 11)
                txt = (page.get("text", "") or "").replace("<br><br>", "\n\n").replace("<br>", "\n")
                # Strip basic HTML
                import re as _re
                txt = _re.sub(r"<[^>]+>", "", txt)
                paragraphs = txt.split("\n\n")
                y = text_y
                for para in paragraphs:
                    for ln in wrap_text(para.replace("\n", " ").strip(), "Helvetica", 11, W - 4*cm):
                        if y < 2*cm: break
                        c.drawString(2*cm, y, ln)
                        y -= 0.42*cm
                    y -= 0.3*cm
                # Numero de page en bas
                c.setFillColor(HexColor("#8A7060"))
                c.setFont("Helvetica-Oblique", 9)
                c.drawCentredString(W/2, 1.2*cm,
                    f"{story.get('title', '')[:50]} — page {idx} / {len(story.get('pages', []))}")
                c.showPage()

    c.save()
    buf.seek(0)
    fname = f"histoires_{profile.get('name', sid).replace(' ', '_')}.pdf"
    from flask import Response
    return Response(buf.getvalue(), mimetype="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{fname}"'})


@app.delete("/api/teacher/students/<sid>/heroes")
def teacher_reset_student(sid):
    """Supprime tous les heros (et leurs histoires) d'un eleve. Le quota se
    recalcule automatiquement (basé sur les hero.json existants).
    v701 : accepte session cookie OU teacher_code legacy."""
    license_code = _resolve_teacher_license()
    if not license_code:
        return jsonify({"error": "non_authentifie"}), 403
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
