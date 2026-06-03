# -*- coding: utf-8 -*-
"""
storage.py — Abstraction lecture/ecriture de fichiers.

En local (CLOUD_STORAGE_BUCKET non defini) : utilise le disque comme avant.
En production Cloud Run (CLOUD_STORAGE_BUCKET defini) : utilise Cloud Storage.

Toutes les fonctions prennent un chemin relatif a la racine du projet :
  - 'quota.json' -> server/quota.json en local
                 -> bucket/server/quota.json en GCS
  - 'assets/custom/<id>/hero.json' -> idem

Note : les fichiers READ-ONLY de l'app (HTML, JS, CSS, assets statiques) ne
passent PAS par ce module. Ils sont servis directement par Flask (en local) ou
par GitHub Pages (en prod). Seules les donnees CREEES A L'EXECUTION (quota,
heros, histoires) passent par ce module.
"""
import os
import shutil
from pathlib import Path

CLOUD_BUCKET = os.getenv("CLOUD_STORAGE_BUCKET", "").strip()
USE_GCS = bool(CLOUD_BUCKET)

# Initialisation lazy de Cloud Storage (uniquement si configure)
_gcs_client = None
_gcs_bucket = None
if USE_GCS:
    try:
        from google.cloud import storage as _gcs_storage
        _gcs_client = _gcs_storage.Client()
        _gcs_bucket = _gcs_client.bucket(CLOUD_BUCKET)
        print(f"[storage] mode CLOUD STORAGE actif (bucket={CLOUD_BUCKET})")
    except Exception as e:
        print(f"[storage] ERREUR init GCS: {e}. Fallback sur disque local.")
        USE_GCS = False

if not USE_GCS:
    print("[storage] mode DISQUE LOCAL (CLOUD_STORAGE_BUCKET non defini)")

# Racine pour les chemins relatifs en mode local
_LOCAL_ROOT = Path(__file__).resolve().parent.parent


def _local_path(relpath):
    """Chemin absolu local pour un chemin relatif au projet."""
    return _LOCAL_ROOT / relpath


# ==================== READ / WRITE ====================

def read_text(relpath):
    """Lit un fichier texte. Renvoie le contenu str, ou None si absent."""
    if USE_GCS:
        blob = _gcs_bucket.blob(relpath)
        if not blob.exists():
            return None
        return blob.download_as_text(encoding="utf-8")
    p = _local_path(relpath)
    if not p.exists():
        return None
    return p.read_text(encoding="utf-8")


def write_text(relpath, content, content_type="text/plain; charset=utf-8"):
    """Ecrit un fichier texte. Cree les dossiers parents si besoin."""
    if USE_GCS:
        _gcs_bucket.blob(relpath).upload_from_string(content, content_type=content_type)
        return
    p = _local_path(relpath)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")


def read_bytes(relpath):
    """Lit un fichier binaire. Renvoie bytes ou None si absent."""
    if USE_GCS:
        blob = _gcs_bucket.blob(relpath)
        if not blob.exists():
            return None
        return blob.download_as_bytes()
    p = _local_path(relpath)
    if not p.exists():
        return None
    return p.read_bytes()


def write_bytes(relpath, content, content_type="application/octet-stream"):
    """Ecrit un fichier binaire."""
    if USE_GCS:
        _gcs_bucket.blob(relpath).upload_from_string(content, content_type=content_type)
        return
    p = _local_path(relpath)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(content)


def exists(relpath):
    if USE_GCS:
        return _gcs_bucket.blob(relpath).exists()
    return _local_path(relpath).exists()


def delete(relpath):
    """Supprime un fichier. Silencieux si deja absent."""
    if USE_GCS:
        blob = _gcs_bucket.blob(relpath)
        if blob.exists():
            blob.delete()
        return
    p = _local_path(relpath)
    if p.exists():
        p.unlink()


def delete_prefix(prefix):
    """Supprime TOUS les blobs/fichiers sous un prefixe (= dossier)."""
    if USE_GCS:
        for blob in _gcs_bucket.list_blobs(prefix=prefix.rstrip("/") + "/"):
            blob.delete()
        return
    p = _local_path(prefix)
    if p.exists():
        if p.is_dir():
            shutil.rmtree(p, ignore_errors=True)
        else:
            p.unlink()


def list_dirs(prefix):
    """Liste les noms de "sous-dossiers" directs sous prefix.
    Ex: list_dirs('assets/custom') -> ['bo-252827', 'bobi-252314', ...]
    """
    if USE_GCS:
        # GCS n'a pas de vrais dossiers. On utilise delimiter pour simuler.
        prefix_clean = prefix.rstrip("/") + "/"
        iterator = _gcs_client.list_blobs(_gcs_bucket, prefix=prefix_clean, delimiter="/")
        list(iterator)  # force la collecte des prefixes
        result = []
        for p in iterator.prefixes:
            name = p[len(prefix_clean):].rstrip("/")
            if name and "/" not in name:
                result.append(name)
        return sorted(result)
    p = _local_path(prefix)
    if not p.exists():
        return []
    return sorted([d.name for d in p.iterdir() if d.is_dir()])


def list_files(prefix, suffix=None):
    """Liste les fichiers directs sous prefix (1er niveau seulement)."""
    if USE_GCS:
        prefix_clean = prefix.rstrip("/") + "/"
        iterator = _gcs_client.list_blobs(_gcs_bucket, prefix=prefix_clean, delimiter="/")
        files = []
        for blob in iterator:
            name = blob.name[len(prefix_clean):]
            if "/" in name:
                continue  # subdir
            if suffix and not name.endswith(suffix):
                continue
            files.append(name)
        return sorted(files)
    p = _local_path(prefix)
    if not p.exists():
        return []
    files = [f.name for f in p.iterdir() if f.is_file()]
    if suffix:
        files = [f for f in files if f.endswith(suffix)]
    return sorted(files)


def public_url(relpath, expires_seconds=3600):
    """Renvoie une URL accessible par le browser pour un fichier.
    En GCS : URL signee valable expires_seconds.
    En local : path relatif servi par Flask.
    """
    if USE_GCS:
        from datetime import timedelta
        blob = _gcs_bucket.blob(relpath)
        return blob.generate_signed_url(
            version="v4",
            expiration=timedelta(seconds=expires_seconds),
            method="GET",
        )
    # En local : Flask sert via /custom/... ou /assets/...
    return "/" + relpath


def info():
    """Pour debug : indique le mode actuel."""
    return {
        "use_gcs": USE_GCS,
        "bucket": CLOUD_BUCKET if USE_GCS else None,
        "local_root": str(_LOCAL_ROOT) if not USE_GCS else None,
    }


def bootstrap_from_local(relpath):
    """Bootstrap : au 1er demarrage Cloud Run, si le fichier n'existe pas
    encore dans le bucket mais existe en local (= dans le conteneur Docker
    via la COPY au build), l'upload. Permet une migration transparente des
    donnees actuelles (quota.json) lors du 1er deploy.
    Apres : GCS est source de verite, le local n'est plus consulte."""
    if not USE_GCS:
        return  # mode local : pas besoin de bootstrap
    if exists(relpath):
        return  # deja en GCS, ne pas ecraser
    local_file = _LOCAL_ROOT / relpath
    if local_file.exists():
        print(f"[storage] BOOTSTRAP {relpath} : conteneur -> GCS")
        with open(local_file, "rb") as f:
            content = f.read()
        # Devine le content_type
        ct = "application/json" if relpath.endswith(".json") else "application/octet-stream"
        write_bytes(relpath, content, content_type=ct)
        print(f"[storage] BOOTSTRAP OK ({len(content)} bytes)")


# ============================================================
# v718 : SYNC DIRECTORY (pour assets/custom/<hero_id>/ et stories)
# Permet d'uploader recursivement tout un dossier local vers GCS
# (apres une creation de heros / histoire) ou inversement
# (restore au demarrage Cloud Run).
# ============================================================

def sync_dir_to_gcs(local_dir_relpath):
    """Upload tous les fichiers d'un dossier local vers GCS (recursif).
    No-op si pas en mode GCS."""
    if not USE_GCS:
        return 0
    base = _LOCAL_ROOT / local_dir_relpath
    if not base.exists() or not base.is_dir():
        return 0
    count = 0
    for f in base.rglob("*"):
        if not f.is_file():
            continue
        rel = f.relative_to(_LOCAL_ROOT).as_posix()
        ct = _guess_content_type(rel)
        with open(f, "rb") as fh:
            _gcs_bucket.blob(rel).upload_from_string(fh.read(), content_type=ct)
        count += 1
    if count:
        print(f"[storage] sync -> GCS : {local_dir_relpath} ({count} fichiers)")
    return count


def sync_dir_from_gcs(prefix):
    """Download tous les blobs sous un prefixe GCS vers le FS local.
    Utile au demarrage Cloud Run pour restaurer les heros/histoires.
    No-op si pas en mode GCS."""
    if not USE_GCS:
        return 0
    count = 0
    for blob in _gcs_bucket.list_blobs(prefix=prefix.rstrip("/") + "/"):
        local_path = _LOCAL_ROOT / blob.name
        local_path.parent.mkdir(parents=True, exist_ok=True)
        blob.download_to_filename(str(local_path))
        count += 1
    if count:
        print(f"[storage] sync <- GCS : {prefix} ({count} fichiers)")
    return count


def _guess_content_type(path):
    """Mime type basique selon l'extension."""
    p = path.lower()
    if p.endswith(".json"): return "application/json"
    if p.endswith(".jpg") or p.endswith(".jpeg"): return "image/jpeg"
    if p.endswith(".png"): return "image/png"
    if p.endswith(".mp3"): return "audio/mpeg"
    if p.endswith(".mp4"): return "video/mp4"
    if p.endswith(".webp"): return "image/webp"
    return "application/octet-stream"
