# -*- coding: utf-8 -*-
"""Audit rapide : position des 5 noeuds map sur 5 profils.
Pour chaque, on capture la map + on note la position absolue des noeuds.
"""
from pathlib import Path
import json
from playwright.sync_api import sync_playwright

URL = "https://aurelienperrier34-cyber.github.io/LeonIA/?premium=1"
OUT = Path("audit_map")

PROFILES = [
    {"name": "pc-1440",   "engine": "chromium", "ctx": {"viewport": {"width": 1440, "height": 900}}},
    {"name": "pc-1280",   "engine": "chromium", "ctx": {"viewport": {"width": 1280, "height": 720}}},
    {"name": "pixel",     "engine": "chromium", "device": "Pixel 5 landscape"},
    {"name": "iphone",    "engine": "webkit",   "device": "iPhone 13 landscape"},
    {"name": "ipad",      "engine": "webkit",   "device": "iPad (gen 7) landscape"},
]

JS = r"""
async () => {
  await new Promise(r => setTimeout(r, 1000));
  if (typeof selectChar === 'function') selectChar('fille');
  await new Promise(r => setTimeout(r, 600));
  goToScreen('map');
  await new Promise(r => setTimeout(r, 2500));
  const nodes = [];
  for (let i = 1; i <= 5; i++) {
    const n = document.getElementById('map-node-' + i);
    if (!n) { nodes.push({i, missing:true}); continue; }
    const r = n.getBoundingClientRect();
    nodes.push({
      i,
      x_pct: (r.left / window.innerWidth * 100).toFixed(1),
      y_pct: (r.top / window.innerHeight * 100).toFixed(1),
      out_of_view: r.right > window.innerWidth + 5 || r.left < -5 || r.bottom > window.innerHeight + 5 || r.top < -5,
    });
  }
  return { vw: window.innerWidth, vh: window.innerHeight, ratio: (window.innerWidth/window.innerHeight).toFixed(3), nodes };
}
"""

def main():
    OUT.mkdir(exist_ok=True)
    report = {}
    with sync_playwright() as p:
        for prof in PROFILES:
            engine = getattr(p, prof["engine"])
            browser = engine.launch()
            ctx_args = p.devices[prof["device"]] if "device" in prof else prof["ctx"]
            ctx = browser.new_context(**ctx_args)
            page = ctx.new_page()
            try:
                page.goto(URL, wait_until="load", timeout=30000)
                data = page.evaluate(JS)
                page.screenshot(path=str(OUT / (prof["name"] + ".png")))
                report[prof["name"]] = data
                print(f"=== {prof['name']} (vw={data['vw']} vh={data['vh']} ratio={data['ratio']}) ===")
                for n in data["nodes"]:
                    flag = " OUT_OF_VIEW" if n.get("out_of_view") else ""
                    print(f"  chap{n['i']}: ({n.get('x_pct')}%, {n.get('y_pct')}%){flag}")
            finally:
                ctx.close(); browser.close()
    (OUT / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nScreenshots + report dans {OUT}/")

if __name__ == "__main__":
    main()
