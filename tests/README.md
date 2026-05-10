# Tests d'émulation mobile — Leon IA

Suite Playwright qui pilote un Chromium en émulation **Pixel 5** (Android) et
**iPhone 13** (iOS) pour vérifier que le jeu fonctionne sur mobile sans
écraser/modifier la version PC.

⚠️ **Aucun fichier du jeu n'est modifié** — uniquement screenshots dans
`tests/screenshots/` et rapports dans `tests/playwright-report/`.

## Installation

```bash
npm install
npx playwright install chromium
```

(Premier lancement uniquement. `npx playwright install` télécharge le navigateur.)

## Lancer

```bash
# Tous les tests (Android + iPhone)
npm test

# Un seul device
npm run test:android
npm run test:iphone

# Mode UI interactif (debug)
npm run test:ui

# Voir le rapport HTML après une exécution
npm run test:report
```

## Ce qui est testé

1. **Smoke test** — chaque écran clé (intro, char-select, map, c1s2..s5, c2s1, c2s5, c3s1, c3s7, c4s1, c5s1) charge sans erreur JS, screenshot capturé pour review visuel
2. **Bulles & dialogues** — la bulle de Léon et le panneau scene-text de l'écran 3 (atelier) sont visibles et dans les bornes du viewport mobile
3. **Boutons & navigation** — "Démarrer l'Aventure" passe à l'écran 1, le bouton de réponse de l'écran 3 mène à l'écran 4
4. **Audio** — la voix narrateur de l'écran 3 est bien déclenchée (intercept de `Audio.play()`)
5. **Calibrations device-aware** — `saveStarCornerPosition` sur mobile écrit dans `starCornerPos.mobile` SANS écraser `starCornerPos` (la garantie que la calibration mobile ne casse pas le desktop)

## Limites

- **Émulation ≠ vrai mobile** : Chromium en mode iPhone n'est PAS Safari iOS.
  Bugs spécifiques (autoplay policy, fullscreen API absent sur iPhone, WebKit
  rendering) ne sont PAS détectés. Pour ça il faut BrowserStack ou un vrai
  device.
- **Audio** : on vérifie que `play()` est appelé, pas que le son est audible.
- **Le serveur de test** est `python3 -m http.server` (statique) — donc
  `/api/save-calibration` ne répond pas. C'est OK : les tests vérifient le
  comportement client (localStorage), pas la persistance disque.

## Ajouter un test

Ajoute un nouveau bloc `test('...', async ({ page }) => { ... })` dans
`mobile.spec.js`. Le helper `gotoScreen(page, id)` navigue via la fonction
globale `window.goToScreen` (plus fiable qu'un raccourci clavier en émulation).

## Voir les screenshots

```
tests/screenshots/android/  # Pixel 5 landscape (851x393)
tests/screenshots/iphone/   # iPhone 13 landscape (844x390)
```

Compare visuellement les deux dossiers pour repérer les différences entre
Android et iPhone.
