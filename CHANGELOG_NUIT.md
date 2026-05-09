# Travail effectué pendant la nuit

## Mon Atelier (modale globale)

Modale accessible via :
- **Pastille étoile** en haut-gauche de la rue (existait déjà, maintenant connectée)
- **Bouton "⭐ XX"** en haut de la map (NEW : nouveau bouton dans la map-toolbar)
- Au sein de la modale, 3 onglets :
  - **🏅 Badges** : 5 badges (1 par chapitre), grisés si non débloqués, en couleur quand chapitre terminé
  - **🛍️ Boutique** : 5 accessoires + 4 cartes, achetables avec ⭐. Le bouton "Acheter" est désactivé si pas assez d'étoiles ou déjà acheté
  - **👕 Mon vestiaire** : seuls les articles possédés. Boutons "Mettre"/"Retirer" pour les accessoires, badge "Carte" pour les cartes

Catalogue actuel (modifiable dans `ARTICLES_CATALOG` ligne ~2585 d'app.js) :
- Cap de Léon (8⭐)
- Chapeau de magicien (8⭐)
- Couronne dorée (20⭐)
- Lunettes IA (6⭐)
- Cape de héros (12⭐)
- 4 cartes à collectionner (10⭐ chacune : Léon, Bot, Pixel, Echo)

Quand le user achète + équipe un accessoire, `applyAvatarAccessoriesEverywhere()` est appelée → tous les `<div class="avatar-with-accessories">` dans le DOM reçoivent l'emoji superposé. (Pour l'instant aucun élément n'a cette classe — il faudrait l'ajouter aux avatars affichés dans le jeu si on veut qu'ils soient visibles).

## c5s5 robot v2 : SVG + démos cliquables

Quand l'enfant choisit 3 modules sur c5s5, `revealC5Robot()` :
1. Cache la phase "pick", affiche la phase "robot"
2. Construit dynamiquement un **SVG du robot** (corps gris + tête + bras + antenne) avec uniquement les 3 emplacements correspondants aux modules choisis (œil/oreille/bouche/cerveau/main)
3. Boot-up animation : chaque module s'allume séquentiellement avec message "👁️ Voir ON..." (700ms par module)
4. Une fois assemblé : nom + mission de la persona (10 personas définies dans `C5_ROBOT_PERSONAS`)
5. Slots cliquables : clic sur un module joue une **démo textuelle** dans une bulle (ex: "Je vois un chat noir, une fleur jaune...")

Le SVG est entièrement contenu dans `buildRobotSVG(mods)` (function ajoutée dans app.js).
Les styles sont dans `style.css` section "c5s5 : Robot SVG + slots cliquables".

## Étoiles (déjà fait avant)

- Chap 1-4 : 5-9⭐ selon score quiz (5 + vfScore)
- Chap 5 : 7⭐ fixe
- Bonus replay : +1⭐ une seule fois par chapitre (`state.replayBonusGiven[chapNum]`)
- `addStars()` synchronise tous les compteurs : header (#star-count), pastille rue (#street-star-count), bouton map (#map-star-count), modale atelier (#atelier-star-count)

## Cache busters actuels

- `style.css?v=2026050309`
- `game.js?v=10`

## Fichiers ajoutés

- `lancer_jeu.bat` : lance Python http.server sur 8765 + ouvre browser. INDISPENSABLE pour bypass Firefox file://.
- `transparentize_avatars.py` : flood-fill BFS pour rendre les avatars PNG natifs transparents.
- `test*.html` : fichiers de diag (test1-test6) — peuvent être supprimés
- `miniapp.js`, `testjs1.js` : fichiers de diag — peuvent être supprimés
- `app_first*.js`, `app_part1.js` : copies de bisection — peuvent être supprimés

## Chantiers RESTANTS pour plus tard

- Quand l'enfant achète un accessoire et l'équipe, il devrait apparaître **visuellement** sur son avatar (face + de dos). Pour l'instant `applyAvatarAccessoriesEverywhere` cherche `.avatar-with-accessories` qui n'existe nulle part. Il faudrait ajouter cette classe sur les avatars principaux (intro, win-face, etc.)
- La calibration enseigne (zone clic + pointeur + destination héros) doit être ajustée à la main par l'utilisateur via `enableCalibMode()` puis les 4 boutons rouges
- Régénérer `ce_matin.mp3` avec le nouveau texte étendu (commande : `python regenerate_all_narrators.py --chap 1`)
- Vérifier que la voix touche_l'enseigne.mp3 n'est plus utilisée nulle part (on l'a remplacée par l'emoji)

## Bug à surveiller

Le **bug du Edit qui tronque app.js** revient régulièrement quand on ajoute du code à la fin. Solution : vérifier après chaque modif via :
```
node -c app.js   # syntaxe script mode
node -e "new Function(require('fs').readFileSync('app.js','utf8'))"  # mode browser-strict
cp app.js game.js   # synchroniser
```

Le HTML pointe sur `game.js` (renommé pour bypass cache stale Firefox).
