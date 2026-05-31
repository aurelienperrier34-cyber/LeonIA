# -*- coding: utf-8 -*-
"""
audit_responsive_lite.py
Audit responsive RAPIDE (sans generation d histoire) sur la v638 locale.
Couvre iPhone/iPad/Pixel/PC sur les ecrans cles, detecte les debordements
horizontaux et capture des screenshots.

Pre-requis :
  python -m http.server 8765   (depuis le dossier racine, deja lance)
  pip install playwright
  python -m playwright install webkit chromium
"""
import json
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

URL = "https://aurelienperrier34-cyber.github.io/LeonIA/?premium=1"
OUT = Path("audit_out")

PROFILES = [
    {"name": "pc-1440",       "engine": "chromium", "ctx": {"viewport": {"width": 1440, "height": 900}}},
    {"name": "pc-1280",       "engine": "chromium", "ctx": {"viewport": {"width": 1280, "height": 720}}},
    {"name": "pixel-land",    "engine": "chromium", "device": "Pixel 5 landscape"},
    {"name": "iphone-land",   "engine": "webkit",   "device": "iPhone 13 landscape"},
    {"name": "ipad-land",     "engine": "webkit",   "device": "iPad (gen 7) landscape"},
]

OVERFLOW_JS = r"""
() => {
  const vw = window.innerWidth, vh = window.innerHeight;
  const docW = document.documentElement.scrollWidth;
  const issues = [];
  if (docW > vw + 2) issues.push('PAGE deborde en largeur: ' + docW + ' > ' + vw);
  const seen = new Set();
  document.querySelectorAll('body *').forEach(el => {
    if (el.offsetParent === null) return;
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return;
    if (s.position === 'fixed') return;
    const r = el.getBoundingClientRect();
    if (r.width <= 2 || r.height <= 2) return;
    if (r.right > vw + 3 || r.left < -3) {
      const id = (el.id ? ('#' + el.id) : '') +
        (el.className && typeof el.className === 'string'
          ? ('.' + el.className.trim().split(/\s+/)[0]) : '');
      const key = el.tagName + id;
      if (seen.has(key)) return; seen.add(key);
      issues.push(el.tagName.toLowerCase() + (id || '') +
        ' [g=' + Math.round(r.left) + ' d=' + Math.round(r.right) + '/' + vw + ']');
    }
  });
  return { vw, vh, docW, issues: issues.slice(0, 12) };
}
"""

# Steps : id court + JS a evaluer. On evite les generations couteuses, on
# navigue juste sur les ecrans-cles et les modales.
STEPS = [
    ("00-intro",            "goToScreen(0)"),
    ("01-perso-pick",       "goToScreen(1)"),
    ("02-perso-fille",      "selectChar('fille'); state.characterName='Test'; saveState()"),
    ("03-map",              "goToScreen('map')"),
    ("04-c1-rue",           "goToScreen(2)"),
    ("05-c1-leon",          "goToScreen(3)"),
    ("06-c1-tap",           "goToScreen(5)"),
    ("07-c1-quiz",          "goToScreen(6)"),
    ("08-c1-victoire",      "goToScreen(7)"),
    ("09-c2-intro",         "goToScreen('c2s1')"),
    ("10-c2-magnifier",     "goToScreen('c2s2')"),
    ("11-c2-detecteur",     "goToScreen('c2s5')"),
    ("12-c2-quiz",          "goToScreen('c2s8')"),
    ("13-c3-machine",       "goToScreen('c3s2')"),
    ("14-c3-sons",          "goToScreen('c3s7')"),
    ("15-c4-bot",           "goToScreen('c4s2')"),
    ("16-c4s4-tromper",     "goToScreen('c4s4')"),
    ("17-c4-memory",        "goToScreen('c4s5')"),
    ("18-c5-toit",          "goToScreen('c5s1')"),
    ("19-c5-build",         "goToScreen('c5s5')"),
    ("20-livre-pick",       "openCreatorMode()"),
    ("21-builder-start",    "openHeroBuilder(); hbState.step=0; hbRender()"),
    ("22-builder-cheveux",  "hbState.step=1; hbRender()"),
    ("23-builder-tenue",    "hbState.step=3; hbRender()"),
    ("24-builder-accessoire","hbState.step=5; hbRender()"),
    ("25-atelier-boutique", "openAtelier(); switchAtelierTab('shop')"),
    ("26-atelier-cartes",   "switchAtelierTab('cards')"),
    ("27-atelier-vestiaire","state.totalStars=999; state.purchases=['cap-leon','glasses-ai','cape-hero']; switchAtelierTab('vest'); refreshAtelierUI()"),
]


def run_profile(p, prof):
    engine = getattr(p, prof["engine"])
    browser = engine.launch()
    if "device" in prof:
        ctx = browser.new_context(**p.devices[prof["device"]])
    else:
        ctx = browser.new_context(**prof["ctx"])
    page = ctx.new_page()
    outdir = OUT / prof["name"]
    outdir.mkdir(parents=True, exist_ok=True)
    res = []
    try:
        page.goto(URL, wait_until="load", timeout=20000)
        page.wait_for_timeout(2000)
        for label, js in STEPS:
            try:
                page.evaluate("() => { %s; }" % js)
            except Exception as e:
                res.append({"ecran": label, "erreur_nav": str(e)[:120]})
                continue
            page.wait_for_timeout(900)
            try:
                check = page.evaluate(OVERFLOW_JS)
            except Exception as e:
                check = {"issues": ["check err: " + str(e)[:80]]}
            page.screenshot(path=str(outdir / (label + ".png")))
            res.append({"ecran": label, "vw": check.get("vw"), "vh": check.get("vh"),
                        "issues": check.get("issues", [])})
            print("  [%s] %s : %d souci(s)" % (prof["name"], label, len(check.get("issues", []))), flush=True)
    finally:
        ctx.close()
        browser.close()
    return res


def main():
    OUT.mkdir(exist_ok=True)
    report = {}
    t0 = time.time()
    with sync_playwright() as p:
        for prof in PROFILES:
            print("=== profil %s (%s) ===" % (prof["name"], prof["engine"]), flush=True)
            try:
                report[prof["name"]] = run_profile(p, prof)
            except Exception as e:
                report[prof["name"]] = [{"erreur_profil": str(e)[:200]}]
                print("  ERREUR profil:", str(e)[:200], flush=True)
    (OUT / "rapport.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    lines = []
    for prof, screens in report.items():
        bad = [s for s in screens if s.get("issues") or s.get("erreur_nav") or s.get("erreur_profil")]
        lines.append("\n### %s : %d/%d ecrans avec souci" % (prof, len(bad), len(screens)))
        for s in bad:
            tag = s.get("ecran", "?")
            if s.get("erreur_profil"):
                lines.append("  [PROFIL KO] " + s["erreur_profil"])
            elif s.get("erreur_nav"):
                lines.append("  %s : nav KO (%s)" % (tag, s["erreur_nav"]))
            else:
                for iss in s["issues"]:
                    lines.append("  %s : %s" % (tag, iss))
    (OUT / "rapport.txt").write_text("\n".join(lines), encoding="utf-8")
    dt = int(time.time() - t0)
    print("\n=== RESUME (%ds) ===\n" % dt + "\n".join(lines), flush=True)
    print("\nScreenshots dans audit_out/<profil>/ + rapport.txt + rapport.json", flush=True)


if __name__ == "__main__":
    main()
