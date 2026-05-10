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

// Désactive les voix narrateur AVANT le chargement (en émulation l'audio ne
// joue pas vraiment, donc l'event 'ended' ne se firera jamais et bloque les
// flows comme le typewriter de la bulle Léon → reveal #s3-answers).
async function disableVoicesBeforeGoto(page) {
  await page.addInitScript(() => {
    try { localStorage.setItem('ia_voices_off', '1'); } catch (e) {}
  });
}

// Bypass _autoImportGameStateBackup() : si game_state_backup.json existe a
// la racine du projet (cas typique de developpement), l'app importe l'etat
// au demarrage et fait un location.reload() apres 500ms, ce qui detruit
// window.state pile au moment ou le test interagit. La fonction skipe
// l'import si localStorage contient deja une de ses cles sentinelles, donc
// on en plante une AVANT le chargement de la page.
async function disableBackupAutoImport(page) {
  await page.addInitScript(() => {
    try { localStorage.setItem('starCornerPos', JSON.stringify({ top: 16, left: 18 })); } catch (e) {}
  });
}

// Setup global appliqué a tous les tests (sauf overrides ponctuels) : evite
// le piege du backup auto-import qui reload la page mid-test.
test.beforeEach(async ({ page }) => {
  await disableBackupAutoImport(page);
});

// Patterns d'erreurs console a IGNORER (warnings reseau / asset, pas bugs app).
const IGNORED_CONSOLE_PATTERNS = [
  /Failed to load resource:\s*Timeout was reached/i,
  /Failed to load resource:\s*the server responded with a status of \d+/i,
  /net::ERR_/i,
];
function isAppError(msg) {
  return !IGNORED_CONSOLE_PATTERNS.some((rx) => rx.test(msg));
}

// =====================================================================
// 1) Smoke test : chaque écran charge sans erreur JS, screenshot capturé
// =====================================================================
test.describe('Smoke test mobile', () => {
  test.beforeEach(async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (isAppError(text)) errors.push('[console] ' + text);
      }
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
    await disableVoicesBeforeGoto(page);
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.goToScreen === 'function', { timeout: 10000 });
    await selectCharacterIfNeeded(page);
  });

  test('atelier (screen 3) : bulle Léon visible et dans le viewport', async ({ page }) => {
    await gotoScreen(page, 3);
    // Sans audio, le typewriter de Léon démarre après ~2.5s (timer fallback).
    // On attend que la bulle ait du contenu et soit visible.
    await page.waitForFunction(() => {
      const bubble = document.querySelector('#screen-3 .dialogue-bubble');
      return bubble && bubble.offsetParent !== null && bubble.textContent.length > 0;
    }, { timeout: 15000 });

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
    await disableVoicesBeforeGoto(page);
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.goToScreen === 'function');
    await page.waitForFunction(
      () => !document.body.classList.contains('needs-rotate'),
      { timeout: 5000 }
    ).catch(() => {});
    // Le bouton 'Demarrer l'Aventure' a la classe btn-bounce (animation CSS
    // continue) => scrollIntoViewIfNeeded boucle infiniment sur "not stable".
    // On contourne en appelant directement el.click() via evaluate (bypass
    // les checks actionability/stability de Playwright).
    await page.locator('text=Démarrer l\'Aventure').first().evaluate((el) => el.click());
    await page.waitForFunction(() => window.state && window.state.currentScreen === 1, { timeout: 5000 });
    expect(await page.evaluate(() => window.state && window.state.currentScreen)).toBe(1);
  });

  test('atelier (screen 3) : bouton "Oui, s\'il te plaît !" navigue vers screen 4', async ({ page }) => {
    // Capture console + erreurs JS pour diagnostiquer si goToScreen(4) plante
    const consoleMsgs = [];
    page.on('console', (msg) => consoleMsgs.push(`[${msg.type()}] ${msg.text()}`));
    page.on('pageerror', (e) => consoleMsgs.push('[pageerror] ' + e.message));

    await disableVoicesBeforeGoto(page);
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.goToScreen === 'function');
    await selectCharacterIfNeeded(page);
    await gotoScreen(page, 3);
    await page.waitForSelector('#s3-answers.show', { timeout: 15000 });
    // Click via evaluate (bypass actionability) pour eliminer le risque
    // d'overlay / element pas cliquable / animation.
    await page.locator('#s3-answers .btn-choice').first().evaluate((el) => el.click());
    await page.waitForFunction(
      () => window.state && window.state.currentScreen === 4,
      { timeout: 5000 }
    ).catch(() => {});
    const finalScreen = await page.evaluate(() => window.state && window.state.currentScreen);
    if (finalScreen !== 4) {
      // Logs detailles pour diagnostiquer
      console.log('Console messages :', consoleMsgs.join('\n'));
    }
    expect(finalScreen, `Etat final : ${finalScreen}. Console: ${consoleMsgs.slice(-10).join(' | ')}`).toBe(4);
  });
});

// =====================================================================
// 4) Audio : vérifie que le narrateur s3 est bien déclenché
// =====================================================================
test.describe('Audio', () => {
  test('atelier (screen 3) : voix narrateur déclenchée', async ({ page }) => {
    // Hook AVANT goto : intercepte les Audio.play() des le premier load,
    // pas besoin de reload (qui timeout sur l'event 'load' de la page).
    await page.addInitScript(() => {
      window.__audioPlays = [];
      const origPlay = HTMLAudioElement.prototype.play;
      HTMLAudioElement.prototype.play = function () {
        window.__audioPlays.push({ src: this.src, t: Date.now() });
        return origPlay.apply(this, arguments);
      };
    });
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.goToScreen === 'function');
    await selectCharacterIfNeeded(page);

    await gotoScreen(page, 3);
    await page.waitForTimeout(3000);

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
