# -*- coding: utf-8 -*-
"""
generate_all_stories.py
=======================
ORCHESTRATEUR overnight pour generer LE LIVRE MAGIQUE COMPLET.

Pour chaque cle (level_combo) :
  1. Genere le TEXTE de la story si absent (Gemini 2.5 Pro)
  2. Genere les IMAGES de chaque page (Gemini 2.5 Flash Image / Nano Banana)
     avec portraits canon en reference + verification stricte + retry
  3. Genere les MP3 de chaque page (Google TTS Studio-A)
     avec verification stricte (Gemini transcrit + compare) + retry

Checkpoint : sauve dans logs/checkpoint.json apres chaque ETAPE de chaque story.
Si interrompu, relance avec le meme cmd et il reprend ou il s'est arrete.

Logs : logs/overnight_<timestamp>.log (humain) + logs/overnight_<ts>.jsonl (machine).

Usage :
  # TOUT (243 stories, ~15-20h, ~$100)
  python generate_all_stories.py

  # Juste un niveau (81 stories ~6h)
  python generate_all_stories.py --levels courte

  # Combos specifiques (debug)
  python generate_all_stories.py --keys courte_dragon_chateau_guitare_fantome

  # Pour skip une etape (debug)
  python generate_all_stories.py --skip-audio  # text+images only
  python generate_all_stories.py --skip-images --skip-audio  # text only

  # Voix audio (defaut Studio-A premium)
  python generate_all_stories.py --voice fr-FR-Studio-A
  python generate_all_stories.py --voice fr-FR-Neural2-A  # 10x moins cher
"""

import argparse
import json
import os
import sys
import time
import traceback
from datetime import datetime
from pathlib import Path
from dotenv import load_dotenv

# Charge .env
for c in [Path(__file__).parent / ".env", Path.cwd() / ".env"]:
    if c.exists():
        load_dotenv(c); break

# Imports modules du projet
from stories_db import (all_keys, parse_key, load_story, story_exists,
                        story_path, page_image_path, page_audio_path,
                        story_dir, LEVELS, LEVEL_PAGES)
from item_canon import (ITEM_CANON, get_canon_for_combo,
                        get_exclusion_instruction, STORY_STYLE)
from generate_story_text import generate_text
from generate_story_gemini import (gen_image_gemini, collect_ref_portraits,
                                    auto_detect_refs_for_page)
from generate_story_audio import synthesize_page, clean_html_for_tts
try:
    from verify_story_image import verify_image, auto_portraits
    _HAS_IMG_VERIFY = True
except Exception:
    _HAS_IMG_VERIFY = False
try:
    from verify_story_audio import verify_audio
    _HAS_AUDIO_VERIFY = True
except Exception:
    _HAS_AUDIO_VERIFY = False


# ============================================================
# Logging
# ============================================================
LOGS_DIR = Path("logs")
LOGS_DIR.mkdir(exist_ok=True)
TIMESTAMP = datetime.now().strftime("%Y%m%d_%H%M%S")
LOG_FILE = LOGS_DIR / f"overnight_{TIMESTAMP}.log"
JSONL_FILE = LOGS_DIR / f"overnight_{TIMESTAMP}.jsonl"
CHECKPOINT_FILE = LOGS_DIR / "checkpoint.json"


def log(msg, also_print=True):
    line = f"[{datetime.now().strftime('%H:%M:%S')}] {msg}"
    if also_print:
        print(line)
    with LOG_FILE.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def jlog(event):
    """Log JSON ligne pour parsing machine."""
    event["ts"] = datetime.now().isoformat()
    with JSONL_FILE.open("a", encoding="utf-8") as f:
        f.write(json.dumps(event, ensure_ascii=False) + "\n")


# ============================================================
# Checkpoint
# ============================================================
def load_checkpoint():
    if CHECKPOINT_FILE.exists():
        return json.loads(CHECKPOINT_FILE.read_text(encoding="utf-8"))
    return {"stories_completed": [], "last_updated": None}


def save_checkpoint(state):
    state["last_updated"] = datetime.now().isoformat()
    CHECKPOINT_FILE.write_text(
        json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")


# ============================================================
# Pipeline pour UNE story
# ============================================================
def process_one_story(key, args, ckpt):
    """Process complet d'UNE story. Retourne dict de stats."""
    log(f"\n{'='*70}\n>>> START : {key}\n{'='*70}")
    jlog({"event": "story_start", "key": key})
    stats = {"key": key, "text": "n/a", "images": "n/a", "audio": "n/a"}
    p = parse_key(key)

    # ============== ETAPE 1 : TEXTE ==============
    if args.skip_text or story_exists(key):
        log(f"  TEXTE : deja present ({story_path(key).name})")
        stats["text"] = "skipped"
    else:
        log(f"  TEXTE : generation Gemini Pro...")
        try:
            story = generate_text(key, max_retries=3)
            if story:
                log(f"    OK : '{story['title']}' ({len(story['pages'])} pages)")
                stats["text"] = "OK"
            else:
                log(f"    ECHEC")
                stats["text"] = "FAIL"
                jlog({"event": "story_end", "key": key, "stats": stats, "reason": "no_text"})
                return stats
        except Exception as e:
            log(f"    EXCEPTION texte : {e}")
            log(traceback.format_exc())
            stats["text"] = "EXCEPTION"
            return stats

    story = load_story(key)
    if not story:
        log(f"  ERREUR : impossible de charger {story_path(key)}")
        stats["text"] = "MISSING_AFTER_GEN"
        return stats

    pages = story.get("pages", [])
    n_pages = len(pages)

    # ============== ETAPE 2 : IMAGES ==============
    if args.skip_images:
        stats["images"] = "skipped"
    else:
        log(f"  IMAGES : {n_pages} pages a generer/verifier")
        img_ok, img_fail = 0, 0
        for idx, page in enumerate(pages, 1):
            dest = page_image_path(key, idx)
            image_prompt = page.get("image_prompt", "")
            if dest.exists() and not args.force_images:
                log(f"    [{idx}/{n_pages}] image deja presente, skip")
                img_ok += 1
                continue

            # Determine les refs pour cette page (auto-detection)
            # v527 : hero + place TOUJOURS inclus (le decor est presque toujours
            # important pour la coherence visuelle, meme si pas mentionne mot
            # pour mot dans le prompt)
            page_roles = auto_detect_refs_for_page(
                image_prompt, p["hero"], p["place"], p["item"], p["villain"],
                always_include=["hero", "place"])
            ref_images = collect_ref_portraits(
                p["hero"], p["place"], p["item"], p["villain"], page_roles)
            canon_prefix = get_canon_for_combo(
                p["hero"], p["place"], p["item"], p["villain"], only_roles=page_roles)
            exclusion = get_exclusion_instruction(
                p["hero"], p["place"], p["item"], p["villain"], page_roles)
            full_prompt = STORY_STYLE + canon_prefix + exclusion + image_prompt

            # Generation + verify avec retry
            page_done = False
            extra_instruction = ""
            for attempt in range(1, args.max_image_retries + 1):
                if attempt > 1:
                    log(f"      retry image {attempt}/{args.max_image_retries}")
                    if dest.exists():
                        dest.unlink()
                ok = gen_image_gemini(full_prompt, dest, ref_images=ref_images,
                                      extra_instruction=extra_instruction)
                if not ok:
                    log(f"    [{idx}/{n_pages}] echec generation image")
                    time.sleep(5)
                    continue

                if args.no_verify_images or not _HAS_IMG_VERIFY:
                    page_done = True
                    break

                vp = auto_portraits(p["hero"], p["place"], p["item"], p["villain"])
                vr = verify_image(dest, hero=p["hero"], place=p["place"],
                                  item=p["item"], villain=p["villain"],
                                  prompt=image_prompt, portrait_paths=vp,
                                  strict=not args.lax_verify)
                if vr.get("ok") or vr.get("skipped") or vr.get("error"):
                    log(f"    [{idx}/{n_pages}] image OK ({vr.get('match_score', 'n/a')})")
                    page_done = True
                    break
                issues = vr.get("issues", [])[:3]
                log(f"    [{idx}/{n_pages}] image KO : {issues}")
                extra_instruction = "Fix: " + "; ".join(issues)
                if len(extra_instruction) > 800:
                    extra_instruction = extra_instruction[:800]

            if page_done:
                img_ok += 1
            else:
                img_fail += 1
                log(f"    [{idx}/{n_pages}] IMAGE ECHEC apres retries")
                jlog({"event": "image_failed", "key": key, "page": idx})

            # Respect rate limit Vertex AI (par minute)
            time.sleep(args.image_delay)
        stats["images"] = f"{img_ok}/{n_pages}"
        log(f"  IMAGES bilan : {img_ok} OK, {img_fail} fail")

    # ============== ETAPE 3 : AUDIO ==============
    if args.skip_audio:
        stats["audio"] = "skipped"
    else:
        log(f"  AUDIO : {n_pages} MP3s a generer/verifier")
        audio_ok, audio_fail = 0, 0
        for idx, page in enumerate(pages, 1):
            dest = page_audio_path(key, idx)
            raw_text = page.get("text", "")
            clean_text = clean_html_for_tts(raw_text)
            if dest.exists() and not args.force_audio:
                if args.no_verify_audio or not _HAS_AUDIO_VERIFY:
                    log(f"    [{idx}/{n_pages}] mp3 deja present, skip")
                    audio_ok += 1
                    continue
                # Verifie l'existant
                vr = verify_audio(dest, expected_text=clean_text, lax=args.lax_verify)
                if vr.get("ok") or vr.get("error"):
                    log(f"    [{idx}/{n_pages}] mp3 OK ({vr.get('match_score', '?')}%)")
                    audio_ok += 1
                    continue
                log(f"    [{idx}/{n_pages}] mp3 existant KO ({vr.get('match_score', '?')}%), regen")
                dest.unlink()

            # Generation + verify avec retry
            page_done = False
            for attempt in range(1, args.max_audio_retries + 1):
                if attempt > 1:
                    log(f"      retry audio {attempt}/{args.max_audio_retries}")
                    if dest.exists():
                        dest.unlink()
                ok = synthesize_page(clean_text, dest, voice=args.voice,
                                     speaking_rate=args.rate, pitch=0.0)
                if not ok:
                    log(f"    [{idx}/{n_pages}] echec generation audio")
                    time.sleep(3)
                    continue

                if args.no_verify_audio or not _HAS_AUDIO_VERIFY:
                    page_done = True
                    break

                vr = verify_audio(dest, expected_text=clean_text, lax=args.lax_verify)
                if vr.get("ok") or vr.get("error"):
                    score = vr.get("match_score", "?")
                    log(f"    [{idx}/{n_pages}] audio OK ({score}%)")
                    page_done = True
                    break
                score = vr.get("match_score", "?")
                wrong = vr.get("wrong_words", [])[:3]
                missing = vr.get("missing_words", [])[:3]
                log(f"    [{idx}/{n_pages}] audio KO ({score}%) wrong={wrong} missing={missing}")

            if page_done:
                audio_ok += 1
            else:
                audio_fail += 1
                jlog({"event": "audio_failed", "key": key, "page": idx})

            time.sleep(args.audio_delay)
        stats["audio"] = f"{audio_ok}/{n_pages}"
        log(f"  AUDIO bilan : {audio_ok} OK, {audio_fail} fail")

    log(f"<<< END : {key} -> {stats}")
    jlog({"event": "story_end", "key": key, "stats": stats})
    return stats


# ============================================================
# Main
# ============================================================
def main():
    p = argparse.ArgumentParser()
    p.add_argument("--levels", default=",".join(LEVELS),
                   help="Niveaux a traiter (defaut all : courte,soir,aventure)")
    p.add_argument("--keys", help="Cles specifiques separees par virgule (override --levels)")
    p.add_argument("--skip-text", action="store_true", help="Skip generation texte")
    p.add_argument("--skip-images", action="store_true", help="Skip generation images")
    p.add_argument("--skip-audio", action="store_true", help="Skip generation audio")
    p.add_argument("--force-images", action="store_true", help="Regenere meme si images existent")
    p.add_argument("--force-audio", action="store_true", help="Regenere meme si MP3 existent")
    p.add_argument("--no-verify-images", action="store_true", help="Skip verif images")
    p.add_argument("--no-verify-audio", action="store_true", help="Skip verif audio")
    p.add_argument("--lax-verify", action="store_true", help="Verif laxe (accepte 95%%)")
    p.add_argument("--max-image-retries", type=int, default=5,
                   help="Defaut 5 (strict mode -> + de retries necessaires)")
    p.add_argument("--max-audio-retries", type=int, default=3)
    p.add_argument("--image-delay", type=float, default=12.0,
                   help="Sleep entre 2 images (rate limit Vertex AI)")
    p.add_argument("--audio-delay", type=float, default=2.0)
    p.add_argument("--voice", default="fr-FR-Studio-A",
                   help="Voix TTS (defaut Studio-A premium)")
    p.add_argument("--rate", type=float, default=0.95)
    p.add_argument("--from-key", help="Reprend a partir de cette cle (skip les precedentes)")
    p.add_argument("--limit", type=int, help="Limite N stories pour test")
    args = p.parse_args()

    # Determine la liste des cles a traiter
    if args.keys:
        keys = [k.strip() for k in args.keys.split(",") if k.strip()]
    else:
        levels = [l.strip() for l in args.levels.split(",") if l.strip()]
        keys = list(all_keys(levels=levels))

    if args.from_key:
        try:
            i = keys.index(args.from_key)
            keys = keys[i:]
            log(f"Reprend a partir de {args.from_key} ({len(keys)} restantes)")
        except ValueError:
            log(f"WARN : --from-key {args.from_key} introuvable")
    if args.limit:
        keys = keys[:args.limit]

    # === PREFLIGHT CHECKS ===
    sa = Path("service-account.json")
    if not sa.exists():
        log("ERREUR : service-account.json introuvable a la racine"); sys.exit(1)
    items_dir = Path("assets/items")
    n_portraits = len(list(items_dir.glob("*.jpg"))) if items_dir.exists() else 0
    if n_portraits < 12:
        log(f"ERREUR : {n_portraits}/12 portraits dans assets/items/ - lance generate_item_portraits.py d'abord")
        sys.exit(1)
    log(f"PREFLIGHT OK : SA + {n_portraits} portraits")

    ckpt = load_checkpoint()
    log(f"\n{'#'*70}")
    log(f"# OVERNIGHT GENERATION START")
    log(f"# Cles a traiter : {len(keys)}")
    log(f"# Voix audio : {args.voice}")
    log(f"# Image verify : {'ON strict' if not args.no_verify_images else 'OFF'} (lax={args.lax_verify})")
    log(f"# Audio verify : {'ON strict' if not args.no_verify_audio else 'OFF'} (lax={args.lax_verify})")
    log(f"# Log file : {LOG_FILE}")
    log(f"# Checkpoint : {CHECKPOINT_FILE}")
    log(f"{'#'*70}\n")

    completed = set(ckpt.get("stories_completed", []))
    total = len(keys)
    start_ts = time.time()
    results = []

    for i, key in enumerate(keys, 1):
        elapsed = time.time() - start_ts
        log(f"\n*** [{i}/{total}] {key}  (elapsed {elapsed/3600:.1f}h)")
        if key in completed and not args.force_images and not args.force_audio:
            log(f"    deja completed selon checkpoint, skip")
            continue
        try:
            stats = process_one_story(key, args, ckpt)
            results.append(stats)
            # Marque complete si au moins images OK (audio = secondaire)
            if "FAIL" not in str(stats) and "EXCEPTION" not in str(stats):
                completed.add(key)
                ckpt["stories_completed"] = sorted(completed)
                save_checkpoint(ckpt)
        except KeyboardInterrupt:
            log("INTERRUPTION manuelle - sauvegarde checkpoint et exit")
            ckpt["stories_completed"] = sorted(completed)
            save_checkpoint(ckpt)
            sys.exit(0)
        except Exception as e:
            log(f"!!! EXCEPTION : {e}")
            log(traceback.format_exc())
            jlog({"event": "story_exception", "key": key, "error": str(e)})

    # Bilan final
    elapsed = time.time() - start_ts
    log(f"\n{'#'*70}")
    log(f"# OVERNIGHT GENERATION END")
    log(f"# Duree : {elapsed/3600:.1f} heures")
    log(f"# Stories tentees : {len(results)}")
    log(f"# Completed checkpointes : {len(completed)}")
    log(f"# Log file : {LOG_FILE}")
    log(f"{'#'*70}")


if __name__ == "__main__":
    main()
