# -*- coding: utf-8 -*-
"""
verify_all_assets.py
====================
Audit qualite POST-OVERNIGHT : passe Gemini Vision (strict mode) sur
TOUTES les images deja generees + Gemini Audio sur TOUS les MP3, et
produit un rapport JSON + texte des images/MP3 a regenerer.

Output :
  - reports/audit_<timestamp>.json : detail complet
  - reports/audit_<timestamp>.txt   : resume humain
  - reports/regen_commands.txt     : commandes prepretes pour regenerer
                                      les pages problematiques

Usage :
  python verify_all_assets.py                     # audit tout
  python verify_all_assets.py --lax               # accepte 95%+ au lieu de strict
  python verify_all_assets.py --only courte       # juste 1 niveau
  python verify_all_assets.py --images-only       # skip audio
  python verify_all_assets.py --audio-only        # skip images
  python verify_all_assets.py --story courte_dragon_chateau_baguette_monstre
"""

import argparse
import json
import sys
import time
from datetime import datetime
from pathlib import Path

from stories_db import (parse_key, load_story, story_path,
                        page_image_path, page_audio_path,
                        all_existing_keys)
from generate_story_audio import clean_html_for_tts
try:
    from verify_story_image import verify_image, auto_portraits
    _HAS_IMG = True
except Exception as e:
    print(f"[audit] verify_story_image indispo : {e}")
    _HAS_IMG = False
try:
    from verify_story_audio import verify_audio
    _HAS_AUDIO = True
except Exception as e:
    print(f"[audit] verify_story_audio indispo : {e}")
    _HAS_AUDIO = False


REPORTS_DIR = Path("reports")
REPORTS_DIR.mkdir(exist_ok=True)
TIMESTAMP = datetime.now().strftime("%Y%m%d_%H%M%S")


def audit_image(key, page_idx, image_prompt, p, lax):
    path = page_image_path(key, page_idx)
    if not path.exists():
        return {"status": "MISSING", "issues": ["fichier absent"]}
    portraits = auto_portraits(p["hero"], p["place"], p["item"], p["villain"])
    vr = verify_image(path, hero=p["hero"], place=p["place"],
                      item=p["item"], villain=p["villain"],
                      prompt=image_prompt, portrait_paths=portraits,
                      strict=not lax)
    if vr.get("ok"):
        return {"status": "OK"}
    if vr.get("error"):
        return {"status": "ERROR", "issues": [vr["error"]]}
    return {
        "status": "PROBLEMATIC",
        "match_score": vr.get("match_score"),
        "kid_safe": vr.get("kid_safe"),
        "issues": vr.get("issues", []),
    }


def audit_audio(key, page_idx, expected_text, lax):
    path = page_audio_path(key, page_idx)
    if not path.exists():
        return {"status": "MISSING", "issues": ["fichier absent"]}
    clean = clean_html_for_tts(expected_text)
    vr = verify_audio(path, expected_text=clean, lax=lax)
    if vr.get("ok"):
        return {"status": "OK", "score": vr.get("match_score")}
    if vr.get("error"):
        return {"status": "ERROR", "issues": [vr["error"]]}
    return {
        "status": "PROBLEMATIC",
        "match_score": vr.get("match_score"),
        "issues": vr.get("issues", []),
        "missing_words": vr.get("missing_words", []),
        "wrong_words": vr.get("wrong_words", []),
    }


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--only", help="Filtre par niveau (courte, soir, aventure)")
    p.add_argument("--story", help="Audit une seule story (override --only)")
    p.add_argument("--lax", action="store_true",
                   help="Mode laxe (accepte 95%+ au lieu de match parfait)")
    p.add_argument("--images-only", action="store_true")
    p.add_argument("--audio-only", action="store_true")
    p.add_argument("--delay", type=float, default=2.0,
                   help="Delai entre 2 verifs (rate-limit Gemini)")
    args = p.parse_args()

    keys = all_existing_keys()
    if args.story:
        keys = [args.story] if args.story in keys else []
    elif args.only:
        keys = [k for k in keys if k.startswith(args.only + "_")]
    if not keys:
        sys.exit(f"Aucune story a auditer")

    print(f"\nAudit de {len(keys)} stories")
    print(f"Mode : {'LAX (95%+)' if args.lax else 'STRICT'}\n")

    report = {"timestamp": TIMESTAMP, "stories": {}}
    regen_cmds = []

    for i, key in enumerate(keys, 1):
        pk = parse_key(key)
        story = load_story(key)
        if not story:
            continue
        pages = story.get("pages", [])
        print(f"[{i}/{len(keys)}] {key} ({len(pages)} pages)")
        story_report = {"images": {}, "audio": {}}

        for idx, pg in enumerate(pages, 1):
            # Audit image
            if not args.audio_only and _HAS_IMG:
                ir = audit_image(key, idx, pg.get("image_prompt", ""), pk, args.lax)
                story_report["images"][f"page{idx}"] = ir
                if ir["status"] in ("PROBLEMATIC", "MISSING"):
                    print(f"  IMG page{idx} {ir['status']} : {ir.get('issues', [])[:2]}")
                time.sleep(args.delay)
            # Audit audio
            if not args.images_only and _HAS_AUDIO:
                ar = audit_audio(key, idx, pg.get("text", ""), args.lax)
                story_report["audio"][f"page{idx}"] = ar
                if ar["status"] in ("PROBLEMATIC", "MISSING"):
                    print(f"  MP3 page{idx} {ar['status']} ({ar.get('match_score', '?')}%) : {ar.get('issues', [])[:2]}")
                time.sleep(args.delay)

        report["stories"][key] = story_report

        # Construit les commandes de regen pour les pages problematiques
        bad_image_pages = [int(k.replace('page', '')) for k, v in story_report["images"].items()
                            if v["status"] in ("PROBLEMATIC", "MISSING")]
        bad_audio_pages = [int(k.replace('page', '')) for k, v in story_report["audio"].items()
                            if v["status"] in ("PROBLEMATIC", "MISSING")]
        if bad_image_pages or bad_audio_pages:
            # 1 cmd pour les images
            if bad_image_pages:
                # On utilise generate_story_gemini directement pour les images
                regen_cmds.append(
                    f"# {key} - regenerer images pages {bad_image_pages}\n"
                    f"python generate_story_gemini.py --story {pk['hero']}_{pk['place']}_{pk['item']}_{pk['villain']} "
                    f"--only {','.join(map(str, bad_image_pages))} --force\n"
                )
            if bad_audio_pages:
                regen_cmds.append(
                    f"# {key} - regenerer audio pages {bad_audio_pages}\n"
                    f"python generate_story_audio.py --story {key} "
                    f"--only {','.join(map(str, bad_audio_pages))} --force --verify\n"
                )

    # Save JSON report
    json_path = REPORTS_DIR / f"audit_{TIMESTAMP}.json"
    json_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nRapport JSON : {json_path}")

    # Save TXT summary
    txt_path = REPORTS_DIR / f"audit_{TIMESTAMP}.txt"
    lines = [f"# AUDIT {TIMESTAMP}  ({len(keys)} stories, mode={'lax' if args.lax else 'strict'})\n"]
    total_img_ok = total_img_pb = total_img_missing = 0
    total_aud_ok = total_aud_pb = total_aud_missing = 0
    for key, sr in report["stories"].items():
        bad_imgs = [k for k, v in sr["images"].items() if v["status"] != "OK"]
        bad_auds = [k for k, v in sr["audio"].items() if v["status"] != "OK"]
        for v in sr["images"].values():
            if v["status"] == "OK": total_img_ok += 1
            elif v["status"] == "MISSING": total_img_missing += 1
            else: total_img_pb += 1
        for v in sr["audio"].values():
            if v["status"] == "OK": total_aud_ok += 1
            elif v["status"] == "MISSING": total_aud_missing += 1
            else: total_aud_pb += 1
        if bad_imgs or bad_auds:
            lines.append(f"\n## {key}")
            if bad_imgs:
                lines.append(f"  IMAGES KO ({len(bad_imgs)}): {', '.join(bad_imgs)}")
                for k in bad_imgs:
                    v = sr["images"][k]
                    if v.get("issues"):
                        lines.append(f"    {k}: {v['issues'][:3]}")
            if bad_auds:
                lines.append(f"  AUDIO KO ({len(bad_auds)}): {', '.join(bad_auds)}")
                for k in bad_auds:
                    v = sr["audio"][k]
                    if v.get("issues"):
                        lines.append(f"    {k} ({v.get('match_score','?')}%): {v['issues'][:3]}")

    lines.append(f"\n## TOTAUX")
    lines.append(f"  Images : {total_img_ok} OK / {total_img_pb} pb / {total_img_missing} missing")
    lines.append(f"  Audio  : {total_aud_ok} OK / {total_aud_pb} pb / {total_aud_missing} missing")
    txt_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"Rapport texte : {txt_path}")

    # Save regen commands
    if regen_cmds:
        regen_path = REPORTS_DIR / f"regen_commands_{TIMESTAMP}.txt"
        regen_path.write_text("".join(regen_cmds), encoding="utf-8")
        print(f"Commandes regen : {regen_path}")
        print(f"\n{len(regen_cmds)} commandes a executer pour reparer les KO.")


if __name__ == "__main__":
    main()
