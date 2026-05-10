// Tests d'émulation mobile pour Leon IA.
// Vérifie : navigation entre écrans, positions des bulles, boutons cliquables,
// déclenchement audio, screenshots à chaque étape pour review visuel.
//
// Lancé contre un serveur statique local (cf. playwright.config.js).
// N'écrit JAMAIS dans les fichiers du jeu — uniquement screenshots dans
// tests/screenshots/<projet>/<screen>.png.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// Liste des écrans à inspecter via les raccourcis dev (Alt+touche, cf. game.js
// ligne 495+). On ouvre chaque écran via state.currentScreen (plus fiable que
// les raccourcis clavier en émulation) puis on vérifie les invariants visuels.
const SCREENS = [
  { id: 0,        label: 'intro',         interactive: true  },
  { id: 1,        label: 'char-select',   interactive: true  },
  { id: 'map',    label: 'map',           interactive: true  },
  { id: 2,        label: 'c1s2-rue',      interactive: true  },
  { id: 3,        label: 'c1s3-leon',     interactive: true  },
  { id: 4,        label: 'c1s4-machine',  interactive: true  },
  { id: 5,        label: 'c1s5-app',      interactive: true  },
  { id: 'c2s1',   label: 'c2s1',          interactive: true  },
  { id: 'c2s5',   label: 'c2s5-defauts',  interactive: true  },
  { id: 'c3s1',   label: 'c3s1',          interactive: true  },
  { id: 'c3s7',   label: 'c3s7-mics',     interactive: true  },
  { id: 'c4s1',   label: 'c4s1',          interactive: true  },
  { id: 'c5s1',   label: 'c5s1',          interactive: true  },
];

// Helper : navigue vers un écran via la fonction goToScreen exposée globalement.
async function gotoScreen(page, id) {
  await page.evaluate((screenId) => {
    if (typeof window.goToScreen === 'function') {
      window.goToScreen(screenId, true);
    }
  }, id);
  await page.waitForTimeout(400); // laisse le DOM transitionner
}

// Helper : vérifie qu'un élément est visible ET dans les bornes du viewport.
async function expectInViewport(page, selector, label) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) {
    return { ok: false, reason: `${label} : élément introuvable (${selector})` };
  }
  const vp = page.viewportSize();
  const fullyInside =
    box.x >= 0 && box.y >= 0 &&
    box.x + box.width <= vp.width &&
    box.y + box.height <= vp.height;
  return {
    ok: fullyInside,
    reason: fullyInside ? null
      : `${label} : sort du viewport (${vp.width}x${vp.height}). box=${JSON.stringify(box)}`,
    box,
  };
}

// Setup : choisit un personnage par défaut (sinon le screen 1 bloque l'avancée)
async function selectCharacterIfNeeded(page) {
  await page.evaluate(() => {
    if (typeof window.selectChar === 'function') {
      window.selectChar('renard');
      window.state && (window.state.characterName = 'Rémi');
      if (typeof window.saveState === 'function') window.saveState();
    }
  });
}

// =====================================================================
// 1) Smoke test : chaque écran charge sans erreur JS, screenshot capturé
// =====================================================================
test.describe('Smoke test mobile', () => {
  test.beforeEach(async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push('[console] ' + msg.text());
    });
    page._jsErrors = errors;

    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.goToScreen === 'function', { timeout: 10000 });
    await selectCharacterIfNeeded(page);
  });

  for (const screen of SCREENS) {
    test(`écran ${screen.label} : se charge proprement`, async ({ page }, testInfo) => {
      await gotoScreen(page, screen.id);

      const screenshotDir = path.join('tests/screenshots', testInfo.project.name);
      fs.mkdirSync(screenshotDir, { recursive: true });
      await page.screenshot({
        path: path.join(screenshotDir, `${screen.label}.png`),
        fullPage: false,
      });

      // Échoue si une erreur JS a été loggée
      expect(page._jsErrors, `Erreurs JS sur ${screen.label}`).toEqual([]);
    });
  }
});

// =====================================================================
// 2) Bulles dans le viewport : pas d'élément qui dépasse en bas/droite
// =====================================================================
test.describe('Bulles & dialogues', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.goToScreen === 'function', { timeout: 10000 });
    await selectCharacterIfNeeded(page);
  });

  test('atelier (screen 3) : bulle Léon visible et dans le viewport', async ({ page }) => {
    await gotoScreen(page, 3);
    // La bulle de Léon est masquée (display:none) tant que la voix narrateur
    // n'a pas fini. On attend qu'elle redevienne visible (typewriter en cours).
    await page.waitForFunction(() => {
      const bubble = document.querySelector('#screen-3 .dialogue-bubble');
      return bubble && bubble.offsetParent !== null && bubble.textContent.length > 0;
    }, { timeout: 20000 });

    const r = await expectInViewport(page, '#screen-3 .dialogue-bubble', 'bulle Léon');
    expect(r.ok, r.reason).toBe(true);
  });

  test('narration (screen 3) : panneau scene-text visible', async ({ page }) => {
    await gotoScreen(page, 3);
    const r = await expectInViewport(page, '#screen-3 .scene-text', 'scene-text');
    expect(r.ok, r.reason).toBe(true);
  });
});

// =====================================================================
// 3) Boutons cliquables : navigation principale fonctionne
// =====================================================================
test.describe('Boutons & navigation', () => {
  test('intro → char-select via "Démarrer l\'Aventure"', async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.goToScreen === 'function');
    // En mobile landscape le bouton peut etre hors viewport (page intro plus
    // longue que l'ecran), on scroll explicitement avant de cliquer.
    const btn = page.locator('text=Démarrer l\'Aventure').first();
    await btn.scrollIntoViewIfNeeded();
    await btn.click({ force: true }); // force : evite blocage si overlay ou animation
    await page.waitForFunction(() => window.state && window.state.currentScreen === 1, { timeout: 5000 });
    expect(await page.evaluate(() => window.state.currentScreen)).toBe(1);
  });

  test('atelier (screen 3) : bouton "Oui, s\'il te plaît !" navigue vers screen 4', async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.goToScreen === 'function');
    await selectCharacterIfNeeded(page);
    await gotoScreen(page, 3);
    // Les reponses #s3-answers n'apparaissent qu'apres la fin du typewriter
    // de la bulle Leon (donc apres voix narrateur + voix Leon, ~10-15s).
    await page.waitForSelector('#s3-answers.show', { timeout: 25000 });
    await page.locator('#s3-answers .btn-choice').first().click();
    await page.waitForFunction(() => window.state.currentScreen === 4, { timeout: 5000 });
    expect(await page.evaluate(() => window.state.currentScreen)).toBe(4);
  });
});

// =====================================================================
// 4) Audio : vérifie que le narrateur s3 est bien déclenché
// =====================================================================
test.describe('Audio', () => {
  test('atelier (screen 3) : voix narrateur déclenchée', async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.goToScreen === 'function');
    await selectCharacterIfNeeded(page);

    // Hook : intercepte les Audio.play() et compte les déclenchements
    await page.addInitScript(() => {
      window.__audioPlays = [];
      const origPlay = HTMLAudioElement.prototype.play;
      HTMLAudioElement.prototype.play = function () {
        window.__audioPlays.push({ src: this.src, t: Date.now() });
        return origPlay.apply(this, arguments);
      };
    });
    await page.reload();
    await page.waitForFunction(() => typeof window.goToScreen === 'function');
    await selectCharacterIfNeeded(page);

    await gotoScreen(page, 3);
    await page.waitForTimeout(2000);

    const plays = await page.evaluate(() => window.__audioPlays || []);
    const narrPlayed = plays.some((p) => /voix_narrateur_3/.test(p.src));
    expect(narrPlayed, `Aucun play() détecté sur voix_narrateur_3.mp3. Audios joués : ${JSON.stringify(plays.map(p => p.src))}`).toBe(true);
  });
});

// =====================================================================
// 5) Calibration device-aware : vérifie que les sauvegardes mobile
//    n'écrasent pas les clés desktop
// =====================================================================
test.describe('Calibrations mobile vs desktop', () => {
  test('saveStarCornerPosition sur mobile écrit dans starCornerPos.mobile', async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.saveStarCornerPosition === 'function', { timeout: 10000 });

    await page.evaluate(() => {
      // Force un état desktop connu d'abord
      localStorage.setItem('starCornerPos', JSON.stringify({ top: 10, left: 10 }));
      // Puis sauve via l'API : devrait aller dans .mobile sur mobile
      window.saveStarCornerPosition({ top: 99, left: 99 });
    });

    const desktop = await page.evaluate(() => JSON.parse(localStorage.getItem('starCornerPos')));
    const mobile = await page.evaluate(() => JSON.parse(localStorage.getItem('starCornerPos.mobile') || 'null'));

    // Sur mobile (émulé), la version desktop doit rester intacte (top:10) et
    // la version mobile doit recevoir les nouvelles valeurs (top:99).
    expect(desktop, 'starCornerPos desktop écrasé !').toEqual({ top: 10, left: 10 });
    expect(mobile, 'starCornerPos.mobile non créé').toEqual({ top: 99, left: 99 });
  });
});
