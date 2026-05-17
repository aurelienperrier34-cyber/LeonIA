# -*- coding: utf-8 -*-
"""
verify_story_audio.py
=====================
Verifie qu'un fichier MP3 narre correspond EXACTEMENT au texte attendu.
Utilise Gemini 2.5 Flash (vision + audio) pour transcrire le MP3 et
comparer avec le texte source.

Renvoie un JSON :
  {
    "ok": bool,
    "match_score": 0-100,
    "text_heard": "transcription de ce que Gemini a entendu",
    "issues": ["liste des differences detectees"],
    "missing_words": ["mots manquants dans l'audio"],
    "wrong_words": ["mots prononces differemment ou ajoutes"]
  }

Usage standalone :
  python verify_story_audio.py path.mp3 --text "Le texte attendu"

Usage module :
  from verify_story_audio import verify_audio
  r = verify_audio("page1.mp3", expected_text="...")
"""

import argparse
import base64
import json
import os
import sys
from pathlib import Path
from dotenv import load_dotenv
import requests

# Charge .env
for candidate in [
    Path(__file__).parent / ".env",
    Path(__file__).parent.parent.parent.parent / ".env",
    Path.cwd() / ".env",
]:
    if candidate.exists():
        load_dotenv(candidate)
        break

# Reutilise la meme auth que pour la verif image (service account preferred)
from verify_story_image import (
    _USE_SA, _SA_PROJECT, _auth_headers, _call,
    GEMINI_MODELS, GEMINI_MODEL, _build_url
)

# Inline pour eviter import circulaire avec generate_story_audio
import re as _re
def clean_html_for_tts(text):
    text = _re.sub(r"<br\s*/?>", "\n", text, flags=_re.IGNORECASE)
    text = _re.sub(r"<[^>]+>", "", text)
    text = text.replace("&nbsp;", " ").replace("&amp;", "&")
    text = text.replace("&lt;", "<").replace("&gt;", ">")
    text = _re.sub(r"[ \t]+", " ", text)
    text = _re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _b64(p):
    return base64.standard_b64encode(Path(p).read_bytes()).decode("utf-8")


def _mime_audio(p):
    ext = Path(p).suffix.lower().lstrip(".")
    return {"mp3": "audio/mpeg", "mpeg": "audio/mpeg",
            "wav": "audio/wav", "ogg": "audio/ogg",
            "opus": "audio/opus", "m4a": "audio/mp4"}.get(ext, "audio/mpeg")


def verify_audio(audio_path, expected_text, lax=False):
    """
    Verifie un MP3 contre un texte attendu.

    audio_path : Path | str
    expected_text : texte que le MP3 devrait dire (sans HTML)
    lax : si True, accepte les variantes mineures (~95% match suffit).
          Si False (default), strict : ok=true seulement si match parfait.
    """
    audio_path = Path(audio_path)
    if not audio_path.exists():
        return {"ok": False, "error": f"Audio introuvable : {audio_path}"}

    expected_clean = clean_html_for_tts(expected_text)

    instruction = f"""You are an audio quality controller for a children's audiobook.

I give you an MP3 narration and the EXPECTED text that should have been read.

Your job:
1. Transcribe EXACTLY what you hear in the MP3 (verbatim, including pauses).
2. Compare to the expected text.
3. Detect ANY differences: missing words, added words, mispronunciations,
   skipped sentences, or words read very differently from spelling.

This matters because:
- Apostrophes (e.g., "n'était") sometimes get mis-read as separated words
- Some TTS voices skip first words or punctuation
- Numbers/dates may be read in unexpected ways

EXPECTED TEXT:
\"\"\"
{expected_clean}
\"\"\"

Reply ONLY with a JSON object (no markdown, no commentary):
{{
  "text_heard": "<verbatim transcription of the audio>",
  "match_score": <integer 0-100, percentage of words correctly read>,
  "missing_words": ["<words in expected but missing from audio>"],
  "wrong_words": ["<words read differently or added>"],
  "issues": ["<short description of each major issue>"]
}}

Be PRECISE. If a single word is wrong (e.g., \"N était\" instead of \"Brio n'était\"),
list it explicitly in wrong_words.
"""

    parts = [
        {"text": instruction},
        {"inline_data": {"mime_type": _mime_audio(audio_path),
                          "data": _b64(audio_path)}},
    ]

    payload = {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {
            "temperature": 0.1,
            "response_mime_type": "application/json",
        },
    }

    models_to_try = [GEMINI_MODEL] + [m for m in GEMINI_MODELS if m != GEMINI_MODEL]
    last_err = None
    rj = None
    for mdl in models_to_try:
        try:
            r = _call(mdl, payload, timeout=90)
            if r.status_code == 404:
                last_err = f"404 {mdl}"
                continue
            if r.status_code >= 400:
                return {"ok": False,
                        "error": f"Gemini {mdl} HTTP {r.status_code}: {r.text[:300]}"}
            rj = r.json()
            break
        except Exception as e:
            last_err = str(e)
            continue
    if rj is None:
        return {"ok": False,
                "error": f"Aucun modele Gemini dispo (dernier: {last_err})"}

    try:
        text = rj["candidates"][0]["content"]["parts"][0]["text"]
        result = json.loads(text)
    except Exception as e:
        return {"ok": False, "error": f"Parsing Gemini: {e} -> {str(rj)[:400]}"}

    score = result.get("match_score", 0)
    # Decision OK/KO
    if lax:
        result["ok"] = score >= 95
    else:
        # Strict : pas d'issues majeures + score >= 98
        result["ok"] = (score >= 98 and
                       not result.get("missing_words") and
                       not result.get("wrong_words"))
    return result


def main():
    p = argparse.ArgumentParser()
    p.add_argument("audio", help="Chemin du MP3 a verifier")
    p.add_argument("--text", required=True,
                   help="Texte attendu (echappes HTML autorises)")
    p.add_argument("--lax", action="store_true",
                   help="Accepte 95%+ au lieu de match parfait")
    args = p.parse_args()

    result = verify_audio(args.audio, args.text, lax=args.lax)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    if not result.get("ok"):
        sys.exit(1)


if __name__ == "__main__":
    main()
