# Règles pour les futurs chapitres (économie de crédits)

## Écrans qui NE DOIVENT PAS avoir de `prompt_image` / `prompt_animation`

### Quiz Vrai/Faux (toujours l'avant-dernier tableau)
- Réutilise `assets/atelier_sans_leon.jpg` (fond partagé entre tous les chapitres)
- Pas d'image à générer, pas de vidéo

### Écran de victoire (dernier tableau)
- Réutilise `assets/atelier_sans_leon.jpg` (fond) + le visage du héros + confettis
- Pas d'image à générer, pas de vidéo

### Mini-jeu (génération d'image fixe uniquement, pas de vidéo)
- Garder seulement `prompt_image` (fond du décor)
- Pas de `prompt_animation` car l'écran est interactif, pas narratif

## Écrans qui ONT besoin de `prompt_image` ET `prompt_animation`
- Tableaux narratifs où Léon parle (typiquement les 4 à 6 premiers tableaux)
- Format = "video" pour les écrans deferred (vidéo qui se lance quand Léon parle)
- Format = "image" si on veut une image fixe (économise les crédits Motion 2.0)

## Structure JSON minimale pour un chapitre

```json
[
  { "tableau": 1, "format": "video", "narrateur": "...", "leon": "...", "prompt_image": "...", "prompt_animation": "..." },
  { "tableau": 2, "format": "video", "narrateur": "...", "leon": "...", "prompt_image": "...", "prompt_animation": "..." },
  { "tableau": 3, "format": "video", "narrateur": "...", "leon": "...", "prompt_image": "...", "prompt_animation": "..." },
  { "tableau": 4, "format": "video", "narrateur": "...", "leon": "...", "prompt_image": "...", "prompt_animation": "..." },
  { "tableau": 5, "format": "image", "narrateur": "...", "leon": "...", "prompt_image": "..." },
  { "tableau": 6, "format": "image", "narrateur": "...", "leon": "...", "prompt_image": "..." },
  { "tableau": 7, "narrateur": "Quiz : ...", "leon": "Vrai ou Faux ?" },
  { "tableau": 8, "narrateur": "Bravo ! Tu as terminé ...", "leon": "Tu es désormais ..." }
]
```

## Économie typique par chapitre

- 4 vidéos Motion 2.0 (~200 crédits/vidéo) = 800 crédits
- 1-2 images Phoenix/Nano (~5-15 crédits chacune) = 30 crédits
- 0 image pour quiz et win (réutilisation) = 0 crédit
- **Total : ~830 crédits par chapitre**

vs si on génère tout :
- 8 vidéos = 1600 crédits + 8 images = 80 crédits = **1680 crédits par chapitre** (le double)

## Vidéos Léon — mouvements de lèvres OBLIGATOIRES

Sur tous les écrans où Léon (ou Bot) parle dans une vidéo générée par Leonardo
Motion 2.0, le `prompt_animation` DOIT commencer par une mention forte du
mouvement de lèvres, sinon Leonardo rend un personnage statique qui parle dans
le vide — incohérent avec la voix off qu'on entend.

**Formule type (à mettre en début de prompt)** :
```
"Léon's mouth clearly opens and closes with visible lip movement as he speaks ...
```

L'agent de validation Claude Haiku (`leonardo_animate.py`) inclut désormais le
CHECK 3 qui flag les prompts oubliant cette mention quand le contexte narratif
contient un dialogue. Il fail le prompt avant qu'on ne dépense des crédits Leonardo.

**Pourquoi** : Motion 2.0 ne fait PAS de lip-sync (on n'a pas besoin que les
lèvres correspondent aux phonèmes), MAIS il faut que la bouche ouvre/ferme
visiblement pour donner vie au personnage. Sans mention explicite et
emphatique, le modèle laisse le visage figé.

## Voix (ElevenLabs)

Toujours générer pour TOUS les tableaux qui ont du texte (narrateur + leon),
y compris quiz et win, sauf si tu veux du silence sur ces écrans.

## Illumination du chemin de la carte

Vérifié : le chemin se met à jour automatiquement à chaque chapitre terminé,
via `updateGlowPath(completed)` dans `app.js` (~ligne 1432). Tant qu'un chapitre N
est ajouté à `state.chaptersCompleted` (ce qui arrive dans le handler de l'écran
de victoire), le segment N→N+1 du SVG `.track-unlocked` apparaît en lumineux.

À FAIRE pour chaque nouveau chapitre :
- Vérifier que l'écran de victoire pousse bien le numéro dans `state.chaptersCompleted`
  (regarde le handler de c3s9 / c4s8 comme modèle)
- Vérifier que `MAP_NODE_ICONS` (~ligne 1400) a la bonne icône pour le chapitre
- Si on dépasse 5 chapitres, ajouter un segment au tableau `segments` dans
  `updateGlowPath` (un nouvel arc de Bézier reliant le nœud N au nœud N+1)

## TODO — refonte visuelle à reprendre plus tard

L'écran **Carte** et l'écran **Rue** (street-mode, début de l'aventure) ont
un style qui ne colle pas avec l'ambiance Pixar/3D des décors d'atelier de Léon.
À retravailler pour homogénéiser :

- **Carte** : actuellement "candy land" en vector simple, manque de texture, de
  profondeur, de cohérence avec les images générées par Leonardo. Idée : refaire
  le fond avec une grande image générée (atelier vu d'en haut, ou paysage d'îles
  flottantes), et garder les nodes en SVG par-dessus.
- **Rue** : style assez plat aussi. Idée : remplacer par une vraie image
  d'inventaire de quartier "atelier de Léon" et conserver l'enseigne + porte
  comme zones cliquables superposées.

Note : ces deux écrans ne sont qu'un sas avant l'aventure. À voir si on les
refait avant le lancement ou si on les garde tels quels pour un MVP.

## TODO — interactions enfants à enrichir (chap 2 et suivants)

Le chapitre 2 (et probablement 3, 4, 5 — à vérifier) est trop passif :
narrateur + Léon qui parle → bouton "suivant" → écran suivant. Les enfants ne
font que cliquer pour avancer. Il faut **plus de moments interactifs** dans
chaque chapitre.

**Idées d'interactions à intégrer :**

- **Cliquer sur les erreurs de l'IA** : sur c2s5 (« Regarde, une main à 6
  doigts, un garçon sans bras... »), afficher plusieurs images générées par IA
  et demander à l'enfant de cliquer sur les défauts (main avec trop de doigts,
  visage déformé, perspective bizarre). Score à la clé.
- **Glisser-déposer** : assembler un prompt en glissant des mots-blocs
  ("chat", "qui vole", "dans l'espace") dans une zone, puis voir le résultat.
  Variante du c2s7 mais plus libre.
- **Choix multiples avec image** : 3-4 vignettes à cliquer pour répondre à une
  question ("Lequel de ces objets utilise une IA ?", "Quelle image n'a pas
  été générée par une IA ?").
- **Quiz "Devine qui a écrit ça"** : 2-3 textes courts (humain vs IA), enfant
  doit deviner qui a écrit quoi.
- **Mini-puzzle** : reconstituer une image que l'IA a "oublié" de finir
  (drag & drop de morceaux).
- **Trouve le bon prompt** : afficher une image générée + 3 prompts possibles,
  trouver celui qui a été utilisé pour la générer.

À répartir selon la pédagogie de chaque chapitre :
- chap 2 (image) → "trouve les erreurs" + "fabrique un prompt"
- chap 3 (son) → "qui parle ? humain ou IA ?" + "associe un son à sa source"
- chap 4 (texte) → "devine qui a écrit ça" + "corrige les hallucinations"
- chap 5 (synthèse) → mini-quiz mixte avec tous les types d'interactions

**Audit à faire sur chap 3, 4, 5** : compter les écrans purement narratifs vs
les écrans avec interaction réelle. Cible : au moins 1 interaction non-triviale
tous les 2 écrans.

**⚠️ Contrainte importante** : ces enrichissements interactifs doivent être
réalisés **sans toucher à la génération d'image ou de vidéo**. Aucun nouveau
crédit Leonardo (Phoenix/Nano/Motion 2.0) ni ElevenLabs ne doit être consommé.
On réutilise exclusivement les assets déjà présents dans `assets/` :
- Les images IA déjà générées (chats, licornes, dragons, exemples chap 2)
- Les fonds existants (`atelier_sans_leon.jpg`, `Leon_devant_machine.jpg`,
  `toile_sans_chat.jpg`, etc.)
- Les voix off déjà enregistrées
- Les emojis et SVG inline pour tout nouvel élément interactif
Tout l'enrichissement passe donc par du HTML/CSS/JS pur (drag & drop, click
zones, overlays, animations CSS), pas par de la nouvelle production graphique.
