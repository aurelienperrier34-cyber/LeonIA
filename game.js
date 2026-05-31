console.log('[app.js] LOADED OK - version 2026050306');
// === Verrouillage paysage + overlay "tourne ton téléphone" (mobile uniquement) ===
function isMobileDevice() {
  return /Android|iPhone|iPod|IEMobile|BlackBerry|Opera Mini/i.test(navigator.userAgent)
      || (navigator.maxTouchPoints > 1 && window.matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 900);
}

// === Calibrations device-aware ===
// Sur mobile, les calibrations sont sauvees sous '<key>.mobile' pour ne pas
// ecraser celles du desktop. La lecture privilegie d'abord la cle mobile,
// puis retombe sur la cle desktop si pas d'override mobile (utile pour qu'un
// premier lancement mobile parte de positions raisonnables avant calibration).
function _calibKey(baseKey) {
  return isMobileDevice() ? baseKey + '.mobile' : baseKey;
}
function _calibGet(baseKey) {
  if (isMobileDevice()) {
    const mobileVal = localStorage.getItem(baseKey + '.mobile');
    if (mobileVal !== null) return mobileVal;
  }
  return localStorage.getItem(baseKey);
}
function _calibSet(baseKey, value) {
  try { localStorage.setItem(_calibKey(baseKey), value); } catch(e) {}
}
function isPortrait() {
  return window.matchMedia('(orientation: portrait)').matches;
}
function tryLockLandscape() {
  // Android Chrome/Firefox en plein écran : lock réel possible. iOS : ignoré silencieusement.
  if (screen.orientation && typeof screen.orientation.lock === 'function') {
    screen.orientation.lock('landscape').catch(() => {});
  }
}
function updateRotateOverlay() {
  const needs = isMobileDevice() && isPortrait();
  document.body.classList.toggle('needs-rotate', needs);
  if (!needs) tryLockLandscape();
}
function setupOrientationLock() {
  updateRotateOverlay();
  window.addEventListener('resize',            updateRotateOverlay);
  window.addEventListener('orientationchange', updateRotateOverlay);
  const _onFsChange = () => { if (_fsElement && _fsElement()) tryLockLandscape(); };
  document.addEventListener('fullscreenchange',       _onFsChange);
  document.addEventListener('webkitfullscreenchange', _onFsChange);
  document.addEventListener('mozfullscreenchange',    _onFsChange);
  document.addEventListener('MSFullscreenChange',     _onFsChange);
}

// === Système de voix-off (narrateur + personnages) ===
const _voiceCache = {};
function getVoice(key, src) {
  if (!_voiceCache[key]) {
    const a = new Audio(src);
    a.preload = 'auto';
    _voiceCache[key] = a;
  }
  return _voiceCache[key];
}

// Audio unlock global : au TOUT PREMIER click/touch/key, on cree TOUS les audios
// critiques dans _voiceCache et on les play+pause muted pour debloquer la policy
// autoplay de Firefox/Chrome. Apres ca, getVoice() retourne ces audios deja
// "unlock" et leurs play() ulterieurs marchent sans gesture supplementaire.
let _audioUnlocked = false;
const _AUDIO_UNLOCK_LIST = [
  { key: 'ce_matin',         file: 'ce_matin.mp3' },
  { key: 'touche_enseigne',  file: "touche_l'enseigne.mp3" },
  { key: 'voix_narrateur_3', file: 'voix_narrateur_3.mp3' },
  { key: 'voix_leon_3',      file: 'Voix_leon_3.mp3' },
  { key: 'au_coeur',         file: 'au_coeur.mp3' },
  { key: 'voix_leon_4',      file: 'Voix_leon_4.mp3' },
  { key: 'attention',        file: 'Attention.mp3' },
];
function _unlockAudio() {
  if (_audioUnlocked) return;
  _audioUnlocked = true;
  console.log('[audio] unlocking via user gesture');
  try {
    // On joue+pause des AUDIOS SEPARES (pas ceux du _voiceCache) pour eviter
    // une race condition : si le screen-N appelle .play() sur le meme objet
    // pendant que _unlockAudio est en cours, le .then() du unlock peut
    // pause() l'audio juste apres notre play() et le rendre muet.
    // L'unlock reste valide au niveau du document : une fois qu'un Audio a
    // play() sous gesture, tous les Audio du document sont debloques.
    _AUDIO_UNLOCK_LIST.forEach(({ file }) => {
      const a = new Audio('assets/' + file);
      a.preload = 'auto';
      a.muted = true;
      const p = a.play();
      if (p && p.then) {
        p.then(() => { try { a.pause(); a.currentTime = 0; } catch(e){} })
         .catch(() => {});
      }
    });
    // Priming SpeechSynthesis : sur Chrome Android, l'API doit etre activee
    // via une utterance dans un user gesture, sinon les speak() suivants sont
    // silencieusement ignores. On envoie une utterance quasi-muette de 1ms.
    if (typeof window.speechSynthesis !== 'undefined') {
      try {
        const primer = new SpeechSynthesisUtterance(' ');
        primer.volume = 0;
        primer.rate = 10;
        window.speechSynthesis.speak(primer);
      } catch(e) {}
    }
  } catch(e) { console.warn('[audio] unlock failed:', e.message); }
  // Detache les listeners apres le 1er trigger
  document.removeEventListener('pointerdown', _unlockAudio, true);
  document.removeEventListener('keydown',     _unlockAudio, true);
  document.removeEventListener('touchstart',  _unlockAudio, true);
}
document.addEventListener('pointerdown', _unlockAudio, true);
document.addEventListener('keydown',     _unlockAudio, true);
document.addEventListener('touchstart',  _unlockAudio, true);

// (Plus de video de fond sur l'ecran d'accueil — remplace par image fixe
// leon_bienvenue.png + animation CSS Ken Burns + particules.)
function stopAllVoices() {
  Object.values(_voiceCache).forEach(a => { try { a.pause(); a.currentTime = 0; } catch(e){} });
}
// Joue un audio et, si la policy autoplay du navigateur le bloque
// (NotAllowedError), enregistre un listener qui relance l'audio au prochain
// clic/keydown/touch. Renvoie une promesse qui resout quand l'audio joue
// reellement (ou est definitivement abandonne).
function playSafely(audio, label) {
  if (!audio) return Promise.reject(new Error('no audio'));
  const start = () => audio.play();
  const first = start();
  if (!first || !first.then) return Promise.resolve();
  return first.catch((err) => {
    const blocked = err && (err.name === 'NotAllowedError' || /user|gesture|interact/i.test(err.message || ''));
    if (!blocked) {
      console.warn('[' + (label || 'audio') + '] play failed:', err && err.message);
      return Promise.reject(err);
    }
    console.warn('[' + (label || 'audio') + '] BLOCKED par autoplay policy — relance au prochain clic');
    return new Promise((resolve) => {
      const retry = () => {
        document.removeEventListener('pointerdown', retry, true);
        document.removeEventListener('keydown',     retry, true);
        document.removeEventListener('touchstart',  retry, true);
        const p = audio.play();
        if (p && p.then) p.then(resolve).catch(() => resolve());
        else resolve();
      };
      document.addEventListener('pointerdown', retry, true);
      document.addEventListener('keydown',     retry, true);
      document.addEventListener('touchstart',  retry, true);
    });
  });
}
function voicesEnabled() {
  return localStorage.getItem('ia_voices_off') !== '1';
}
function subtitlesEnabled() {
  return localStorage.getItem('ia_cc_off') !== '1';
}

// ============================================================
// Calibration manuelle des 3 micros sur c3s7
//   Alt+P : active/désactive le mode (cibles rouges autour des 3 emojis)
//   1, 2, 3 : sélectionne le micro à ajuster
//   ←/→/↑/↓ : déplace l'emoji sélectionné (Shift = pas plus gros)
//   Sauvegarde automatique dans localStorage.
// ============================================================
const C3S7_DEFAULT_POS = [
  { left: 31, top: 0 },
  { left: 46, top: 0 },
  { left: 61, top: 0 }
];
function loadC3s7MicPositions() {
  try {
    const raw = _calibGet('c3s7MicPos');
    if (raw) return JSON.parse(raw);
  } catch(e) {}
  return JSON.parse(JSON.stringify(C3S7_DEFAULT_POS));
}
function saveC3s7MicPositions(pos) {
  _calibSet('c3s7MicPos', JSON.stringify(pos));
  // Persiste aussi sur disque dans calibration.json (anti-perte au vidage cache)
  if (typeof persistCalibration === 'function') persistCalibration({ c3s7MicPos: pos });
}
function applyC3s7MicPositions() {
  const screen = document.getElementById('screen-c3s7');
  if (!screen) return;
  const pos = loadC3s7MicPositions();
  pos.forEach((p, i) => {
    screen.style.setProperty(`--mic${i + 1}-left`, `${p.left}%`);
    screen.style.setProperty(`--mic${i + 1}-top`,  `${p.top}px`);
  });
}
function toggleC3s7Calib() {
  // Garde-fou : si on n'est pas sur c3s7, on bascule d'abord puis on active
  if (state.currentScreen !== 'c3s7') {
    goToScreen('c3s7', true);
    setTimeout(() => toggleC3s7Calib(), 200);
    return;
  }
  window._c3s7CalibActive = !window._c3s7CalibActive;
  if (window._c3s7CalibSelected === undefined) window._c3s7CalibSelected = 0;
  // Approche simple, calquée sur la calibration entry-marker qui marche :
  // une classe sur <body> active l'affichage des marqueurs HTML statiques,
  // CSS s'occupe de tout le reste.
  document.body.classList.toggle('calib-c3s7-mics', window._c3s7CalibActive);
  console.log('[calib] body.classList :', document.body.className);
  updateC3s7CalibSelection();
  if (window._c3s7CalibActive) {
    const pos = loadC3s7MicPositions();
    console.log('🎯 Calibration c3s7 ON — 1/2/3 pour sélectionner, ←→↑↓ pour bouger (Shift = pas plus gros), Alt+P pour quitter');
    console.log('   Positions actuelles :', pos);
  } else {
    console.log('🎯 Calibration c3s7 OFF — positions sauvegardées :', loadC3s7MicPositions());
  }
}
function selectC3s7Mic(idx) {
  window._c3s7CalibSelected = Math.max(0, Math.min(2, idx));
  updateC3s7CalibSelection();
  console.log(`Micro ${idx + 1} sélectionné`);
}
function updateC3s7CalibSelection() {
  // Bascule la classe .calib-selected sur le marqueur (red dot) du micro courant
  const markers = [
    document.getElementById('calib-mic-1'),
    document.getElementById('calib-mic-2'),
    document.getElementById('calib-mic-3')
  ];
  markers.forEach((m, i) => {
    if (!m) return;
    m.classList.toggle('calib-selected', !!window._c3s7CalibActive && i === window._c3s7CalibSelected);
  });
}
function nudgeC3s7Mic(dx, dy) {
  const pos = loadC3s7MicPositions();
  const idx = window._c3s7CalibSelected || 0;
  pos[idx].left = Math.max(0, Math.min(100, pos[idx].left + dx));
  pos[idx].top  = pos[idx].top + dy;
  saveC3s7MicPositions(pos);
  applyC3s7MicPositions();
  console.log(`Mic ${idx + 1} : left=${pos[idx].left.toFixed(2)}%, top=${pos[idx].top}px`);
}
function toggleVoices() {
  const off = voicesEnabled(); // si actuellement ON, on passe à OFF
  localStorage.setItem('ia_voices_off', off ? '1' : '0');
  if (off) stopAllVoices();
  updateAVToggles();
}
function toggleSubtitles() {
  const off = subtitlesEnabled();
  localStorage.setItem('ia_cc_off', off ? '1' : '0');
  document.body.classList.toggle('cc-off', off);
  updateAVToggles();
}
function updateAVToggles() {
  const v = document.getElementById('av-voice');
  const c = document.getElementById('av-cc');
  if (v) v.textContent = voicesEnabled() ? '🔊' : '🔇';
  if (c) { c.textContent = subtitlesEnabled() ? 'CC' : 'CC̶'; c.classList.toggle('off', !subtitlesEnabled()); }
}

// State Management
let state = {
  characterType: null,
  characterName: '',
  characterImage: '',
  currentScreen: 0,
  totalStars: 0,
  vfScore: 0,
  vfDone: 0,
  vfAnswered: [false, false, false, false],
  tapAnswered: false,
  tapAttempts: 0,
  chaptersCompleted: [],
  starsAwarded: false,
  // PREMIUM : acces au contenu payant (chapitres 2-5 + Livre magique).
  // Source de verite = localStorage 'ia_premium' (voir isPremium()).
  isPremium: false,
  // PLUMES : monnaie consommable pour creer des histoires custom (a venir).
  // Source de verite = localStorage 'ia_plumes' (voir getPlumes()).
  plumes: 0,
  c2WordsSelected: [],
  vfScoreC2: 0,
  vfDoneC2: 0,
  vfAnsweredC2: [false, false, false, false],
  starsAwardedC2: false,
  c3SoundsPlayed: [],
  vfScoreC3: 0,
  vfDoneC3: 0,
  vfAnsweredC3: [false, false, false, false],
  starsAwardedC3: false,
  // Mini-interactions chap 5 (+1 ⭐ chacune, donnees une seule fois)
  c5s4WishAwarded: false,
  c5s2SpotsFound: [],          // ids des hotspots IA deja trouves dans la session courante
  c5s2GameAwarded: false,      // bonus +1 ⭐ deja attribue
  // c4s5 : memory pairs "Test de l'amitie"
  c4s5PairsFound: [],          // ids des paires deja matchees
  c4s5GameAwarded: false,      // bonus +1 ⭐ deja attribue
  // c4s3 : cascade de livres
  c4s3TapsDone: 0,             // 0..7 (chaque tap multiplie x10)
  c4s3GameAwarded: false,      // bonus +1 ⭐ deja attribue (1M atteint)
  // c2s2 : inspecte la machine
  c2s2SpotsFound: [],          // ids des hotspots deja decouverts
  c2s2GameAwarded: false,      // bonus +1 ⭐ deja attribue
  // c5s3 : swipe Vrai/Fake
  c5s3CardIndex: 0,            // index de la carte courante (0..5)
  c5s3Score: 0,                // bonnes reponses
  c5s3GameAwarded: false,      // bonus +1 ⭐ deja attribue (si >= 4/6)
  // c3s3 : aide la machine a ecrire BONJOUR
  c3s3LetterIndex: 0,          // prochaine lettre a placer (0..6)
  c3s3GameAwarded: false,      // bonus +1 ⭐ deja attribue
  // c3s2 : attrape les mots qui dansent
  c3s2Caught: 0,               // nombre de mots attrapes
  c3s2GameAwarded: false,      // bonus +1 ⭐ deja attribue
  // screen-4 : reconnaitre les vrais arbres
  s4TreesFound: 0,             // arbres trouves (0..3)
  s4GameAwarded: false,        // bonus +1 ⭐ deja attribue
  // c3s5 : compose 3 notes, l'IA invente
  c3s5NotesPicked: [],         // index des notes choisies
  c3s5GameAwarded: false,      // bonus +1 ⭐ deja attribue
  // c4s2 : pose une question a Bot
  c4s2QuestionsAsked: [],      // ids des questions deja posees
  c4s2GameAwarded: false       // bonus +1 ⭐ deja attribue
};

// Configuration & Default names
const charData = {
  fille:   { name: null,    img: 'assets/avatar_fille_1776108656117.png?v=2',  backVideo: 'assets/fille marche de dos.mp4', chromaKey: 'whiteKey', backImg: 'assets/fille de dos.jpg', walkRate: 0.6, profileImg: 'assets/fille_de_profil-removebg-preview.png', faceImg: 'assets/fille_face.jpg',      faceImgClean: 'assets/fille_face-removebg-preview.png' },
  garcon:  { name: null,    img: 'assets/avatar_garcon_1776108702967.png?v=2', backVideo: 'assets/garcon marche de dos.mp4', chromaKey: 'ultraSoftGreenKey', backImg: null, walkRate: 0.35, profileImg: 'assets/Garcon_de_profil-removebg-preview.png', faceImg: 'assets/garcon_de_face.jpg', faceImgClean: 'assets/garcon_de_face-removebg-preview.png' },
  renard:  { name: 'Rémi',  img: 'assets/avatar_renard_1776108778358.png?v=2', backVideo: 'assets/renard marche de dos.mp4', chromaKey: 'greenKey', backImg: null, walkRate: 0.6, profileImg: 'assets/Remi_de_profil-removebg-preview.png', faceImg: 'assets/remi_face.jpg',        faceImgClean: 'assets/remi_face-removebg-preview.png' },
  robot:   { name: 'Pixel', img: 'assets/avatar_robot_1776108872947.png?v=2',  backVideo: 'assets/pixel marche de dos.mp4', chromaKey: 'softGreenKey', backImg: null, walkRate: 0.6, profileImg: 'assets/pixel_de_profil-removebg-preview.png', faceImg: 'assets/pixel_face.jpg',      faceImgClean: 'assets/pixel_face-removebg-preview.png' }
};

// ============================================================
// CHROMA KEY iOS-COMPATIBLE (v395)
// ============================================================
// iOS Safari ne supporte PAS fiablement les filtres SVG sur <video>
// (ex: filter: url(#greenKey) reste sans effet -> le perso garde son
// cadre vert). Sur iOS uniquement, on dessine la video frame-par-frame
// dans un <canvas> place au-dessus, et on applique le chroma key en
// manipulation pixel JS. Un MutationObserver mirroe automatiquement
// transform/style de la video sur le canvas -> toutes les animations
// existantes (marche, scale) fonctionnent sans toucher au code appelant.

function _isIOSDevice() {
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // v435 : detection iPadOS 13+ robuste. UA = Macintosh, mais touch
  // (vrai Mac = pas de touch). navigator.platform deprecie -> on utilise UA + touch.
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return true;
  // Fallback : ancien check platform si UA ne contient pas Macintosh
  if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) return true;
  return false;
}

// v433 : ajoute body.ios-device pour cibler les overrides typo/UI iOS-only
// via CSS. Pas de bg/color modif globale (les rules iOS-specifiques sont
// scopees a des elements precis, ex .c3s7-hint). Re-introduction safe car
// AUCUNE rule body.ios-device { bg/color } generale ne consomme la classe.
(function _tagIOSDevice(){
  if (!_isIOSDevice()) return;
  const apply = () => { if (document.body) document.body.classList.add('ios-device'); };
  if (document.body) apply();
  else document.addEventListener('DOMContentLoaded', apply, { once: true });
})();

// Parametres chroma par type, calibres pour matcher visuellement les
// filtres SVG #greenKey / #softGreenKey / #ultraSoftGreenKey / #whiteKey.
function _chromaParamsForType(type) {
  if (type === 'whiteKey') {
    return { kind: 'white', threshold: 232 };
  }
  // Green keys : 'g doit etre dominant ET pas trop sombre'
  const map = {
    'ultraSoftGreenKey': { gMin: 110, gOverR: 1.45, gOverB: 1.45 },
    'softGreenKey':      { gMin:  80, gOverR: 1.25, gOverB: 1.25 },
    'aiGreenKey':        { gMin:  70, gOverR: 1.20, gOverB: 1.20 },
    'greenKey':          { gMin:  60, gOverR: 1.15, gOverB: 1.15 },
    'greenKeyShadow':    { gMin:  60, gOverR: 1.15, gOverB: 1.15 },
    'leonGreenKey':      { gMin:  70, gOverR: 1.20, gOverB: 1.20 }
  };
  return Object.assign({ kind: 'green' }, map[type] || map.greenKey);
}

function _applyChromaToImageData(d, p) {
  if (p.kind === 'white') {
    const t = p.threshold;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > t && d[i+1] > t && d[i+2] > t) d[i+3] = 0;
    }
  } else {
    const gMin = p.gMin, gOverR = p.gOverR, gOverB = p.gOverB;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i+1], b = d[i+2];
      if (g > gMin && g > r * gOverR && g > b * gOverB) d[i+3] = 0;
    }
  }
}

// Installe le canvas chroma-key sur une <video>. No-op si non-iOS.
// Retourne le canvas cree (ou existant) pour ref. Idempotent.
function setupCanvasChromaKeyForVideo(video, chromaType) {
  if (!_isIOSDevice()) return null;
  if (!video) return null;
  if (video._chromaCanvas && video._chromaType === chromaType) {
    // Deja installe pour le bon type
    return video._chromaCanvas;
  }
  // Si chroma type a change, retire l'ancien observer/raf
  if (video._chromaStop) { try { video._chromaStop(); } catch(e){} }
  if (video._chromaObs)  { try { video._chromaObs.disconnect(); } catch(e){} }

  const parent = video.parentElement;
  if (!parent) return null;

  // Reutilise le canvas existant ou en cree un nouveau
  let canvas = video._chromaCanvas;
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = (video.id || 'hero-video') + '-canvas';
    parent.insertBefore(canvas, video.nextSibling);
  }
  // Le canvas reprend les classes de la video -> meme positionnement CSS
  canvas.className = video.className;
  // La video sert de source : on la cache (visibility) tout en gardant
  // le layout. play() continue de fonctionner sur visibility:hidden.
  video.style.visibility = 'hidden';
  // Le canvas prend la place de la video au-dessus visuellement
  canvas.style.pointerEvents = 'none';

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const params = _chromaParamsForType(chromaType);

  let rafId = null;
  let lastDrawnTime = -1;
  const draw = () => {
    if (video.readyState >= 2 && video.videoWidth > 0) {
      // Redimensionne le canvas a la resolution intrinseque de la video
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }
      // Ne redessine que si la video a avance (evite du travail inutile)
      const t = video.currentTime;
      if (t !== lastDrawnTime) {
        lastDrawnTime = t;
        try {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          _applyChromaToImageData(img.data, params);
          ctx.putImageData(img, 0, 0);
        } catch(e) { /* tainted canvas / cross-origin : on ne plante pas */ }
      }
    }
    rafId = requestAnimationFrame(draw);
  };
  draw();

  // Mirroe les changements de style (transform, opacity, display, transition)
  // de la video sur le canvas — toutes les animations existantes fonctionnent.
  const syncStyles = () => {
    const v = video.style;
    const c = canvas.style;
    c.transform = v.transform;
    c.transition = v.transition;
    c.opacity = v.opacity;
    c.display = v.display === 'none' ? 'none' : '';
    // Filter doit etre 'none' sur le canvas (le keying est deja fait pixel)
    c.filter = 'none';
    c.webkitFilter = 'none';
  };
  syncStyles();
  const mo = new MutationObserver(syncStyles);
  mo.observe(video, { attributes: true, attributeFilter: ['style', 'class'] });
  // Re-applique aussi la class si elle change
  const classObs = () => { canvas.className = video.className; };

  video._chromaCanvas = canvas;
  video._chromaType = chromaType;
  video._chromaStop = () => { if (rafId) cancelAnimationFrame(rafId); };
  video._chromaObs = mo;
  return canvas;
}

const vfCorrectAnswers = [true, false, true, false];

// Quiz chapitre 2 : (1) IA crée images avec mots, (2) IA dessine sans avoir vu, (3) IA peut se tromper, (4) IA dessine par plaisir
const vfCorrectAnswersC2 = [true, false, true, false];

// Quiz chapitre 3 : (1) IA peut écouter+comprendre, (2) IA a une vraie bouche, (3) IA compose musique, (4) IA comprend toujours tout
const vfCorrectAnswersC3 = [true, false, true, false];
// Quiz chapitre 4 :
// (1) IA peut tenir une vraie conversation = vrai
// (2) Bot ressent vraiment des émotions = faux
// (3) IA a appris en lisant des millions de textes = vrai
// (4) IA dit toujours la vérité, on peut la croire les yeux fermés = faux
const vfCorrectAnswersC4 = [true, false, true, false];

// Persistence légère via sessionStorage
function saveState() {
  sessionStorage.setItem('ia_state', JSON.stringify({
    characterType: state.characterType,
    characterName: state.characterName,
    characterImage: state.characterImage,
    totalStars: state.totalStars,
    currentScreen: state.currentScreen,
    chaptersCompleted: state.chaptersCompleted,
    starsAwarded: state.starsAwarded,
    // Atelier : sans ces champs les achats etaient perdus a chaque rechargement
    // alors que les etoiles depensees restaient deduites.
    purchases: state.purchases,
    equippedAccessories: state.equippedAccessories,
    cardsUnlocked: state.cardsUnlocked,
    replayedChapters: state.replayedChapters,
    // Mini-interactions (+1 ⭐ chacune, donnees une seule fois)
    c5s4WishAwarded: state.c5s4WishAwarded,
    c5s2GameAwarded: state.c5s2GameAwarded,
    c4s5GameAwarded: state.c4s5GameAwarded,
    c4s3GameAwarded: state.c4s3GameAwarded,
    c2s2GameAwarded: state.c2s2GameAwarded,
    c5s3GameAwarded: state.c5s3GameAwarded,
    c3s3GameAwarded: state.c3s3GameAwarded,
    c3s2GameAwarded: state.c3s2GameAwarded,
    s4GameAwarded: state.s4GameAwarded,
    c3s5GameAwarded: state.c3s5GameAwarded,
    c4s2GameAwarded: state.c4s2GameAwarded
  }));
}
function restoreState() {
  try {
    const saved = JSON.parse(sessionStorage.getItem('ia_state') || '{}');
    if (saved.characterType) Object.assign(state, saved);
  } catch(e) {}
}

// Init
document.addEventListener("DOMContentLoaded", () => {
  restoreState();
  state.isPremium = isPremium();   // source de verite = localStorage / ?premium=1
  grantInitialPlumes();            // offre PLUMES_FREE_GIFT a la 1re ouverture
  state.plumes = getPlumes();      // source de verite = localStorage 'ia_plumes'
  updatePlumesUI();
  if (!subtitlesEnabled()) document.body.classList.add('cc-off');
  if (state.characterType) document.body.classList.add('has-character');
  updateAVToggles();
  setupOrientationLock();
  // Applique la calibration de la pastille etoiles globale + le compteur initial
  if (typeof applyStarCornerPosition === 'function') applyStarCornerPosition();
  if (typeof updateStarBadge === 'function')         updateStarBadge();
  // Pour eviter tout flash sombre/blanc pendant le decodage video, on copie
  // l'attribut poster de chaque <video> dans son background-image CSS. Comme
  // ca, des l'arrivee sur l'ecran l'image apparait INSTANTANEMENT (le navigateur
  // affiche le background CSS avant meme que l'element video ne rende sa frame).
  // On RETIRE ensuite l'attribut poster du <video> : sinon le navigateur gere
  // une transition interne poster→video qui cree une micro-pause au tout
  // premier frame. Avec le bg CSS seul, la transition est totalement gommée.
  document.querySelectorAll('video[poster]').forEach(v => {
    const p = v.getAttribute('poster');
    if (!p) return;
    v.style.backgroundImage    = "url('" + p.replace(/'/g, "\\'") + "')";
    v.style.backgroundSize     = 'cover';
    v.style.backgroundPosition = 'center';
    v.style.backgroundRepeat   = 'no-repeat';
    // Preload aussi l'image dans le cache (utile au tout premier passage)
    const img = new Image();
    img.src = p;
    // Retire l'attribut poster pour eviter la transition interne du navigateur
    v.removeAttribute('poster');
  });

  // ============================================================
  // PRÉCHARGEMENT AGRESSIF DE TOUTES LES VIDÉOS
  // ============================================================
  // preload="auto" est ignoré par la plupart des navigateurs quand l'élément
  // est sur un écran display:none (et tous les écrans inactifs le sont).
  // Solution : créer dynamiquement des <link rel="preload" as="video"> qui
  // forcent le téléchargement en background dès que la page est chargée.
  // → Premier frame de chaque vidéo prête en cache → ZÉRO fond violet à la
  //   transition d'écran (chap 1 → chap 5).
  // On attend 'load' puis 1.2s pour ne pas bloquer le rendu initial.
  window.addEventListener('load', () => {
    setTimeout(() => {
      const seen = new Set();
      document.querySelectorAll('video[src]').forEach(v => {
        const src = v.getAttribute('src');
        if (!src || seen.has(src)) return;
        seen.add(src);
        if (document.querySelector(`link[rel="preload"][href="${src.replace(/"/g, '\\"')}"]`)) return;
        const link = document.createElement('link');
        link.rel = 'preload';
        link.as = 'video';
        link.href = src;
        link.type = 'video/mp4';
        document.head.appendChild(link);
      });
      console.log('[preload] ' + seen.size + ' vidéos préchargées en background — fini le fond violet');
    }, 1200);
  });

  // Enrobe les avatars + applique les accessoires equipes des le chargement
  // (sinon les .char-img de l'ecran d'intro restent nues tant qu'on ne navigue pas).
  if (typeof applyAvatarAccessoriesEverywhere === 'function') {
    applyAvatarAccessoriesEverywhere();
  }

  // Reprise automatique sur la dernière page visitée (après un F5)
  // L'audio des ecrans utilise playSafely : si l'autoplay est bloque,
  // le retry s'effectue tout seul au premier clic utilisateur.
  const resumeTarget = state.currentScreen;
  if (state.characterType && resumeTarget && resumeTarget !== 0) {
    if (typeof resumeTarget === 'number' && resumeTarget >= 2) {
      document.getElementById('main-header').style.display = 'flex';
      document.getElementById('main-progress').style.display = 'flex';
    }
    setTimeout(() => {
      goToScreen(resumeTarget);
      // v496 : re-trigger l enveloppement des avatars apres la navigation
      // de resume. Sur F5 depuis screen-1, le timing initial peut faire
      // que les avatars ne sont pas correctement enveloppes/affiches.
      // Idempotent : si deja wraps, ne refait rien.
      if (typeof applyAvatarAccessoriesEverywhere === 'function') {
        requestAnimationFrame(() => applyAvatarAccessoriesEverywhere());
      }
      // v535 : si on resume sur 'creator', il faut explicitement initialiser
      // le picker (sinon le livre reste vide, on voit que Leon).
      if (resumeTarget === 'creator' && typeof openCreatorMode === 'function') {
        // openCreatorMode appelle deja goToScreen('creator') mais c est
        // idempotent. Il enchaine ensuite sur le polling rAF qui declenche
        // initCreatorPick une fois le screen visible.
        openCreatorMode();
      }
    }, 0);
  }

  // Raccourcis développeur : Alt+2 … Alt+8, Alt+M pour la carte
  const _keyHandler = e => {
    // DEBUG : log toutes les combos Alt pour vérifier que le handler reçoit bien l'événement
    if (e.altKey) {
      console.log('[keydown alt]', { code: e.code, key: e.key, alt: e.altKey, ctrl: e.ctrlKey, shift: e.shiftKey });
    }
    // Calibration c3s7 active : sélection micro + nudge avec flèches
    if (window._c3s7CalibActive) {
      if (['1','2','3'].includes(e.key)) {
        e.preventDefault();
        selectC3s7Mic(parseInt(e.key, 10) - 1);
        return;
      }
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
        e.preventDefault();
        const step = e.shiftKey ? 2 : 0.3;       // % par appui (Shift = pas plus gros)
        const stepY = e.shiftKey ? 12 : 2;       // px par appui
        if (e.key === 'ArrowLeft')  nudgeC3s7Mic(-step, 0);
        if (e.key === 'ArrowRight') nudgeC3s7Mic( step, 0);
        if (e.key === 'ArrowUp')    nudgeC3s7Mic(0, -stepY);
        if (e.key === 'ArrowDown')  nudgeC3s7Mic(0,  stepY);
        return;
      }
    }
    // Flèches quand calibration active : nudge la cible (pas besoin d'Alt — évite Alt+arrow = back/forward Firefox)
    // (Ancien systeme de calibration via fleches : desactive — on utilise le drag-drop maintenant)
    if (!e.altKey) return;

    // ============================================================
    // Raccourcis dev PRIORITAIRES (avant la navigation) car ils
    // utilisent des combos qui matcheraient sinon un ecran de chapitre.
    // ============================================================
    // Alt+Shift+I : calibration des 6 hotspots c5s2 (sinon Alt+Shift+I = c4s8)
    if (e.code === 'KeyI' && e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      console.log('[shortcut] Alt+Shift+I → toggleC5s2SpotCalib (screen=' + state.currentScreen + ')');
      if (typeof toggleC5s2SpotCalib === 'function') toggleC5s2SpotCalib();
      return;
    }
    // Alt+Shift+M : calibration des 3 hotspots c2s2 (Alt+M seul = Carte)
    if (e.code === 'KeyM' && e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      console.log('[shortcut] Alt+Shift+M → toggleC2s2SpotCalib (screen=' + state.currentScreen + ')');
      if (typeof toggleC2s2SpotCalib === 'function') toggleC2s2SpotCalib();
      return;
    }

    // ============================================================
    // Raccourcis de navigation par chapitre (PRIORITAIRES sur les
    // raccourcis dev pour éviter les conflits Alt+R/Alt+U etc.) :
    //   Chap 1  : Alt+0..8                     → écrans numériques
    //   Chap 2  : Alt+Shift+1..9               → c2s1..c2s9
    //   Chap 3  : Alt+A,Z,E,R,T,Y,U,I,O        → c3s1..c3s9 (rang du haut AZERTY)
    //   Chap 4  : Alt+Shift+A,Z,E,R,T,Y,U,I    → c4s1..c4s8
    //   Chap 5  : Alt+W,X,C,V,B,N              → c5s1..c5s6 (rang du bas AZERTY,
    //                                            saute M qui est pris par la Carte)
    //   Map     : Alt+M
    //
    // IMPORTANT : e.code reflète la position physique (= layout QWERTY),
    // donc presser A sur AZERTY = e.code 'KeyQ' (top-left letter). Les maps
    // PHYS_*_ROW utilisent les codes physiques, valables partout. On ajoute
    // un fallback e.key pour les claviers exotiques.
    // ============================================================
    const digitMatch = /^(?:Digit|Numpad)([0-9])$/.exec(e.code || '');
    const digit = digitMatch ? digitMatch[1] : null;
    const PHYS_TOP_ROW = {
      KeyQ: 1, KeyW: 2, KeyE: 3, KeyR: 4, KeyT: 5,
      KeyY: 6, KeyU: 7, KeyI: 8, KeyO: 9
    };
    const LOGIC_AZERTY = {
      a: 1, z: 2, e: 3, r: 4, t: 5, y: 6, u: 7, i: 8, o: 9
    };
    // Chap 5 : rang du bas AZERTY (W X C V B N) — KeyM saute pour ne pas
    // entrer en conflit avec Alt+M (Carte). 6 ecrans c5s1..c5s6.
    const PHYS_BOTTOM_ROW = {
      KeyZ: 1, KeyX: 2, KeyC: 3, KeyV: 4, KeyB: 5, KeyN: 6
    };
    const LOGIC_BOTTOM = {
      w: 1, z: 1, x: 2, c: 3, v: 4, b: 5, n: 6
    };
    const letterIdx = PHYS_TOP_ROW[e.code]
                   || LOGIC_AZERTY[(e.key || '').toLowerCase()]
                   || null;
    const bottomIdx = PHYS_BOTTOM_ROW[e.code]
                   || LOGIC_BOTTOM[(e.key || '').toLowerCase()]
                   || null;

    let target;
    if (e.shiftKey && letterIdx && letterIdx <= 8) {
      target = `c4s${letterIdx}`;          // Chap 4 : Alt+Shift+lettre
    } else if (letterIdx) {
      target = `c3s${letterIdx}`;          // Chap 3 : Alt+lettre
    } else if (bottomIdx && bottomIdx <= 6) {
      target = `c5s${bottomIdx}`;          // Chap 5 : Alt+lettre rang du bas
    } else if (e.ctrlKey && e.shiftKey && digit && digit !== '0') {
      target = `c4s${digit}`;              // Chap 4 fallback : Alt+Ctrl+Shift+N
    } else if (e.shiftKey && digit && digit !== '0') {
      target = `c2s${digit}`;              // Chap 2 : Alt+Shift+N
    } else if (e.ctrlKey && digit && digit !== '0') {
      target = `c3s${digit}`;              // Chap 3 fallback : Alt+Ctrl+N
    } else if (digit) {
      const n = parseInt(digit, 10);       // Chap 1 : Alt+0..8
      if (n <= 8) target = n;
    } else if (e.code === 'KeyM') {
      target = 'map';
    }
    if (target !== undefined) {
      e.preventDefault();
      e.stopPropagation();
      console.log('[shortcut]', { code: e.code, key: e.key, alt: e.altKey, ctrl: e.ctrlKey, shift: e.shiftKey, '→ target': target });
      if (!state.characterType) {
        state.characterType  = 'robot';
        state.characterImage = charData.robot.img;
        state.characterName  = 'Pixel';
        saveState();
      }
      const isStoryShortcut = (typeof target === 'number' && target >= 2)
                           || (typeof target === 'string' && /^c\d+s\d+$/.test(target));
      if (isStoryShortcut) {
        document.getElementById('main-header').style.display = 'flex';
        document.getElementById('main-progress').style.display = 'flex';
      }
      // force=true : permet de réappuyer sur le même raccourci pour relancer le karaoké
      goToScreen(target, true);
      return;
    }

    // ============================================================
    // Raccourcis dev (déclenchés seulement si pas de navigation matchée)
    // ============================================================
    // Alt+S : calibration enseigne/porte (flèches pour ajuster)
    if (e.code === 'KeyS') {
      e.preventDefault();
      if (!window._calibActive) { window._calibActive = true;  window._calibMode = 'sign'; }
      else if (window._calibMode === 'sign') { window._calibMode = 'entry'; }
      else { window._calibActive = false; }
      const msg = !window._calibActive ? 'désactivée' : (window._calibMode === 'sign' ? 'ENSEIGNE (flèches)' : 'PORTE (flèches)');
      console.log('Calibration :', msg);
      document.body.classList.toggle('dev-marker', window._calibActive);
      if (typeof updateEntryMarker === 'function') updateEntryMarker();
      return;
    }
    // Alt+D : affiche/masque le marqueur de destination du renard
    if (e.code === 'KeyD') {
      e.preventDefault();
      document.body.classList.toggle('dev-marker');
      if (typeof updateEntryMarker === 'function') updateEntryMarker();
      return;
    }
    // Alt+P / Alt+K : calibration des 3 micros sur c3s7 (cibles rouges, 1/2/3 + flèches)
    // (Alt+K en fallback si Alt+P est intercepte par le navigateur ou une extension)
    if (e.code === 'KeyP' || e.code === 'KeyK' || (e.key || '').toLowerCase() === 'p' || (e.key || '').toLowerCase() === 'k') {
      e.preventDefault();
      console.log('[shortcut] Alt+P/K → toggleC3s7Calib');
      toggleC3s7Calib();
      return;
    }
    // Alt+L : déverrouille tous les chapitres (dev) — déplacé d'Alt+U qui sert à c3s7
    if (e.code === 'KeyL') {
      e.preventDefault();
      state.chaptersCompleted = [1, 2, 3, 4];
      saveState();
      console.log('🔓 Tous les chapitres déverrouillés (dev)');
      if (state.currentScreen === 'map') updateMapState();
      else goToScreen('map');
      return;
    }
    // Alt+J : calibration position du heros sur l'ecran 4 (par perso)
    // (Alt+H est intercepte par Firefox pour le menu Historique)
    if (e.code === 'KeyJ' || e.code === 'KeyH') {
      e.preventDefault();
      console.log('[shortcut] Alt+J → toggleHero4Calib (screen=' + state.currentScreen + ')');
      toggleHero4Calib();
      return;
    }
    // Alt+T : calibration du panneau scene-text (narrateur + Leon) sur l'ecran courant
    if (e.code === 'KeyT') {
      e.preventDefault();
      console.log('[shortcut] Alt+T → toggleSceneTextCalib (screen=' + state.currentScreen + ')');
      toggleSceneTextCalib();
      return;
    }
    // Alt+F / Alt+Shift+F : calibration des 6 hotspots c2s5 (drag les cercles rouges)
    // Note Firefox : Alt+F est intercepte pour le menu Fichier. Si ca ne
    // declenche rien, utilise Alt+Shift+F qui passe a travers.
    if (e.code === 'KeyF') {
      e.preventDefault();
      console.log('[shortcut] Alt+F/Alt+Shift+F → toggleC2s5DefectCalib (screen=' + state.currentScreen + ')');
      if (typeof toggleC2s5DefectCalib === 'function') toggleC2s5DefectCalib();
      return;
    }
    // Alt+Shift+I : calibration des 6 hotspots c5s2 (drag IA + distracteurs)
    // (Alt+I sans shift est intercepte par chap 3 c3s8 — donc on force le shift)
    if (e.code === 'KeyI' && e.shiftKey) {
      e.preventDefault();
      console.log('[shortcut] Alt+Shift+I → toggleC5s2SpotCalib (screen=' + state.currentScreen + ')');
      if (typeof toggleC5s2SpotCalib === 'function') toggleC5s2SpotCalib();
      return;
    }
    // Alt+G : "Give me stars" — 999 etoiles + RESET des achats (dev/test)
    // Permet de tester le flux d'achat normal en boutique avec plein d'etoiles.
    if (e.code === 'KeyG') {
      e.preventDefault();
      _ensureAtelierState();
      state.totalStars = 999;
      state.purchases = [];                 // reset : on peut re-acheter
      state.equippedAccessories = { hat: null, glasses: null, cape: null };
      saveState();
      console.log('⭐ 999 etoiles. Achats remis a zero — va dans la boutique pour tester l\'achat.');
      if (typeof updateStarBadge === 'function') updateStarBadge();
      if (typeof refreshAtelierUI === 'function') refreshAtelierUI();
      // Rafraichit aussi les avatars (enleve les accessoires equipes precedents)
      if (typeof applyAvatarAccessoriesEverywhere === 'function') applyAvatarAccessoriesEverywhere();
      return;
    }
  };
  window.addEventListener  ('keydown', _keyHandler, true);
  document.addEventListener('keydown', _keyHandler, true);

  console.log("IA : Le monde de Léon — raccourcis : Chap1=Alt+0..8 | Chap2=Alt+Shift+1..9 | Chap3=Alt+A/Z/E/R/T/Y/U/I/O | Chap4=Alt+Shift+A/Z/E/R/T/Y/U/I | Chap5=Alt+W/X/C/V/B/N | Carte=Alt+M");

  // Plein écran : on tente sur CHAQUE geste utilisateur tant qu'on n'est pas
  // déjà en plein écran. Ça permet de récupérer si le premier clic n'a pas
  // déclenché (clic refusé par certains navigateurs, popup permission etc).
  // Une fois en plein écran, le listener s'auto-retire pour ne plus interférer.
  // IMPORTANT : on skip si la cible est le bouton plein écran lui-même
  // (sinon autoFs s'exécute en capture phase AVANT le click du bouton et
  // consomme le gesture utilisateur -> le bouton ne fonctionne plus sur
  // Chrome desktop).
  const autoFs = (ev) => {
    if (_fsElement()) {
      window.removeEventListener('pointerdown', autoFs, true);
      window.removeEventListener('touchend',    autoFs, true);
      window.removeEventListener('keydown',     autoFs, true);
      return;
    }
    // Skip si l'utilisateur clique sur le bouton plein ecran -> on laisse
    // toggleFullscreen() gerer l'appel proprement avec userGesture: true.
    const t = ev && ev.target;
    if (t && (t.id === 'btn-fullscreen' || (t.closest && t.closest('#btn-fullscreen')))) {
      return;
    }
    enterFullscreen();
  };
  window.addEventListener('pointerdown', autoFs, true);
  window.addEventListener('touchend',    autoFs, true);
  window.addEventListener('keydown',     autoFs, true);
});

// Character Selection — fallback iOS Safari : bind explicite via addEventListener.
// Sur iOS, onclick sur <div> peut etre ignore selon le contexte de focus / fullscreen.
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.character-card[data-char]').forEach(card => {
    const type = card.getAttribute('data-char');
    if (!type) return;
    const handler = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      try { selectChar(type); } catch(e) { console.error('selectChar fail', e); }
    };
    card.addEventListener('click', handler, false);
    card.addEventListener('touchend', handler, { passive: false });
  });
});

function selectChar(type) {
  state.characterType = type;
  state.characterImage = charData[type].img;
  document.body.classList.add('has-character'); // pour afficher la pastille globale
  // Coche le radio correspondant pour le feedback visuel (border/checked CSS)
  try {
    const radios = document.querySelectorAll('input[name="char"]');
    radios.forEach(r => { r.checked = (r.value === type); });
  } catch(e) {}

  const InputWrap = document.getElementById('name-input-wrap');
  const StartBtn = document.getElementById('btn-start');
  const NameInput = document.getElementById('char-name-input');

  InputWrap.classList.add('visible');

  if (charData[type].name) {
    NameInput.placeholder = `ex: ${charData[type].name}`;
    NameInput.value = charData[type].name;
    state.characterName = charData[type].name;
    StartBtn.disabled = false;
  } else {
    NameInput.placeholder = "Écris ici...";
    NameInput.value = "";
    state.characterName = "";
    StartBtn.disabled = true;
  }
  saveState();
}

// Update Name when typing
function updateName() {
  const val = document.getElementById('char-name-input').value.trim();
  state.characterName = val;
  document.getElementById('btn-start').disabled = val.length === 0;
  saveState();
}

// ============================================================
// PREMIUM — acces au contenu payant (chapitres 2-5 + Livre magique)
// ============================================================
// Source de verite : localStorage 'ia_premium' === '1' (persiste a la
// fermeture de l'onglet). La monnaie de creation d'histoires s'appellera
// "plumes" (a venir, phase paiement).
//
// >>> POUR DEVELOPPER / TESTER : tout debloquer facilement <<<
//   - tape  unlockPremium()  dans la console du navigateur, OU
//   - ouvre l'app avec  ?premium=1  dans l'URL
//   - tape  lockPremium()  pour re-verrouiller et revoir les cadenas.
// ============================================================
// Prix de l'achat unique (debloque tout le contenu Premium, a vie).
const PREMIUM_PRICE = '4,99 €';

function isPremium() {
  try {
    if (new URLSearchParams(location.search).get('premium') === '1') return true;
    return localStorage.getItem('ia_premium') === '1';
  } catch (e) { return false; }
}

// Applique (ou retire) le statut Premium : persistance + state + rafraichit l'UI.
function _setPremiumFlag(on) {
  try {
    if (on) localStorage.setItem('ia_premium', '1');
    else    localStorage.removeItem('ia_premium');
  } catch (e) {}
  state.isPremium = !!on;
  try { if (typeof updateMapState === 'function') updateMapState(); } catch (e) {}
}

function unlockPremium() {
  _setPremiumFlag(true);
  console.log('%c[premium] DÉBLOQUÉ — chapitres 2-5 + Livre magique accessibles.', 'color:#2e8b57;font-weight:bold');
}

function lockPremium() {
  _setPremiumFlag(false);
  console.log('%c[premium] VERROUILLÉ — contenu payant re-bloqué.', 'color:#b22222;font-weight:bold');
}

// Achat unique du Premium (user-facing, depuis le paywall).
// ============================================================
// ⚠️ MVP : PAIEMENT SIMULÉ — il n'y a PAS encore de backend de paiement.
// Cliquer "Débloquer" debloque immediatement, SANS encaisser.
// >>> TODO PAIEMENT : remplacer le corps par un Stripe Checkout :
//     - rediriger vers la session Checkout / ouvrir le widget,
//     - n'appeler _setPremiumFlag(true) + showPremiumSuccess() qu'au retour
//       "payment succeeded" (webhook ou redirect success_url).
//   NE PAS publier l'app au grand public tant que ce TODO n'est pas fait,
//   sinon le contenu payant est donne gratuitement.
// ============================================================
function purchasePremium() {
  _setPremiumFlag(true);
  document.getElementById('premium-paywall')?.remove();
  showPremiumSuccess();
}

// Petit ecran de confirmation apres achat.
function showPremiumSuccess() {
  document.getElementById('premium-success')?.remove();
  const ov = document.createElement('div');
  ov.id = 'premium-success';
  ov.setAttribute('style',
    'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;' +
    'justify-content:center;background:rgba(20,10,35,0.82);' +
    'backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);padding:5vw;');
  ov.innerHTML =
    '<div style="max-width:420px;width:100%;background:linear-gradient(160deg,#fff8ee,#ffe9c7);' +
    'border:3px solid #e0a23a;border-radius:22px;padding:28px 24px;text-align:center;' +
    'box-shadow:0 20px 60px rgba(0,0,0,.5);font-family:inherit;color:#4a2f12;">' +
      '<div style="font-size:50px;line-height:1;margin-bottom:8px;">🎉</div>' +
      '<h2 style="margin:0 0 8px;font-size:1.3rem;color:#7a4a10;">C\'est débloqué !</h2>' +
      '<p style="margin:0 0 20px;font-size:.97rem;line-height:1.45;opacity:.9;">' +
        'Toute l\'aventure de Léon est à toi : les <b>chapitres 2 à 5</b> et le ' +
        '<b>Livre magique</b>. Bon voyage&nbsp;! ✨</p>' +
      '<button id="premium-success-close" style="cursor:pointer;border:none;' +
      'background:linear-gradient(160deg,#7ec850,#4ca22f);color:#fff;font-weight:800;' +
      'font-size:1rem;padding:12px 30px;border-radius:14px;box-shadow:0 4px 14px rgba(76,162,47,.5);">' +
      'C\'est parti ! 🚀</button>' +
    '</div>';
  ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
  document.body.appendChild(ov);
  document.getElementById('premium-success-close')?.addEventListener('click', () => ov.remove());
}

// Expose pour la console / le HTML
window.unlockPremium = unlockPremium;
window.lockPremium = lockPremium;
window.purchasePremium = purchasePremium;

// ============================================================
// ÉDITION ÉCOLE — déverrouillage par CODE DE LICENCE
// ============================================================
// En édition école, l'établissement a payé une licence : tout est débloqué
// et le COMMERCE est masqué (les enfants n'achètent rien, ni Premium ni plumes ;
// les plumes deviennent un quota géré par l'enseignant).
// localStorage 'ia_edition' === 'school'.
//
// ⚠️ MVP : validation du code EN LOCAL (liste + motif). En production, le code
// sera vérifié CÔTÉ SERVEUR (collection Firestore 'licenses') — sinon il suffit
// de lire le code pour tricher. >>> TODO BACKEND : validation serveur.
// DEV : activateSchoolLicense('ECOLE-DEMO') / deactivateSchoolLicense() en console.
// ============================================================
const SCHOOL_DEMO_CODES = ['ECOLE-DEMO', 'PROF-LEON', 'CLASSE-2026'];

function isSchoolEdition() {
  try { return localStorage.getItem('ia_edition') === 'school'; } catch (e) { return false; }
}

function _validateLicenseLocal(code) {
  const c = (code || '').trim().toUpperCase();
  if (!c) return false;
  if (SCHOOL_DEMO_CODES.includes(c)) return true;
  // Motif large pour les pilotes : ECOLE-XXXX (4+ alphanum)
  return /^ECOLE-[A-Z0-9]{4,}$/.test(c);
}

function activateSchoolLicense(code) {
  if (!_validateLicenseLocal(code)) return false;
  try {
    localStorage.setItem('ia_edition', 'school');
    localStorage.setItem('ia_license_code', (code || '').trim().toUpperCase());
  } catch (e) {}
  _setPremiumFlag(true);              // débloque tout le contenu
  document.getElementById('premium-paywall')?.remove();
  document.getElementById('school-code-prompt')?.remove();
  showSchoolWelcome();
  console.log('%c[ecole] Licence activée — édition école, commerce masqué.', 'color:#2e8b57;font-weight:bold');
  return true;
}

function deactivateSchoolLicense() {
  try { localStorage.removeItem('ia_edition'); localStorage.removeItem('ia_license_code'); } catch (e) {}
  _setPremiumFlag(false);
  console.log('%c[ecole] Édition école désactivée.', 'color:#b22222;font-weight:bold');
}
window.activateSchoolLicense = activateSchoolLicense;
window.deactivateSchoolLicense = deactivateSchoolLicense;
window.isSchoolEdition = isSchoolEdition;

// Saisie du code école (depuis le paywall)
function showSchoolCodePrompt() {
  document.getElementById('school-code-prompt')?.remove();
  const ov = document.createElement('div');
  ov.id = 'school-code-prompt';
  ov.setAttribute('style',
    'position:fixed;inset:0;z-index:100000;display:flex;align-items:center;' +
    'justify-content:center;background:rgba(20,10,35,0.85);' +
    'backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);padding:5vw;');
  ov.innerHTML =
    '<div style="max-width:400px;width:100%;background:linear-gradient(160deg,#fff8ee,#ffe9c7);' +
    'border:3px solid #e0a23a;border-radius:22px;padding:26px 24px;text-align:center;' +
    'box-shadow:0 20px 60px rgba(0,0,0,.5);font-family:inherit;color:#4a2f12;">' +
      '<div style="font-size:42px;line-height:1;margin-bottom:6px;">🏫</div>' +
      '<h2 style="margin:0 0 6px;font-size:1.2rem;color:#7a4a10;">Code école</h2>' +
      '<p style="margin:0 0 14px;font-size:.9rem;opacity:.85;">Entre le code fourni à ' +
      'ton établissement pour tout débloquer.</p>' +
      '<input id="school-code-input" type="text" placeholder="ECOLE-XXXX" ' +
      'style="width:100%;box-sizing:border-box;border:2px solid #e0a23a;border-radius:12px;' +
      'padding:11px 14px;font-family:inherit;font-size:1.05rem;text-align:center;' +
      'text-transform:uppercase;color:#4a2f12;margin-bottom:6px;">' +
      '<div id="school-code-err" style="color:#b22222;font-size:.8rem;min-height:1em;margin-bottom:8px;"></div>' +
      '<button id="school-code-ok" style="cursor:pointer;border:none;width:100%;' +
      'background:linear-gradient(160deg,#7ec850,#4ca22f);color:#fff;font-weight:800;' +
      'font-size:1rem;padding:12px;border-radius:14px;box-shadow:0 4px 14px rgba(76,162,47,.45);">' +
      'Activer 🏫</button>' +
      '<button id="school-code-cancel" style="margin-top:12px;cursor:pointer;border:none;' +
      'background:none;color:#7a4a10;font-size:.85rem;text-decoration:underline;opacity:.7;">Annuler</button>' +
    '</div>';
  ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
  document.body.appendChild(ov);
  const input = document.getElementById('school-code-input');
  const tryActivate = () => {
    if (!activateSchoolLicense(input.value)) {
      document.getElementById('school-code-err').textContent = 'Code invalide. Vérifie auprès de ton établissement.';
    }
  };
  document.getElementById('school-code-ok').addEventListener('click', tryActivate);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryActivate(); });
  document.getElementById('school-code-cancel').addEventListener('click', () => ov.remove());
  setTimeout(() => input.focus(), 50);
}
window.showSchoolCodePrompt = showSchoolCodePrompt;

// v653 : info pour les chapitres non encore atteints (progress lock). Permet
// aux enseignants en demo d'acceder via Code ecole sans avoir a tout refaire.
function showProgressLockInfo(chap) {
  document.getElementById('progress-lock-info')?.remove();
  const ov = document.createElement('div');
  ov.id = 'progress-lock-info';
  ov.setAttribute('style',
    'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;' +
    'justify-content:center;background:rgba(20,10,35,0.82);' +
    'backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);padding:5vw;');
  const prev = (chap || 2) - 1;
  ov.innerHTML =
    '<div style="max-width:420px;width:100%;background:linear-gradient(160deg,#fff8ee,#ffe9c7);' +
    'border:3px solid #b89868;border-radius:22px;padding:26px 24px;text-align:center;' +
    'box-shadow:0 20px 60px rgba(0,0,0,.5);font-family:inherit;color:#4a2f12;">' +
      '<div style="font-size:46px;line-height:1;margin-bottom:8px;">🔒</div>' +
      '<h2 style="margin:0 0 8px;font-size:1.2rem;color:#7a4a10;">Chapitre ' + chap + ' verrouillé</h2>' +
      '<p style="margin:0 0 18px;font-size:.95rem;line-height:1.5;opacity:.9;">' +
        'Pour découvrir ce chapitre, termine d\'abord le <b>chapitre ' + prev + '</b>. ' +
        'L\'aventure est conçue pour être suivie dans l\'ordre.</p>' +
      '<button id="progress-lock-school" style="cursor:pointer;border:none;width:100%;' +
      'background:linear-gradient(160deg,#7ec850,#4ca22f);color:#fff;font-weight:800;' +
      'font-size:.95rem;padding:11px 20px;border-radius:14px;box-shadow:0 4px 14px rgba(76,162,47,.35);">' +
      'Vous êtes enseignant ? Code école 🏫</button>' +
      '<button id="progress-lock-close" style="margin-top:12px;cursor:pointer;border:none;' +
      'background:none;color:#7a4a10;font-size:.85rem;text-decoration:underline;opacity:.7;">' +
      'Fermer</button>' +
    '</div>';
  ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
  document.body.appendChild(ov);
  document.getElementById('progress-lock-school')?.addEventListener('click', () => {
    ov.remove();
    showSchoolCodePrompt();
  });
  document.getElementById('progress-lock-close')?.addEventListener('click', () => ov.remove());
}
window.showProgressLockInfo = showProgressLockInfo;

function showSchoolWelcome() {
  document.getElementById('school-welcome')?.remove();
  const ov = document.createElement('div');
  ov.id = 'school-welcome';
  ov.setAttribute('style',
    'position:fixed;inset:0;z-index:100000;display:flex;align-items:center;' +
    'justify-content:center;background:rgba(20,10,35,0.85);' +
    'backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);padding:5vw;');
  ov.innerHTML =
    '<div style="max-width:400px;width:100%;background:linear-gradient(160deg,#fff8ee,#ffe9c7);' +
    'border:3px solid #e0a23a;border-radius:22px;padding:28px 24px;text-align:center;' +
    'box-shadow:0 20px 60px rgba(0,0,0,.5);font-family:inherit;color:#4a2f12;">' +
      '<div style="font-size:48px;line-height:1;margin-bottom:8px;">🏫✨</div>' +
      '<h2 style="margin:0 0 8px;font-size:1.25rem;color:#7a4a10;">Édition école activée !</h2>' +
      '<p style="margin:0 0 18px;font-size:.95rem;opacity:.9;">Toute l\'aventure de Léon ' +
      'est débloquée pour ta classe : les 5 chapitres et le Livre magique.</p>' +
      '<button id="school-welcome-close" style="cursor:pointer;border:none;' +
      'background:linear-gradient(160deg,#7ec850,#4ca22f);color:#fff;font-weight:800;' +
      'font-size:1rem;padding:12px 30px;border-radius:14px;box-shadow:0 4px 14px rgba(76,162,47,.5);">' +
      'En classe ! 🚀</button>' +
    '</div>';
  ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
  document.body.appendChild(ov);
  document.getElementById('school-welcome-close')?.addEventListener('click', () => ov.remove());
}

// ============================================================
// PLUMES 🪶 — monnaie consommable pour la creation d'histoires custom
// ============================================================
// 1 plume = 1 histoire personnalisee (fonctionnalite de generation a venir).
// Source de verite : localStorage 'ia_plumes' (solde persiste, comme un achat).
// Packs vendus a l'unite (pas d'abonnement). Paiement SIMULE pour l'instant.
//
// >>> DEV / TEST : addPlumes(10), setPlumes(0), openPlumesShop() en console.
// ============================================================
const PLUMES_PACKS = [
  { id: 'decouverte', plumes: 5,  price: '2,99 €',  label: 'Découverte' },
  { id: 'famille',    plumes: 25, price: '9,99 €',  label: 'Famille', best: true },
  { id: 'conteur',    plumes: 60, price: '19,99 €', label: 'Conteur' },
];
const PLUMES_FREE_GIFT = 3;   // plumes offertes a la toute premiere ouverture

function getPlumes() {
  try { return parseInt(localStorage.getItem('ia_plumes') || '0', 10) || 0; }
  catch (e) { return 0; }
}

function setPlumes(n) {
  n = Math.max(0, n | 0);
  try { localStorage.setItem('ia_plumes', String(n)); } catch (e) {}
  state.plumes = n;
  try { updatePlumesUI(); } catch (e) {}
  return n;
}

function addPlumes(n)   { return setPlumes(getPlumes() + (n | 0)); }
function spendPlumes(n) {                       // renvoie true si solde suffisant
  n = n | 0;
  if (getPlumes() < n) return false;
  setPlumes(getPlumes() - n);
  return true;
}

// Cadeau de bienvenue : quelques plumes offertes une seule fois.
function grantInitialPlumes() {
  try {
    if (localStorage.getItem('ia_plumes_init') !== '1') {
      localStorage.setItem('ia_plumes_init', '1');
      addPlumes(PLUMES_FREE_GIFT);
    }
  } catch (e) {}
}

// Met a jour tout afficheur de solde present dans le DOM (id ou classe).
function updatePlumesUI() {
  const n = getPlumes();
  document.querySelectorAll('[data-plumes-balance]').forEach(el => { el.textContent = n; });
}

// Achat d'un pack de plumes (depuis la boutique).
// ⚠️ MVP : PAIEMENT SIMULÉ — voir le meme TODO Stripe que purchasePremium().
function purchasePlumes(packId) {
  const pack = PLUMES_PACKS.find(p => p.id === packId);
  if (!pack) return;
  // TODO PAIEMENT : Stripe Checkout, puis addPlumes au retour "paid" seulement.
  addPlumes(pack.plumes);
  document.getElementById('plumes-shop')?.remove();
  showPlumesSuccess(pack.plumes);
}

// Boutique de plumes : overlay leger injecte dynamiquement.
function showPlumesShop() {
  // Édition école : pas d'achat. Les plumes sont un quota géré par l'enseignant.
  if (isSchoolEdition()) { showSchoolPlumesInfo(); return; }
  document.getElementById('plumes-shop')?.remove();
  const solde = getPlumes();
  const cards = PLUMES_PACKS.map(p =>
    '<button data-plumes-pack="' + p.id + '" style="position:relative;cursor:pointer;' +
    'border:2px solid ' + (p.best ? '#f57c00' : '#e0a23a') + ';border-radius:16px;' +
    'background:' + (p.best ? 'linear-gradient(160deg,#fff3df,#ffe2b3)' : '#fffaf0') + ';' +
    'padding:14px 10px;text-align:center;font-family:inherit;color:#4a2f12;flex:1;min-width:96px;">' +
      (p.best ? '<div style="position:absolute;top:-11px;left:50%;transform:translateX(-50%);' +
        'background:#f57c00;color:#fff;font-size:.62rem;font-weight:800;padding:2px 8px;' +
        'border-radius:8px;white-space:nowrap;">LE + POPULAIRE</div>' : '') +
      '<div style="font-size:1.5rem;font-weight:800;">' + p.plumes + ' 🪶</div>' +
      '<div style="font-size:.8rem;opacity:.7;margin:2px 0 8px;">' + p.label + '</div>' +
      '<div style="background:#f57c00;color:#fff;font-weight:800;font-size:.9rem;' +
      'padding:7px 4px;border-radius:10px;">' + p.price + '</div>' +
    '</button>'
  ).join('');
  const ov = document.createElement('div');
  ov.id = 'plumes-shop';
  ov.setAttribute('style',
    'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;' +
    'justify-content:center;background:rgba(20,10,35,0.82);' +
    'backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);padding:5vw;');
  ov.innerHTML =
    '<div style="max-width:460px;width:100%;background:linear-gradient(160deg,#fff8ee,#ffe9c7);' +
    'border:3px solid #e0a23a;border-radius:22px;padding:24px 22px;text-align:center;' +
    'box-shadow:0 20px 60px rgba(0,0,0,.5);font-family:inherit;color:#4a2f12;">' +
      '<div style="font-size:44px;line-height:1;margin-bottom:4px;">🪶</div>' +
      '<h2 style="margin:0 0 4px;font-size:1.3rem;color:#7a4a10;">Les plumes de Léon</h2>' +
      '<p style="margin:0 0 4px;font-size:.92rem;line-height:1.4;opacity:.9;">' +
        'Chaque plume permet de créer <b>une histoire personnalisée</b>.</p>' +
      '<p style="margin:0 0 16px;font-weight:700;font-size:.95rem;">' +
        'Tu as <span data-plumes-balance>' + solde + '</span> 🪶</p>' +
      '<div style="display:flex;gap:10px;justify-content:center;margin-bottom:16px;">' + cards + '</div>' +
      '<button id="plumes-shop-close" style="cursor:pointer;border:none;background:none;' +
      'color:#7a4a10;font-size:.85rem;text-decoration:underline;opacity:.7;">Fermer</button>' +
      '<div style="margin-top:10px;font-size:.74rem;opacity:.55;">Paiement à l\'unité · sans abonnement</div>' +
    '</div>';
  ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
  document.body.appendChild(ov);
  ov.querySelectorAll('[data-plumes-pack]').forEach(btn =>
    btn.addEventListener('click', () => purchasePlumes(btn.getAttribute('data-plumes-pack'))));
  document.getElementById('plumes-shop-close')?.addEventListener('click', () => ov.remove());
}

function showPlumesSuccess(n) {
  document.getElementById('plumes-success')?.remove();
  const ov = document.createElement('div');
  ov.id = 'plumes-success';
  ov.setAttribute('style',
    'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;' +
    'justify-content:center;background:rgba(20,10,35,0.82);' +
    'backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);padding:5vw;');
  ov.innerHTML =
    '<div style="max-width:400px;width:100%;background:linear-gradient(160deg,#fff8ee,#ffe9c7);' +
    'border:3px solid #e0a23a;border-radius:22px;padding:26px 24px;text-align:center;' +
    'box-shadow:0 20px 60px rgba(0,0,0,.5);font-family:inherit;color:#4a2f12;">' +
      '<div style="font-size:48px;line-height:1;margin-bottom:6px;">🪶✨</div>' +
      '<h2 style="margin:0 0 8px;font-size:1.25rem;color:#7a4a10;">+' + n + ' plumes !</h2>' +
      '<p style="margin:0 0 18px;font-size:.95rem;opacity:.9;">Tu as maintenant ' +
        '<b><span data-plumes-balance>' + getPlumes() + '</span> 🪶</b> pour créer tes histoires.</p>' +
      '<button id="plumes-success-close" style="cursor:pointer;border:none;' +
      'background:linear-gradient(160deg,#7ec850,#4ca22f);color:#fff;font-weight:800;' +
      'font-size:1rem;padding:12px 30px;border-radius:14px;box-shadow:0 4px 14px rgba(76,162,47,.5);">' +
      'Super ! 🎉</button>' +
    '</div>';
  ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
  document.body.appendChild(ov);
  document.getElementById('plumes-success-close')?.addEventListener('click', () => ov.remove());
}

// Édition école : info quota (pas d'achat) au lieu de la boutique.
function showSchoolPlumesInfo() {
  document.getElementById('plumes-shop')?.remove();
  const solde = getPlumes();
  const ov = document.createElement('div');
  ov.id = 'plumes-shop';
  ov.setAttribute('style',
    'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;' +
    'justify-content:center;background:rgba(20,10,35,0.82);' +
    'backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);padding:5vw;');
  ov.innerHTML =
    '<div style="max-width:420px;width:100%;background:linear-gradient(160deg,#fff8ee,#ffe9c7);' +
    'border:3px solid #e0a23a;border-radius:22px;padding:26px 24px;text-align:center;' +
    'box-shadow:0 20px 60px rgba(0,0,0,.5);font-family:inherit;color:#4a2f12;">' +
      '<div style="font-size:44px;line-height:1;margin-bottom:6px;">🪶🏫</div>' +
      '<h2 style="margin:0 0 6px;font-size:1.25rem;color:#7a4a10;">Tes plumes de classe</h2>' +
      '<p style="margin:0 0 8px;font-weight:700;">Il te reste <span data-plumes-balance>' + solde + '</span> 🪶</p>' +
      '<p style="margin:0 0 18px;font-size:.92rem;line-height:1.4;opacity:.85;">' +
        'Dans l\'édition école, les plumes sont fournies par ton enseignant. ' +
        'Chaque plume permet de créer une histoire personnalisée.</p>' +
      '<button id="plumes-shop-close" style="cursor:pointer;border:none;' +
      'background:linear-gradient(160deg,#ffb74d,#f57c00);color:#fff;font-weight:800;' +
      'font-size:1rem;padding:11px 26px;border-radius:14px;">D\'accord</button>' +
    '</div>';
  ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
  document.body.appendChild(ov);
  document.getElementById('plumes-shop-close')?.addEventListener('click', () => ov.remove());
}

// Expose pour la console / le HTML
window.getPlumes = getPlumes;
window.addPlumes = addPlumes;
window.setPlumes = setPlumes;
window.spendPlumes = spendPlumes;
window.openPlumesShop = showPlumesShop;
window.showSchoolPlumesInfo = showSchoolPlumesInfo;

// ============================================================
// CRÉE TON HÉROS — builder visuel guidé (front)
// ============================================================
// Collecte les choix de l'enfant (memes cles que generate_custom_hero.py) :
//   type / hair / hair_color / outfit / outfit_color / accessory / name / keyword
// La generation reelle (portrait Gemini) se fera via la Cloud Function ;
// pour l'instant le bouton final appelle un PLACEHOLDER.
// ============================================================
const HB_OPTS = {
  type: [
    { v: 'fille',  label: 'Fille',  emoji: '👧' },
    { v: 'garcon', label: 'Garçon', emoji: '👦' },
    { v: 'animal', label: 'Animal', emoji: '🦊' },
    { v: 'robot',  label: 'Robot',  emoji: '🤖' },
  ],
  hair: [
    { v: 'court',    label: 'Courts',   emoji: '💇' },
    { v: 'long',     label: 'Longs',    emoji: '👩' },
    { v: 'boucle',   label: 'Bouclés',  emoji: '🦱' },
    { v: 'couettes', label: 'Couettes', emoji: '👧' },
    { v: 'queue',    label: 'Queue',    emoji: '🎀' },
    { v: 'tresse',   label: 'Tresse',   emoji: '🧒' },
    { v: 'chauve',   label: 'Aucun',    emoji: '🥚' },
  ],
  outfit: [
    { v: 'cape',        label: 'Cape',        emoji: '🦸' },
    { v: 'robe',        label: 'Robe',        emoji: '👗' },
    { v: 'salopette',   label: 'Salopette',   emoji: '👖' },
    { v: 'pull',        label: 'Pull',        emoji: '🧶' },
    { v: 'combinaison', label: 'Combinaison', emoji: '🧑‍🚀' },
    { v: 'tshirt',      label: 'T-shirt',     emoji: '👕' },
    { v: 'armure',      label: 'Armure',      emoji: '🛡️' },
  ],
  accessory: [
    { v: 'chapeau',   label: 'Chapeau',  emoji: '🎩' },
    { v: 'couronne',  label: 'Couronne', emoji: '👑' },
    { v: 'lunettes',  label: 'Lunettes', emoji: '👓' },
    { v: 'echarpe',   label: 'Écharpe',  emoji: '🧣' },
    { v: 'sac',       label: 'Sac à dos',emoji: '🎒' },
    { v: 'casquette', label: 'Casquette',emoji: '🧢' },
    { v: 'noeud',     label: 'Nœud',     emoji: '🎀' },
    { v: 'aucun',     label: 'Aucun',    emoji: '🚫' },
  ],
  colors: [
    { v: 'brun', hex: '#6b4423' },   { v: 'blond', hex: '#e6c34a' },
    { v: 'roux', hex: '#c1440e' },   { v: 'noir', hex: '#2b2b2b' },
    { v: 'rose', hex: '#ff5fa2' },   { v: 'bleu', hex: '#3aa0ff' },
    { v: 'violet', hex: '#9b5de5' }, { v: 'vert', hex: '#3fbf6f' },
    { v: 'rouge', hex: '#e23b3b' },  { v: 'orange', hex: '#ff8c33' },
    { v: 'blanc', hex: '#f4f4f4' },
    { v: 'turquoise', hex: '#2ec4b6' },
    { v: 'arc-en-ciel', hex: 'linear-gradient(90deg,#ff5f5f,#ffd23f,#3fbf6f,#3aa0ff,#9b5de5)' },
  ],
};

let hbState = {
  step: 0, type: 'fille', hair: 'court', hair_color: 'brun',
  outfit: 'tshirt', outfit_color: 'bleu', accessory: 'aucun',
  name: '', keyword: '',
};

// Liste des etapes selon le type (animal/robot sautent les cheveux)
function hbSteps() {
  const s = ['type'];
  if (hbState.type === 'fille' || hbState.type === 'garcon') {
    s.push('hair');
    if (hbState.hair !== 'chauve') s.push('hair_color');
  }
  s.push('outfit', 'outfit_color', 'accessory', 'name', 'recap');
  return s;
}

function openHeroBuilder() {
  // Premium : la creation fait partie du contenu payant.
  if (!isPremium()) { showPremiumPaywall('book'); goToScreen('map'); return; }
  hbState.step = 0;
  goToScreen('hero-builder');
  updatePlumesUI();
  hbRender();
}
window.openHeroBuilder = openHeroBuilder;

function hbPick(field, value) {
  hbState[field] = value;
  hbRender();
}
window.hbPick = hbPick;

function hbNext() {
  const steps = hbSteps();
  if (hbState.step < steps.length - 1) { hbState.step++; hbRender(); }
}
function hbPrev() {
  if (hbState.step > 0) { hbState.step--; hbRender(); }
}
window.hbNext = hbNext;
window.hbPrev = hbPrev;

function _hbGrid(field) {
  return '<div class="hb-grid hb-grid-icons">' + HB_OPTS[field].map(o =>
    '<button type="button" class="hb-opt' + (hbState[field] === o.v ? ' selected' : '') +
    '" onclick="hbPick(\'' + field + '\',\'' + o.v + '\')">' +
    // Illustration watercolor ; repli sur l'emoji si l'icone n'est pas (encore) generee
    '<img class="hb-opt-img" src="assets/ui/builder/' + field + '_' + o.v + '.jpg?v=614" alt="" loading="lazy" ' +
    'onerror="this.style.display=\'none\'; var e=this.nextElementSibling; if(e) e.style.display=\'inline-block\';">' +
    '<span class="hb-opt-emoji" style="display:none">' + o.emoji + '</span>' +
    '<span class="hb-opt-label">' + o.label + '</span></button>'
  ).join('') + '</div>';
}

function _hbColors(field) {
  return '<div class="hb-grid">' + HB_OPTS.colors.map(c =>
    '<button type="button" class="hb-opt hb-swatch' + (hbState[field] === c.v ? ' selected' : '') +
    '" title="' + c.v + '" style="background:' + c.hex + '" ' +
    'onclick="hbPick(\'' + field + '\',\'' + c.v + '\')"></button>'
  ).join('') + '</div>';
}

function hbRender() {
  const steps = hbSteps();
  if (hbState.step >= steps.length) hbState.step = steps.length - 1;
  const cur = steps[hbState.step];
  const stage = document.getElementById('hb-stage');
  const prog = document.getElementById('hb-progress');
  const prevBtn = document.getElementById('hb-prev');
  const nextBtn = document.getElementById('hb-next');
  if (!stage) return;

  // Barre de progression
  prog.innerHTML = steps.map((_, i) =>
    '<span class="hb-dot' + (i === hbState.step ? ' current' : (i < hbState.step ? ' done' : '')) + '"></span>'
  ).join('');

  let html = '';
  switch (cur) {
    case 'type':
      html = '<h2 class="hb-step-title">Qui est ton héros ?</h2>' + _hbGrid('type');
      break;
    case 'hair':
      html = '<h2 class="hb-step-title">Ses cheveux ?</h2>' + _hbGrid('hair');
      break;
    case 'hair_color':
      html = '<h2 class="hb-step-title">Couleur des cheveux ?</h2>' + _hbColors('hair_color');
      break;
    case 'outfit':
      html = '<h2 class="hb-step-title">Sa tenue ?</h2>' + _hbGrid('outfit');
      break;
    case 'outfit_color':
      html = '<h2 class="hb-step-title">Couleur de la tenue ?</h2>' + _hbColors('outfit_color');
      break;
    case 'accessory':
      html = '<h2 class="hb-step-title">Un accessoire ?</h2>' + _hbGrid('accessory');
      break;
    case 'name':
      html = '<h2 class="hb-step-title">Son petit nom ?</h2>' +
        '<div class="hb-field"><label>Prénom du héros</label>' +
        '<input id="hb-name" type="text" maxlength="20" placeholder="ex : Zoé" ' +
        'value="' + (hbState.name || '').replace(/"/g, '&quot;') + '" oninput="hbState.name=this.value; hbUpdateNav();"></div>' +
        '<div class="hb-field"><label>Une idée en plus ? (facultatif)</label>' +
        '<textarea id="hb-keyword" rows="2" maxlength="120" class="hb-textarea" ' +
        'placeholder="ex : avec une petite licorne de compagnie ; ou : une exploratrice des étoiles" ' +
        'oninput="hbState.keyword=this.value;">' + (hbState.keyword || '').replace(/</g, '&lt;') + '</textarea>' +
        '<span class="hb-field-hint">Un détail, un thème ou un compagnon (le héros reste celui choisi plus haut)</span></div>';
      break;
    case 'recap':
      html = _hbRecapHtml();
      break;
  }
  stage.innerHTML = html;

  // Navigation
  prevBtn.hidden = (hbState.step === 0);
  if (cur === 'recap') {
    nextBtn.style.display = 'none';
  } else {
    nextBtn.style.display = '';
  }
  hbUpdateNav();
}

// Active/desactive "Suivant" (ex: prenom obligatoire)
function hbUpdateNav() {
  const steps = hbSteps();
  const cur = steps[hbState.step];
  const nextBtn = document.getElementById('hb-next');
  if (!nextBtn) return;
  nextBtn.disabled = (cur === 'name' && !(hbState.name || '').trim());
}
window.hbUpdateNav = hbUpdateNav;

function _hbLabel(field, val) {
  if (field === 'colors') {
    const c = HB_OPTS.colors.find(x => x.v === val); return c ? c.v : val;
  }
  const o = (HB_OPTS[field] || []).find(x => x.v === val);
  return o ? o.label.toLowerCase() : val;
}

function _hbRecapHtml() {
  const isHuman = hbState.type === 'fille' || hbState.type === 'garcon';
  const lines = [];
  lines.push((HB_OPTS.type.find(t => t.v === hbState.type) || {}).label);
  if (isHuman) {
    if (hbState.hair === 'chauve') lines.push('sans cheveux');
    else lines.push('cheveux ' + _hbLabel('hair', hbState.hair) + ' ' + hbState.hair_color);
  }
  lines.push('tenue : ' + _hbLabel('outfit', hbState.outfit) + ' ' + hbState.outfit_color);
  if (hbState.accessory !== 'aucun') lines.push('accessoire : ' + _hbLabel('accessory', hbState.accessory));
  if ((hbState.keyword || '').trim()) lines.push('idée : ' + hbState.keyword.trim());
  return '<div class="hb-recap">' +
    '<div class="hb-opt-emoji" style="font-size:3.4rem">✨</div>' +
    '<div class="hb-recap-name">' + (hbState.name || 'Mon héros') + '</div>' +
    '<div class="hb-recap-list">' + lines.filter(Boolean).join('<br>') + '</div>' +
    '<button class="hb-btn hb-next" style="margin-top:14px" type="button" onclick="hbGenerate()">' +
    'Donne vie à mon héros ! ✨</button>' +
    '<div style="color:rgba(255,255,255,0.5);font-size:.78rem;margin-top:6px">' +
    'Gratuit · tu utiliseras une plume 🪶 quand il vivra une histoire</div>' +
    '</div>';
}

// Construit l'objet params (memes cles que generate_custom_hero.py)
function hbParams() {
  return {
    type: hbState.type, hair: hbState.hair, hair_color: hbState.hair_color,
    outfit: hbState.outfit, outfit_color: hbState.outfit_color,
    accessory: hbState.accessory, name: (hbState.name || '').trim(),
    keyword: (hbState.keyword || '').trim(),
  };
}

// ============================================================
// Connexion au BACKEND de generation
// ============================================================
// URL configurable : localhost par defaut (pilote), Cloud Run plus tard via
//   localStorage.setItem('ia_backend_url', 'https://...')
function getBackendUrl() {
  // Par defaut : MEME ORIGINE que la page (le serveur sert l'app + l'API).
  // -> marche depuis n'importe quel appareil du reseau (PC, Pixel, tablette...)
  //    sans hardcoder localhost (qui, sur le tel, designe le tel lui-meme !).
  //    Surchageable via localStorage 'ia_backend_url' (ex: Cloud Run).
  try {
    const override = localStorage.getItem('ia_backend_url');
    if (override) return override;
  } catch (e) {}
  if (location && location.origin && location.origin.indexOf('http') === 0) {
    return location.origin;
  }
  return 'http://localhost:8787';   // fallback (app ouverte en file://)
}
function getLicenseCode() {
  try { return localStorage.getItem('ia_license_code') || 'ECOLE-DEMO'; }
  catch (e) { return 'ECOLE-DEMO'; }
}
window.getBackendUrl = getBackendUrl;

function _heroOverlay(id, innerHtml) {
  document.getElementById(id)?.remove();
  const ov = document.createElement('div');
  ov.id = id;
  ov.setAttribute('style',
    'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;' +
    'justify-content:center;background:rgba(20,10,35,0.85);' +
    'backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);padding:5vw;');
  ov.innerHTML =
    '<div style="max-width:430px;width:100%;background:linear-gradient(160deg,#fff8ee,#ffe9c7);' +
    'border:3px solid #e0a23a;border-radius:22px;padding:26px 24px;text-align:center;' +
    'box-shadow:0 20px 60px rgba(0,0,0,.5);font-family:inherit;color:#4a2f12;">' + innerHtml + '</div>';
  document.body.appendChild(ov);
  return ov;
}

function showHeroLoading(name) {
  _heroOverlay('hero-loading',
    '<div style="font-size:48px;line-height:1;margin-bottom:10px;" class="anim-bounce">🪄✨</div>' +
    '<h2 style="margin:0 0 8px;font-size:1.3rem;color:#7a4a10;">Léon donne vie à ' + name + '…</h2>' +
    '<p style="margin:0;font-size:.95rem;opacity:.85;">Sa baguette dessine ton héros. ' +
    'Ça prend environ une minute ⏳</p>');
}

function showHeroError(msg) {
  const ov = _heroOverlay('hero-error',
    '<div style="font-size:44px;margin-bottom:8px;">😯</div>' +
    '<h2 style="margin:0 0 8px;font-size:1.2rem;color:#7a4a10;">Oups</h2>' +
    '<p style="margin:0 0 18px;font-size:.95rem;opacity:.9;">' + msg + '</p>' +
    '<button id="hero-error-close" style="cursor:pointer;border:none;' +
    'background:linear-gradient(160deg,#ffb74d,#f57c00);color:#fff;font-weight:800;' +
    'font-size:1rem;padding:11px 26px;border-radius:14px;">Réessayer</button>');
  document.getElementById('hero-error-close').addEventListener('click', () => ov.remove());
}

function showHeroResult(data) {
  const url = getBackendUrl() + data.portrait_url;
  const ov = _heroOverlay('hero-result',
    '<h2 style="margin:0 0 10px;font-size:1.35rem;color:#7a4a10;">' +
      (data.name || 'Ton héros') + ' est né ! 🎉</h2>' +
    '<img src="' + url + '" alt="' + (data.name || '') + '" ' +
    'style="width:200px;height:200px;object-fit:cover;border-radius:18px;' +
    'border:3px solid #e0a23a;box-shadow:0 6px 18px rgba(0,0,0,.25);margin-bottom:14px;">' +
    '<p style="margin:0 0 16px;font-size:.92rem;opacity:.85;">' +
      'Il est ajouté à <b>Mes héros</b>. Tu pourras lui faire vivre des histoires 🪶</p>' +
    '<button id="hero-result-close" style="cursor:pointer;border:none;' +
    'background:linear-gradient(160deg,#7ec850,#4ca22f);color:#fff;font-weight:800;' +
    'font-size:1rem;padding:12px 30px;border-radius:14px;box-shadow:0 4px 14px rgba(76,162,47,.45);">' +
    'Génial ! 😍</button>');
  document.getElementById('hero-result-close').addEventListener('click', () => {
    ov.remove();
    goToScreen('map');   // retour carte ; la galerie "Mes heros" arrive (step 5b)
  });
}

// Vrai appel au backend : cree le heros (portrait Gemini cote serveur).
async function hbGenerate() {
  const params = hbParams();
  showHeroLoading(params.name || 'ton héros');
  try {
    const res = await fetch(getBackendUrl() + '/api/create-hero', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ license: getLicenseCode() }, params)),
    });
    const data = await res.json().catch(() => ({}));
    document.getElementById('hero-loading')?.remove();
    if (!res.ok) {
      showHeroError(data.message || data.error || 'La génération a échoué. Réessaie.');
      return;
    }
    showHeroResult(data);
  } catch (e) {
    document.getElementById('hero-loading')?.remove();
    showHeroError('Le serveur de Léon est injoignable. Vérifie qu\'il est bien lancé. (' + e.message + ')');
  }
}
window.hbGenerate = hbGenerate;

// Paywall : overlay leger injecte dynamiquement (aucun HTML a modifier).
// feature = numero de chapitre (2..5) ou 'book' pour le Livre magique.
function showPremiumPaywall(feature) {
  const isBook = feature === 'book';
  const titre = isBook ? 'Le Livre magique de Léon' : ('Chapitre ' + feature);
  document.getElementById('premium-paywall')?.remove();
  const ov = document.createElement('div');
  ov.id = 'premium-paywall';
  ov.setAttribute('style',
    'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;' +
    'justify-content:center;background:rgba(20,10,35,0.82);' +
    'backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);padding:5vw;');
  // v653 : pivot B2G (vente mairie / ecole). On retire le bouton "Debloquer
  // tout 4,99 EUR" (Stripe pas integre + brouille le positionnement aupres
  // des collectivites). Le Code ecole devient l'action principale.
  ov.innerHTML =
    '<div style="max-width:460px;width:100%;background:linear-gradient(160deg,#fff8ee,#ffe9c7);' +
    'border:3px solid #e0a23a;border-radius:22px;padding:28px 26px;text-align:center;' +
    'box-shadow:0 20px 60px rgba(0,0,0,.5);font-family:inherit;color:#4a2f12;">' +
      '<div style="font-size:46px;line-height:1;margin-bottom:10px;">🏫</div>' +
      '<h2 style="margin:0 0 6px;font-size:1.3rem;color:#7a4a10;">' + titre + '</h2>' +
      '<p style="margin:0 0 16px;font-size:.95rem;line-height:1.45;opacity:.9;">' +
        'Cette aventure est accessible aux <b>écoles et collectivités partenaires</b>. ' +
        'Si vous êtes enseignant et que votre établissement participe, entrez votre code école.</p>' +
      '<button id="premium-paywall-school" style="cursor:pointer;border:none;width:100%;' +
      'background:linear-gradient(160deg,#7ec850,#4ca22f);color:#fff;font-weight:800;' +
      'font-size:1.05rem;padding:14px 24px;border-radius:14px;box-shadow:0 4px 14px rgba(76,162,47,.45);">' +
      'J\'ai un code école 🏫</button>' +
      '<div style="margin-top:20px;padding-top:16px;border-top:1px solid rgba(122,74,16,.25);' +
      'font-size:.85rem;line-height:1.5;opacity:.8;text-align:left;">' +
        '<b>Vous êtes une mairie, une école ou un éditeur ?</b><br>' +
        'Pour faire bénéficier vos classes de l\'application, contactez l\'auteur : ' +
        '<a href="mailto:aurelienperrier34@gmail.com" style="color:#7a4a10;font-weight:700;">' +
        'aurelienperrier34@gmail.com</a></div>' +
      '<button id="premium-paywall-close" style="margin-top:14px;cursor:pointer;border:none;' +
      'background:none;color:#7a4a10;font-size:.85rem;text-decoration:underline;opacity:.6;">' +
      'Fermer</button>' +
    '</div>';
  ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
  document.body.appendChild(ov);
  document.getElementById('premium-paywall-school')?.addEventListener('click', showSchoolCodePrompt);
  document.getElementById('premium-paywall-close')?.addEventListener('click', () => ov.remove());
}
window.showPremiumPaywall = showPremiumPaywall;

// Start a mapped chapter
function startChapter(n) {
  // Verrou Premium : seul le chapitre 1 est gratuit.
  if (n >= 2 && !isPremium()) { showPremiumPaywall(n); return; }

  const firstScreens = { 1: 2, 2: 'c2s1', 3: 'c3s1', 4: 'c4s1', 5: 'c5s1' };
  const target = firstScreens[n];
  if (!target) return;
  document.getElementById('main-header').style.display = 'flex';
  document.getElementById('main-progress').style.display = 'flex';

  // PRE-UNLOCK AUDIO : declenche un play() dans le click handler utilisateur
  // pour debloquer la policy autoplay de Firefox. Le play() reel se passe
  // dans goToScreen(target), mais ce play() prealable suffit a "unlock" l'API.
  if (n === 1 && voicesEnabled()) {
    try {
      delete _voiceCache['ce_matin'];
      const a = getVoice('ce_matin', 'assets/ce_matin.mp3?v=' + Date.now());
      a.muted = true;  // Permet de play sans son immediatement
      const p = a.play();
      if (p && p.then) p.then(() => { a.pause(); a.currentTime = 0; a.muted = false; }).catch(() => {});
    } catch(e) {}
  }

  // Pareil pour le fullscreen : depuis ce click, on peut le demander
  enterFullscreen();

  goToScreen(target);
}

// Navigation between all screens
function goToScreen(screenIdentifier, force) {
  // Guard : ne pas ré-exécuter si déjà sur le même écran (évite le clignotement des bulles).
  // En mode force=true (ex: raccourcis clavier), on autorise le replay.
  if (!force && state.currentScreen === screenIdentifier && document.getElementById(`screen-${screenIdentifier}`)?.classList.contains('active')) {
    return;
  }

  // v663 : stop la musique de victoire si on quitte un ecran win (clic sur
  // Continuer/Carte/etc). Si on re-rentre sur un win, le handler win plus bas
  // appelle _playVictoryJingle qui relance proprement.
  if (typeof _stopVictoryJingle === 'function') _stopVictoryJingle();

  // Hide all screens
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));

  // Show target
  const targetScreen = document.getElementById(`screen-${screenIdentifier}`);
  if (targetScreen) targetScreen.classList.add('active');

  state.currentScreen = screenIdentifier;
  saveState();

  // Bouton flottant "retour carte" : visible sur tous les tableaux de chapitre,
  // masque sur intro (0), choix perso (1) et la carte elle-meme.
  try {
    const backMapBtn = document.getElementById('btn-back-map-global');
    if (backMapBtn) {
      const hideOn = ['0', 0, 1, '1', 'map'];
      const shouldHide = hideOn.includes(screenIdentifier);
      backMapBtn.style.display = shouldHide ? 'none' : 'inline-flex';
    }
  } catch(e) {}

  // Inject hero image/video dans les scènes
  if (screenIdentifier >= 2 && screenIdentifier <= 5) {
    if (screenIdentifier !== 3) {
      const heroMedia = document.getElementById(`hero-img-${screenIdentifier}`);
      if (heroMedia && state.characterImage) {
         heroMedia.src = state.characterImage;
      }
    }
  }

  // Helper : écran narratif (chap 1 = nombres, chap 2+ = strings c{n}s{n})
  const isStoryStr = typeof screenIdentifier === 'string' && /^c\d+s\d+$/.test(screenIdentifier);

  // Cinématographie globale : on entre en plein ecran sur TOUS les ecrans
  // sauf l'intro 0 (page d'accueil) ou la map (qui a son propre layout).
  // Le navigateur n'autorise requestFullscreen que dans un gesture utilisateur,
  // donc on appelle uniquement quand goToScreen est invoque par un click.
  const isIntro = (screenIdentifier === 0 || screenIdentifier === 'map');
  if (!isIntro) {
    enterFullscreen();
  }

  if (screenIdentifier === 2) {
    document.body.classList.add('street-mode');
    document.body.classList.remove('novel-mode'); // Pas de novel dans la rue
  } else {
    document.body.classList.remove('street-mode');
  }

  // Activation du mode Visual Novel (Edge-to-Edge) pour les scènes suivantes
  if ((typeof screenIdentifier === 'number' && screenIdentifier >= 3) || isStoryStr) {
    document.body.classList.add('novel-mode');
  } else if (screenIdentifier !== 2) {
    document.body.classList.remove('novel-mode');
  }

  // === Animation Typewriter / Karaoké pour les Dialogues ===
  if (window.typewriterTimeout) clearTimeout(window.typewriterTimeout);
  if (window.narratorAudio) { window.narratorAudio.pause(); window.narratorAudio = null; }
  if (window.leonAudio) { window.leonAudio.pause(); window.leonAudio = null; }

  if (screenIdentifier === 3) {
    const bubble = document.querySelector('#screen-3 .dialogue-bubble');
    const who = document.querySelector('#screen-3 .dialogue-who');
    const leonVid = document.querySelector('#screen-3 .leon-video-bg');
    const s3ans = document.getElementById('s3-answers');
    if (s3ans) s3ans.classList.remove('show'); // réponses cachées au départ

    if (bubble && leonVid) {
      const fullText = "« Ah, un explorateur ! Veux-tu savoir ce que c'est, l'IA ? »";

      bubble.textContent = '';
      bubble.style.display = 'none';
      if (who) who.style.display = 'none';

      const narrAudio = getVoice('voix_narrateur_3', 'assets/voix_narrateur_3.mp3?v=' + Date.now());
      const leonAudio = getVoice('voix_leon_3',      'assets/Voix_leon_3.mp3?v=' + Date.now());

      // Typewriter Léon synchronisé sur la durée de son audio si connue
      const startTypewriter = () => {
        bubble.style.display = '';
        if (who) who.style.display = '';

        let i = 0;
        const duration = (leonAudio && isFinite(leonAudio.duration) && leonAudio.duration > 0)
          ? leonAudio.duration * 1000 : (fullText.length * 38);
        const stepMs = Math.max(22, duration / fullText.length);
        const type = () => {
          if (i < fullText.length) {
            bubble.textContent += fullText.charAt(i);
            i++;
            window.typewriterTimeout = setTimeout(type, stepMs);
          } else {
            setTimeout(() => {
              try { leonVid.pause(); } catch(e) {}
            }, 200);
            setTimeout(() => { if (s3ans) s3ans.classList.add('show'); }, 400);
          }
        };
        type();
      };

      // 1) Narrateur d'abord : lit la narration pendant que le texte "Derrière le comptoir…" est visible
      const playLeonPart = () => {
        leonVid.play().catch(()=>{});
        if (voicesEnabled() && leonAudio) {
          leonAudio.currentTime = 0;
          // playSafely : si l'audio est bloque par autoplay (ex F5),
          // l'API enregistre un retry sur le prochain clic.
          playSafely(leonAudio, 'leon_3').catch(()=>{});
        }
        startTypewriter();
      };

      if (voicesEnabled() && narrAudio) {
        narrAudio.currentTime = 0;
        const onNarrEnd = () => {
          narrAudio.removeEventListener('ended', onNarrEnd);
          setTimeout(playLeonPart, 400);
        };
        narrAudio.addEventListener('ended', onNarrEnd, { once: true });
        // playSafely : si la policy autoplay bloque (post-F5), reessaie au
        // prochain clic. Si l'audio joue puis se termine, l'event 'ended'
        // declenche playLeonPart (cf. addEventListener au-dessus).
        playSafely(narrAudio, 'narr_3').catch(() => {
          // Erreur non-autoplay : on deroule sans son
          window.typewriterTimeout = setTimeout(playLeonPart, 2500);
        });
      } else {
        // Mode muet : on garde le rythme visuel d'origine (2,5s pour lire la narration)
        window.typewriterTimeout = setTimeout(playLeonPart, 2500);
      }
    }
  }

  if (screenIdentifier === 4) {
    console.log('[s4] enter screen 4', { voicesOn: voicesEnabled() });
    if (typeof resetS4Game === 'function') resetS4Game();
    const bubble4  = document.getElementById('s4-bubble');
    const s4ans    = document.getElementById('s4-answers');
    const leonVid4 = document.getElementById('leon-video-bg-4');
    const heroImg4 = document.getElementById('hero-back-4');
    const heroVid4 = document.getElementById('hero-back-video-4');
    console.log('[s4] elements:', { bubble4: !!bubble4, leonVid4: !!leonVid4, heroImg4: !!heroImg4, heroVid4: !!heroVid4 });
    if (s4ans) s4ans.classList.remove('show');

    // Héros de profil ou de dos (fallback)
    const cd = charData[state.characterType] || {};
    if (heroVid4 && heroImg4) {
      if (cd.profileImg) {
        heroImg4.src = cd.profileImg;
        heroImg4.style.display = 'block';
        heroVid4.style.display = 'none';
        heroImg4.style.filter = 'drop-shadow(0 8px 6px rgba(0,0,0,0.35))';
        // positionHero4 applique la position calibree (par perso) — Alt+H pour recalibrer
        setTimeout(positionHero4, 50);
      } else if (cd.backVideo) {
        heroVid4.src = cd.backVideo;
        heroVid4.style.display = 'block';
        heroImg4.style.display = 'none';
        try { heroVid4.currentTime = Math.min(1.2, 1.5); heroVid4.pause(); } catch(e){}
      } else if (cd.backImg) {
        heroImg4.src = cd.backImg;
        heroImg4.style.display = 'block';
        heroVid4.style.display = 'none';
      } else {
        heroImg4.src = cd.img || '';
        heroImg4.style.display = 'block';
        heroVid4.style.display = 'none';
      }
    }

    // Lance la video DES L'ENTREE sur l'ecran (en parallele du narrateur).
    // Avant, on attendait la fin du narrateur pour la lancer, ce qui rendait
    // l'image statique tant que le narrateur parlait — et si le narrateur
    // echouait silencieusement, la video ne demarrait jamais.
    if (leonVid4) {
      leonVid4.loop = true;
      leonVid4.muted = true;
      leonVid4.playsInline = true;
      try { leonVid4.pause(); leonVid4.currentTime = 0; } catch(e) {}
    }

    // Typewriter bulle Léon synchronisé avec la voix, après le narrateur
    if (bubble4) {
      const fullHTML = '« L\'IA, c\'est une machine qui <strong>apprend</strong>. On lui montre plein d\'exemples... et après, elle t\'aide à créer ! »';
      // Texte plein : dérivé de fullHTML pour éviter de dépendre du DOM (bug si re-entrée sur l'écran)
      const fullText = fullHTML.replace(/<[^>]+>/g, '');
      bubble4.textContent = '';
      bubble4.style.display = 'none';

      const who4 = document.getElementById('s4-who');
      if (who4) who4.style.display = 'none';

      // On utilise les audios DEJA UNLOCK dans _voiceCache (peuples par
      // _unlockAudio au premier clic). On NE supprime PAS le cache, sinon on
      // perd l'unlock et le navigateur rebloque l'autoplay.
      const narrAudio4 = getVoice('au_coeur',    'assets/au_coeur.mp3');
      const leonAudio4 = getVoice('voix_leon_4', 'assets/Voix_leon_4.mp3');
      // Diagnostic : on log les events critiques de l'audio narrateur
      narrAudio4.addEventListener('loadedmetadata', () => console.log('[s4] narrator loadedmetadata, duration =', narrAudio4.duration), { once: true });
      narrAudio4.addEventListener('canplay',        () => console.log('[s4] narrator canplay'), { once: true });
      narrAudio4.addEventListener('error',          (e) => console.warn('[s4] narrator ERROR event:', narrAudio4.error && narrAudio4.error.message, narrAudio4.error && narrAudio4.error.code), { once: true });

      const startTypewriter4 = () => {
        bubble4.style.display = '';
        if (who4) who4.style.display = '';

        let i = 0;
        const duration = (leonAudio4 && isFinite(leonAudio4.duration) && leonAudio4.duration > 0)
          ? leonAudio4.duration * 1000 : (fullText.length * 32);
        const stepMs = Math.max(22, duration / fullText.length);

        if (voicesEnabled() && leonAudio4) {
          leonAudio4.currentTime = 0;
          playSafely(leonAudio4, 's4-leon');
        }
        if (leonVid4) {
          leonVid4.play().catch(()=>{});
        }

        const type4 = () => {
          if (i < fullText.length) {
            bubble4.textContent += fullText.charAt(i);
            i++;
            window.typewriterTimeout = setTimeout(type4, stepMs);
          } else {
            bubble4.innerHTML = fullHTML;
            setTimeout(() => {
              try { if (leonVid4) { leonVid4.pause(); } } catch(e) {}
            }, 200);
            // À la fin du karaoke : on active le mini-jeu "vrais arbres"
            // (le bouton "J'ai compris" sera révélé seulement après complétion).
            setTimeout(() => { if (typeof activateS4Game === 'function') activateS4Game(); }, 600);
          }
        };
        type4();
      };

      // Garde-fou : on garantit qu'on lance le typewriter au plus tard apres
      // 4 secondes, peu importe ce qui se passe avec le narrateur. Comme ca
      // l'image et le dialogue Leon partent toujours, meme si le mp3 narrateur
      // est casse / muet / ne charge pas.
      let _typewriterStarted4 = false;
      const safeStartTypewriter4 = (reason) => {
        if (_typewriterStarted4) return;
        _typewriterStarted4 = true;
        console.log('[s4] startTypewriter triggered by:', reason);
        startTypewriter4();
      };
      const _safetyNet4 = setTimeout(() => safeStartTypewriter4('safety-net 5s'), 5000);

      // 1) Narrateur d'abord, puis Léon
      if (voicesEnabled() && narrAudio4) {
        narrAudio4.currentTime = 0;
        const onNarrEnd4 = () => {
          narrAudio4.removeEventListener('ended', onNarrEnd4);
          clearTimeout(_safetyNet4);
          setTimeout(() => safeStartTypewriter4('narrator ended'), 400);
        };
        narrAudio4.addEventListener('ended', onNarrEnd4);
        playSafely(narrAudio4, 's4-narrator')
          .then(() => console.log('[s4] narrator PLAYING (duration:', narrAudio4.duration, 's)'))
          .catch((err) => {
            console.warn('[s4] narrator definitively failed:', err && err.message);
            clearTimeout(_safetyNet4);
            window.typewriterTimeout = setTimeout(() => safeStartTypewriter4('narrator catch'), 1500);
          });
      } else {
        console.log('[s4] voices off / no narrAudio — typewriter dans 1.5s');
        clearTimeout(_safetyNet4);
        window.typewriterTimeout = setTimeout(() => safeStartTypewriter4('voices off'), 1500);
      }
    }
  }

  if (screenIdentifier === 6) {
    // Quizz final : visuel epure. Pas de heros, pas de video animee.
    // Le HTML utilise deja une <img> fixe pour le fond Leon-machine.
    const heroImg6 = document.getElementById('hero-back-6');
    if (heroImg6) {
      heroImg6.src = '';
      heroImg6.style.display = 'none';
    }
    // Garde-fou si le HTML est restaure en <video> :
    const leonVid6 = document.getElementById('leon-video-bg-6');
    if (leonVid6 && typeof leonVid6.pause === 'function') {
      try { leonVid6.pause(); leonVid6.currentTime = 0.5; } catch(e) {}
    }
  }

  if (screenIdentifier === 5) {
    const heroImg5 = document.getElementById('hero-back-5');
    const cd = charData[state.characterType] || {};

    if (heroImg5) {
      if (cd.profileImg) {
        heroImg5.src = cd.profileImg;
        heroImg5.style.display = 'block';
        // Pas de chroma key (url(#aiGreenKey)) sur les images -removebg deja
        // detourees : elle effacait des pixels verts du perso (ex: Pixel le
        // robot apparaissait moitie transparent). Drop-shadow comme screen 4.
        heroImg5.style.filter = 'drop-shadow(0 8px 6px rgba(0,0,0,0.35))';
      } else {
        heroImg5.src = cd.img || '';
        heroImg5.style.display = 'block';
      }
      // On applique les memes positions calibrees que sur l'ecran 4
      // (par perso, lues depuis localStorage / calibration.json).
      if (state.characterType) {
        const positions = loadHero4Pos();
        const pos = positions[state.characterType]
                 || HERO4_DEFAULT_POS[state.characterType]
                 || HERO4_DEFAULT_POS.fille;
        heroImg5.style.right  = pos.right  + '%';
        heroImg5.style.bottom = pos.bottom + '%';
        heroImg5.style.height = pos.height + '%';
      }
    }

    // L'ecran 5 affiche une image fixe (pas de video) — voir HTML : balise <img>.
    // Garde-fou si jamais le HTML est restaure en <video> :
    const leonVid5 = document.getElementById('leon-video-bg-5');
    if (leonVid5 && typeof leonVid5.pause === 'function') {
      try { leonVid5.pause(); leonVid5.currentTime = 0.5; } catch(e) {}
    }

    // Raccourci pour réinitialiser le jeu si la page est rechargée (efface l'état du minijeu)
    state.tapAnswered = false;
    state.tapAttempts = 0;
    saveState();

    document.getElementById('btn-to-6').classList.remove('show-btn');

    const fb = document.getElementById('tap-feedback');
    if (fb) { fb.classList.remove('show'); fb.textContent = ''; }

    document.querySelectorAll('.tap-option').forEach(o => {
      o.classList.remove('answered', 'correct', 'wrong');
    });

    const s5ans = document.getElementById('s5-answers');
    const s5instr = document.getElementById('s5-instruction');
    const s5game = document.getElementById('s5-game'); // bloc glassmorphism

    // La bulle de Leon apparait des l'entree (pour lecture) ; le bloc complet
    // du quizz (cadre glassmorphism + instruction + boutons) attend la fin de
    // la voix de Leon et apparait d'un seul coup.
    const s5bubble = document.querySelector('#screen-5 .dialogue-bubble');
    if (s5bubble) {
      s5bubble.style.display = '';
      if (!s5bubble.textContent.trim() && s5bubble.dataset.fullhtml) {
        s5bubble.innerHTML = s5bubble.dataset.fullhtml;
      }
    }
    // On masque tout le quizz (cadre + instruction + boutons) au depart.
    if (s5game) {
      s5game.style.transition = 'opacity 0.4s';
      s5game.style.opacity = '0';
      s5game.style.pointerEvents = 'none'; // pas de clic sur le cadre invisible
    }
    if (s5ans)   s5ans.classList.remove('show');
    if (s5instr) { s5instr.style.transition = 'opacity 0.4s'; s5instr.style.opacity = '0'; }

    const revealS5Quiz = () => {
      if (s5game)  { s5game.style.opacity = '1'; s5game.style.pointerEvents = ''; }
      if (s5instr) s5instr.style.opacity = '1';
      if (s5ans)   s5ans.classList.add('show');
    };

    // Voix de Leon « Attention, l'IA ne sait pas tout faire ! » + reveal du
    // quizz a la fin (avec filet de securite si l'audio echoue / est bloque).
    let _s5Revealed = false;
    const safeRevealS5 = () => {
      if (_s5Revealed) return; _s5Revealed = true;
      revealS5Quiz();
      // Lit la consigne narrateur quand le quizz s'affiche (apres Leon)
      // Pas de playConsigne('s5') : Leon dit deja la consigne dans son dialogue.
    };
    const _s5Net = setTimeout(() => safeRevealS5(), 6000);

    if (voicesEnabled()) {
      const attentionAudio = getVoice('attention', 'assets/Attention.mp3');
      if (attentionAudio) {
        try { attentionAudio.currentTime = 0; } catch(e) {}
        const onEnd = () => {
          attentionAudio.removeEventListener('ended', onEnd);
          clearTimeout(_s5Net);
          // Petit delai pour que la voix se dissipe avant l'apparition du quizz
          setTimeout(safeRevealS5, 300);
        };
        attentionAudio.addEventListener('ended', onEnd);
        playSafely(attentionAudio, 's5-attention')
          .then(() => console.log('[s5] attention PLAYING (duration:', attentionAudio.duration, 's)'))
          .catch((err) => {
            console.warn('[s5] attention failed:', err && err.message);
            clearTimeout(_s5Net);
            setTimeout(safeRevealS5, 1500);
          });
      } else {
        clearTimeout(_s5Net);
        setTimeout(safeRevealS5, 1500);
      }
    } else {
      // Voix coupees : on reveille le quizz apres une pause de lecture
      clearTimeout(_s5Net);
      setTimeout(safeRevealS5, 2200);
    }
  }

  if (screenIdentifier === 2) {

    // Video de fond rue : EN PAUSE sur la 1ere frame, demarre apres la narration
    const streetBgVid = document.getElementById('street-bg-video');
    if (streetBgVid) {
      streetBgVid.loop = true;
      try { streetBgVid.currentTime = 0; } catch(e) {}
      try { streetBgVid.pause(); } catch(e) {}
      // Prime un play() bref pour decoder la 1ere frame puis pause immediate
      const _streetPrime = streetBgVid.play();
      if (_streetPrime && _streetPrime.then) {
        _streetPrime.then(() => { try { streetBgVid.pause(); streetBgVid.currentTime = 0; } catch(e) {} }).catch(() => {});
      }
    }

    // Helper : planifie l'apparition du pointeur 👆 (3s apres la fin de la narration).
    // Pas de mp3 audio - l'emoji clignotant suffit.
    const schedulePointer = (delayMs) => {
      if (window._signPointerTimer) clearTimeout(window._signPointerTimer);
      window._signPointerTimer = setTimeout(() => {
        const ptr = document.getElementById('sign-pointer');
        if (ptr) ptr.classList.add('show');
      }, delayMs);
    };

    // Voix narrateur "Ce matin, tu te promenes..." -> a la fin : video demarre + timer pointeur
    console.log('[narr] voicesEnabled:', voicesEnabled());
    if (voicesEnabled()) {
      // Recree l'audio a chaque visite pour garantir un etat propre (evite les bugs de
      // cache d'Audio entre navigations)
      delete _voiceCache['ce_matin'];
      const narrAudio2 = getVoice('ce_matin', 'assets/ce_matin.mp3?v=' + Date.now());
      console.log('[narr] audio cree:', narrAudio2 ? 'OK' : 'NULL');
      if (narrAudio2) {
        try { narrAudio2.pause(); narrAudio2.currentTime = 0; } catch(e) {}
        // Si un ancien listener traine, on le retire (defensive)
        if (window._narrEndListener) {
          try { narrAudio2.removeEventListener('ended', window._narrEndListener); } catch(e) {}
        }
        const onNarrEnd = () => {
          if (streetBgVid) {
            try { streetBgVid.currentTime = 0; streetBgVid.play().catch(() => {}); } catch(e) {}
          }
          schedulePointer(3000);  // 3s apres la fin reelle de la narration
          try { narrAudio2.removeEventListener('ended', onNarrEnd); } catch(e) {}
          window._narrEndListener = null;
        };
        window._narrEndListener = onNarrEnd;
        narrAudio2.addEventListener('ended', onNarrEnd);
        // playSafely : gere automatiquement le retry en cas de blocage autoplay
        playSafely(narrAudio2, 'narr_2')
          .then(() => console.log('[narr] play OK'))
          .catch(err => console.warn('[narr] play definitively failed:', err && err.message));
        // Filet de securite : 12s apres entree, force start video + pointeur si rien ne s'est passe
        setTimeout(() => {
          if (streetBgVid && streetBgVid.paused) { try { streetBgVid.play().catch(() => {}); } catch(e) {} }
          // Ne re-schedule QUE si pointer pas deja montre
          const ptrEl = document.getElementById('sign-pointer');
          if (ptrEl && !ptrEl.classList.contains('show') && !window._signPointerTimer) {
            schedulePointer(0);
          }
        }, 12000);
      } else if (streetBgVid) {
        try { streetBgVid.play().catch(() => {}); } catch(e) {}
        schedulePointer(3000);
      }
    } else if (streetBgVid) {
      try { streetBgVid.play().catch(() => {}); } catch(e) {}
      schedulePointer(3000);
    }

    // Vidéo "de dos" en pause, démarrée au clic sur l'enseigne
    const vid2   = document.getElementById('hero-video-2');
    const vidSrc = document.getElementById('hero-video-2-src');
    const back   = state.characterType && charData[state.characterType] && charData[state.characterType].backVideo;
    const chroma = state.characterType && charData[state.characterType] && charData[state.characterType].chromaKey || 'greenKey';
    if (back && vid2 && vidSrc) {
      // L'avatar de DOS doit etre visible en idle. Mais la frame 0 de la video
      // contient parfois l'avatar de FACE (avec fond plat). Strategie :
      // 1) hide tant qu'on n'est pas SUR que currentTime > 0.5s
      // 2) reveal SEULEMENT apres l'event 'seeked' (pas de fallback temporel)
      vid2.style.filter = `url(#${chroma})`;
      vid2.style.transition = 'none';
      // Avatar idle : agrandi (scale 1.4) pour bien voir le perso au depart.
      // Il rapetissera progressivement (scale 0.88) pendant la marche vers la
      // porte, donnant un effet de profondeur (eloignement).
      vid2.style.transform  = 'translateX(-50%) scale(1.4)';
      vid2.style.display = 'none';
      vid2.style.opacity = '0';
      if (vidSrc.getAttribute('src') !== back) { vidSrc.src = back; vid2.load(); }
      // v395 : iOS Safari ne supporte pas SVG filter sur <video> -> le perso
      // garde son cadre vert. On installe un canvas chroma-key qui rend la
      // video sans fond. No-op sur Android/PC (SVG filter fonctionne).
      if (typeof setupCanvasChromaKeyForVideo === 'function') {
        setupCanvasChromaKeyForVideo(vid2, chroma);
      }

      let _seekRetries = 0;
      // v656 : detection iOS Safari (le seek peut ne jamais firer 'seeked'
      // sur certaines versions -> les 6 retries echouent et on revelait la
      // frame 0 = avatar de FACE avec fond opaque. Sur iOS specifiquement
      // on prefere garder le perso CACHE en idle plutot que montrer l'avatar
      // de face. Le perso apparait au clic sur la porte (debut animation
      // de marche), ou il joue les bonnes frames de dos.
      const _isIOS = typeof _isIOSDevice === 'function' ? _isIOSDevice() :
        /iPhone|iPad|iPod/.test(navigator.userAgent || '');
      const reveal = () => {
        if (vid2.currentTime < 0.5) {
          if (_seekRetries++ > 6) {
            // Sur iOS : on n'affiche RIEN plutot qu'un avatar de face. Le
            // perso apparait correctement au clic sur la porte (marche).
            if (_isIOS) {
              console.warn('[s2] iOS seek echec apres 6 retries -> on garde le perso cache (apparaitra au clic).');
              vid2.style.display = 'none';
              vid2.style.opacity = '0';
              return;
            }
            // Hors iOS : reveal force (mieux vaut un perso momentane qu'une rue vide).
            console.warn('[s2] reveal force apres 6 retries, currentTime=' + vid2.currentTime);
          } else {
            const target = Math.min(1.2, (vid2.duration || 2) - 0.05);
            try { vid2.currentTime = target; } catch(e) {}
            vid2.addEventListener('seeked', reveal, { once: true });
            return;
          }
        }
        vid2.style.display = 'block';
        requestAnimationFrame(() => requestAnimationFrame(() => {
          vid2.style.transition = 'opacity 0.3s';
          vid2.style.opacity = '1';
        }));
      };
      const seekToBack = () => {
        vid2.pause();
        const target = Math.min(1.2, (vid2.duration || 2) - 0.05);
        try { vid2.currentTime = target; } catch(e) {}
      };
      if (vid2.readyState >= 1) seekToBack();
      else vid2.addEventListener('loadedmetadata', seekToBack, { once: true });
      vid2.addEventListener('seeked', reveal, { once: true });
    } else if (vid2) {
      vid2.style.display = 'none';
    }

    if (typeof watchSignScene    === 'function') watchSignScene();
    if (typeof positionNeonSign  === 'function') {
      setTimeout(() => { positionNeonSign(); if (typeof updateEntryMarker === 'function') updateEntryMarker(); }, 50);
      setTimeout(() => { positionNeonSign(); if (typeof updateEntryMarker === 'function') updateEntryMarker(); }, 400);
    }

    // Reset hint texte (ancien) et pointeur emoji (nouveau) -- le scheduling est gere
    // par schedulePointer() declenche a la fin de la narration (voir plus haut)
    const hint = document.getElementById('sign-hint');
    const pointer = document.getElementById('sign-pointer');
    if (hint) hint.classList.remove('show');
    if (pointer) pointer.classList.remove('show');
    if (window._signHintTimer) clearTimeout(window._signHintTimer);
  }

  // ============================================================
  // CHAPITRE 2 : LA FABRIQUE À IMAGES
  // ============================================================
  if (isStoryStr) {
    // Auto-play de la vidéo de fond
    const targetVideo = document.querySelector(`#screen-${screenIdentifier} video.leon-machine-video`);

    // Chapitre 2 narratif : meme pattern que chap 3/4/5 — video gelee sur
    // frame 0 pendant que le narrateur parle, declenchee via onLeonStart.
    // c2s1 inclus aussi (avant il etait en cutAfter4s : video qui partait
    // tout de suite a l'entree pendant 4s, donc en parallele du narrateur).
    const c2DeferredVideo = ['c2s1', 'c2s2', 'c2s4', 'c2s5', 'c2s6'];
    // Chapitre 3 narratif : vidéo gelée sur frame 0 pendant que le narrateur parle.
    // Le play est déclenché plus bas via opts.onLeonStart (synchro avec voix Léon).
    const c3DeferredVideo = ['c3s1', 'c3s2', 'c3s3', 'c3s4', 'c3s5', 'c3s6'];
    // Chapitre 4 : même pattern (T1-T4 narratifs vidéo, T8 = badge final vidéo)
    const c4DeferredVideo = ['c4s1', 'c4s2', 'c4s3', 'c4s4', 'c4s5'];
    // Chapitre 5 : 4 narratifs vidéo (T1-T4), T5 image fixe (mini-jeu), T6 win
    const c5DeferredVideo = ['c5s1', 'c5s2', 'c5s3', 'c5s4'];
    // c3s1 : vidéo non-loop, joue ~4s puis se fige (pour intro chap 3)
    // (c2s1 est passe en c2DeferredVideo pour suivre le pattern narrateur->Leon)
    const cutAfter4s = ['c3s1'];
    if ((c2DeferredVideo.includes(screenIdentifier) || c3DeferredVideo.includes(screenIdentifier) || c4DeferredVideo.includes(screenIdentifier) || c5DeferredVideo.includes(screenIdentifier)) && targetVideo) {
      targetVideo.loop = !cutAfter4s.includes(screenIdentifier);
      targetVideo.muted = true;
      try { targetVideo.pause(); targetVideo.currentTime = 0; } catch(e) {}
      // Force le chargement complet de la video AVANT que Leon ne lance play().
      // Sinon il arrive que le navigateur demarre la lecture avec un buffer
      // insuffisant : 1 frame puis re-buffering = micro-pause visible.
      if (targetVideo.readyState < 4) {        // < HAVE_ENOUGH_DATA
        try { targetVideo.load(); } catch(e) {}
      }
    } else if (cutAfter4s.includes(screenIdentifier) && targetVideo) {
      targetVideo.loop = false;
      targetVideo.currentTime = 0;
      targetVideo.play().catch(() => {});
      if (window._cutTimer) clearTimeout(window._cutTimer);
      window._cutTimer = setTimeout(() => {
        try { targetVideo.pause(); } catch(e) {}
      }, 4000);
    } else if (targetVideo) {
      // Autres écrans : vidéo en loop continue
      targetVideo.loop = true;
      try { targetVideo.play().catch(() => {}); } catch(e) {}

      // c2s4 : on remet à zéro AVANT la fin pour que le tourbillon d'images
      // ne disparaisse jamais (sinon le `loop` natif redémarre seulement à la fin).
      if (screenIdentifier === 'c2s4') {
        const LOOP_BEFORE_END = 2.0; // secondes avant la fin pour relancer
        if (targetVideo._earlyLoop) targetVideo.removeEventListener('timeupdate', targetVideo._earlyLoop);
        targetVideo._earlyLoop = () => {
          if (targetVideo.duration && targetVideo.currentTime >= targetVideo.duration - LOOP_BEFORE_END) {
            targetVideo.currentTime = 0;
            targetVideo.play().catch(() => {});
          }
        };
        targetVideo.addEventListener('timeupdate', targetVideo._earlyLoop);
      }
    }

    // c2s3 : démo machine — typewriter du prompt puis reveal de l'image, puis dialogue Léon
    if (screenIdentifier === 'c2s3') {
      playC2s3Demo();
    }
    // Effet karaoké pour les écrans narratifs (pas pour mini-jeu/quiz/démo)
    const narrativeC2 = ['c2s1','c2s2','c2s4','c2s5','c2s6','c2s7'];
    const narrativeC3 = ['c3s1','c3s2','c3s3','c3s4','c3s5','c3s6','c3s7'];
    const narrativeC4 = ['c4s1','c4s2','c4s3','c4s4','c4s5','c4s6'];
    const narrativeC5 = ['c5s1','c5s2','c5s3','c5s4','c5s5'];
    const isNarrative = narrativeC2.includes(screenIdentifier) || narrativeC3.includes(screenIdentifier) || narrativeC4.includes(screenIdentifier) || narrativeC5.includes(screenIdentifier);

    if (isNarrative) {
      // Audios + callbacks optionnels par écran
      const optsMap = {
        // Chapitre 2 (Pixel) : voix narrateur + Leon generees a partir de
        // scenar_chap2_json.txt (cf. regenerate_all_narrators.py --chap 2).
        // Mapping tableau -> ecran :
        //   t1 -> c2s1, t2 -> c2s2, t3 -> c2s3 (demo), t4 -> c2s4,
        //   t5 -> c2s5, t6 -> c2s6.
        // onLeonStart/onLeonEnd : la video reste gelee pendant le narrateur,
        // se lance quand Leon commence a parler, se fige quand il a fini.
        c2s1: {
          narratorAudio: 'assets/chapitre_2/t1_narrateur.mp3', leonAudio: 'assets/chapitre_2/t1_leon.mp3',
          onLeonStart: () => { const v = document.getElementById('leon-video-c2s1'); if (v) v.play().catch(()=>{}); },
          onLeonEnd:   () => { const v = document.getElementById('leon-video-c2s1'); if (v) { try { v.pause(); } catch(e) {} } }
        },
        c2s2: {
          narratorAudio: 'assets/chapitre_2/t2_narrateur.mp3', leonAudio: 'assets/chapitre_2/t2_leon.mp3',
          onLeonStart: () => { const v = document.getElementById('leon-video-c2s2'); if (v) v.play().catch(()=>{}); },
          // Active le mini-jeu a la fin de l'AUDIO Leon (pas du typewriter), pour
          // que la consigne narrateur ne soit pas lue pendant que Leon parle encore.
          onLeonEnd: () => {
            const v = document.getElementById('leon-video-c2s2'); if (v) { try { v.pause(); } catch(e) {} }
            if (typeof activateC2s2Game === 'function') activateC2s2Game();
          }
        },
        c2s4: {
          narratorAudio: 'assets/chapitre_2/t4_narrateur.mp3', leonAudio: 'assets/chapitre_2/t4_leon.mp3',
          onLeonStart: () => {
            const v = document.getElementById('leon-video-c2s4');
            if (!v) return;
            v.loop = true;
            v.play().catch(()=>{});
            // v423 : LOOP_BEFORE_END = 3.0 -> reset a 2s sur les 5s. Skip la moitie
            // finale ou le tourbillon se vide (centre gris qui grandit). Le user
            // confirme que 1s et 2s skip etaient insuffisants. Le re-encodage v420
            // (19->2.3 Mbps) evite tout probleme de stall meme avec reset frequent.
            const LOOP_BEFORE_END = 3.0;
            if (v._earlyLoop) v.removeEventListener('timeupdate', v._earlyLoop);
            v._earlyLoop = () => {
              if (v.duration && v.currentTime >= v.duration - LOOP_BEFORE_END) {
                v.currentTime = 0;
                v.play().catch(() => {});
              }
            };
            v.addEventListener('timeupdate', v._earlyLoop);

            // v423 : double-securite pour pauser la video quand l audio Leon finit.
            // onLeonEnd (via fireLeonEnd) marche en theorie mais user observe la
            // video continue. On attache aussi un listener direct sur leonAudio
            // 'ended' qui pause v + retire l early-loop. Idempotent (si onLeonEnd
            // fire d abord, le 2eme handler trouvera v deja pause).
            const a = window.leonAudio;
            if (a) {
              if (v._pauseHandler) a.removeEventListener('ended', v._pauseHandler);
              v._pauseHandler = () => {
                if (v._earlyLoop) { v.removeEventListener('timeupdate', v._earlyLoop); v._earlyLoop = null; }
                try { v.pause(); } catch(e) {}
              };
              a.addEventListener('ended', v._pauseHandler, { once: true });
            }
          },
          // v422 : pause la video a la fin de l audio Leon (comme les autres
          // scenes c2). On utilise onLeonEnd (event 'ended' de leonAudio).
          // v423 ajoute un listener direct comme backup (cf. onLeonStart).
          onLeonEnd: () => {
            const v = document.getElementById('leon-video-c2s4');
            if (!v) return;
            if (v._earlyLoop) { v.removeEventListener('timeupdate', v._earlyLoop); v._earlyLoop = null; }
            try { v.pause(); } catch(e) {}
          }
        },
        c2s5: {
          narratorAudio: 'assets/chapitre_2/t5_narrateur.mp3', leonAudio: 'assets/chapitre_2/t5_leon.mp3',
          onLeonStart: () => { const v = document.getElementById('leon-video-c2s5'); if (v) v.play().catch(()=>{}); },
          // A la fin de l'AUDIO Leon : on lance le mini-jeu "Trouve les defauts !"
          // (la consigne narrateur sera ainsi lue apres Leon, pas pendant)
          onLeonEnd: () => {
            const v = document.getElementById('leon-video-c2s5'); if (v) { try { v.pause(); } catch(e) {} }
            if (typeof activateC2s5Game === 'function') activateC2s5Game();
          }
        },
        c2s6: {
          narratorAudio: 'assets/chapitre_2/t6_narrateur.mp3', leonAudio: 'assets/chapitre_2/t6_leon.mp3',
          onLeonStart: () => { const v = document.getElementById('leon-video-c2s6'); if (v) v.play().catch(()=>{}); },
          onLeonEnd:   () => { const v = document.getElementById('leon-video-c2s6'); if (v) { try { v.pause(); } catch(e) {} } }
        },
        // c2s7 = mini-jeu prompt. La toile reste figee (pas de video animee),
        // le narrateur introduit puis Leon donne la consigne en karaoke.
        c2s7: {
          narratorAudio: 'assets/chapitre_2/t7_narrateur.mp3', leonAudio: 'assets/chapitre_2/t7_leon.mp3',
          onLeonEnd: () => { /* Pas de playConsigne('c2s7') : Leon dit deja la consigne. */ }
        },
        // Chapitre 3 : audios produits par l'agent (t{n}_narrateur.mp3 / t{n}_leon.mp3)
        // onLeonStart démarre la vidéo SEULEMENT quand Léon commence à parler
        // (la vidéo reste figée sur frame 0 pendant le narrateur)
        c3s1: {
          narratorAudio: 'assets/chapitre_3/t1_narrateur.mp3', leonAudio: 'assets/chapitre_3/t1_leon.mp3',
          // NB : pas de currentTime=0 ici — le bloc d'entrée d'écran a déjà
          // posé la vidéo à 0 et amorcé son décodeur. Reset redondant ici =
          // re-seek qui invalide les frames décodées et fait laguer le play.
          onLeonStart: () => { const v = document.getElementById('leon-video-c3s1'); if (v) v.play().catch(()=>{}); },
          onLeonEnd:   () => { const v = document.getElementById('leon-video-c3s1'); if (v) { try { v.pause(); } catch(e) {} } }
        },
        c3s2: {
          narratorAudio: 'assets/chapitre_3/t2_narrateur.mp3', leonAudio: 'assets/chapitre_3/t2_leon.mp3',
          onLeonStart: () => { const v = document.getElementById('leon-video-c3s2'); if (v) v.play().catch(()=>{}); },
          onLeonEnd: () => {
            const v = document.getElementById('leon-video-c3s2'); if (v) { try { v.pause(); } catch(e) {} }
            if (typeof activateC3s2Game === 'function') activateC3s2Game();
          }
        },
        c3s3: {
          narratorAudio: 'assets/chapitre_3/t3_narrateur.mp3', leonAudio: 'assets/chapitre_3/t3_leon.mp3',
          onLeonStart: () => { const v = document.getElementById('leon-video-c3s3'); if (v) v.play().catch(()=>{}); },
          onLeonEnd: () => {
            const v = document.getElementById('leon-video-c3s3'); if (v) { try { v.pause(); } catch(e) {} }
            if (typeof activateC3s3Game === 'function') activateC3s3Game();
          }
        },
        c3s4: {
          narratorAudio: 'assets/chapitre_3/t4_narrateur.mp3', leonAudio: 'assets/chapitre_3/t4_leon.mp3',
          onLeonStart: () => { const v = document.getElementById('leon-video-c3s4'); if (v) v.play().catch(()=>{}); },
          onLeonEnd:   () => { const v = document.getElementById('leon-video-c3s4'); if (v) { try { v.pause(); } catch(e) {} } }
        },
        c3s5: {
          narratorAudio: 'assets/chapitre_3/t5_narrateur.mp3', leonAudio: 'assets/chapitre_3/t5_leon.mp3',
          leonEndDelayMs: 500,  // laisse 500ms aux notes pour finir leur envol
          onLeonStart: () => { const v = document.getElementById('leon-video-c3s5'); if (v) v.play().catch(()=>{}); },
          onLeonEnd: () => {
            const v = document.getElementById('leon-video-c3s5'); if (v) { try { v.pause(); } catch(e) {} }
            if (typeof activateC3s5Game === 'function') setTimeout(activateC3s5Game, 600);
          }
        },
        c3s6: {
          narratorAudio: 'assets/chapitre_3/t6_narrateur.mp3', leonAudio: 'assets/chapitre_3/t6_leon.mp3?v=366',
          onLeonStart: () => { const v = document.getElementById('leon-video-c3s6'); if (v) v.play().catch(()=>{}); },
          onLeonEnd:   () => { const v = document.getElementById('leon-video-c3s6'); if (v) { try { v.pause(); } catch(e) {} } }
        },
        // c3s7 : mini-jeu, mais on garde le karaoké narrateur+Léon (image fixe)
        c3s7: {
          narratorAudio: 'assets/chapitre_3/t7_narrateur.mp3', leonAudio: 'assets/chapitre_3/t7_leon.mp3',
          onLeonEnd: () => { /* Pas de playConsigne('c3s7') : Leon dit deja la consigne. */ }
        },
        // Chapitre 4 : Bot, l'IA qui parle
        c4s1: {
          narratorAudio: 'assets/chapitre_4/t1_narrateur.mp3', leonAudio: 'assets/chapitre_4/t1_leon.mp3',
          onLeonStart: () => { const v = document.getElementById('leon-video-c4s1'); if (v) v.play().catch(()=>{}); },
          onLeonEnd:   () => { const v = document.getElementById('leon-video-c4s1'); if (v) { try { v.pause(); } catch(e) {} } }
        },
        c4s2: {
          narratorAudio: 'assets/chapitre_4/t2_narrateur.mp3', leonAudio: 'assets/chapitre_4/t2_leon.mp3',
          onLeonStart: () => { const v = document.getElementById('leon-video-c4s2'); if (v) v.play().catch(()=>{}); },
          // Active le mini-jeu ici : onLeonEnd se declenche a la fin de l'audio
          // de Leon (alors que onComplete se declenche a la fin du typewriter,
          // qui peut etre plus court que l'audio si le texte est court).
          onLeonEnd:   () => {
            const v = document.getElementById('leon-video-c4s2'); if (v) { try { v.pause(); } catch(e) {} }
            if (typeof activateC4s2Game === 'function') setTimeout(activateC4s2Game, 600);
          }
        },
        c4s3: {
          narratorAudio: 'assets/chapitre_4/t3_narrateur.mp3', leonAudio: 'assets/chapitre_4/t3_leon.mp3',
          onLeonStart: () => { const v = document.getElementById('leon-video-c4s3'); if (v) v.play().catch(()=>{}); },
          onLeonEnd: () => {
            const v = document.getElementById('leon-video-c4s3'); if (v) { try { v.pause(); } catch(e) {} }
            if (typeof activateC4s3Game === 'function') activateC4s3Game();
          }
        },
        c4s4: {
          narratorAudio: 'assets/chapitre_4/t4_narrateur.mp3', leonAudio: 'assets/chapitre_4/t4_leon.mp3',
          onLeonStart: () => { const v = document.getElementById('leon-video-c4s4'); if (v) v.play().catch(()=>{}); },
          onLeonEnd:   () => { const v = document.getElementById('leon-video-c4s4'); if (v) { try { v.pause(); } catch(e) {} } }
        },
        c4s5: {
          narratorAudio: 'assets/chapitre_4/t5_narrateur.mp3', leonAudio: 'assets/chapitre_4/t5_leon.mp3',
          onLeonStart: () => {
            const v = document.getElementById('leon-video-c4s5');
            // Reset le flag de stop pour autoriser la vidéo à reboucler PENDANT
            // que Léon parle. On le remettra à true dans onLeonEnd.
            window._c4s5LoopOff = false;
            if (v) { v.currentTime = 1.5; v.play().catch(()=>{}); }
            // v447 : trace le moment ou Leon commence pour proteger contre
            // un onLeonEnd premature (sur iOS, leonAudio peut fire 'ended'
            // instantanement si play() echoue silencieux -> activateC4s5Game
            // declenche trop tot, video a peine demarree).
            window._c4s5LeonStartTs = Date.now();
          },
          onLeonEnd: () => {
            const v = document.getElementById('leon-video-c4s5');
            // v447 : si onLeonEnd fire <8s apres onLeonStart, c est trop tot
            // (audio Leon dure ~13.5s). On reschedule l activation du game
            // pour laisser la video tourner le temps voulu.
            const elapsed = Date.now() - (window._c4s5LeonStartTs || 0);
            const MIN_PLAY_MS = 13500;
            const remaining = Math.max(0, MIN_PLAY_MS - elapsed);
            setTimeout(() => {
              // Coupe le rebouclage AVANT de pause -> sinon timeupdate/ended
              // relance la vidéo pendant le memory game.
              window._c4s5LoopOff = true;
              if (v) { try { v.pause(); } catch(e) {} }
              if (typeof activateC4s5Game === 'function') activateC4s5Game();
            }, remaining);
          }
        },
        // c4s6 : mini-jeu "Trouve l'erreur de Bot" (image fixe, pas de video)
        // v450 : narrateur retire (pas de narration). Leon dit son dialogue
        // original (Choisis une question et observe la reponse de Bot...) puis
        // a la fin du dialogue, le mini-jeu apparait + Leon dit la consigne
        // specifique du jeu (Clique sur une question et donne la reponse...).
        c4s6: {
          leonAudio: 'assets/chapitre_4/t6_leon.mp3',
          // Active le panneau de questions a la fin de l'audio Leon (+ 600ms)
          // puis joue la consigne audio specifique du jeu.
          onLeonEnd: () => {
            setTimeout(() => {
              const sceneText = document.querySelector('#screen-c4s6 .scene-text');
              if (sceneText) sceneText.style.display = 'none';
              const game = document.getElementById('c4s6-game');
              if (game) game.style.display = '';
              // Consigne du mini-jeu, voix Leon (assets/consignes/c4s6.mp3)
              if (typeof playConsigne === 'function') playConsigne('c4s6');
            }, 600);
          }
        },
        // Chapitre 5 : Le toit aux étoiles (4 narratifs vidéo)
        c5s1: {
          narratorAudio: 'assets/chapitre_5/t1_narrateur.mp3', leonAudio: 'assets/chapitre_5/t1_leon.mp3',
          onLeonStart: () => { const v = document.getElementById('leon-video-c5s1'); if (v) v.play().catch(()=>{}); },
          onLeonEnd:   () => { const v = document.getElementById('leon-video-c5s1'); if (v) { try { v.pause(); } catch(e) {} } }
        },
        c5s2: {
          narratorAudio: 'assets/chapitre_5/t2_narrateur.mp3', leonAudio: 'assets/chapitre_5/t2_leon.mp3',
          onLeonStart: () => { const v = document.getElementById('leon-video-c5s2'); if (v) v.play().catch(()=>{}); },
          onLeonEnd: () => {
            const v = document.getElementById('leon-video-c5s2'); if (v) { try { v.pause(); } catch(e) {} }
            if (typeof activateC5s2Game === 'function') setTimeout(activateC5s2Game, 600);
          }
        },
        c5s3: {
          narratorAudio: 'assets/chapitre_5/t3_narrateur.mp3?v=376', leonAudio: 'assets/chapitre_5/t3_leon.mp3?v=376',
          onLeonStart: () => { const v = document.getElementById('leon-video-c5s3'); if (v) v.play().catch(()=>{}); },
          onLeonEnd: () => {
            const v = document.getElementById('leon-video-c5s3'); if (v) { try { v.pause(); } catch(e) {} }
            if (typeof activateC5s3Game === 'function') activateC5s3Game();
          }
        },
        c5s4: {
          narratorAudio: 'assets/chapitre_5/t4_narrateur.mp3', leonAudio: 'assets/chapitre_5/t4_leon.mp3',
          onLeonStart: () => { const v = document.getElementById('leon-video-c5s4'); if (v) v.play().catch(()=>{}); },
          onLeonEnd: () => {
            const v = document.getElementById('leon-video-c5s4'); if (v) { try { v.pause(); } catch(e) {} }
            if (typeof activateC5s4Wish === 'function') activateC5s4Wish();
          }
        },
        // c5s5 : mini-jeu "construis ton robot IA" (image fixe, pas de video,
        // pas de dialogue intro). v475 : narrateur+leon audios retires - le
        // user veut juste la consigne directe. La consigne est jouee dans le
        // handler 'c5s5' du screen change (cf. plus bas), pas via onLeonEnd.
        c5s5: {}
      };
      playStoryScene(screenIdentifier, optsMap[screenIdentifier] || {});
    } else if (screenIdentifier !== 'c2s3') {
      // Mini-jeu / quiz : on affiche les boutons après une courte pause
      const sActions = document.querySelector(`#screen-${screenIdentifier} .answers-group`);
      if (sActions) {
        sActions.classList.remove('show');
        setTimeout(() => sActions.classList.add('show'), 1200);
      }
    }
  }

  // Mini-jeu écran c2s7 : reset à l'entrée
  // c2s5 : mini-jeu "Trouve les defauts !" — reset a l'entree
  if (screenIdentifier === 'c2s5') {
    if (typeof resetC2s5Game === 'function')      resetC2s5Game();
    if (typeof applyC2s5DefectPos === 'function') applyC2s5DefectPos();
  }

  // c5s4 : reset visuel de la mini-interaction "Mon voeu" a chaque entree.
  // La zone reapparaitra apres le karaoke via opts.onComplete -> activateC5s4Wish().
  if (screenIdentifier === 'c5s4') {
    const zone = document.getElementById('c5s4-wish');
    if (zone) {
      zone.classList.remove('show');
      zone.style.display = 'none';
    }
    // Cache le bouton "Continuer" tant que le voeu n'est pas sauvegarde
    const skip = document.querySelector('#screen-c5s4 .c5s4-skip-btn');
    if (skip) {
      const actions = skip.closest('.answers-group');
      if (actions) actions.style.display = 'none';
    }
  }

  // c5s2 : reset des hotspots a chaque entree.
  // Le panneau et les zones reapparaitront apres le karaoke via opts.onComplete.
  if (screenIdentifier === 'c5s2') {
    if (typeof resetC5s2Game === 'function') resetC5s2Game();
    if (typeof applyC5s2SpotPos === 'function') applyC5s2SpotPos();
  }

  // c4s5 : reset du memory game a chaque entree.
  if (screenIdentifier === 'c4s5') {
    if (typeof resetC4s5Game === 'function') resetC4s5Game();
  }

  // c4s3 : reset de la cascade de livres a chaque entree.
  if (screenIdentifier === 'c4s3') {
    if (typeof resetC4s3Game === 'function') resetC4s3Game();
  }

  // c2s2 : reset de l'inspecteur a chaque entree.
  if (screenIdentifier === 'c2s2') {
    if (typeof resetC2s2Game === 'function') resetC2s2Game();
    if (typeof applyC2s2SpotPos === 'function') applyC2s2SpotPos();
  }

  // c5s3 : reset du swipe Vrai/Fake a chaque entree.
  if (screenIdentifier === 'c5s3') {
    if (typeof resetC5s3Game === 'function') resetC5s3Game();
  }

  // c3s3 : reset BONJOUR a chaque entree
  if (screenIdentifier === 'c3s3') {
    if (typeof resetC3s3Game === 'function') resetC3s3Game();
  }

  // c3s2 : reset bulles de mots a chaque entree
  if (screenIdentifier === 'c3s2') {
    if (typeof resetC3s2Game === 'function') resetC3s2Game();
  }

  // c3s5 : reset compose-3-notes a chaque entree
  if (screenIdentifier === 'c3s5') {
    if (typeof resetC3s5Game === 'function') resetC3s5Game();
  }

  // c4s2 : reset pose-question-a-Bot a chaque entree
  if (screenIdentifier === 'c4s2') {
    if (typeof resetC4s2Game === 'function') resetC4s2Game();
  }

  if (screenIdentifier === 'c2s7') {
    state.c2WordsSelected = [];
    saveState();
    // v426 : recalibre les overlays (toile + typewriter + result) sur le rect
    // VIDEO reel (cover-fit aware), comme c2s3 (cf. applyC2s3Overlays / v415-v417).
    // Appel synchrone + frame+timeouts car la scene n est pas toujours mesurable
    // a l instant goToScreen.
    if (typeof applyC2s7Overlays === 'function') {
      applyC2s7Overlays();
      requestAnimationFrame(applyC2s7Overlays);
      setTimeout(applyC2s7Overlays, 100);
      setTimeout(applyC2s7Overlays, 400);
    }
    document.querySelectorAll('#c2s7-words .prompt-word').forEach(b => {
      b.classList.remove('selected');
      b.onclick = () => selectPromptWord(b);
    });
    // Reset composition résultat + typewriter
    const result = document.getElementById('canvas-result-c2s7');
    if (result) result.classList.remove('revealed', 'style-volant', 'style-geant', 'style-rigolo');
    const twWrap = document.getElementById('prompt-typewriter-c2s7');
    if (twWrap) twWrap.classList.remove('show');
    const tw = document.querySelector('#prompt-typewriter-c2s7 .prompt-text-c7');
    if (tw) tw.textContent = '';
    document.getElementById('btn-to-c2s8')?.classList.remove('show-btn');
    document.getElementById('btn-c2s7-restart')?.classList.remove('show-btn');
  }

  // Quiz écran c2s8 : reset du quiz à l'entrée
  if (screenIdentifier === 'c2s8') {
    state.vfScoreC2 = 0;
    state.vfDoneC2 = 0;
    state.vfAnsweredC2 = [false, false, false, false];
    saveState();
    document.querySelectorAll('#screen-c2s8 .vf-btn').forEach(b => {
      b.disabled = false;
      b.classList.remove('correct', 'wrong');
    });
    document.getElementById('score-display-c2').style.display = 'none';
    document.getElementById('btn-to-c2s9')?.classList.remove('show-btn');
  }

  // ============================================================
  // CHAPITRE 3 : LE DÉTECTIVE DES SONS — handlers spécifiques
  // ============================================================
  if (screenIdentifier === 'c3s7') {
    state.c3SoundsPlayed = [];
    state.c3SoundsAnswered = [];
    saveState();
    document.querySelectorAll('#c3s7-sounds .sound-btn').forEach(b => {
      b.classList.remove('played');
      b.onclick = () => playSoundC3(b);
    });
    const transcript = document.getElementById('c3s7-transcription');
    if (transcript) transcript.textContent = '— —';
    document.getElementById('btn-to-c3s8')?.classList.remove('show-btn');
    if (typeof _c3s7HideSayDoneButton === 'function') _c3s7HideSayDoneButton();
    // Applique les positions de micros sauvegardées (calibration)
    if (typeof applyC3s7MicPositions === 'function') applyC3s7MicPositions();
    // L'audio narrateur + Léon est désormais géré par playStoryScene via
    // narrativeC3 (karaoké standard, comme c3s1..c3s6).
  }

  if (screenIdentifier === 'c3s8') {
    state.vfScoreC3 = 0;
    state.vfDoneC3 = 0;
    state.vfAnsweredC3 = [false, false, false, false];
    saveState();
    document.querySelectorAll('#screen-c3s8 .vf-btn').forEach(b => {
      b.disabled = false;
      b.classList.remove('correct', 'wrong');
    });
    document.getElementById('score-display-c3').style.display = 'none';
    document.getElementById('btn-to-c3s9')?.classList.remove('show-btn');

    // Voix d'introduction du quiz : narrateur puis Léon
    if (window.narratorAudio) { try { window.narratorAudio.pause(); } catch(e){} }
    if (window.leonAudio)     { try { window.leonAudio.pause();     } catch(e){} }
    if (typeof voicesEnabled === 'function' && voicesEnabled()) {
      const narrAudio = getVoice('narr_c3s8', 'assets/chapitre_3/t8_narrateur.mp3?v=' + Date.now());
      const leonAudio = getVoice('leon_c3s8', 'assets/chapitre_3/t8_leon.mp3?v='     + Date.now());
      window.narratorAudio = narrAudio;
      const playLeon = () => {
        if (!leonAudio) return;
        window.leonAudio = leonAudio;
        leonAudio.currentTime = 0;
        leonAudio.play().catch(() => {});
      };
      if (narrAudio) {
        narrAudio.currentTime = 0;
        narrAudio.addEventListener('ended', () => setTimeout(playLeon, 400), { once: true });
        narrAudio.play().catch(playLeon);
      } else {
        playLeon();
      }
    }
  }

  if (screenIdentifier === 'c3s9') {
    const cdC3 = charData[state.characterType] || {};
    const heroFaceC3 = document.getElementById('hero-win-face-c3');
    if (heroFaceC3) {
      if (cdC3.faceImgClean) {
        heroFaceC3.src = cdC3.faceImgClean;
        heroFaceC3.style.filter = 'drop-shadow(0 10px 18px rgba(0,0,0,0.5))';
        heroFaceC3.style.clipPath = 'none';
      } else {
        heroFaceC3.src = cdC3.faceImg || cdC3.img || '';
        heroFaceC3.style.filter = 'url(#greenKeyShadow)';
        heroFaceC3.style.clipPath = 'inset(2px)';
      }
    }
    document.getElementById('win-name-c3').textContent = state.characterName;
    if (!state.starsAwardedC3) {
      const earnedC3 = 5 + state.vfScoreC3;
      addStars(earnedC3);
      document.getElementById('stars-earned-c3').textContent = `+${earnedC3} ⭐`;
      state.starsAwardedC3 = true;
    } else {
      const bonus = awardReplayBonus(3);
      if (bonus > 0) document.getElementById('stars-earned-c3').textContent = `+${bonus} ⭐ bonus replay !`;
      else document.getElementById('stars-earned-c3').textContent = `Bravo !`;
    }
    if (!state.chaptersCompleted.includes(3)) {
      state.chaptersCompleted.push(3);
    }
    saveState();
    launchConfettiC3();
    if (typeof awardLegendaryLeonIfPerfect === 'function') awardLegendaryLeonIfPerfect();
    if (typeof updateStarBadge === 'function') updateStarBadge();
    if (typeof applyStarCornerPosition === 'function') applyStarCornerPosition();
    if (typeof _playVictoryJingle === 'function') _playVictoryJingle();
  }

  // ============================================================
  // CHAPITRE 4 : BOT, L'IA QUI PARLE — handlers spécifiques
  // ============================================================
  if (screenIdentifier === 'c4s6') {
    state.c4QuestionsAsked = [];
    state.c4WrongFound = [];
    saveState();
    // Reset visibility : le panneau de jeu est cache jusqu'a la fin de Leon (onLeonEnd)
    const game = document.getElementById('c4s6-game');
    if (game) game.style.display = 'none';
    const sceneText = document.querySelector('#screen-c4s6 .scene-text');
    if (sceneText) sceneText.style.display = '';
    document.querySelectorAll('#c4s6-questions .sound-btn').forEach(b => {
      b.classList.remove('played', 'hunt-mode', 'found-wrong', 'bot-was-right', 'has-answer', 'thinking');
      b.disabled = false;
      b.onclick = () => askBotC4(b);
      // remettre l'invite par defaut dans chaque carte
      const slot = b.querySelector('.q-answer');
      if (slot) slot.textContent = slot.dataset.empty || '🤔 Touche-moi pour poser la question';
    });
    const ans = document.getElementById('c4s6-answer');
    const label = document.getElementById('c4s6-result-label');
    const instr = document.getElementById('c4s6-instruction');
    if (ans) ans.textContent = 'Pose une question à Bot pour voir sa réponse...';
    if (label) label.textContent = 'Bot répond :';
    // v455 : texte aligne sur l audio Leon (v452 dans HTML, restaure ici au reset)
    if (instr) instr.textContent = '👆 Clique sur une question et donne la réponse. Clique à nouveau pour voir la réponse de Bot.';
    // v457 : cache le frame .sound-result au reset (revisit de la scene).
    // Il sera re-show en phase 2 via activateHuntModeC4.
    const result = document.getElementById('c4s6-result');
    if (result) result.style.display = 'none';
    document.getElementById('btn-to-c4s7')?.classList.remove('show-btn');
  }

  if (screenIdentifier === 'c4s7') {
    state.vfScoreC4 = 0;
    state.vfDoneC4 = 0;
    state.vfAnsweredC4 = [false, false, false, false];
    saveState();
    document.querySelectorAll('#screen-c4s7 .vf-btn').forEach(b => {
      b.disabled = false;
      b.classList.remove('correct', 'wrong');
    });
    document.getElementById('score-display-c4').style.display = 'none';
    document.getElementById('btn-to-c4s8')?.classList.remove('show-btn');
  }

  if (screenIdentifier === 'c4s8') {
    const cdC4 = charData[state.characterType] || {};
    const heroFaceC4 = document.getElementById('hero-win-face-c4');
    if (heroFaceC4) {
      if (cdC4.faceImgClean) {
        heroFaceC4.src = cdC4.faceImgClean;
        heroFaceC4.style.filter = 'drop-shadow(0 10px 18px rgba(0,0,0,0.5))';
        heroFaceC4.style.clipPath = 'none';
      } else {
        heroFaceC4.src = cdC4.faceImg || cdC4.img || '';
        heroFaceC4.style.filter = 'url(#greenKeyShadow)';
        heroFaceC4.style.clipPath = 'inset(2px)';
      }
    }
    document.getElementById('win-name-c4').textContent = state.characterName;
    if (!state.starsAwardedC4) {
      const earnedC4 = 5 + state.vfScoreC4;
      addStars(earnedC4);
      document.getElementById('stars-earned-c4').textContent = `+${earnedC4} ⭐`;
      state.starsAwardedC4 = true;
    } else {
      const bonus = awardReplayBonus(4);
      if (bonus > 0) document.getElementById('stars-earned-c4').textContent = `+${bonus} ⭐ bonus replay !`;
      else document.getElementById('stars-earned-c4').textContent = `Bravo !`;
    }
    if (!state.chaptersCompleted.includes(4)) {
      state.chaptersCompleted.push(4);
    }
    saveState();
    if (typeof launchConfettiC4 === 'function') launchConfettiC4();
    if (typeof awardLegendaryLeonIfPerfect === 'function') awardLegendaryLeonIfPerfect();
    if (typeof updateStarBadge === 'function') updateStarBadge();
    if (typeof applyStarCornerPosition === 'function') applyStarCornerPosition();
    if (typeof _playVictoryJingle === 'function') _playVictoryJingle();
  }

  // ============================================================
  // CHAPITRE 5 — Le toit aux étoiles : mini-jeu robot + victoire
  // ============================================================
  if (screenIdentifier === 'c5s5') {
    // v475 : c5s5 n a PAS de dialogue intro narrateur/leon (le mini-jeu
    // demarre direct). On joue juste la consigne audio Leon "Choisis 3
    // modules pour ton robot" a l entree, apres une petite pause pour
    // laisser la scene se rendre.
    setTimeout(() => {
      if (typeof playConsigne === 'function') playConsigne('c5s5');
    }, 500);
    state.c5RobotModules = [];
    saveState();
    document.querySelectorAll('#c5s5-modules .c5-module-btn').forEach(b => {
      b.classList.remove('selected');
      b.disabled = false;
      // v482 : sur iOS, pointerdown n est PAS un transient activation trigger
      // (seuls click, pointerup, touchend le sont). Donc speechSynthesis.speak()
      // appele dans selectC5Module via pointerdown est REJETE par iOS -> greeting
      // muet. Sur iOS uniquement : on utilise click (gesture media OK), on
      // accepte le delai 300ms d origine. Sur Android : on garde pointerdown
      // pour le single-tap.
      const isIOSDev = typeof _isIOSDevice === 'function' && _isIOSDevice();
      if (isIOSDev) {
        b.onpointerdown = null;
        b.onclick = (ev) => {
          if (b.disabled) return;
          selectC5Module(b);
        };
      } else {
        // Android : pointerdown pour single-tap fix
        b._c5HandlePointer = (ev) => {
          if (b.disabled) return;
          if (b._c5Handled) return;
          b._c5Handled = true;
          setTimeout(() => { b._c5Handled = false; }, 350);
          ev.preventDefault();
          selectC5Module(b);
        };
        b.onpointerdown = b._c5HandlePointer;
        b.onclick = (ev) => {
          if (b._c5Handled) { ev.preventDefault(); return; }
          selectC5Module(b);
        };
      }
    });
    document.getElementById('btn-to-c5s6')?.classList.remove('show-btn');
    const instr = document.getElementById('c5s5-instruction');
    if (instr) instr.innerHTML = 'Choisis <strong>3 modules</strong> pour ton robot 👇';
    // Reset des phases
    const phasePick  = document.getElementById('c5s5-phase-pick');
    const phaseRobot = document.getElementById('c5s5-phase-robot');
    const countdown  = document.getElementById('c5s5-countdown');
    const bubble     = document.getElementById('c5s5-bubble');
    const demoBtns   = document.getElementById('c5s5-demo-buttons');
    const confetti   = document.getElementById('c5s5-confetti');
    if (phasePick)  phasePick.style.display  = '';
    if (phaseRobot) phaseRobot.style.display = 'none';
    if (countdown)  countdown.style.display  = 'none';
    if (bubble)     bubble.style.display     = 'none';
    if (demoBtns)   demoBtns.innerHTML       = '';
    if (confetti)   confetti.innerHTML       = '';
    if (typeof _c5DemosTested !== 'undefined') _c5DemosTested = new Set();
    // Stoppe la voix synthétique si en cours
    try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch(e) {}
    // Stoppe la vidéo
    const video = document.getElementById('c5s5-robot-video');
    if (video) { try { video.pause(); video.removeAttribute('src'); video.load(); } catch(e) {} }
  }

  if (screenIdentifier === 'c5s6') {
    const cdC5 = charData[state.characterType] || {};
    const heroFaceC5 = document.getElementById('hero-win-face-c5');
    if (heroFaceC5) {
      if (cdC5.faceImgClean) {
        heroFaceC5.src = cdC5.faceImgClean;
        heroFaceC5.style.filter = 'drop-shadow(0 10px 18px rgba(0,0,0,0.5))';
        heroFaceC5.style.clipPath = 'none';
      } else {
        heroFaceC5.src = cdC5.faceImg || cdC5.img || '';
        heroFaceC5.style.filter = 'url(#greenKeyShadow)';
        heroFaceC5.style.clipPath = 'inset(2px)';
      }
    }
    document.getElementById('win-name-c5').textContent = state.characterName;
    if (!state.starsAwardedC5) {
      const earnedC5 = 7;  // chap 5 : pas de quiz, recompense fixe = 7 etoiles
      addStars(earnedC5);
      document.getElementById('stars-earned-c5').textContent = `+${earnedC5} ⭐`;
      state.starsAwardedC5 = true;
    } else {
      const bonus = awardReplayBonus(5);
      if (bonus > 0) document.getElementById('stars-earned-c5').textContent = `+${bonus} ⭐ bonus replay !`;
      else document.getElementById('stars-earned-c5').textContent = `Bravo !`;
    }
    if (!state.chaptersCompleted.includes(5)) {
      state.chaptersCompleted.push(5);
    }
    saveState();
    if (typeof launchConfettiC5 === 'function') launchConfettiC5();
    // Tente de débloquer la carte LÉGENDAIRE si 16/16 sur tous les quiz
    if (typeof awardLegendaryLeonIfPerfect === 'function') awardLegendaryLeonIfPerfect();
    // Filet de securite : on force la mise a jour de la pastille etoiles
    // globale + on reapplique sa position calibree. addStars() s'en occupe
    // deja, mais sur l'ecran de victoire (transition sceneswap) la pastille
    // pouvait afficher l'ancien total / etre mal positionnee dans certains cas.
    if (typeof updateStarBadge === 'function') updateStarBadge();
    if (typeof applyStarCornerPosition === 'function') applyStarCornerPosition();
    if (typeof _playVictoryJingle === 'function') _playVictoryJingle();
  }

  // Victoire chapitre 2
  if (screenIdentifier === 'c2s9') {
    const cdC29 = charData[state.characterType] || {};
    const heroFaceC2 = document.getElementById('hero-win-face-c2');
    if (heroFaceC2) {
      if (cdC29.faceImgClean) {
        heroFaceC2.src = cdC29.faceImgClean;
        heroFaceC2.style.filter = 'drop-shadow(0 10px 18px rgba(0,0,0,0.5))';
        heroFaceC2.style.clipPath = 'none';
      } else {
        heroFaceC2.src = cdC29.faceImg || cdC29.img || '';
        heroFaceC2.style.filter = 'url(#greenKeyShadow)';
        heroFaceC2.style.clipPath = 'inset(2px)';
      }
    }
    document.getElementById('win-name-c2').textContent = state.characterName;
    if (!state.starsAwardedC2) {
      const earnedC2 = 5 + state.vfScoreC2;
      addStars(earnedC2);
      document.getElementById('stars-earned-c2').textContent = `+${earnedC2} ⭐`;
      state.starsAwardedC2 = true;
    } else {
      const bonus = awardReplayBonus(2);
      if (bonus > 0) document.getElementById('stars-earned-c2').textContent = `+${bonus} ⭐ bonus replay !`;
      else document.getElementById('stars-earned-c2').textContent = `Bravo !`;
    }
    if (!state.chaptersCompleted.includes(2)) {
      state.chaptersCompleted.push(2);
    }
    saveState();
    launchConfettiC2();
    if (typeof awardLegendaryLeonIfPerfect === 'function') awardLegendaryLeonIfPerfect();
    if (typeof updateStarBadge === 'function') updateStarBadge();
    if (typeof applyStarCornerPosition === 'function') applyStarCornerPosition();
    if (typeof _playVictoryJingle === 'function') _playVictoryJingle();
  }

  if (screenIdentifier === 8) {
    const cd8 = charData[state.characterType] || {};
    const heroFamily = document.getElementById('hero-family');
    if (heroFamily) {
      heroFamily.src = cd8.faceImgClean || cd8.faceImg || cd8.img || '';
      heroFamily.style.filter = cd8.faceImgClean
        ? 'drop-shadow(0 10px 18px rgba(0,0,0,0.5))'
        : 'url(#greenKeyShadow)';
      heroFamily.style.clipPath = cd8.faceImgClean ? 'none' : 'inset(2px)';
    }
    // Reset des 3 sections interactives (inputs + confirmations cachees)
    ['mission', 'question', 'imagine'].forEach(section => {
      const input   = document.getElementById('family-' + section + '-input');
      const btn     = document.getElementById('family-' + section + '-btn');
      const confirm = document.getElementById('family-' + section + '-confirm');
      if (input) {
        input.value = '';
        input.disabled = false;
        input.style.background = '';
      }
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Valider ✓';
        btn.style.opacity = '';
      }
      if (confirm) confirm.classList.remove('show');
    });
  }

  if (screenIdentifier === 7) {
    document.getElementById('main-progress').style.display = 'none';
    // Héros de face avec chroma-key
    const cd7 = charData[state.characterType] || {};
    const heroFace = document.getElementById('hero-win-face');
    if (heroFace) {
      // Priorité : version sans fond (removebg) > version fond vert (chroma) > avatar
      if (cd7.faceImgClean) {
        heroFace.src = cd7.faceImgClean;
        heroFace.style.filter = 'drop-shadow(0 10px 18px rgba(0,0,0,0.5))';
        heroFace.style.clipPath = 'none';
      } else {
        heroFace.src = cd7.faceImg || cd7.img || '';
        heroFace.style.filter = 'url(#greenKeyShadow)';
        heroFace.style.clipPath = 'inset(2px)';
      }
    }
    document.getElementById('win-name').textContent = state.characterName;
    if (!state.starsAwarded) {
      const earned = 5 + state.vfScore;
      addStars(earned);
      document.getElementById('stars-earned').textContent = `+${earned} ⭐`;
      state.starsAwarded = true;
    } else {
      const bonus = awardReplayBonus(1);
      if (bonus > 0) document.getElementById('stars-earned').textContent = `+${bonus} ⭐ bonus replay !`;
      else document.getElementById('stars-earned').textContent = `Bravo !`;
    }
    if (!state.chaptersCompleted.includes(1)) {
      state.chaptersCompleted.push(1);
    }
    saveState();
    launchConfetti();
    if (typeof awardLegendaryLeonIfPerfect === 'function') awardLegendaryLeonIfPerfect();
    if (typeof updateStarBadge === 'function') updateStarBadge();
    if (typeof applyStarCornerPosition === 'function') applyStarCornerPosition();
    if (typeof _playVictoryJingle === 'function') _playVictoryJingle();
  }

  const isMap = screenIdentifier === 'map';

  if (isMap || screenIdentifier === 0) {
    document.getElementById('main-header').style.display = 'none';
    document.getElementById('main-progress').style.display = 'none';
  }

  // ===== MAP LOGIC =====
  if (screenIdentifier === 2) {
    document.body.classList.add('street-mode');
    // Scene immersive : on cache le header IA Explorers et la barre de progression
    document.getElementById('main-header').style.display = 'none';
    document.getElementById('main-progress').style.display = 'none';
    // Sync compteur etoiles + restaure position calibree de la pastille
    const sscEl = document.getElementById('street-star-count');
    if (sscEl) sscEl.textContent = state.totalStars || 0;
    if (typeof applyStarCornerPosition === 'function') applyStarCornerPosition();
    if (typeof applySignZonePos        === 'function') applySignZonePos();
    if (typeof applyPointerPos         === 'function') applyPointerPos();
    if (typeof applyHeroDestPos        === 'function') applyHeroDestPos();
    enterFullscreen();
  } else {
    document.body.classList.remove('street-mode');
  }

  if (isMap) {
    document.body.classList.add('map-mode');
    // Sync compteur etoiles dans le bouton Mon Atelier
    const msc = document.getElementById('map-star-count');
    if (msc) msc.textContent = state.totalStars || 0;
    // Filet de securite : on reapplique les positions calibrees des noeuds a
    // chaque entree sur la map. Si loadCalibrationFromServer n'avait pas encore
    // fini son fetch async lors du premier passage, ce reapply garantit que
    // les noeuds finissent toujours aux bonnes coordonnees.
    if (typeof applyMapNodePositions === 'function') applyMapNodePositions();

    // L'avatar devient le pion
    const sagaHero = document.getElementById('map-hero-avatar');
    if (sagaHero && state.characterImage) {
      sagaHero.src = state.characterImage;
      sagaHero.style.display = 'block';
    }
    // Cree le wrapper d'accessoires + applique les emojis equipes (couronne, etc.)
    if (typeof applyAvatarAccessoriesEverywhere === 'function') applyAvatarAccessoriesEverywhere();
    // Apres wrapping, c'est le wrapper qui porte la position absolue (cf. style.css).
    const sagaWrap = (sagaHero && sagaHero.parentElement && sagaHero.parentElement.classList.contains('avatar-accessory-wrap'))
                       ? sagaHero.parentElement : sagaHero;
    if (sagaWrap && sagaHero) sagaWrap.style.display = 'block';

    updateMapState();
    // Restaure les positions des noeuds calibrées par l'utilisateur (si modifiées via 🎯 Calibrer)
    if (typeof applyMapNodePositions === 'function') applyMapNodePositions();
    // Positionne l'avatar sur le prochain chapitre à jouer
    const nextChap = (state.chaptersCompleted.length || 0) + 1;
    const avatarNode = document.getElementById('map-node-' + Math.min(nextChap, 5));
    const fallbackNode = document.getElementById('map-node-1');
    const anchorNode = avatarNode || fallbackNode;
    if (anchorNode && sagaWrap) {
      sagaWrap.style.top = anchorNode.style.top;
      sagaWrap.style.left = anchorNode.style.left;
    }

    // Force le scroll vers le bas de la carte
    const screenMap = document.getElementById('screen-map');

    function scrollMapToBottom() {
      if (!screenMap) return;
      // Sur mobile/tactile, la map est position:absolute full-screen, il n'y
      // a rien a scroller. Mais si on scrolle quand meme (overflow:auto de
      // base), les enfants absolute sont visuellement decales (bug -31).
      const isMobile = window.matchMedia && (
        window.matchMedia('(max-width: 900px)').matches ||
        window.matchMedia('(pointer: coarse)').matches
      );
      if (isMobile) {
        screenMap.scrollTop = 0;
      } else {
        screenMap.scrollTop = screenMap.scrollHeight;
      }
    }

    // Fix bug "cadre Netflix tout autour" : 100dvh est parfois fige a une
    // mauvaise valeur quand on arrive sur la map (barre URL Chrome qui change
    // de visibilite, ou viewport encore en transition). Resultat : la map
    // est plus courte que l'ecran, et le purple foncé du #screen-map background
    // apparait sous la map. Au rotate/exit, le browser recalcule 100dvh et le
    // bug disparait.
    // Solution : forcer une hauteur explicite en JS basee sur window.innerHeight
    // qui est toujours a jour, contrairement a 100dvh dont la maj depend du browser.
    // IMPORTANT : le CSS a `height: 100dvh !important` qui bat un style inline
    // normal. Il faut donc utiliser setProperty(..., 'important') pour gagner.
    function fixMapVH() {
      // v649 : on REMET le JS fixMapVH parce que la CSS position:fixed inset:0
      // seule n'a pas suffi (user feedback : bande noire persistante). Chrome
      // calcule 100vh a une valeur differente de innerHeight au premier paint
      // sur certains setups. Le JS mesure et applique la VRAIE valeur.
      if (!screenMap) return;
      // v649 : utilise EXACTEMENT innerHeight (mesure JS, pas 100vh CSS qui
      // peut etre miscalcule par Chrome au premier paint).
      const h = window.innerHeight;
      const w = window.innerWidth;
      screenMap.style.setProperty('height', h + 'px', 'important');
      screenMap.style.setProperty('min-height', h + 'px', 'important');
      screenMap.style.setProperty('max-height', h + 'px', 'important');
      screenMap.style.setProperty('width', w + 'px', 'important');
      // Force overflow: hidden + scrollTop: 0. Le #screen-map de base a
      // `overflow-y: auto` et scrollMapToBottom() scrolle a la fin du
      // contenu. Sur mobile, cela cree un decalage visuel de -31px sur les
      // enfants absolute (mp.bRect.top = -31 alors que offsetTop = 0).
      screenMap.style.setProperty('overflow', 'hidden', 'important');
      screenMap.style.setProperty('overflow-x', 'hidden', 'important');
      screenMap.style.setProperty('overflow-y', 'hidden', 'important');
      screenMap.scrollTop = 0;
      // Force TOUTES les proprietes de positionnement de .full-map-pixar pour
      // ne laisser aucune ambiguite avec le CSS (aspect-ratio, top, bottom,
      // transform peuvent fight le sizing). On utilise des valeurs absolues.
      // Force aussi animation: none sur screen-map au cas ou slideUpFade
      // tournerait quand meme (laisserait une translateY residuelle).
      screenMap.style.setProperty('animation', 'none', 'important');
      screenMap.style.setProperty('transform', 'none', 'important');
      const mapPixar = screenMap.querySelector('.full-map-pixar');
      if (mapPixar) {
        // v337 : object-fit: fill (etirement) au lieu de cover (crop).
        // La map remplit tout l'ecran -> mapW = innerWidth, mapH = innerHeight.
        // L'image est etiree d'environ 26% horizontalement (ratio image 1.78
        // vs ratio viewport 2.25 sur Pixel 9), mais aucun pixel n'est crope
        // et les chapitres en % restent positionnes correctement sur leurs
        // landmarks (Leon sur sa maison, observatoire sur sa tour, etc.).
        const mapW = w;
        const leftOffset = 0;
        mapPixar.style.setProperty('position', 'absolute', 'important');
        mapPixar.style.setProperty('top', '0', 'important');
        mapPixar.style.setProperty('left', leftOffset + 'px', 'important');
        mapPixar.style.setProperty('bottom', 'auto', 'important');
        mapPixar.style.setProperty('right', 'auto', 'important');
        mapPixar.style.setProperty('transform', 'none', 'important');
        mapPixar.style.setProperty('animation', 'none', 'important');
        mapPixar.style.setProperty('aspect-ratio', 'auto', 'important');
        mapPixar.style.setProperty('width', mapW + 'px', 'important');
        mapPixar.style.setProperty('height', h + 'px', 'important');
        mapPixar.style.setProperty('margin', '0', 'important');
        // IMG remplit le conteneur avec object-fit: fill (etirement non
        // uniforme) pour eviter les bandes laterales.
        const img = mapPixar.querySelector('.map-bg-img');
        if (img) {
          img.style.setProperty('position', 'absolute', 'important');
          img.style.setProperty('top', '0', 'important');
          img.style.setProperty('left', '0', 'important');
          img.style.setProperty('width', mapW + 'px', 'important');
          img.style.setProperty('height', h + 'px', 'important');
          // v649 : object-fit: cover (preserve ratio, crop si necessaire) au
          // lieu de fill (etirement non uniforme qui deformait la map).
          img.style.setProperty('object-fit', 'cover', 'important');
        }
      }
    }
    // fixMapVH : sur DESKTOP, 100dvh est fiable -> 1 appel + 1 rAF suffit
    // (les timeouts repetes provoquaient un tressautement visible a chaque
    // appel apres la sortie de chapitre). Sur MOBILE/TOUCH, on garde les
    // appels echelonnes pour capter la transition de la barre URL Chrome
    // qui change 100dvh apres coup. Guard "dimensions identiques" pour
    // eviter les reapplis inutiles meme dans le delai chevauchant.
    const _isTouch = window.matchMedia && (
      window.matchMedia('(pointer: coarse)').matches ||
      window.matchMedia('(max-width: 900px)').matches
    );
    let _lastVH = -1, _lastVW = -1;
    function fixMapVHGuarded() {
      const h = window.innerHeight, w = window.innerWidth;
      if (h === _lastVH && w === _lastVW) return;
      _lastVH = h; _lastVW = w;
      fixMapVH();
    }
    // Expose pour les listeners globaux (resize + fullscreenchange) afin de
    // re-fixer la map quand le viewport change apres l'entree (sortie de
    // plein ecran, rotate, redim. fenetre). Sans ca, la hauteur figee par
    // fixMapVH() restait celle d'avant l'evenement -> bande violette en bas.
    window._refixMap = fixMapVHGuarded;
    fixMapVHGuarded();
    // v650 : rAF boucle pendant 30 frames (~500 ms) qui re-applique fixMapVH
    // a CHAQUE frame. C'est la seule approche fiable apres feedback user :
    // le bug "bande noire fixee par ouverture DevTools" indique que Chrome
    // ne calcule pas la layout correctement au premier paint et ne re-apply
    // pas une simple modif de style. Forcer a chaque frame contourne ce
    // probleme - le 1er paint est wrong, mais les paints suivants ont la
    // bonne dimension parce qu'on les pousse explicitement.
    let _frameI = 0;
    function _fixMapLoop() {
      if (!document.body.classList.contains('map-mode')) return;
      // visualViewport est plus fiable au premier paint que innerHeight
      const h = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
      const sm = document.getElementById('screen-map');
      if (sm && Math.abs(sm.getBoundingClientRect().height - h) > 1) {
        if (typeof window._refixMap === 'function') window._refixMap();
      }
      _frameI++;
      if (_frameI < 30) requestAnimationFrame(_fixMapLoop);
    }
    requestAnimationFrame(_fixMapLoop);
    if (_isTouch) {
      setTimeout(fixMapVHGuarded, 400);
      setTimeout(fixMapVHGuarded, 1000);
    }

    requestAnimationFrame(scrollMapToBottom);
    if (_isTouch) {
      setTimeout(scrollMapToBottom, 300);
      setTimeout(scrollMapToBottom, 800);
    }

    // Quand l'image de la carte finit de charger, on re-scrolle
    const mapImg = document.querySelector('.map-bg-img');
    if (mapImg) {
      if (mapImg.complete) {
        scrollMapToBottom();
      } else {
        mapImg.addEventListener('load', scrollMapToBottom);
      }
    }
  } else {
    document.body.classList.remove('map-mode');
    // Cleanup : retire la hauteur forcee posee par fixMapVH() pour ne pas
    // figer une mauvaise valeur lors de prochains entry/exit. removeProperty
    // est necessaire car les styles ont ete poses avec 'important'.
    const sm = document.getElementById('screen-map');
    if (sm) {
      sm.style.removeProperty('height');
      sm.style.removeProperty('min-height');
      sm.style.removeProperty('max-height');
      const mapPixar = sm.querySelector('.full-map-pixar');
      if (mapPixar) {
        mapPixar.style.removeProperty('height');
        mapPixar.style.removeProperty('width');
      }
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Update progress bar
  if (typeof screenIdentifier === 'number' && screenIdentifier >= 1 && screenIdentifier <= 6) {
    updateProgress(screenIdentifier);
  }

  // Couronne / lunettes / cape : on (re)applique sur tous les avatars visibles
  // (utile notamment pour les ecrans de victoire et la map).
  if (typeof applyAvatarAccessoriesEverywhere === 'function') {
    applyAvatarAccessoriesEverywhere();
  }
  // Position calibree du panneau scene-text si l'utilisateur l'a deplace via Alt+T
  if (typeof applySceneTextPos === 'function') {
    applySceneTextPos(screenIdentifier);
  }
}

function updateProgress(n) {
  const totalSteps = 6;
  const pct = Math.round((n / totalSteps) * 100);
  document.getElementById('progress-fill').style.width = pct + '%';
  document.getElementById('progress-label').textContent = `L'aventure · Étape ${n}/${totalSteps}`;
}

// Screen 2 : Click the neon sign to walk in
function walkToShopAndEnter() {
  const vid2 = document.getElementById('hero-video-2');
  const sign = document.querySelector('.neon-shop-target');
  const scene = document.querySelector('#screen-2 .immersive-scene');
  const hint = document.getElementById('sign-hint');

  if (hint) hint.classList.remove('show');
  const pointer = document.getElementById('sign-pointer');
  if (pointer) pointer.classList.remove('show');
  if (window._signPointerTimer) { clearTimeout(window._signPointerTimer); window._signPointerTimer = null; }
  if (!vid2 || !sign || !scene) return;

  // v658 : assure que vid2 est visible AU CLIC, peu importe ce qu'a fait le
  // reveal() en idle. Sur iOS si le seek a echoue, v657 garde le perso cache
  // pendant l'idle -> il faut le forcer visible ici sinon la marche se joue
  // invisible. play() va naturellement avancer la video au-dela de la frame 0
  // (en quelques 100ms), donc on n'aura pas le bug "avatar de face" trop
  // visible. Mieux vaut un perso visible (parfois avec un flash de frame 0)
  // qu'un perso invisible toute la marche.
  vid2.style.display = 'block';
  vid2.style.opacity = '1';

  // v660 : warm-up audio via WebAudio API au lieu de play()/pause() sur les
  // audios reels. L'ancienne approche (play muted/volume:0 + pause) laissait
  // s'echapper "Ha un explorateur" sur iPhone -> Leon parlait pendant la marche.
  // WebAudio API resume() unlocks l'audio iOS sans jouer aucun son specifique.
  // Les audios reels jouent ensuite normalement quand goToScreen(3) le demande.
  try {
    if (!window._audioCtxUnlocked) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) {
        if (!window._sharedAudioCtx) window._sharedAudioCtx = new Ctx();
        const ctx = window._sharedAudioCtx;
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        // Joue un silence d'1 sample pour confirmer l'activation iOS sans
        // emettre de son audible. Buffer vide = silence garanti.
        try {
          const buf = ctx.createBuffer(1, 1, 22050);
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.connect(ctx.destination);
          src.start(0);
        } catch (e) {}
        window._audioCtxUnlocked = true;
      }
    }
    // Pre-charge en plus les audios de l'ecran 3 (sans les jouer) : iOS marque
    // les elements comme prets via load(), pas besoin de play().
    if (typeof voicesEnabled === 'function' && voicesEnabled() && typeof getVoice === 'function') {
      const _preload = [
        getVoice('voix_narrateur_3', 'assets/voix_narrateur_3.mp3'),
        getVoice('voix_leon_3',      'assets/Voix_leon_3.mp3')
      ];
      _preload.forEach(a => { if (a) { try { a.load(); } catch (e) {} } });
    }
  } catch (e) {}

  // Position cible = marker destination heros (calibre par l'utilisateur).
  // v386 : on re-applique applyHeroDestPos juste avant de lire la position —
  // la scene est maintenant garantie mesurable, donc la projection cover-fit
  // (video-content-% -> px conteneur) est correcte sur tous les formats.
  if (typeof applyHeroDestPos === 'function') applyHeroDestPos();
  const dest      = document.getElementById('hero-destination');
  const foxRect   = vid2.getBoundingClientRect();
  const startX    = foxRect.left + foxRect.width / 2;
  const startY    = foxRect.top  + foxRect.height;            // pieds du perso
  let targetX, targetY;
  if (dest) {
    const dr = dest.getBoundingClientRect();
    targetX = dr.left + dr.width / 2;
    targetY = dr.top  + dr.height / 2;
  } else {
    // Fallback : centre de la zone enseigne
    const signRect = sign.getBoundingClientRect();
    targetX = signRect.left + signRect.width / 2;
    targetY = signRect.top  + signRect.height / 2 + 30;
  }
  const dx = targetX - startX;
  const dy = targetY - startY;

  vid2.style.transition = 'transform 6s cubic-bezier(0.4, 0, 0.2, 1), opacity 6s ease';
  vid2.style.transform  = `translateX(-50%) translate(${dx}px, ${dy}px) scale(0.65)`;
  vid2.style.opacity    = '1';
  const _wr = (state.characterType && charData[state.characterType] && charData[state.characterType].walkRate) || 0.6;
  vid2.playbackRate     = _wr;
  vid2.play().catch(() => {});

  // 6s de marche pour avoir un deplacement doux et fluide, puis 2s d'arret devant la porte
  setTimeout(() => { vid2.pause(); vid2.playbackRate = 1.0; }, 6000);
  setTimeout(() => {
    goToScreen(3);
  }, 8000);
}

// Fullscreen
function _fsElement() {
  return document.fullscreenElement
      || document.webkitFullscreenElement
      || document.mozFullScreenElement
      || document.msFullscreenElement;
}
function _fsRequest(el) {
  const fn = el.requestFullscreen
          || el.webkitRequestFullscreen
          || el.webkitEnterFullscreen
          || el.mozRequestFullScreen
          || el.msRequestFullscreen;
  if (!fn) return Promise.reject(new Error('fullscreen API unavailable'));
  try {
    const p = fn.call(el, { navigationUI: 'hide' });
    return (p && p.then) ? p : Promise.resolve();
  } catch (e) {
    try {
      const p2 = fn.call(el);
      return (p2 && p2.then) ? p2 : Promise.resolve();
    } catch (e2) { return Promise.reject(e2); }
  }
}
function _fsExit() {
  const fn = document.exitFullscreen
          || document.webkitExitFullscreen
          || document.mozCancelFullScreen
          || document.msExitFullscreen;
  if (fn) try { return fn.call(document); } catch (e) {}
}
function enterFullscreen(opts) {
  // v411 (revient au comportement v409) : sur iOS Safari hors PWA,
  // requestFullscreen fait flasher la barre de statut a chaque appel.
  // On skip TOUS les appels iOS sauf ceux explicitement marques
  // userGesture:true (= bouton FS de l app uniquement).
  // En v410 j avais ajoute navigator.userActivation.isActive comme
  // detection auto -> mais chaque clic d ecran (tapAnswer, neon-shop,
  // etc.) active le user gesture -> FS tente -> flash heure/date.
  // Le warm-up audio (separe, dans walkToShopAndEnter) suffit pour
  // l audio atelier sans avoir besoin du FS auto.
  const userGesture = opts && opts.userGesture;
  if (!userGesture && typeof _isIOSDevice === 'function'
      && _isIOSDevice() && !window.navigator.standalone) {
    return Promise.resolve();
  }
  if (_fsElement()) return Promise.resolve();
  return _fsRequest(document.documentElement).then(() => {
    try { tryLockLandscape(); } catch (e) {}
  }).catch((err) => {
    console.log('[fs] enterFullscreen refuse :', err && err.message);
  });
}
function toggleFullscreen() {
  if (!_fsElement()) {
    // Appel via le bouton plein ecran = user gesture -> on autorise sur iOS aussi
    enterFullscreen({ userGesture: true });
  } else {
    _fsExit();
  }
}

function _syncFsIcon() {
  const isFs = !!_fsElement();
  const enter = document.getElementById('fs-icon-enter');
  const exit  = document.getElementById('fs-icon-exit');
  if (enter) enter.style.display = isFs ? 'none' : 'block';
  if (exit)  exit.style.display  = isFs ? 'block' : 'none';
}
document.addEventListener('fullscreenchange',       _syncFsIcon);
document.addEventListener('webkitfullscreenchange', _syncFsIcon);
document.addEventListener('mozfullscreenchange',    _syncFsIcon);
document.addEventListener('MSFullscreenChange',     _syncFsIcon);

// Star Counter
function addStars(amount) {
  state.totalStars += amount;
  // v373 : avant, addStars mettait a jour star-count / street / map / atelier
  // mais OUBLIAIT #global-star-count — la pastille etoiles visible PENDANT le
  // jeu (sur les ecrans de chapitre). Resultat : les etoiles gagnees ne
  // s'accumulaient pas a l'ecran. On delegue a updateStarBadge() qui couvre
  // TOUS les compteurs connus, et on persiste via saveState().
  if (typeof updateStarBadge === 'function') {
    updateStarBadge();
  } else {
    // Fallback defensif si updateStarBadge n'est pas encore defini
    const ids = ['star-count', 'street-star-count', 'global-star-count', 'map-star-count', 'atelier-star-count'];
    ids.forEach(id => { const el = document.getElementById(id); if (el) el.textContent = state.totalStars; });
  }
  if (typeof saveState === 'function') saveState();
  // Animation pop sur le compteur principal
  const starEl = document.getElementById('star-count');
  if (starEl) {
    starEl.style.transform = 'scale(1.5)';
    setTimeout(() => { starEl.style.transform = 'scale(1)'; }, 300);
  }
}

// Bonus replay : +1 etoile la premiere fois qu'on rejoue un chapitre.
// Renvoie le nombre de bonus accordes (0 ou 1).
function awardReplayBonus(chapterNum) {
  // v579 : replay REPETABLE, gain = score du quiz du chapitre rejoue
  // (pedagogique : il faut bien repondre pour gagner). Chapitre 5 sans quiz
  // = bonus fixe de 2. Plus de cap "une seule fois" -> la collection complete
  // devient atteignable en re-jouant et maitrisant les quiz.
  const scoreByChapter = {
    1: state.vfScore   || 0,
    2: state.vfScoreC2 || 0,
    3: state.vfScoreC3 || 0,
    4: state.vfScoreC4 || 0,
    5: 2,
  };
  const bonus = scoreByChapter[chapterNum] || 0;
  if (bonus > 0) {
    addStars(bonus);
    saveState();
  }
  return bonus;
}

// Screen 5: Tap mini-game
function tapAnswer(element, isCorrect) {
  if (state.tapAnswered) return;

  const options = document.querySelectorAll('.tap-option');
  const feedback = document.getElementById('tap-feedback');

  // v372 : sur mobile (panneau plein hauteur, overflow-y: auto), le feedback
  // et le bouton "Continuons" peuvent etre sous le pli. Apres une reponse
  // definitive, on scrolle le panneau vers le bas pour les rendre visibles.
  const _s5ScrollToEnd = () => {
    const panel = document.getElementById('s5-game');
    if (!panel) return;
    [0, 120, 350].forEach(d => setTimeout(() => {
      try { panel.scrollTop = panel.scrollHeight; } catch(e) {}
    }, d));
  };

  if (isCorrect) {
    state.tapAnswered = true;
    options.forEach(o => o.classList.add('answered'));
    element.classList.add('correct');
    feedback.textContent = '🎉 Bravo ! L\'IA ne peut pas faire de câlins — elle n\'a pas de corps !';
    feedback.style.color = '#0A6B4A';
    feedback.classList.add('show');
    const btnTo6 = document.getElementById('btn-to-6');
    btnTo6.classList.add('show-btn');
    _s5ScrollToEnd();
  } else {
    state.tapAttempts++;
    element.classList.add('wrong');

    if (state.tapAttempts === 1) {
      feedback.textContent = '😊 Essaie encore ! L\'IA sait faire certaines choses très bien.';
      feedback.style.color = '#B7860B';
      feedback.classList.add('show');
      setTimeout(() => element.classList.remove('wrong'), 800);
    } else {
      state.tapAnswered = true;
      options.forEach(o => {
        o.classList.add('answered');
        if (o.querySelector('.opt-emoji').textContent === '🤗') o.classList.add('correct');
      });
      feedback.textContent = '💡 La bonne réponse : l\'IA ne peut pas faire de câlins !';
      feedback.style.color = '#555';
      const btnTo6 = document.getElementById('btn-to-6');
      btnTo6.classList.add('show-btn');
      _s5ScrollToEnd();
    }
  }
}

// Screen 6: Vrai/Faux Quiz
function vfAnswer(btn, index, userSaysTrue) {
  if (state.vfAnswered[index]) return;
  state.vfAnswered[index] = true;
  state.vfDone++;

  const isCorrect = (userSaysTrue === vfCorrectAnswers[index]);
  const siblings = btn.parentElement.querySelectorAll('.vf-btn');
  siblings.forEach(b => b.disabled = true);

  if (isCorrect) {
    btn.classList.add('correct');
    state.vfScore++;
  } else {
    btn.classList.add('wrong');
    siblings.forEach(b => {
      if (b.classList.contains('vrai') === vfCorrectAnswers[index]) b.classList.add('correct');
    });
  }
  if (state.vfDone === 4) setTimeout(showVFScore, 600);
}

// Affiche le score du quizz V/F final du chap 1 et revele le bouton
// "Ouvrir le coffre" qui mene a l'ecran de victoire (#7).
// Cette fonction etait referencee mais avait disparu du code.
// ============================================================
// DEFI FAMILLE (ecran 8) : 3 sections interactives avec input
// + confirmation pedagogique apres chaque reponse.
// ============================================================
function onFamilyInput(section) {
  // Active/desactive le bouton Valider selon que l'input est rempli
  const input = document.getElementById('family-' + section + '-input');
  const btn   = document.getElementById('family-' + section + '-btn');
  if (!input || !btn) return;
  btn.disabled = input.value.trim().length === 0;
}
function submitFamilyAnswer(section) {
  const input   = document.getElementById('family-' + section + '-input');
  const btn     = document.getElementById('family-' + section + '-btn');
  const confirm = document.getElementById('family-' + section + '-confirm');
  if (!input || !confirm) return;
  if (!input.value.trim()) return;
  // Verrouille l'input apres soumission (bleu doux pour signaler)
  input.disabled = true;
  input.style.background = 'rgba(255,255,255,0.6)';
  if (btn) {
    btn.disabled = true;
    btn.textContent = '✓ Validé';
    btn.style.opacity = '0.7';
  }
  confirm.classList.add('show');
}

function showVFScore() {
  const starsMsg = state.vfScore === 4 ? '⭐⭐⭐' : state.vfScore >= 2 ? '⭐⭐' : '⭐';
  const textMsg  = state.vfScore === 4 ? 'Bravo, tu maitrises l\'IA !'
                : state.vfScore >= 2 ? 'Pas mal !'
                :                       'Tu vas progresser !';
  const stars = document.getElementById('score-stars');
  const text  = document.getElementById('score-text');
  const disp  = document.getElementById('score-display');
  if (stars) stars.textContent = starsMsg;
  if (text)  text.textContent  = `${state.vfScore}/4 — ${textMsg}`;
  if (disp)  disp.style.display = 'block';
  _revealChestBtn('btn-to-7');
}

// ============================================================
// GESTION DE LA CARTE — DÉVERROUILLAGE DES CHAPITRES
// ============================================================
const MAP_NODE_ICONS = ['⚙️', '🎨', '🎵', '💬', '🏆'];

function updateMapState() {
  const completed = state.chaptersCompleted || [];

  const premium = isPremium();
  for (let i = 1; i <= 5; i++) {
    const node = document.getElementById('map-node-' + i);
    if (!node) continue;
    const icon = node.querySelector('.node-icon');
    const progressOk = i === 1 || completed.includes(i - 1);
    const premiumOk  = i === 1 || premium;   // chapitre 1 toujours gratuit

    if (progressOk && premiumOk) {
      // Pleinement debloque
      node.classList.remove('node-locked', 'node-premium');
      node.classList.add('node-unlocked');
      node.setAttribute('onclick', `startChapter(${i})`);
      if (icon) { icon.textContent = MAP_NODE_ICONS[i - 1]; icon.classList.remove('locked-icon'); }
    } else if (progressOk && !premiumOk) {
      // Progression faite mais contenu Premium -> cadenas dore + paywall
      node.classList.remove('node-unlocked');
      node.classList.add('node-locked', 'node-premium');
      node.setAttribute('onclick', `showPremiumPaywall(${i})`);
      if (icon) { icon.textContent = '👑'; icon.classList.add('locked-icon'); }
    } else {
      // Pas encore atteint (progression non faite). v653 : avant le clic
      // ne faisait rien (handler vide) -> les enseignants en demo ne
      // pouvaient pas debloquer via Code ecole. Maintenant on ouvre une
      // info "termine d'abord le chap X" + bouton Code ecole pour les profs.
      node.classList.remove('node-unlocked', 'node-premium');
      node.classList.add('node-locked');
      node.setAttribute('onclick', `showProgressLockInfo(${i})`);
      if (icon) { icon.textContent = '🔒'; icon.classList.add('locked-icon'); }
    }
  }

  // Badge Premium sur les cartes du dock (livre magique + crée ton héros)
  try {
    const bookLock = document.getElementById('dock-book-lock');
    const bookCard = document.getElementById('dock-book-card');
    if (bookLock) bookLock.style.display = premium ? 'none' : '';
    if (bookCard) bookCard.classList.toggle('map-dock-card-locked', !premium);
    const heroLock = document.getElementById('dock-hero-lock');
    const heroCard = document.getElementById('dock-hero-card');
    if (heroLock) heroLock.style.display = premium ? 'none' : '';
    if (heroCard) heroCard.classList.toggle('map-dock-card-locked', !premium);
  } catch (e) {}

  // Pulse sur le prochain chapitre à jouer
  document.querySelectorAll('.node-island').forEach(n => n.classList.remove('candy-pulse'));
  const nextChap = completed.length + 1;
  const nextNode = document.getElementById('map-node-' + Math.min(nextChap, 5));
  if (nextNode) nextNode.querySelector('.node-island')?.classList.add('candy-pulse');

  updateGlowPath(completed);
}

function updateGlowPath(completed) {
  const svgUnlocked = document.querySelector('.track-unlocked');
  if (!svgUnlocked) return;
  // Segments du chemin lumineux (base → nœud 1, puis chaque nœud suivant)
  const segments = [
    'M 50 100 C 50 96, 50 94, 50 92',  // [0] base → nœud 1
    'C 50 84, 25 82, 25 72',           // [1] nœud 1 → nœud 2 (après chap 1)
    'C 25 62, 70 62, 70 52',           // [2] nœud 2 → nœud 3 (après chap 2)
    'C 70 42, 30 42, 30 30',           // [3] nœud 3 → nœud 4 (après chap 3)
    'C 30 18, 55 18, 55 8'             // [4] nœud 4 → nœud 5 (après chap 4)
  ];
  // On prend le numéro du plus HAUT chapitre terminé (pas la longueur du
  // tableau) : si l'utilisateur saute des chapitres via raccourcis et termine
  // direct le chap 3, on doit illuminer le chemin jusqu'au nœud 4 quand même.
  const maxChap = (completed || []).length ? Math.max(...completed) : 0;
  const count = Math.min(maxChap + 1, segments.length);
  svgUnlocked.setAttribute('d', segments.slice(0, count).join(' '));
}

// ============================================================
// HELPER GÉNÉRIQUE : effet "karaoké" / typewriter sur dialogue
// Réutilisable pour tous les chapitres
// opts = { narratorAudio, leonAudio, onComplete, narrationDelay }
// ============================================================
function playStoryScene(screenId, opts = {}) {
  console.log('[karaoke] playStoryScene', screenId);
  const root = document.getElementById('screen-' + screenId);
  if (!root) { console.warn('[karaoke] screen not found', screenId); return; }
  const bubble  = root.querySelector('.dialogue-bubble');
  const who     = root.querySelector('.dialogue-who');
  const actions = root.querySelector('.answers-group');
  console.log('[karaoke]', { bubble: !!bubble, who: !!who, actions: !!actions });

  // Nettoyage agressif des timers / audios précédents pour éviter les doubles typewriters
  if (window.typewriterTimeout) clearTimeout(window.typewriterTimeout);
  window.typewriterTimeout = null;
  // Incrémente un token : tout setTimeout en chaîne le vérifiera et s'auto-annulera s'il a changé.
  window._karaokeToken = (window._karaokeToken || 0) + 1;
  // Pause les audios en cours sans toucher à src (sinon on casse le cache _voiceCache).
  // La protection contre le double-typewriter est assurée par window._karaokeToken
  // et le flag _typewriterStarted dans playStoryScene.
  if (window.narratorAudio) {
    try { window.narratorAudio.pause(); } catch(e){}
    window.narratorAudio = null;
  }
  if (window.leonAudio) {
    try { window.leonAudio.pause(); } catch(e){}
    window.leonAudio = null;
  }

  // Pas de bulle ? On affiche juste les boutons après une petite pause
  if (!bubble) {
    if (actions) setTimeout(() => actions.classList.add('show'), 1200);
    return;
  }

  // Mémorise le HTML original au premier passage (pour reset propre si on revient)
  if (!bubble.dataset.fullhtml) {
    bubble.dataset.fullhtml = bubble.innerHTML;
    bubble.dataset.fulltext = bubble.textContent; // décode aussi &nbsp; →
  }
  const fullHTML = bubble.dataset.fullhtml;
  const fullText = bubble.dataset.fulltext || bubble.textContent;

  // Reset visuel
  bubble.textContent = '';
  bubble.style.display = 'none';
  bubble.classList.remove('anim-pop-in');
  if (who) who.style.display = 'none';
  if (actions) actions.classList.remove('show');

  // Audios optionnels (préfixés par l'ID d'écran pour le cache)
  const narrAudio = opts.narratorAudio ? getVoice('narr_' + screenId, opts.narratorAudio + '?v=' + Date.now()) : null;
  const leonAudio = opts.leonAudio    ? getVoice('leon_' + screenId, opts.leonAudio    + '?v=' + Date.now()) : null;
  if (leonAudio) window.leonAudio = leonAudio;
  if (narrAudio) window.narratorAudio = narrAudio;

  let _typewriterStarted = false;
  // onLeonEnd est appelé une seule fois, au PREMIER des deux événements suivants :
  // - leonAudio 'ended' (fin de l'audio Léon)
  // - typewriter terminé (fin de l'écriture du texte, fallback si pas d'audio)
  let _leonEndFired = false;
  const fireLeonEnd = () => {
    if (_leonEndFired) return;
    _leonEndFired = true;
    const delay = (typeof opts.leonEndDelayMs === 'number') ? opts.leonEndDelayMs : 0;
    const cb = () => {
      if (typeof opts.onLeonEnd === 'function') {
        try { opts.onLeonEnd(); } catch(e) { console.warn('[karaoke] onLeonEnd error', e); }
      }
    };
    if (delay > 0) setTimeout(cb, delay); else cb();
  };

  const startTypewriter = () => {
    if (_typewriterStarted) return;  // garde-fou : une seule exécution par playStoryScene
    _typewriterStarted = true;
    bubble.style.display = '';
    if (who) who.style.display = '';

    // Hook : démarre la vidéo de fond pile au moment où Léon commence à parler.
    // Si on l'a déjà tiré juste après la fin du narrateur (chemin "narrateur
    // d'abord"), on ne le rejoue pas pour éviter un double currentTime=0.
    if (typeof opts.onLeonStart === 'function' && !opts._onLeonStartFiredEarly) {
      try { opts.onLeonStart(); } catch(e) { console.warn('[karaoke] onLeonStart error', e); }
    }
    opts._onLeonStartFiredEarly = false; // reset pour les rejeux futurs

    if (voicesEnabled() && leonAudio) {
      leonAudio.currentTime = 0;
      playSafely(leonAudio, 'leon_' + screenId);
      leonAudio.addEventListener('ended', fireLeonEnd, { once: true });
    }

    // SUR MOBILE TACTILE UNIQUEMENT : on skip le typewriter visuel (cause
    // les 'lettres doublees/triplees' pendant que Leon parle, bug observe
    // sur plusieurs ecrans). L'audio Leon continue normalement ; le texte
    // apparait d'un coup en fade-in.
    const isTouchOnly = (typeof window !== 'undefined' && window.matchMedia
      && window.matchMedia('(pointer: coarse) and (hover: none)').matches);
    if (isTouchOnly) {
      bubble.innerHTML = fullHTML;
      bubble.style.opacity = '0';
      bubble.style.transition = 'opacity 0.35s ease';
      requestAnimationFrame(() => { bubble.style.opacity = '1'; });
      if (actions) setTimeout(() => actions.classList.add('show'), 600);
      if (opts.onComplete) opts.onComplete();
      return;
    }

    // ANTI-FLICKER mobile : pre-calcule la taille finale du bubble + active la
    // classe .typewriting qui (en CSS) desactive backdrop-filter et cache le
    // pseudo-element ::before. C'est la cause des "lettres doublees" sur
    // mobile : a chaque char ajoute par le typewriter, le browser doit
    // re-blur le fond du bubble ET de sa fleche ::before en parallele.
    try {
      bubble.style.visibility = 'hidden';
      bubble.innerHTML = fullHTML;
      const w = bubble.offsetWidth;
      const h = bubble.offsetHeight;
      bubble.style.minWidth  = w + 'px';
      bubble.style.minHeight = h + 'px';
      bubble.textContent = '';
      bubble.style.visibility = '';
      bubble.classList.add('typewriting');
    } catch(e) {}

    let i = 0;
    const duration = (leonAudio && isFinite(leonAudio.duration) && leonAudio.duration > 0)
      ? leonAudio.duration * 1000
      : (fullText.length * 38);
    const stepMs = Math.max(22, duration / fullText.length);

    // Capture le token courant : si playStoryScene est rappelé, ce closure s'auto-annulera.
    const myToken = window._karaokeToken;

    const type = () => {
      if (myToken !== window._karaokeToken) return; // un autre playStoryScene a démarré
      if (i < fullText.length) {
        bubble.textContent += fullText.charAt(i);
        i++;
        window.typewriterTimeout = setTimeout(type, stepMs);
      } else {
        // Restaure le HTML (gras, etc.) à la fin
        bubble.innerHTML = fullHTML;
        // Libere les min-width/height fixes pose au demarrage (anti-flicker)
        bubble.style.minWidth = '';
        bubble.style.minHeight = '';
        // Restaure le backdrop-filter (la classe '.typewriting' le neutralisait)
        bubble.classList.remove('typewriting');
        // Fallback : si l'audio Léon n'a pas tiré 'ended' (mode silencieux ou bug),
        // on déclenche tout de même onLeonEnd quand le typewriter se termine.
        fireLeonEnd();
        if (actions) setTimeout(() => actions.classList.add('show'), 350);
        if (opts.onComplete) opts.onComplete();
      }
    };
    type();
  };

  // 1) Narrateur d'abord (si dispo), puis Léon
  if (voicesEnabled() && narrAudio) {
    narrAudio.currentTime = 0;
    const onNarrEnd = () => {
      narrAudio.removeEventListener('ended', onNarrEnd);
      // Démarre IMMÉDIATEMENT la vidéo de fond (onLeonStart) à la fin du
      // narrateur, pour qu'il n'y ait aucun trou visuel. Le typewriter et la
      // voix Léon enchaînent ~80ms plus tard (juste assez pour que la frame
      // décodée s'affiche avant que Léon ouvre la bouche).
      if (typeof opts.onLeonStart === 'function') {
        try { opts.onLeonStart(); } catch(e) { console.warn('[karaoke] onLeonStart early error', e); }
      }
      // On marque le hook comme déjà appelé pour qu'il ne soit pas rejoué
      // par startTypewriter (sinon double currentTime=0).
      opts._onLeonStartFiredEarly = true;
      setTimeout(startTypewriter, 80);
    };
    narrAudio.addEventListener('ended', onNarrEnd, { once: true });
    playSafely(narrAudio, 'narr_' + screenId).catch(() => {
      window.typewriterTimeout = setTimeout(startTypewriter, opts.narrationDelay ?? 2500);
    });
  } else {
    // Pas de voix : petite pause si la narration est visible (lecture), sinon enchaîne vite
    const hasNarration = !!root.querySelector('.narration');
    window.typewriterTimeout = setTimeout(startTypewriter, hasNarration ? 1500 : 400);
  }
}

// ============================================================
// CHAPITRE 2 — Démo machine c2s3 : prompt typewriter + reveal image
// ============================================================
// ============================================================
// CHAPITRE 3 c3s5 : lecture de l'extrait de musique IA
// ============================================================
function playC3s5Music() {
  const btn = document.getElementById('btn-listen-c3s5-music');
  // Stoppe la voix Léon si encore en cours pour laisser place à la musique
  if (window.leonAudio) { try { window.leonAudio.pause(); } catch(e) {} }
  if (window.narratorAudio) { try { window.narratorAudio.pause(); } catch(e) {} }

  // Singleton : on réutilise l'objet Audio entre clics
  if (!window._c3s5MusicAudio) {
    window._c3s5MusicAudio = new Audio('assets/chapitre_3/8-bit-adventure.mp3');
    window._c3s5MusicAudio.addEventListener('ended', () => {
      if (btn) btn.innerHTML = '<span class="choice-icon">🎵</span> Réécouter';
    });
  }
  const a = window._c3s5MusicAudio;

  if (a.paused) {
    a.currentTime = 0;
    a.play().catch(() => {});
    if (btn) btn.innerHTML = '<span class="choice-icon">⏸</span> En lecture...';
  } else {
    a.pause();
    if (btn) btn.innerHTML = '<span class="choice-icon">🎵</span> Réécouter';
  }
}

function playC2s3Demo() {
  const tw      = document.getElementById('prompt-typewriter-c2s3');
  const catZone = document.getElementById('canvas-cat-c2s3');
  const sWho    = document.querySelector('#screen-c2s3 .dialogue-who');
  const sBubble = document.querySelector('#screen-c2s3 .dialogue-bubble');
  if (!tw || !catZone) return;

  // v415 : recalibre les overlays (texte + zone chat) sur le rect VIDEO reel.
  // Sans ca, les --canvas-* en % CONTENEUR sont decales sur iPad/iPhone (cover
  // crop different selon aspect ratio). Appel synchrone + 1 frame plus tard
  // (scene pas toujours mesurable au goToScreen instant).
  if (typeof applyC2s3Overlays === 'function') {
    applyC2s3Overlays();
    requestAnimationFrame(applyC2s3Overlays);
    setTimeout(applyC2s3Overlays, 100);
    setTimeout(applyC2s3Overlays, 400);
  }

  // La narration reste visible d'entrée. Le dialogue de Léon, lui, est caché
  // jusqu'à ce que le chat soit complètement apparu.
  // (NE PAS vider bubble.textContent ici — playStoryScene en a besoin pour mémoriser le texte original)
  if (sWho)    sWho.style.display = 'none';
  if (sBubble) sBubble.style.display = 'none';

  // Reset typewriter
  tw.textContent = '';

  // Génère 12×12 = 144 fragments de chat (chacun montre une partie via background-position)
  const ROWS = 12, COLS = 12;
  catZone.innerHTML = '';
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const f = document.createElement('div');
      f.className = 'cat-pixel';
      f.style.top    = `${(r / ROWS) * 100}%`;
      f.style.left   = `${(c / COLS) * 100}%`;
      f.style.width  = `${100 / COLS}%`;
      f.style.height = `${100 / ROWS}%`;
      // Background size = grille entière, position = position du fragment dans cette grille
      f.style.backgroundSize     = `${COLS * 100}% ${ROWS * 100}%`;
      f.style.backgroundPosition = `${(c / (COLS - 1)) * 100}% ${(r / (ROWS - 1)) * 100}%`;
      catZone.appendChild(f);
    }
  }

  if (window._c2s3Timer) clearTimeout(window._c2s3Timer);
  if (window._c2s3TypeInterval) clearInterval(window._c2s3TypeInterval);

  const promptText = 'un chat avec un chapeau';
  const STEP_MS    = 100;
  const PRE_DELAY  = 400;
  const POST_TYPE  = 500;
  const PIXEL_TOTAL_MS = 2000;

  // === Sequence c2s3 ===
  // 1) Narrateur "Leon tape sa demande... La machine s'allume !" (audio + texte)
  // 2) Typewriter du prompt sur la toile
  // 3) Apparition pixel par pixel du chat
  // 4) Bulle Leon "Voila ! L'IA a compris..." + voix Leon (karaoke typewriter)
  // Le narrateur est dissocie du karaoke : on ne le passe PAS a playStoryScene
  // pour qu'il ne soit pas relance a la fin (sinon doublon avec la bulle Leon).
  const startCanvasAnim = () => {
    window._c2s3Timer = setTimeout(() => {
      // Voix de Leon synchronisee avec le typewriter : il prononce "un chat
      // avec un chapeau" pile au moment ou le texte commence a s'ecrire.
      if (voicesEnabled() && typeof getVoice === 'function') {
        const promptVoice = getVoice('leon_c2s3_prompt', 'assets/chapitre_2/t3_leon_prompt.mp3');
        if (promptVoice) {
          try { promptVoice.currentTime = 0; } catch(e) {}
          if (typeof playSafely === 'function') playSafely(promptVoice, 'leon_c2s3_prompt').catch(() => {});
          else promptVoice.play().catch(() => {});
        }
      }
      let i = 0;
      window._c2s3TypeInterval = setInterval(() => {
        if (i < promptText.length) {
          tw.textContent += promptText.charAt(i);
          i++;
        } else {
          clearInterval(window._c2s3TypeInterval);
          // Apparition pixel par pixel du chat
          setTimeout(() => {
            const fragments = catZone.querySelectorAll('.cat-pixel');
            const order = [...Array(fragments.length).keys()].sort(() => Math.random() - 0.5);
            const stepMs = PIXEL_TOTAL_MS / fragments.length;
            order.forEach((idx, n) => {
              setTimeout(() => fragments[idx].classList.add('shown'), n * stepMs);
            });
            // Apres l'apparition du chat : on lance UNIQUEMENT le karaoke Leon
            // (narrateur deja joue plus haut).
            setTimeout(() => playStoryScene('c2s3', {
              leonAudio: 'assets/chapitre_2/t3_leon.mp3'
            }), PIXEL_TOTAL_MS + 300);
          }, POST_TYPE);
        }
      }, STEP_MS);
    }, PRE_DELAY);
  };

  // 1) Narrateur d'abord — bloque l'animation tant qu'il n'a pas fini de parler
  const narrAudio = (typeof getVoice === 'function')
    ? getVoice('narr_c2s3', 'assets/chapitre_2/t3_narrateur.mp3') : null;
  if (voicesEnabled() && narrAudio) {
    try { narrAudio.currentTime = 0; } catch(e) {}
    narrAudio.addEventListener('ended', () => setTimeout(startCanvasAnim, 200), { once: true });
    playSafely(narrAudio, 'narr_c2s3').catch(() => setTimeout(startCanvasAnim, 1500));
  } else {
    // Voix coupees : on laisse 1.2s pour lire la narration a l'ecran avant l'anim
    setTimeout(startCanvasAnim, 1200);
  }
}

// ============================================================
// CHAPITRE 2 — MINI-JEU + QUIZ + CONFETTI
// ============================================================
// Silhouettes SVG colorables (fill: currentColor)
const SVG_CAT = `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
  <path d="M150 110 Q180 100 175 70 Q170 58 162 68" stroke="currentColor" stroke-width="14" stroke-linecap="round" fill="none"/>
  <ellipse cx="100" cy="130" rx="58" ry="48" fill="currentColor"/>
  <circle cx="100" cy="82" r="42" fill="currentColor"/>
  <path d="M70 52 L58 22 L88 46 Z" fill="currentColor"/>
  <path d="M130 52 L142 22 L112 46 Z" fill="currentColor"/>
</svg>`;
const SVG_DRAGON = `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
  <path d="M82 78 L92 58 L102 78 Z" fill="currentColor"/>
  <path d="M105 78 L117 56 L128 78 Z" fill="currentColor"/>
  <ellipse cx="95" cy="115" rx="58" ry="40" fill="currentColor"/>
  <ellipse cx="50" cy="92" rx="30" ry="22" fill="currentColor"/>
  <path d="M120 90 Q165 48 178 78 Q170 112 128 110 Z" fill="currentColor"/>
  <path d="M145 135 Q182 142 188 178 Q170 164 158 148 Z" fill="currentColor"/>
</svg>`;
const SVG_ROBOT = `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
  <line x1="100" y1="42" x2="100" y2="22" stroke="currentColor" stroke-width="6" stroke-linecap="round"/>
  <circle cx="100" cy="16" r="7" fill="currentColor"/>
  <rect x="62" y="38" width="76" height="52" rx="10" fill="currentColor"/>
  <rect x="55" y="88" width="90" height="78" rx="10" fill="currentColor"/>
  <rect x="34" y="92" width="20" height="55" rx="6" fill="currentColor"/>
  <rect x="146" y="92" width="20" height="55" rx="6" fill="currentColor"/>
  <circle cx="44" cy="155" r="14" fill="currentColor"/>
  <circle cx="156" cy="155" r="14" fill="currentColor"/>
  <rect x="68" y="166" width="22" height="28" rx="4" fill="currentColor"/>
  <rect x="110" y="166" width="22" height="28" rx="4" fill="currentColor"/>
</svg>`;
const SVG_UNICORN = `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
  <path d="M152 50 L160 22 L168 50 Z" fill="currentColor"/>
  <path d="M148 65 Q138 52 142 30 Q150 42 156 58" fill="currentColor"/>
  <ellipse cx="160" cy="68" rx="22" ry="15" fill="currentColor"/>
  <path d="M138 80 Q160 90 158 110 L150 115 Q142 100 132 92 Z" fill="currentColor"/>
  <ellipse cx="100" cy="125" rx="58" ry="35" fill="currentColor"/>
  <path d="M48 115 Q22 125 18 158 Q32 145 50 140 Z" fill="currentColor"/>
  <rect x="62" y="155" width="14" height="34" rx="3" fill="currentColor"/>
  <rect x="84" y="158" width="14" height="32" rx="3" fill="currentColor"/>
  <rect x="108" y="158" width="14" height="32" rx="3" fill="currentColor"/>
  <rect x="130" y="155" width="14" height="34" rx="3" fill="currentColor"/>
</svg>`;

// Dictionnaire des mots du mini-jeu : catégorie + données visuelles
// genre = 'm' ou 'f' pour les sujets ; feminin = forme accordée pour
// adjectifs (couleurs, styles) — utilisée quand le sujet choisi est feminin
// (ex : "licorne bleue géante" au lieu de "licorne bleu géant").
const PROMPT_WORDS_C2 = {
  // Sujets — silhouettes SVG colorables (fallback si pas d'image générée)
  chat:    { cat: 'subject', svg: SVG_CAT,     en: 'cat',     genre: 'm' },
  dragon:  { cat: 'subject', svg: SVG_DRAGON,  en: 'dragon',  genre: 'm' },
  licorne: { cat: 'subject', svg: SVG_UNICORN, en: 'unicorn', genre: 'f' },
  // Couleurs (appliquées au fill du SVG ; en = nom anglais pour les fichiers)
  rouge:  { cat: 'color', glow: '#FF3B3B', label: 'rouge',  feminin: 'rouge',    en: 'red'    },
  bleu:   { cat: 'color', glow: '#1E90FF', label: 'bleu',   feminin: 'bleue',    en: 'blue'   },
  violet: { cat: 'color', glow: '#9B30FF', label: 'violet', feminin: 'violette', en: 'purple' },
  // Styles (animation + accessoire)
  volant: { cat: 'style', accessory: '🦋', cls: 'style-volant', feminin: 'volante'  },
  géant:  { cat: 'style', accessory: '⭐', cls: 'style-geant',  feminin: 'géante'   },
  rigolo: { cat: 'style', accessory: '🎉', cls: 'style-rigolo', feminin: 'rigolote' }
};

function selectPromptWord(btn) {
  const word = btn.dataset.w;
  const cat  = btn.dataset.cat;
  const idx = state.c2WordsSelected.indexOf(word);
  if (idx !== -1) {
    // Deselect : retire le mot
    state.c2WordsSelected.splice(idx, 1);
    btn.classList.remove('selected');
  } else {
    // Avant d'ajouter le nouveau mot : on retire le mot deja selectionne
    // dans la MEME categorie (sujet/couleur/style). Ainsi 1 seul par categorie.
    document.querySelectorAll(`#c2s7-words .prompt-word[data-cat="${cat}"].selected`).forEach(otherBtn => {
      const otherWord = otherBtn.dataset.w;
      const otherIdx = state.c2WordsSelected.indexOf(otherWord);
      if (otherIdx !== -1) state.c2WordsSelected.splice(otherIdx, 1);
      otherBtn.classList.remove('selected');
    });
    // Puis ajoute le nouveau (capacite max 3 = 1 sujet + 1 couleur + 1 style)
    if (state.c2WordsSelected.length < 3) {
      state.c2WordsSelected.push(word);
      btn.classList.add('selected');
    }
  }

  // Si 3 mots choisis, on déclenche la génération
  if (state.c2WordsSelected.length === 3) {
    triggerC2s7Generation();
  } else {
    // Sinon, on cache le résultat et le bouton
    document.getElementById('canvas-result-c2s7')?.classList.remove('revealed', 'style-volant', 'style-geant', 'style-rigolo');
    document.getElementById('prompt-typewriter-c2s7')?.classList.remove('show');
    document.getElementById('btn-to-c2s8')?.classList.remove('show-btn');
  }
  saveState();
}

function triggerC2s7Generation() {
  const tw      = document.querySelector('#prompt-typewriter-c2s7 .prompt-text-c7');
  const twWrap  = document.getElementById('prompt-typewriter-c2s7');
  const result  = document.getElementById('canvas-result-c2s7');
  const subjectEl   = document.getElementById('result-subject-c2s7');
  const accessoryEl = document.getElementById('result-accessory-c2s7');
  const auraEl      = document.getElementById('result-aura-c2s7');
  if (!tw || !result || !subjectEl) return;

  // Reset animations précédentes
  if (window._c2s7Timer) clearTimeout(window._c2s7Timer);
  if (window._c2s7TypeInt) clearInterval(window._c2s7TypeInt);
  result.classList.remove('revealed', 'style-volant', 'style-geant', 'style-rigolo');
  twWrap.classList.remove('show');
  tw.textContent = '';

  // Tri des mots par catégorie pour avoir un ordre cohérent (sujet + couleur + style)
  const order = ['subject', 'color', 'style'];
  const sorted = [...state.c2WordsSelected].sort(
    (a, b) => order.indexOf(PROMPT_WORDS_C2[a]?.cat) - order.indexOf(PROMPT_WORDS_C2[b]?.cat)
  );
  // Accord en genre : si le sujet est feminin (ex: "licorne"), on remplace
  // les couleurs et styles par leur forme feminine.
  const subj = sorted.find(w => PROMPT_WORDS_C2[w]?.cat === 'subject');
  const isFem = subj && PROMPT_WORDS_C2[subj]?.genre === 'f';
  const promptText = sorted.map(w => {
    const data = PROMPT_WORDS_C2[w];
    if (!data) return w;
    if (isFem && (data.cat === 'color' || data.cat === 'style') && data.feminin) {
      return data.feminin;
    }
    return w;
  }).join(' ');

  // 1) Typewriter du prompt sur la toile
  twWrap.classList.add('show');
  let i = 0;
  window._c2s7TypeInt = setInterval(() => {
    if (i < promptText.length) {
      tw.textContent += promptText.charAt(i);
      i++;
    } else {
      clearInterval(window._c2s7TypeInt);
      // 2) Petite pause puis composition du résultat
      window._c2s7Timer = setTimeout(() => composeC2s7Result(subjectEl, accessoryEl, auraEl, result), 450);
    }
  }, 95);
}

function composeC2s7Result(subjectEl, accessoryEl, auraEl, resultZone) {
  // Récupère un mot de chaque catégorie
  const findCat = cat => state.c2WordsSelected.find(w => PROMPT_WORDS_C2[w]?.cat === cat);
  const subjKey  = findCat('subject');
  const colorKey = findCat('color');
  const styleKey = findCat('style');

  // Valeurs avec fallbacks
  const subj  = subjKey  ? PROMPT_WORDS_C2[subjKey]  : { emoji: '🎨' };
  const color = colorKey ? PROMPT_WORDS_C2[colorKey] : null;
  const style = styleKey ? PROMPT_WORDS_C2[styleKey] : {};

  // Sujet — priorité à l'image combinée [color]_[subject].(jpg|png) (anglais)
  // Ex: red_cat.jpg, blue_dragon.jpg, purple_unicorn.jpg
  // Fallback automatique sur la silhouette SVG si l'image manque.
  subjectEl.style.color = color ? color.glow : '#9B30FF';

  const colorEn = color?.en;
  const subjEn  = subj?.en;
  const candidates = (colorEn && subjEn) ? [
    `assets/${colorEn}_${subjEn}.jpg`,
    `assets/${colorEn}_${subjEn}.png`
  ] : [];

  const setFallback = () => {
    if (subj.svg) subjectEl.innerHTML = subj.svg;
    else subjectEl.textContent = subj.emoji || '🎨';
  };

  const tryNext = (idx) => {
    if (idx >= candidates.length) { setFallback(); return; }
    const probe = new Image();
    probe.onload = () => {
      // Filtre whiteKey appliqué pour rendre le fond blanc/crème transparent
      subjectEl.innerHTML = `<img src="${candidates[idx]}" alt="${subjKey} ${colorKey}" class="result-subject-img" style="filter: url(#whiteKey)">`;
    };
    probe.onerror = () => tryNext(idx + 1);
    probe.src = candidates[idx];
  };

  if (candidates.length) tryNext(0);
  else setFallback();

  accessoryEl.textContent = style.accessory || '';

  // Aura colorée (subtile derrière, l'image porte déjà la couleur principale)
  const tagEl = document.getElementById('result-color-tag-c2s7');
  if (color) {
    auraEl.style.background = `radial-gradient(circle, ${color.glow}55 0%, transparent 70%)`;
    auraEl.style.setProperty('--blob-color', color.glow + '55');
    resultZone.style.setProperty(
      '--subject-glow',
      `drop-shadow(0 0 12px ${color.glow}) drop-shadow(0 4px 8px rgba(0,0,0,0.3))`
    );
    if (tagEl) {
      tagEl.textContent = color.label;
      tagEl.style.setProperty('--color-tag-bg', color.glow);
    }
  } else {
    auraEl.style.background = 'radial-gradient(circle, rgba(155,93,229,0.4) 0%, transparent 70%)';
    auraEl.style.setProperty('--blob-color', 'rgba(155,93,229,0.4)');
    resultZone.style.removeProperty('--subject-glow');
    if (tagEl) tagEl.textContent = '';
  }

  // Style
  if (style.cls) resultZone.classList.add(style.cls);

  // Reveal en fondu
  resultZone.classList.add('revealed');

  // Boutons Recommencer + Au quiz apres le reveal
  setTimeout(() => {
    document.getElementById('btn-to-c2s8')?.classList.add('show-btn');
    document.getElementById('btn-c2s7-restart')?.classList.add('show-btn');
  }, 800);
}

// Recommencer le mini-jeu c2s7 (efface les mots, le resultat, les animations)
// pour relancer une nouvelle composition.
function resetC2s7() {
  state.c2WordsSelected = [];
  saveState();
  document.querySelectorAll('#c2s7-words .prompt-word').forEach(b => {
    b.classList.remove('selected');
  });
  // Cache resultat + typewriter
  const result = document.getElementById('canvas-result-c2s7');
  if (result) {
    result.classList.remove('revealed', 'style-volant', 'style-geant', 'style-rigolo');
  }
  const twWrap = document.getElementById('prompt-typewriter-c2s7');
  if (twWrap) twWrap.classList.remove('show');
  const tw = document.querySelector('#prompt-typewriter-c2s7 .prompt-text-c7');
  if (tw) tw.textContent = '';
  // Cache les deux boutons jusqu'a la prochaine generation
  document.getElementById('btn-to-c2s8')?.classList.remove('show-btn');
  document.getElementById('btn-c2s7-restart')?.classList.remove('show-btn');
  // Annule timers en cours
  if (window._c2s7Timer)   clearTimeout(window._c2s7Timer);
  if (window._c2s7TypeInt) clearInterval(window._c2s7TypeInt);
  console.log('[c2s7] reset — relance ton choix de 3 mots');
}

function vfAnswerC2(btn, index, userSaysTrue) {
  if (state.vfAnsweredC2[index]) return;
  state.vfAnsweredC2[index] = true;
  state.vfDoneC2++;

  const isCorrect = (userSaysTrue === vfCorrectAnswersC2[index]);
  const siblings = btn.parentElement.querySelectorAll('.vf-btn');
  siblings.forEach(b => b.disabled = true);

  if (isCorrect) {
    btn.classList.add('correct');
    state.vfScoreC2++;
  } else {
    btn.classList.add('wrong');
    siblings.forEach(b => {
      if (b.classList.contains('vrai') === vfCorrectAnswersC2[index]) b.classList.add('correct');
    });
  }
  if (state.vfDoneC2 === 4) setTimeout(showVFScoreC2, 600);
}

function showVFScoreC2() {
  const starsMsg = state.vfScoreC2 === 4 ? '⭐⭐⭐' : state.vfScoreC2 >= 2 ? '⭐⭐' : '⭐';
  const textMsg  = state.vfScoreC2 === 4 ? 'Bravo l\'artiste !' : state.vfScoreC2 >= 2 ? 'Pas mal !' : 'Tu vas progresser !';
  document.getElementById('score-stars-c2').textContent = starsMsg;
  document.getElementById('score-text-c2').textContent = `${state.vfScoreC2}/4 — ${textMsg}`;
  document.getElementById('score-display-c2').style.display = 'block';
  _revealChestBtn('btn-to-c2s9');
}

function launchConfettiC2() {
  const container = document.getElementById('confetti-container-c2');
  if (!container) return;
  container.innerHTML = '';
  const colors = ['#FFD166','#FF6B6B','#06D6A0','#9B5DE5','#4FC3F7','#FFB347','#FF69B4','#FFF'];
  for (let i = 0; i < 70; i++) {
    const el = document.createElement('div');
    el.className = 'confetto';
    el.style.left = (Math.random() * 110 - 5) + 'vw';
    el.style.width  = (7 + Math.random() * 9) + 'px';
    el.style.height = (11 + Math.random() * 11) + 'px';
    el.style.background = colors[Math.floor(Math.random() * colors.length)];
    el.style.borderRadius = Math.random() > 0.4 ? '50%' : '3px';
    el.style.transform = `rotate(${Math.random()*360}deg)`;
    const delay    = Math.random() * 2.8;
    const duration = 2.5 + Math.random() * 2.5;
    el.style.animation = `confettiFall ${duration}s ${delay}s linear forwards`;
    container.appendChild(el);
  }
}

// ============================================================
// CHAPITRE 3 — Mini-jeu 4 sons + Quiz + Confetti
// ============================================================
// 3 sons (un sous chaque micro du décor) — mix correct/erroné pour montrer
// que l'IA peut se tromper (verdict 'wrong' sur piano = vraie hallucination).
// Si tu places assets/sound_dog.mp3, sound_piano.mp3, sound_thunder.mp3 ils
// seront utilisés en priorité. Sinon → synthèse Web Audio (fallback).
const C3_SOUNDS = {
  dog: {
    audio: 'assets/dragon-studio-free-dog-barking-sounds-427411.mp3',
    realLabel: 'chien', realEmoji: '🐕',
    transcription: '« WAOUF WAOUF&nbsp;! » 🐕', verdict: 'correct',
    choices: [
      { label: 'chat',   emoji: '🐈' },
      { label: 'chien',  emoji: '🐕', correct: true },
      { label: 'vache',  emoji: '🐄' }
    ]
  },
  piano: {
    audio: 'assets/11325622-piano-chords-239967.mp3',
    realLabel: 'piano', realEmoji: '🎹',
    transcription: '« Quelqu\'un fait du popcorn&nbsp;! » 🍿', verdict: 'wrong',
    choices: [
      { label: 'guitare',  emoji: '🎸' },
      { label: 'piano',    emoji: '🎹', correct: true },
      { label: 'batterie', emoji: '🥁' }
    ]
  },
  thunder: {
    audio: 'assets/soundmarker33-thunder-clap-512544.mp3',
    realLabel: 'orage', realEmoji: '⛈️',
    transcription: '« BOUM ! Patatra&nbsp;! » ⛈️', verdict: 'correct',
    choices: [
      { label: 'cascade', emoji: '💧' },
      { label: 'tambour', emoji: '🥁' },
      { label: 'orage',   emoji: '⛈️', correct: true }
    ]
  }
};
// Cache : indique si un fichier mp3 existe (testé une fois, mémorisé)
const _c3SoundFileExists = {};

// === Synthèse Web Audio des 3 sons (pas de fichier mp3 nécessaire) ===
function _getGameAudioCtx() {
  if (!window._gameAudioCtx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    window._gameAudioCtx = new C();
  }
  if (window._gameAudioCtx.state === 'suspended') {
    window._gameAudioCtx.resume().catch(() => {});
  }
  return window._gameAudioCtx;
}

function _playDogBark(ctx) {
  // Aboiement plus réaliste : composante tonale (sawtooth qui chute) + bouffée
  // de bruit blanc pour le côté rauque, avec 2 "wouf" en succession.
  const now = ctx.currentTime;
  const woof = (start) => {
    // Composante tonale (le "vocal" du chien)
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const tonalGain = ctx.createGain();
    osc1.type = 'sawtooth';
    osc2.type = 'square';
    osc1.frequency.setValueAtTime(280, start);
    osc1.frequency.exponentialRampToValueAtTime(110, start + 0.18);
    osc2.frequency.setValueAtTime(560, start);    // harmonique aigu
    osc2.frequency.exponentialRampToValueAtTime(220, start + 0.18);
    tonalGain.gain.setValueAtTime(0.0001, start);
    tonalGain.gain.exponentialRampToValueAtTime(0.5, start + 0.015);
    tonalGain.gain.exponentialRampToValueAtTime(0.001, start + 0.22);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1500;
    osc1.connect(filter); osc2.connect(filter);
    filter.connect(tonalGain); tonalGain.connect(ctx.destination);
    osc1.start(start); osc1.stop(start + 0.25);
    osc2.start(start); osc2.stop(start + 0.25);
    // Bouffée de bruit raclant (le côté rauque/animal)
    const noiseDur = 0.18;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * noiseDur), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1);
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const noiseGain = ctx.createGain();
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 800;
    noiseFilter.Q.value = 2;
    noiseGain.gain.setValueAtTime(0.0001, start);
    noiseGain.gain.exponentialRampToValueAtTime(0.3, start + 0.02);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, start + 0.18);
    noise.connect(noiseFilter); noiseFilter.connect(noiseGain); noiseGain.connect(ctx.destination);
    noise.start(start);
  };
  woof(now);
  woof(now + 0.34);
}

function _playPianoMelody(ctx) {
  // Mélodie piano : 4 notes avec harmoniques (timbre plus riche que le triangle nu)
  const now = ctx.currentTime;
  const notes = [261.63, 329.63, 392.00, 523.25]; // C4 E4 G4 C5
  notes.forEach((freq, i) => {
    const t = now + i * 0.22;
    // Fondamentale + 3 harmoniques pour timbre plus piano-esque
    [1, 2, 3, 4].forEach((mult, j) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = j === 0 ? 'triangle' : 'sine';
      osc.frequency.value = freq * mult;
      const amp = j === 0 ? 0.35 : (j === 1 ? 0.15 : (j === 2 ? 0.06 : 0.02));
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(amp, t + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.7 - j * 0.1);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.8);
    });
  });
  // Petit accord final pour le punch
  const tFinal = now + 4 * 0.22 + 0.1;
  [261.63, 329.63, 392.00].forEach(f => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = f;
    gain.gain.setValueAtTime(0.0001, tFinal);
    gain.gain.exponentialRampToValueAtTime(0.25, tFinal + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, tFinal + 1.0);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(tFinal); osc.stop(tFinal + 1.1);
  });
}

function _playThunderRumble(ctx) {
  // Tonnerre : crack initial sec + grondement long et roulant
  const now = ctx.currentTime;
  const dur = 2.2;
  // Bruit blanc avec modulation lente (pour le côté "roulement")
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    // Modulation lente (~3-7 Hz) qui simule les variations naturelles du tonnerre
    const t = i / ctx.sampleRate;
    const mod = 0.5 + 0.5 * Math.sin(2 * Math.PI * 4.5 * t + Math.sin(t * 7) * 2);
    data[i] = (Math.random() * 2 - 1) * mod;
  }
  // Bande basse (rumble)
  const lowFilter = ctx.createBiquadFilter();
  lowFilter.type = 'lowpass';
  lowFilter.frequency.value = 200;
  lowFilter.Q.value = 0.7;
  const lowGain = ctx.createGain();
  lowGain.gain.setValueAtTime(0.0001, now);
  lowGain.gain.exponentialRampToValueAtTime(0.85, now + 0.06);  // crack
  lowGain.gain.linearRampToValueAtTime(0.5, now + 0.4);          // sustain élevé
  lowGain.gain.exponentialRampToValueAtTime(0.2, now + 1.4);     // décroissance
  lowGain.gain.exponentialRampToValueAtTime(0.001, now + dur);   // queue
  // Bande mid (texture)
  const midFilter = ctx.createBiquadFilter();
  midFilter.type = 'bandpass';
  midFilter.frequency.value = 600;
  midFilter.Q.value = 1.5;
  const midGain = ctx.createGain();
  midGain.gain.setValueAtTime(0.0001, now);
  midGain.gain.exponentialRampToValueAtTime(0.4, now + 0.04);   // crack aigu (le claquement)
  midGain.gain.exponentialRampToValueAtTime(0.05, now + 0.5);
  midGain.gain.exponentialRampToValueAtTime(0.001, now + 1.5);
  // Source partagée par les deux filtres
  const noise1 = ctx.createBufferSource(); noise1.buffer = buffer;
  const noise2 = ctx.createBufferSource(); noise2.buffer = buffer;
  noise1.connect(lowFilter); lowFilter.connect(lowGain); lowGain.connect(ctx.destination);
  noise2.connect(midFilter); midFilter.connect(midGain); midGain.connect(ctx.destination);
  noise1.start(now);
  noise2.start(now);
}

function _synthFallbackC3(id) {
  const ctx = _getGameAudioCtx();
  if (!ctx) return;
  try {
    if      (id === 'dog')     _playDogBark(ctx);
    else if (id === 'piano')   _playPianoMelody(ctx);
    else if (id === 'thunder') _playThunderRumble(ctx);
  } catch(e) { console.warn('[c3s7] sound synth error', e); }
}

function playSoundC3(btn) {
  const id = btn.dataset.id;
  const data = C3_SOUNDS[id];
  if (!data) return;

  const transcript = document.getElementById('c3s7-transcription');

  // Affiche l'IA en train d'ecouter
  if (transcript) {
    transcript.classList.add('listening');
    transcript.innerHTML = '<em>👂 J\'écoute...</em>';
  }

  // Helper : montre la reponse de l'IA avec son verdict ✓/❌ + voix Leon
  const showAIResponse = () => {
    if (!transcript) return;
    transcript.classList.remove('listening');
    const verdictIcon = data.verdict === 'correct' ? '✅' : '❌';
    transcript.innerHTML = data.transcription + ' ' + verdictIcon;
    // Cache le bouton "J'ai dit !" puisque la reponse est arrivee
    _c3s7HideSayDoneButton();
    // Voix de Leon qui commente la transcription de l'IA
    if (typeof voicesEnabled === 'function' && voicesEnabled()) {
      try {
        if (window._c3s7LeonAudio) { try { window._c3s7LeonAudio.pause(); } catch(e) {} }
        window._c3s7LeonAudio = new Audio(`assets/chapitre_3/t7_leon_${id}.mp3`);
        window._c3s7LeonAudio.play().catch(() => {});
      } catch(e) {}
    }
    // Quand les 3 sons ont ete REPONDUS → bouton "Au quiz"
    if (state.c3SoundsAnswered) {
      if (!state.c3SoundsAnswered.includes(id)) state.c3SoundsAnswered.push(id);
    } else {
      state.c3SoundsAnswered = [id];
    }
    saveState();
    if (state.c3SoundsAnswered.length === 3) {
      setTimeout(() => document.getElementById('btn-to-c3s8')?.classList.add('show-btn'), 700);
    }
  };

  // Quand le son est fini, on demande a l'enfant de parler. Il valide via le bouton ✅
  const promptKidToSpeak = () => {
    if (!transcript) return;
    transcript.classList.remove('listening');
    transcript.innerHTML = '🎤 <strong>À toi !</strong> Dis à voix haute ce que tu entends...';
    _c3s7ShowSayDoneButton(showAIResponse);
  };

  // Annule un eventuel timer precedent et bouton precedent
  if (window._c3s7AIDelay) clearTimeout(window._c3s7AIDelay);
  _c3s7HideSayDoneButton();

  // 1) Lecture du son
  let audioElement = null;
  if (data.audio && _c3SoundFileExists[id] !== false) {
    audioElement = new Audio(data.audio);
    audioElement.volume = 0.65;
    audioElement.addEventListener('error', () => {
      _c3SoundFileExists[id] = false;
      _synthFallbackC3(id);
      // Fallback synthese : on connait pas la duree, on prompte apres 4s
      window._c3s7AIDelay = setTimeout(promptKidToSpeak, 4000);
    }, { once: true });
    audioElement.addEventListener('canplay', () => {
      _c3SoundFileExists[id] = true;
    }, { once: true });
    // Quand le son est fini → on prompte l'enfant de parler
    audioElement.addEventListener('ended', () => {
      promptKidToSpeak();
    }, { once: true });
    const playPromise = audioElement.play();
    if (playPromise && playPromise.catch) {
      playPromise.catch(() => {
        _c3SoundFileExists[id] = false;
        _synthFallbackC3(id);
        window._c3s7AIDelay = setTimeout(promptKidToSpeak, 4000);
      });
    }
  } else {
    _synthFallbackC3(id);
    window._c3s7AIDelay = setTimeout(promptKidToSpeak, 3000);
  }

  btn.classList.add('played');
  if (!state.c3SoundsPlayed.includes(id)) state.c3SoundsPlayed.push(id);
  saveState();
}

// Bouton "✅ J'ai dit !" qui apparait apres le son et permet a l'enfant
// de declencher manuellement la reponse de l'IA (a son rythme).
function _c3s7ShowSayDoneButton(onClick) {
  let btn = document.getElementById('c3s7-say-done-btn');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'c3s7-say-done-btn';
    btn.className = 'c3s7-say-done-btn';
    // Append au body : position:fixed reste relatif au viewport, garantit clic OK
    document.body.appendChild(btn);
  }
  btn.innerHTML = '✅ J\'ai dit !';
  btn.style.display = 'inline-flex';
  // 2 RAF pour bien declencher l'animation pop-in via .show
  requestAnimationFrame(() => requestAnimationFrame(() => btn.classList.add('show')));
  btn.onclick = (ev) => {
    ev.stopPropagation();
    if (typeof onClick === 'function') onClick();
  };
}

function _c3s7HideSayDoneButton() {
  const btn = document.getElementById('c3s7-say-done-btn');
  if (btn) {
    btn.classList.remove('show');
    btn.style.display = 'none';
    btn.onclick = null;
  }
}

function vfAnswerC3(btn, index, userSaysTrue) {
  if (state.vfAnsweredC3[index]) return;
  state.vfAnsweredC3[index] = true;
  state.vfDoneC3++;

  const isCorrect = (userSaysTrue === vfCorrectAnswersC3[index]);
  const siblings = btn.parentElement.querySelectorAll('.vf-btn');
  siblings.forEach(b => b.disabled = true);

  if (isCorrect) {
    btn.classList.add('correct');
    state.vfScoreC3++;
  } else {
    btn.classList.add('wrong');
    siblings.forEach(b => {
      if (b.classList.contains('vrai') === vfCorrectAnswersC3[index]) b.classList.add('correct');
    });
  }
  if (state.vfDoneC3 === 4) setTimeout(showVFScoreC3, 600);
}

function showVFScoreC3() {
  const starsMsg = state.vfScoreC3 === 4 ? '⭐⭐⭐' : state.vfScoreC3 >= 2 ? '⭐⭐' : '⭐';
  const textMsg  = state.vfScoreC3 === 4 ? 'Bravo, vraies oreilles d\'or !' : state.vfScoreC3 >= 2 ? 'Pas mal !' : 'Tu vas progresser !';
  document.getElementById('score-stars-c3').textContent = starsMsg;
  document.getElementById('score-text-c3').textContent  = `${state.vfScoreC3}/4 — ${textMsg}`;
  document.getElementById('score-display-c3').style.display = 'block';
  _revealChestBtn('btn-to-c3s9');
}

// ============================================================
// CHAPITRE 2 — c2s5 : mini-jeu "Trouve les defauts !" (6 hotspots)
// ============================================================
// Position par defaut des 6 hotspots, alignes sur la grille 2x3 t5_grid.png
// qui est elle-meme positionnee via .c2s5-grid-overlay (top:6%, left:16%, width:44%).
// Ces positions correspondent au CENTRE de chaque vignette de la grille.
// Calibrable via Alt+F en cours de jeu (drag and drop).
//
// Layout :
//   [0] sun (✓)   [1] cat (✗)    [2] puppy (✓)
//   [3] girl (✗)  [4] tulip (✓)  [5] dog (✗)
const C2S5_DEFAULT_POS = [
  { left: 24, top: 17 },   // sun
  { left: 38, top: 17 },   // cat
  { left: 52, top: 17 },   // puppy
  { left: 24, top: 38 },   // girl
  { left: 38, top: 38 },   // tulip
  { left: 52, top: 38 }    // dog
];
function loadC2s5DefectPos() {
  try {
    const raw = _calibGet('c2s5DefectPos');
    if (raw) return JSON.parse(raw);
  } catch(e) {}
  return JSON.parse(JSON.stringify(C2S5_DEFAULT_POS));
}
function saveC2s5DefectPos(pos) {
  _calibSet('c2s5DefectPos', JSON.stringify(pos));
  if (typeof persistCalibration === 'function') persistCalibration({ c2s5DefectPos: pos });
}
function applyC2s5DefectPos() {
  const pos = loadC2s5DefectPos();
  pos.forEach((p, i) => {
    const el = document.getElementById('c2s5-defect-' + (i + 1));
    if (el) {
      el.style.left = p.left + '%';
      el.style.top  = p.top  + '%';
    }
  });
}

function resetC2s5Game() {
  state.c2s5DefectsFound = [];
  saveState();
  if (typeof _c2s5ClearHints === 'function') _c2s5ClearHints();
  document.querySelectorAll('#screen-c2s5 .c2s5-defect-zone').forEach(z => {
    z.classList.remove('active', 'found', 'hint-pulse');
    z.onclick = null;
  });
  const game = document.getElementById('c2s5-game');
  if (game) game.style.display = 'none';
  const cnt = document.getElementById('c2s5-found-count');
  if (cnt) cnt.textContent = '0';
  const cont = document.getElementById('c2s5-continue');
  if (cont) cont.style.display = 'none';
  document.getElementById('c2s5-actions')?.classList.remove('show');
}

// Appele par playStoryScene via opts.onComplete (cf. optsMap c2s5)
function activateC2s5Game() {
  // Pas de playConsigne('c2s5') : Leon donne deja la consigne dans son
  // dialogue (karaoke), on evite le doublon narrateur.
  // Active les 3 hotspots avec halo pulsant
  document.querySelectorAll('#screen-c2s5 .c2s5-defect-zone').forEach(z => {
    z.classList.add('active');
    z.classList.remove('found', 'hint-pulse');
    z.onclick = () => markC2s5Defect(z);
  });
  // Affiche le panneau de mini-jeu en bas
  const game = document.getElementById('c2s5-game');
  if (game) game.style.display = 'flex';
  // Le bouton "C'est drole !" reste cache jusqu'a la fin
  const cont = document.getElementById('c2s5-continue');
  if (cont) cont.style.display = 'none';
  // Plante les hints progressifs (text apres 15s, halo apres 25s)
  _c2s5ScheduleHints();
}

// === Indice progressif : bulle glassmorphisme + voix de Léon ===
// L'indice "Regarde bien les mains !" apparait UNIQUEMENT quand l'enfant a
// deja trouve les 2 autres defauts (chat + chien) et qu'il manque encore la
// fille (6 doigts). Apres 6s sans la trouver, l'indice s'affiche.
function _c2s5ScheduleHints() {
  _c2s5ClearHints();
  const found = state.c2s5DefectsFound || [];
  const remaining = ['cat', 'girl', 'dog'].filter(id => !found.includes(id));
  // L'indice ne se declenche que si :
  //   - il reste UNIQUEMENT 'girl' a trouver (les 2 autres sont fait)
  if (remaining.length === 1 && remaining[0] === 'girl') {
    window._c2s5HintTimer1 = setTimeout(() => _c2s5ShowHintBubble(), 6000);
  }
}

function _c2s5ClearHints() {
  if (window._c2s5HintTimer1) { clearTimeout(window._c2s5HintTimer1); window._c2s5HintTimer1 = null; }
  if (window._c2s5HintHideTimer) { clearTimeout(window._c2s5HintHideTimer); window._c2s5HintHideTimer = null; }
  const bubble = document.getElementById('c2s5-hint-bubble');
  if (bubble) {
    bubble.classList.remove('show', 'hide');
    bubble.style.display = 'none';
  }
  // Stoppe la voix de Leon si en cours
  if (window._c2s5HintAudio) { try { window._c2s5HintAudio.pause(); } catch(e) {} }
}

function _c2s5RemainingDefects() {
  const found = state.c2s5DefectsFound || [];
  const all   = ['cat', 'girl', 'dog'];
  return all.filter(id => !found.includes(id));
}

function _c2s5ShowHintBubble() {
  const remaining = _c2s5RemainingDefects();
  // L'indice ne s'affiche QUE pour la fille (6 doigts) — defaut le plus subtil.
  // Si la fille a deja ete trouvee, pas d'indice (chat/chien sont visibles).
  if (!remaining.includes('girl')) return;
  const bubble = document.getElementById('c2s5-hint-bubble');
  const text   = document.getElementById('c2s5-hint-text');
  if (bubble && text) {
    text.innerHTML = '👀 Regarde bien <strong>les mains</strong> !';
    bubble.style.display = 'block';
    bubble.classList.remove('hide');
    requestAnimationFrame(() => bubble.classList.add('show'));
  }
  // Voix de Leon en parallele (si l'audio existe et voix activees)
  if (typeof voicesEnabled === 'function' && voicesEnabled()) {
    try {
      window._c2s5HintAudio = new Audio('assets/chapitre_2/t5_leon_hint_mains.mp3');
      window._c2s5HintAudio.play().catch(() => {});
    } catch(e) {}
  }
  // Disparition apres 5s
  if (window._c2s5HintHideTimer) clearTimeout(window._c2s5HintHideTimer);
  window._c2s5HintHideTimer = setTimeout(() => _c2s5HideHintBubble(), 5000);
}

function _c2s5HideHintBubble() {
  const bubble = document.getElementById('c2s5-hint-bubble');
  if (!bubble) return;
  bubble.classList.remove('show');
  bubble.classList.add('hide');
  setTimeout(() => {
    bubble.style.display = 'none';
    bubble.classList.remove('hide');
  }, 450);
}

function markC2s5Defect(zone) {
  if (!zone || zone.classList.contains('found')) return;
  const id = zone.dataset.defectId;
  const isDefective = zone.dataset.defective === 'true';

  if (!isDefective) {
    // Clic sur une vignette correcte : feedback "Non, celle-ci est juste !"
    zone.classList.add('miss-flash');
    setTimeout(() => zone.classList.remove('miss-flash'), 600);
    const instr = document.getElementById('c2s5-instruction');
    if (instr) {
      const original = instr.dataset.original || instr.innerHTML;
      if (!instr.dataset.original) instr.dataset.original = original;
      instr.innerHTML = '🤔 <strong>Non, celle-ci est juste !</strong> Cherche encore.';
      clearTimeout(window._c2s5InstrTimer);
      window._c2s5InstrTimer = setTimeout(() => {
        instr.innerHTML = instr.dataset.original;
      }, 1800);
    }
    return;
  }

  // Vignette defective : marque trouve
  if (!state.c2s5DefectsFound) state.c2s5DefectsFound = [];
  if (state.c2s5DefectsFound.includes(id)) return;
  state.c2s5DefectsFound.push(id);
  saveState();
  zone.classList.add('found');
  zone.classList.remove('hint-pulse');
  zone.onclick = null;
  const cnt = document.getElementById('c2s5-found-count');
  if (cnt) cnt.textContent = state.c2s5DefectsFound.length;
  spawnC2s5Sparkles(zone);
  // Reschedule les hints depuis zero apres chaque trouvaille (laisse 15s a chaque etape)
  if (typeof _c2s5ScheduleHints === 'function') _c2s5ScheduleHints();
  if (state.c2s5DefectsFound.length === 3) {
    if (typeof _c2s5ClearHints === 'function') _c2s5ClearHints();
    setTimeout(() => completeC2s5Game(true), 600);
  }
}

function skipC2s5Game() {
  completeC2s5Game(false);
}

function completeC2s5Game(success) {
  const game = document.getElementById('c2s5-game');
  if (game) game.style.display = 'none';
  if (success) {
    // +1 etoile bonus (exploration / interaction). Quiz officiel = 3 etoiles,
    // donc 1 ici garde le mini-jeu en valeur intermediaire.
    if (typeof addStars === 'function') addStars(1);
    showC2s5Toast('🎉 Bravo détective ! +1 ⭐');
  }
  const actions = document.getElementById('c2s5-actions');
  if (actions) actions.classList.add('show');
  const cont = document.getElementById('c2s5-continue');
  if (cont) cont.style.display = '';
}

function spawnC2s5Sparkles(zone) {
  const rect = zone.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  for (let i = 0; i < 10; i++) {
    const s = document.createElement('span');
    s.className = 'c2s5-sparkle';
    s.textContent = ['✨', '⭐', '💫'][i % 3];
    s.style.left = cx + 'px';
    s.style.top  = cy + 'px';
    document.body.appendChild(s);
    const angle = (i / 10) * Math.PI * 2;
    const dist = 60 + Math.random() * 40;
    requestAnimationFrame(() => {
      s.style.transform = `translate(${Math.cos(angle) * dist}px, ${Math.sin(angle) * dist}px) scale(${0.7 + Math.random() * 0.6})`;
      s.style.opacity = '0';
    });
    setTimeout(() => s.remove(), 700);
  }
}

function showC2s5Toast(msg) {
  // Reutilise la classe c2s5-toast (definie dans style.css). Generique pour
  // afficher un toast central de bonus.
  const t = document.createElement('div');
  t.className = 'c2s5-toast';
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 400);
  }, 2200);
}

// Toast bonus generique (degrade jaune-corail) reutilisable par toutes les
// mini-interactions des chapitres 2 a 5. Appelle a la fin d'une interaction
// reussie (+1 etoile).
function showBonusToast(msg) {
  const t = document.createElement('div');
  t.className = 'bonus-toast';
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 400);
  }, 2200);
}

// ============================================================
// c5s4 — Mini-interaction "Mon voeu"
// L'enfant tape ce qu'il veut inventer plus tard. Sauvegarde dans
// localStorage. +1 ⭐ si non vide. Bouton "Passer" toujours dispo.
// ============================================================
function activateC5s4Wish() {
  // Pas de playConsigne('c5s4') : Leon dit deja la consigne dans son dialogue.
  const zone = document.getElementById('c5s4-wish');
  const input = document.getElementById('c5s4-wish-input');
  if (!zone || !input) return;

  // Pre-remplit si l'enfant a deja ecrit un voeu lors d'une visite precedente.
  try {
    const saved = localStorage.getItem('c5s4_wish');
    if (saved && !input.value) input.value = saved;
  } catch(e) {}

  zone.style.display = '';
  // Force reflow pour declencher la transition CSS d'apparition
  void zone.offsetWidth;
  zone.classList.add('show');

  // Si deja sauvegarde et bonus deja donne, on indique visuellement
  const saveBtn = document.getElementById('c5s4-wish-save');
  if (saveBtn && state.c5s4WishAwarded) {
    saveBtn.classList.add('saved');
    saveBtn.textContent = '✅ Vœu gardé';
  }
}

function saveC5s4Wish() {
  const input = document.getElementById('c5s4-wish-input');
  const saveBtn = document.getElementById('c5s4-wish-save');
  if (!input) return;

  const text = input.value.trim();
  if (text.length === 0) {
    // Champ vide : on n'attribue pas l'etoile, on signale gentiment et on enchaine
    if (input) input.focus();
    return;
  }

  // Sauvegarde
  try { localStorage.setItem('c5s4_wish', text); } catch(e) {}

  // Bonus +1 ⭐ une seule fois (anti-spam au cas ou l'enfant revient sur l'ecran)
  if (!state.c5s4WishAwarded) {
    if (typeof addStars === 'function') addStars(1);
    state.c5s4WishAwarded = true;
    if (typeof saveState === 'function') saveState();
    showBonusToast('✨ Joli vœu ! +1 ⭐');
  } else {
    showBonusToast('✅ Vœu mis à jour');
  }

  // Bouton passe en mode "saved"
  if (saveBtn) {
    saveBtn.classList.add('saved');
    saveBtn.textContent = '✅ Vœu gardé';
  }
  // Revele le bouton "Continuer" maintenant que le voeu est enregistre
  const skip = document.querySelector('#screen-c5s4 .c5s4-skip-btn');
  if (skip) {
    const actions = skip.closest('.answers-group');
    if (actions) actions.style.display = '';
  }

  // Petite pause pour que l'enfant voie le toast, puis on enchaine sur le mini-jeu
  setTimeout(() => goToScreen('c5s5'), 1400);
}

// Mode calibration drag (Alt+F)
function toggleC2s5DefectCalib() {
  if (state.currentScreen !== 'c2s5') {
    goToScreen('c2s5', true);
    setTimeout(toggleC2s5DefectCalib, 300);
    return;
  }
  document.body.classList.toggle('calib-c2s5');
  const active = document.body.classList.contains('calib-c2s5');
  if (active) {
    enableC2s5DefectDrag();
    console.log('🎯 Calib c2s5 ON — drag les 3 cercles rouges sur les defauts. Re-presse Alt+F pour terminer.');
  } else {
    disableC2s5DefectDrag();
    console.log('🎯 Calib c2s5 OFF — positions sauvegardees :', loadC2s5DefectPos());
  }
}
function enableC2s5DefectDrag() {
  document.querySelectorAll('#screen-c2s5 .c2s5-defect-zone').forEach(el => {
    el.style.cursor = 'grab';
    el.addEventListener('mousedown',  startC2s5DefectDrag, false);
    el.addEventListener('touchstart', startC2s5DefectDrag, { passive: false });
  });
}
function disableC2s5DefectDrag() {
  document.querySelectorAll('#screen-c2s5 .c2s5-defect-zone').forEach(el => {
    el.removeEventListener('mousedown',  startC2s5DefectDrag, false);
    el.removeEventListener('touchstart', startC2s5DefectDrag);
    el.style.cursor = '';
  });
}
function startC2s5DefectDrag(e) {
  if (!document.body.classList.contains('calib-c2s5')) return;
  e.preventDefault(); e.stopPropagation();
  const zone = e.currentTarget;
  // L'id HTML est de la forme "c2s5-defect-N" — on extrait N (1..6)
  const idMatch = zone.id && zone.id.match(/c2s5-defect-(\d+)/);
  const id = idMatch ? parseInt(idMatch[1], 10) : 0;
  if (!id) return;
  const screen = document.querySelector('#screen-c2s5 .story-scene');
  if (!screen) return;
  const rect = screen.getBoundingClientRect();
  const onMove = (mv) => {
    const pt = mv.touches ? mv.touches[0] : mv;
    const left = ((pt.clientX - rect.left) / rect.width)  * 100;
    const top  = ((pt.clientY - rect.top)  / rect.height) * 100;
    zone.style.left = Math.max(0, Math.min(100, left)) + '%';
    zone.style.top  = Math.max(0, Math.min(100, top))  + '%';
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('mouseup',   onUp);
    document.removeEventListener('touchend',  onUp);
    const positions = loadC2s5DefectPos();
    const left = parseFloat(zone.style.left);
    const top  = parseFloat(zone.style.top);
    positions[id - 1] = { left, top };
    saveC2s5DefectPos(positions);
    console.log('[c2s5 calib] defect', id, '→', { left, top });
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('mouseup',   onUp);
  document.addEventListener('touchend',  onUp);
}
window.toggleC2s5DefectCalib = toggleC2s5DefectCalib; // accessible aussi en console

// ============================================================
// c5s2 — Mini-jeu "L'IA dans ta journee"
// 6 hotspots sur l'image : 4 IA (hologrammes) + 2 distracteurs.
// Pattern reutilise depuis c2s5.
// ============================================================

// Positions par defaut (en %, sur le rectangle .story-scene de c5s2)
// Calibrables via Alt+Shift+I et persistees dans localStorage.c5s2SpotPos
const C5S2_DEFAULT_POS = [
  { left: 28, top: 22 }, // 1 GPS         — hologramme haut-gauche
  { left: 75, top: 18 }, // 2 Microphone  — hologramme haut-droite
  { left: 18, top: 50 }, // 3 TV          — hologramme milieu-gauche
  { left: 80, top: 42 }, // 4 Manette     — hologramme milieu-droite
  { left:  8, top: 72 }, // 5 Telescope   — distracteur bas-gauche
  { left: 90, top: 80 }  // 6 Lanterne    — distracteur bas-droite
];

function loadC5s2SpotPos() {
  try {
    const raw = _calibGet('c5s2SpotPos');
    if (raw) return JSON.parse(raw);
  } catch(e) {}
  return JSON.parse(JSON.stringify(C5S2_DEFAULT_POS));
}
function saveC5s2SpotPos(pos) {
  _calibSet('c5s2SpotPos', JSON.stringify(pos));
  if (typeof persistCalibration === 'function') persistCalibration({ c5s2SpotPos: pos });
}
function applyC5s2SpotPos() {
  const pos = loadC5s2SpotPos();
  pos.forEach((p, i) => {
    const el = document.getElementById('c5s2-spot-' + (i + 1));
    if (el) {
      el.style.left = p.left + '%';
      el.style.top  = p.top  + '%';
    }
  });
}

function resetC5s2Game() {
  state.c5s2SpotsFound = [];
  if (typeof saveState === 'function') saveState();
  // Restaure la bulle de dialogue
  const sceneText = document.querySelector('#screen-c5s2 .scene-text');
  if (sceneText) sceneText.style.display = '';
  // Cache panneau, zones et cartes
  const game  = document.getElementById('c5s2-game');
  const zones = document.getElementById('c5s2-zones');
  const cards = document.getElementById('c5s2-cards');
  if (game)  game.style.display  = 'none';
  if (zones) zones.style.display = 'none';
  if (cards) cards.style.display = 'none';
  // Restaure les classes / textes
  const instr = document.getElementById('c5s2-instruction');
  if (instr) instr.innerHTML = '🎯 <strong>Glisse chaque IA sur son super-pouvoir&nbsp;!</strong>';
  const skip = document.querySelector('#screen-c5s2 .c5s2-skip-btn');
  if (skip) {
    skip.classList.remove('complete');
    skip.innerHTML = '<span class="choice-icon">⏭️</span> Passer';
  }
  // Reset zones + cartes
  document.querySelectorAll('#c5s2-zones .c5s2-zone').forEach(z => z.classList.remove('matched', 'drag-hover'));
  document.querySelectorAll('#c5s2-cards .c5s2-card').forEach(c => {
    c.classList.remove('matched', 'shake', 'dragging');
    c.style.transform = '';
    c.style.left = '';
    c.style.top  = '';
  });
  const counter = document.getElementById('c5s2-found-count');
  if (counter) counter.textContent = '0';
}

function activateC5s2Game() {
  // Pas de playConsigne('c5s2') : Leon dit deja la consigne dans son dialogue.
  // Cache la bulle de dialogue de Léon
  const sceneText = document.querySelector('#screen-c5s2 .scene-text');
  if (sceneText) sceneText.style.display = 'none';
  const game  = document.getElementById('c5s2-game');
  const zones = document.getElementById('c5s2-zones');
  const cards = document.getElementById('c5s2-cards');
  if (game)  game.style.display  = '';
  if (zones) zones.style.display = 'flex';
  if (cards) cards.style.display = 'flex';
  // Mélange l'ordre des cartes IA pour qu'elles ne soient pas alignées avec leurs bonnes zones
  if (cards) {
    const arr = Array.from(cards.querySelectorAll('.c5s2-card'));
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    arr.forEach(c => cards.appendChild(c)); // ré-append dans le nouvel ordre
  }
  // Wire up le drag & drop sur chaque carte
  document.querySelectorAll('#c5s2-cards .c5s2-card').forEach(c => _c5s2WireCardDrag(c));
}

// === Drag & drop (souris + tactile) avec listeners document-level ===
// On reroute move/up sur document pour que la souris rapide n'échappe pas
// à la carte. La carte est déplacée vers <body> pour échapper au transform
// parent qui casse position:fixed.
function _c5s2WireCardDrag(card) {
  if (!card) return;
  let dragging = false;
  let offsetX = 0, offsetY = 0;
  let originParent = null;
  // Drag via transform: translate3d() + requestAnimationFrame — bien plus
  // fluide que left/top (qui force un reflow a chaque frame). Sur Android
  // c'est la difference entre "saccade" et "colle au doigt".
  let lastX = 0, lastY = 0;
  let rafId = 0;
  const zonesCache = [];

  const flushMove = () => {
    rafId = 0;
    if (!dragging) return;
    card.style.transform = 'translate3d(' + (lastX - offsetX) + 'px,' + (lastY - offsetY) + 'px,0)';
    // Detection hover via cache (evite querySelectorAll a chaque frame)
    let hover = null;
    for (let i = 0; i < zonesCache.length; i++) {
      const z = zonesCache[i];
      const r = z.getBoundingClientRect();
      if (lastX >= r.left && lastX <= r.right && lastY >= r.top && lastY <= r.bottom) {
        hover = z;
        break;
      }
    }
    for (let i = 0; i < zonesCache.length; i++) {
      const z = zonesCache[i];
      if (z === hover) z.classList.add('drag-hover');
      else             z.classList.remove('drag-hover');
    }
  };

  const onMove = (ev) => {
    if (!dragging) return;
    ev.preventDefault();
    lastX = ev.clientX;
    lastY = ev.clientY;
    if (!rafId) rafId = requestAnimationFrame(flushMove);
  };
  const onUp = (ev) => {
    if (!dragging) return;
    dragging = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    card.classList.remove('dragging');
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup',   onUp);
    document.removeEventListener('pointercancel', onUp);
    document.querySelectorAll('#c5s2-zones .c5s2-zone').forEach(z => z.classList.remove('drag-hover'));
    const dropZone = _c5s2ZoneAtPoint(ev.clientX, ev.clientY);
    const correct = card.dataset.correct;
    if (dropZone && dropZone.dataset.power === correct && !dropZone.classList.contains('matched')) {
      _c5s2SnapToZone(card, dropZone);
    } else {
      _c5s2ResetCardPosition(card, originParent);
      if (dropZone) {
        card.classList.add('shake');
        setTimeout(() => card.classList.remove('shake'), 520);
      }
    }
  };
  const onDown = (ev) => {
    if (card.classList.contains('matched')) return;
    ev.preventDefault();
    dragging = true;
    card.classList.add('dragging');
    // Cache des zones de drop pour eviter querySelectorAll a chaque frame
    zonesCache.length = 0;
    document.querySelectorAll('#c5s2-zones .c5s2-zone').forEach(z => zonesCache.push(z));
    const rect = card.getBoundingClientRect();
    offsetX = ev.clientX - rect.left;
    offsetY = ev.clientY - rect.top;
    originParent = card.parentElement;
    document.body.appendChild(card);
    card.style.position = 'fixed';
    card.style.left = '0';
    card.style.top  = '0';
    card.style.margin = '0';
    card.style.willChange = 'transform';
    card.style.transform = 'translate3d(' + (ev.clientX - offsetX) + 'px,' + (ev.clientY - offsetY) + 'px,0)';
    lastX = ev.clientX;
    lastY = ev.clientY;
    // Listeners au niveau document (souris ou doigt qui sort de la carte = pas de souci)
    document.addEventListener('pointermove', onMove, { passive: false });
    document.addEventListener('pointerup',   onUp);
    document.addEventListener('pointercancel', onUp);
  };
  card.onpointerdown = onDown;
}

function _c5s2ZoneAtPoint(x, y) {
  const zones = document.querySelectorAll('#c5s2-zones .c5s2-zone');
  for (const z of zones) {
    const r = z.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return z;
  }
  return null;
}

function _c5s2ResetCardPosition(card, originParent) {
  // Remet la carte dans son parent d'origine et purge les styles inline
  if (originParent && card.parentElement !== originParent) originParent.appendChild(card);
  card.style.position = '';
  card.style.left = '';
  card.style.top  = '';
  card.style.transform = '';
  card.style.margin = '';
  card.style.willChange = '';
}

function _c5s2SnapToZone(card, zone) {
  // Place la carte EN ENFANT de la zone pour qu'elle reste collée même au resize
  zone.appendChild(card);
  card.style.position = 'absolute';
  card.style.left = '0';
  card.style.top  = '0';
  card.style.right = '0';
  card.style.bottom = '0';
  card.style.width = '100%';
  card.style.height = '100%';
  card.style.transform = '';
  card.style.margin = '0';
  card.style.willChange = '';
  card.classList.add('matched');
  zone.classList.add('matched');
  // Compteur
  const id = card.dataset.ia;
  if (!state.c5s2SpotsFound.includes(id)) {
    state.c5s2SpotsFound.push(id);
    if (typeof saveState === 'function') saveState();
  }
  const counter = document.getElementById('c5s2-found-count');
  if (counter) counter.textContent = state.c5s2SpotsFound.length;
  if (typeof spawnC2s5Sparkles === 'function') spawnC2s5Sparkles(zone);
  if (state.c5s2SpotsFound.length >= 4) {
    setTimeout(() => completeC5s2Game(), 700);
  }
}

function completeC5s2Game() {
  // Bonus +1 ⭐ une seule fois
  if (!state.c5s2GameAwarded) {
    if (typeof addStars === 'function') addStars(1);
    state.c5s2GameAwarded = true;
    if (typeof saveState === 'function') saveState();
    if (typeof showBonusToast === 'function') {
      showBonusToast('🎉 Bravo détective de l\'IA ! +1 ⭐');
    }
  }
  // Le bouton "Passer" devient "Continuer" (vert)
  const skip = document.querySelector('#screen-c5s2 .c5s2-skip-btn');
  if (skip) {
    skip.classList.add('complete');
    skip.innerHTML = '<span class="choice-icon">✨</span> Continuer';
  }
}

// ----- Calibration drag (Alt+Shift+I) -----
function toggleC5s2SpotCalib() {
  if (state.currentScreen !== 'c5s2') {
    goToScreen('c5s2', true);
    setTimeout(toggleC5s2SpotCalib, 300);
    return;
  }
  document.body.classList.toggle('calib-c5s2');
  const active = document.body.classList.contains('calib-c5s2');
  if (active) {
    enableC5s2SpotDrag();
    console.log('🎯 Calib c5s2 ON — drag les 6 cercles (rouge=IA, bleu=distracteur). Re-presse Alt+Shift+I pour terminer.');
  } else {
    disableC5s2SpotDrag();
    console.log('🎯 Calib c5s2 OFF — positions sauvegardees :', loadC5s2SpotPos());
  }
}
function enableC5s2SpotDrag() {
  document.querySelectorAll('#screen-c5s2 .c5s2-spot-zone').forEach(el => {
    el.style.cursor = 'grab';
    el.addEventListener('mousedown',  startC5s2SpotDrag, false);
    el.addEventListener('touchstart', startC5s2SpotDrag, { passive: false });
  });
}
function disableC5s2SpotDrag() {
  document.querySelectorAll('#screen-c5s2 .c5s2-spot-zone').forEach(el => {
    el.removeEventListener('mousedown',  startC5s2SpotDrag, false);
    el.removeEventListener('touchstart', startC5s2SpotDrag);
    el.style.cursor = '';
  });
}
function startC5s2SpotDrag(e) {
  if (!document.body.classList.contains('calib-c5s2')) return;
  e.preventDefault(); e.stopPropagation();
  const zone = e.currentTarget;
  const idMatch = zone.id && zone.id.match(/c5s2-spot-(\d+)/);
  const id = idMatch ? parseInt(idMatch[1], 10) : 0;
  if (!id) return;
  const screen = document.querySelector('#screen-c5s2 .story-scene');
  if (!screen) return;
  const rect = screen.getBoundingClientRect();
  const onMove = (mv) => {
    const pt = mv.touches ? mv.touches[0] : mv;
    const left = ((pt.clientX - rect.left) / rect.width)  * 100;
    const top  = ((pt.clientY - rect.top)  / rect.height) * 100;
    zone.style.left = Math.max(0, Math.min(100, left)) + '%';
    zone.style.top  = Math.max(0, Math.min(100, top))  + '%';
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('mouseup',   onUp);
    document.removeEventListener('touchend',  onUp);
    const positions = loadC5s2SpotPos();
    const left = parseFloat(zone.style.left);
    const top  = parseFloat(zone.style.top);
    positions[id - 1] = { left, top };
    saveC5s2SpotPos(positions);
    console.log('[c5s2 calib] spot', id, '→', { left, top });
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('mouseup',   onUp);
  document.addEventListener('touchend',  onUp);
}
window.toggleC5s2SpotCalib = toggleC5s2SpotCalib; // accessible aussi en console

// ============================================================
// c2s2 — Mini-jeu "Inspecte la machine"
// 3 hotspots invisibles sur la machine de Leon : cerveau / oreille / pinceau.
// Click → tooltip explicatif. 3/3 → +1 ⭐.
// ============================================================
const C2S2_DEFAULT_POS = [
  { left: 50, top: 38 }, // 1 cerveau (haut-centre de la machine)
  { left: 35, top: 55 }, // 2 oreille (milieu-gauche)
  { left: 65, top: 60 }  // 3 pinceau (milieu-droite)
];

const C2S2_TOOLTIPS = {
  brush:    { title: '🪄 Le pinceau',          desc: 'Il dessine ce que tu imagines !' },
  canvas:   { title: '🎨 La toile lumineuse',  desc: 'C\'est ici que ton image apparaît !' },
  sparkles: { title: '✨ La magie de l\'IA',   desc: 'Elle réfléchit pour créer ton image.' }
};

function loadC2s2SpotPos() {
  try {
    const raw = _calibGet('c2s2SpotPos');
    if (raw) return JSON.parse(raw);
  } catch(e) {}
  return JSON.parse(JSON.stringify(C2S2_DEFAULT_POS));
}
function saveC2s2SpotPos(pos) {
  _calibSet('c2s2SpotPos', JSON.stringify(pos));
  if (typeof persistCalibration === 'function') persistCalibration({ c2s2SpotPos: pos });
}
function applyC2s2SpotPos() {
  const pos = loadC2s2SpotPos();
  pos.forEach((p, i) => {
    const el = document.getElementById('c2s2-spot-' + (i + 1));
    if (el) {
      el.style.left = p.left + '%';
      el.style.top  = p.top  + '%';
    }
  });
}

function resetC2s2Game() {
  state.c2s2SpotsFound = [];
  if (typeof saveState === 'function') saveState();
  if (window._c2s2HideTimer)  clearTimeout(window._c2s2HideTimer);
  if (window._c2s2StartTimer) clearTimeout(window._c2s2StartTimer);
  // Désactive la loupe (au cas ou on revient sur l'ecran)
  if (typeof _c2s2DeactivateMagnifier === 'function') _c2s2DeactivateMagnifier();
  // Restaure les dialogues (au cas ou on revient sur l'ecran)
  const sceneText = document.querySelector('#screen-c2s2 .scene-text');
  if (sceneText) sceneText.style.display = '';
  const game = document.getElementById('c2s2-game');
  if (game) {
    game.style.display = 'none';
    game.style.opacity = '';
    game.style.transition = '';
  }
  const skip = document.querySelector('#screen-c2s2 .c2s2-skip-btn');
  if (skip) {
    skip.classList.remove('complete');
    skip.innerHTML = '<span class="choice-icon">✨</span> Continuer';
  }
  // Cache le bouton tant que le mini-jeu n'est pas complete
  const actions = document.getElementById('c2s2-actions');
  if (actions) actions.style.display = 'none';
  document.querySelectorAll('#screen-c2s2 .c2s2-spot-zone').forEach(el => {
    el.classList.remove('active', 'found');
    el.onclick = null;
  });
  const counter = document.getElementById('c2s2-found-count');
  if (counter) counter.textContent = '0';
  const tooltip = document.getElementById('c2s2-tooltip');
  if (tooltip) { tooltip.classList.remove('show'); tooltip.style.display = 'none'; }
}

// Etat magnifier (suivi du curseur sur l'image)
let _c2s2HoverTimer = null;
let _c2s2HoverSpot = null;

function activateC2s2Game() {
  // Pause de respiration apres le karaoke avant que le mini-jeu n'apparaisse
  if (window._c2s2StartTimer) clearTimeout(window._c2s2StartTimer);
  window._c2s2StartTimer = setTimeout(_doActivateC2s2Game, 800);
}

function _doActivateC2s2Game() {
  // Pas de playConsigne('c2s2') : Leon donne la consigne dans son dialogue
  // ("clique sur les 3 cercles dorés pour découvrir ses secrets !").
  // 1. Masque les dialogues
  const sceneText = document.querySelector('#screen-c2s2 .scene-text');
  if (sceneText) sceneText.style.display = 'none';

  // 2. Affiche le panneau de consigne (ephemere, fade out apres 3.5s)
  const game = document.getElementById('c2s2-game');
  if (game) {
    game.style.display = '';
    game.style.opacity = '1';
    game.style.transition = 'opacity 0.6s ease';
  }
  // Met a jour le texte de consigne pour la loupe
  const instr = document.querySelector('#c2s2-game .tap-instruction');
  if (instr) instr.innerHTML = '🔍 <strong>Promène la loupe</strong> pour trouver les 3 modules&nbsp;!';

  document.querySelectorAll('#screen-c2s2 .c2s2-spot-zone').forEach(el => {
    el.classList.add('active');
    el.onclick = () => clickC2s2Spot(el);
  });

  // 3. Active le mode loupe magique
  document.body.classList.add('c2s2-magnifier-mode');
  let magnifier = document.getElementById('c2s2-magnifier');
  const sceneEl = document.querySelector('#screen-c2s2 .story-scene');
  if (!magnifier && sceneEl) {
    magnifier = document.createElement('div');
    magnifier.id = 'c2s2-magnifier';
    magnifier.className = 'c2s2-magnifier';
    sceneEl.appendChild(magnifier);
  }
  if (magnifier) {
    magnifier.classList.add('show');
    // Position initiale visible (centre de la scene) + animation "wiggle"
    // qui suggere a l'enfant de balader la loupe. L'animation s'arrete au
    // 1er mouvement (cf. _c2s2OnMagnifierMove).
    magnifier.style.left = '50%';
    magnifier.style.top  = '52%';
    magnifier.classList.add('hint-wiggle');
  }

  if (sceneEl) {
    sceneEl.removeEventListener('mousemove', _c2s2OnMagnifierMove);
    sceneEl.removeEventListener('touchmove', _c2s2OnMagnifierMove);
    sceneEl.removeEventListener('touchstart', _c2s2OnMagnifierMove);
    sceneEl.addEventListener('mousemove',  _c2s2OnMagnifierMove);
    sceneEl.addEventListener('touchmove',  _c2s2OnMagnifierMove, { passive: false });
    sceneEl.addEventListener('touchstart', _c2s2OnMagnifierMove, { passive: false });
  }
  // v412 : pre-cache geometrie (sceneRect + hotspots) pour eviter
  // getBoundingClientRect a chaque move (reflow forcing -> latence iOS).
  _c2s2RefreshGeometryCache();
  // Si l ecran tourne ou redimensionne, on recalcule (sinon offset doigt/loupe).
  window.addEventListener('resize', _c2s2RefreshGeometryCache);
  window.addEventListener('orientationchange', _c2s2RefreshGeometryCache);

  // 4. Apres 5s, fade out le panneau pour ne laisser que l'image et la loupe
  //    (le pulse doré attire l'œil pendant ce temps).
  if (window._c2s2HideTimer) clearTimeout(window._c2s2HideTimer);
  window._c2s2HideTimer = setTimeout(() => {
    if (game) {
      game.style.opacity = '0';
      setTimeout(() => { if (game) game.style.display = 'none'; }, 700);
    }
  }, 5000);
}

// v412 : optimisations pour reduire la latence loupe sur iOS/mobile :
// - preventDefault pour empecher scroll/zoom natif iOS pendant le drag
// - cache du sceneRect et des hotspot rects (calcul 1x au start, pas a chaque move)
// - position via transform translate3d (GPU compositor, pas de reflow)
// - rAF pour batcher les mises a jour (1 seul update par frame meme si N touchmove)
let _c2s2SceneRect = null;
let _c2s2HotspotCache = null;
let _c2s2PendingFrame = null;
let _c2s2PendingPt = null;

function _c2s2RefreshGeometryCache() {
  const sceneEl = document.querySelector('#screen-c2s2 .story-scene');
  if (!sceneEl) { _c2s2SceneRect = null; _c2s2HotspotCache = null; return; }
  _c2s2SceneRect = sceneEl.getBoundingClientRect();
  _c2s2HotspotCache = [];
  document.querySelectorAll('#screen-c2s2 .c2s2-spot-zone.active:not(.found)').forEach(el => {
    const er = el.getBoundingClientRect();
    _c2s2HotspotCache.push({
      el,
      cx: er.left + er.width / 2 - _c2s2SceneRect.left,
      cy: er.top  + er.height / 2 - _c2s2SceneRect.top
    });
  });
}

function _c2s2ApplyMagnifierUpdate() {
  _c2s2PendingFrame = null;
  if (!_c2s2PendingPt || !_c2s2SceneRect) return;
  const magnifier = document.getElementById('c2s2-magnifier');
  if (!magnifier) return;
  if (magnifier.classList.contains('hint-wiggle')) {
    magnifier.classList.remove('hint-wiggle');
  }
  const x = _c2s2PendingPt.clientX - _c2s2SceneRect.left;
  const y = _c2s2PendingPt.clientY - _c2s2SceneRect.top;

  // Detection collision (read seul, pas de DOM read forcant reflow)
  let overSpot = null;
  if (_c2s2HotspotCache) {
    for (let i = 0; i < _c2s2HotspotCache.length; i++) {
      const h = _c2s2HotspotCache[i];
      if (h.el.classList.contains('found')) continue;
      const dx = x - h.cx, dy = y - h.cy;
      if (dx*dx + dy*dy < 2500) { overSpot = h.el; break; } // 50^2
    }
  }
  // v414 : retour a left/top (qui marchait avant v412). Le translate3d JS
  // entrait en conflit avec le translate(-50%,-50%) CSS pour des raisons de
  // containing block / scale parent -> decalage doigt/loupe. left/top en px
  // est plus simple et marche partout. preventDefault + rAF + cache restent.
  // Le transform CSS de base translate(-50%,-50%) gere le centrage.
  // .over-hotspot gere son scale(1.08) via CSS.
  magnifier.style.left = x + 'px';
  magnifier.style.top  = y + 'px';

  if (overSpot) {
    magnifier.classList.add('over-hotspot');
    if (_c2s2HoverSpot !== overSpot) {
      if (_c2s2HoverTimer) clearTimeout(_c2s2HoverTimer);
      if (_c2s2HoverSpot) _c2s2HoverSpot.classList.remove('hovering');
      _c2s2HoverSpot = overSpot;
      overSpot.classList.add('hovering');
      _c2s2HoverTimer = setTimeout(() => {
        clickC2s2Spot(overSpot);
        if (_c2s2HoverSpot) _c2s2HoverSpot.classList.remove('hovering');
        _c2s2HoverSpot = null;
        _c2s2HoverTimer = null;
        _c2s2RefreshGeometryCache(); // un spot trouve -> refresh cache
      }, 600);
    }
  } else {
    magnifier.classList.remove('over-hotspot');
    if (_c2s2HoverSpot) _c2s2HoverSpot.classList.remove('hovering');
    _c2s2HoverSpot = null;
    if (_c2s2HoverTimer) { clearTimeout(_c2s2HoverTimer); _c2s2HoverTimer = null; }
  }
}

function _c2s2OnMagnifierMove(e) {
  // preventDefault : sans ca, iOS tente de scroller/zoomer pendant le drag
  // -> handler delaye et magnifier en retard sur le doigt. passive:false
  // est deja pose a l'addEventListener (cf. activate).
  if (e.cancelable) { try { e.preventDefault(); } catch(err) {} }
  if (!_c2s2SceneRect) _c2s2RefreshGeometryCache();
  if (!_c2s2SceneRect) return;
  _c2s2PendingPt = e.touches ? e.touches[0] : e;
  // rAF : si plusieurs touchmove arrivent dans la meme frame, on n'applique
  // qu'une fois (le dernier point gagne). Reduit drastiquement le travail.
  if (_c2s2PendingFrame == null) {
    _c2s2PendingFrame = requestAnimationFrame(_c2s2ApplyMagnifierUpdate);
  }
}

function _c2s2DeactivateMagnifier() {
  document.body.classList.remove('c2s2-magnifier-mode');
  const magnifier = document.getElementById('c2s2-magnifier');
  if (magnifier) magnifier.classList.remove('show', 'over-hotspot');
  const sceneEl = document.querySelector('#screen-c2s2 .story-scene');
  if (sceneEl) {
    sceneEl.removeEventListener('mousemove', _c2s2OnMagnifierMove);
    sceneEl.removeEventListener('touchmove', _c2s2OnMagnifierMove);
    sceneEl.removeEventListener('touchstart', _c2s2OnMagnifierMove);
  }
  // v412 : cleanup resize listeners + pending frame
  window.removeEventListener('resize', _c2s2RefreshGeometryCache);
  window.removeEventListener('orientationchange', _c2s2RefreshGeometryCache);
  if (_c2s2PendingFrame != null) { cancelAnimationFrame(_c2s2PendingFrame); _c2s2PendingFrame = null; }
  _c2s2SceneRect = null;
  _c2s2HotspotCache = null;
  _c2s2PendingPt = null;
  if (_c2s2HoverTimer) { clearTimeout(_c2s2HoverTimer); _c2s2HoverTimer = null; }
  if (_c2s2HoverSpot) { _c2s2HoverSpot.classList.remove('hovering'); _c2s2HoverSpot = null; }
}

function clickC2s2Spot(el) {
  if (!el || el.classList.contains('found')) return;
  const id = el.dataset.spotId;
  el.classList.add('found');
  el.onclick = null;
  if (!state.c2s2SpotsFound.includes(id)) {
    state.c2s2SpotsFound.push(id);
    if (typeof saveState === 'function') saveState();
  }
  const counter = document.getElementById('c2s2-found-count');
  if (counter) counter.textContent = state.c2s2SpotsFound.length;
  if (typeof spawnC2s5Sparkles === 'function') spawnC2s5Sparkles(el);

  // Tooltip explicatif positionne au-dessus du hotspot, avec hierarchie titre + desc
  const tooltip = document.getElementById('c2s2-tooltip');
  const data = C2S2_TOOLTIPS[id];
  if (tooltip && data) {
    tooltip.innerHTML = `<div class="c2s2-tooltip-title">${data.title}</div><div class="c2s2-tooltip-desc">${data.desc}</div>`;
    tooltip.style.display = '';
    const left = parseFloat(el.style.left) || 50;
    const top  = parseFloat(el.style.top) || 50;
    tooltip.style.left = left + '%';
    tooltip.style.top  = Math.max(top - 22, 8) + '%';
    tooltip.style.transform = 'translate(-50%, 0)';
    tooltip.classList.remove('show');
    void tooltip.offsetWidth;
    tooltip.classList.add('show');
    if (window._c2s2TooltipTimer) clearTimeout(window._c2s2TooltipTimer);
    window._c2s2TooltipTimer = setTimeout(() => {
      tooltip.classList.remove('show');
      setTimeout(() => { tooltip.style.display = 'none'; }, 400);
    }, 3200);
  }

  // 3/3 trouves ?
  if (state.c2s2SpotsFound.length >= 3) {
    completeC2s2Game();
  }
}

function completeC2s2Game() {
  if (!state.c2s2GameAwarded) {
    if (typeof addStars === 'function') addStars(1);
    state.c2s2GameAwarded = true;
    if (typeof saveState === 'function') saveState();
    if (typeof showBonusToast === 'function') {
      showBonusToast('🔍 Tu as percé les secrets de la machine ! +1 ⭐');
    }
  }
  // Désactive la loupe (3/3 trouves, plus besoin de chercher)
  if (typeof _c2s2DeactivateMagnifier === 'function') _c2s2DeactivateMagnifier();
  // Revele le bouton "Continuer" maintenant que le mini-jeu est complete
  const actions = document.getElementById('c2s2-actions');
  if (actions) actions.style.display = '';
  const skip = document.querySelector('#screen-c2s2 .c2s2-skip-btn');
  if (skip) {
    skip.classList.add('complete');
    skip.innerHTML = '<span class="choice-icon">✨</span> Continuer';
  }
}

// ----- Calibration drag (Alt+Shift+M) -----
function toggleC2s2SpotCalib() {
  if (state.currentScreen !== 'c2s2') {
    goToScreen('c2s2', true);
    setTimeout(toggleC2s2SpotCalib, 300);
    return;
  }
  document.body.classList.toggle('calib-c2s2');
  const active = document.body.classList.contains('calib-c2s2');
  if (active) {
    enableC2s2SpotDrag();
    console.log('🎯 Calib c2s2 ON — drag les 3 cercles (cerveau / oreille / pinceau). Re-presse Alt+Shift+M pour terminer.');
  } else {
    disableC2s2SpotDrag();
    console.log('🎯 Calib c2s2 OFF — positions sauvegardees :', loadC2s2SpotPos());
  }
}
function enableC2s2SpotDrag() {
  document.querySelectorAll('#screen-c2s2 .c2s2-spot-zone').forEach(el => {
    el.style.cursor = 'grab';
    el.addEventListener('mousedown',  startC2s2SpotDrag, false);
    el.addEventListener('touchstart', startC2s2SpotDrag, { passive: false });
  });
}
function disableC2s2SpotDrag() {
  document.querySelectorAll('#screen-c2s2 .c2s2-spot-zone').forEach(el => {
    el.removeEventListener('mousedown',  startC2s2SpotDrag, false);
    el.removeEventListener('touchstart', startC2s2SpotDrag);
    el.style.cursor = '';
  });
}
function startC2s2SpotDrag(e) {
  if (!document.body.classList.contains('calib-c2s2')) return;
  e.preventDefault(); e.stopPropagation();
  const zone = e.currentTarget;
  const idMatch = zone.id && zone.id.match(/c2s2-spot-(\d+)/);
  const id = idMatch ? parseInt(idMatch[1], 10) : 0;
  if (!id) return;
  const screen = document.querySelector('#screen-c2s2 .story-scene');
  if (!screen) return;
  const rect = screen.getBoundingClientRect();
  const onMove = (mv) => {
    const pt = mv.touches ? mv.touches[0] : mv;
    const left = ((pt.clientX - rect.left) / rect.width)  * 100;
    const top  = ((pt.clientY - rect.top)  / rect.height) * 100;
    zone.style.left = Math.max(0, Math.min(100, left)) + '%';
    zone.style.top  = Math.max(0, Math.min(100, top))  + '%';
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('mouseup',   onUp);
    document.removeEventListener('touchend',  onUp);
    const positions = loadC2s2SpotPos();
    const left = parseFloat(zone.style.left);
    const top  = parseFloat(zone.style.top);
    positions[id - 1] = { left, top };
    saveC2s2SpotPos(positions);
    console.log('[c2s2 calib] spot', id, '→', { left, top });
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('mouseup',   onUp);
  document.addEventListener('touchend',  onUp);
}
window.toggleC2s2SpotCalib = toggleC2s2SpotCalib;

// ============================================================
// c5s3 — Mini-jeu "Détective Vrai/Fake" (2 phases)
// Phase 1 : "Réelle ou IA ?" → bonne réponse = IA
// Phase 2 : trouve les 3 indices d'IA avec la loupe (overlays SVG)
// ============================================================
const C5S3_INDICES = {
  finger: { title: '🖐️ Six doigts !',     desc: 'Une vraie main n\'a que 5 doigts.' },
  arm:    { title: '👐 Un bras en trop',   desc: 'D\'où sort ce bras ? Il n\'y a personne là !' },
  flying: { title: '🦋 Un papillon géant !', desc: 'Il est presque aussi gros que la tête de la fillette. Bizarre, non ?' }
};

let _c5s3SpotsFound = new Set(); // ids des indices déjà trouvés en phase 2
let _c5s3HoverTimer = null;
let _c5s3HoverSpot = null;

function resetC5s3Game() {
  state.c5s3Score = 0;
  state.c5s3CardIndex = 0;
  if (typeof saveState === 'function') saveState();
  _c5s3SpotsFound = new Set();
  // Restaure les dialogues
  const sceneText = document.querySelector('#screen-c5s3 .scene-text');
  if (sceneText) sceneText.style.display = '';
  // Restaure la vidéo, cache la photo
  const video = document.getElementById('leon-video-c5s3');
  if (video) video.style.display = '';
  const photo = document.getElementById('c5s3-photo');
  if (photo) photo.style.zIndex = '';
  // Cache les 2 phases
  const p1 = document.getElementById('c5s3-phase1');
  const p2 = document.getElementById('c5s3-phase2');
  if (p1) p1.style.display = 'none';
  if (p2) p2.style.display = 'none';
  // Retire la classe phase2-active (cache les overlays SVG)
  const screen = document.getElementById('screen-c5s3');
  if (screen) screen.classList.remove('c5s3-phase2-active');
  // Désactive la loupe + nettoyage
  if (typeof _c5s3DeactivateMagnifier === 'function') _c5s3DeactivateMagnifier();
  // Reset hotspots
  document.querySelectorAll('#screen-c5s3 .c5s3-spot-zone').forEach(el => {
    el.classList.remove('active', 'found', 'hovering');
    el.onclick = null;
  });
  // Reset bouton skip → "Continuer" cache jusqu'a la complete
  const skip = document.querySelector('#screen-c5s3 .c5s3-skip-btn');
  if (skip) {
    skip.classList.remove('complete');
    skip.innerHTML = '<span class="choice-icon">✨</span> Continuer';
    const actions = skip.closest('.answers-group');
    if (actions) actions.style.display = 'none';
  }
  // Reset hint phase 1
  const hint = document.getElementById('c5s3-q-hint');
  if (hint) hint.textContent = '';
}

// === PHASE 1 : "Réelle ou IA ?" ===
function activateC5s3Game() {
  // Pas de playConsigne('c5s3_phase1') : Leon dit la consigne dans son dialogue (modifie).
  // Cache les dialogues
  const sceneText = document.querySelector('#screen-c5s3 .scene-text');
  if (sceneText) sceneText.style.display = 'none';
  // Cache la vidéo et révèle la photo (sinon la vidéo z-index:1 recouvre la photo z-index:0)
  const video = document.getElementById('leon-video-c5s3');
  if (video) { try { video.pause(); } catch(e){} video.style.display = 'none'; }
  const photo = document.getElementById('c5s3-photo');
  if (photo) photo.style.zIndex = '3';
  // Montre phase 1 (la question)
  const p1 = document.getElementById('c5s3-phase1');
  if (p1) p1.style.display = 'flex';
  // v467 : revient au simple onclick (le pointerdown avec preventDefault
  // de v465 pouvait bloquer le click sur RÉELLE sur iOS). Le onclick HTML
  // existe deja, on s assure juste qu il est bien wired.
  const realBtn = document.querySelector('#c5s3-phase1 .c5s3-q-real');
  const aiBtn   = document.querySelector('#c5s3-phase1 .c5s3-q-ai');
  if (realBtn) realBtn.onclick = () => answerC5s3Phase1(true);
  if (aiBtn)   aiBtn.onclick   = () => answerC5s3Phase1(false);
}

function answerC5s3Phase1(saysReal) {
  const hint = document.getElementById('c5s3-q-hint');
  const realBtn = document.querySelector('#c5s3-phase1 .c5s3-q-real');
  const aiBtn   = document.querySelector('#c5s3-phase1 .c5s3-q-ai');

  if (saysReal) {
    // v466 : Mauvaise reponse -> feedback ULTRA visible (etait subtil).
    // Hint texte gros + couleur, bouton RÉELLE flash rouge + shake.
    if (hint) {
      hint.textContent = '❌ Non ! Regarde mieux, cette photo a des défauts...';
      hint.style.color = '#FF6B6B';
      hint.style.fontWeight = '800';
      hint.style.fontSize = '1.05rem';
    }
    if (realBtn) {
      realBtn.classList.remove('shake');
      void realBtn.offsetWidth;
      realBtn.classList.add('shake');
      // Flash rouge persistant
      realBtn.style.background = 'rgba(255, 107, 107, 0.45)';
      realBtn.style.borderColor = '#FF6B6B';
      setTimeout(() => {
        realBtn.style.background = '';
        realBtn.style.borderColor = '';
      }, 1200);
    }
    return;
  }

  // Bonne réponse → passe à phase 2
  if (hint) hint.textContent = '👏 Bravo détective ! Maintenant trouve les preuves...';
  setTimeout(() => {
    const p1 = document.getElementById('c5s3-phase1');
    if (p1) p1.style.display = 'none';
    _showC5s3Phase2();
  }, 1200);
}

// === PHASE 2 : trouve les 3 indices avec la loupe ===
function _showC5s3Phase2() {
  // Pas de playConsigne('c5s3_phase2') : Leon dit la consigne dans son dialogue (modifie).
  // Affiche les overlays SVG (via classe sur l'écran)
  const screen = document.getElementById('screen-c5s3');
  if (screen) screen.classList.add('c5s3-phase2-active');
  // Affiche le panneau "Trouve les 3 indices"
  const p2 = document.getElementById('c5s3-phase2');
  if (p2) p2.style.display = 'inline-flex';
  // Active les hotspots
  document.querySelectorAll('#screen-c5s3 .c5s3-spot-zone').forEach(el => {
    el.classList.add('active');
    el.onclick = () => clickC5s3Spot(el);
  });
  // Active la loupe magique
  document.body.classList.add('c5s3-magnifier-mode');
  let magnifier = document.getElementById('c5s3-magnifier');
  const sceneEl = document.querySelector('#screen-c5s3 .story-scene');
  if (!magnifier && sceneEl) {
    magnifier = document.createElement('div');
    magnifier.id = 'c5s3-magnifier';
    magnifier.className = 'c5s3-magnifier';
    sceneEl.appendChild(magnifier);
  }
  if (magnifier) {
    magnifier.classList.add('show');
    // Position initiale en bas de la scène + animation "wiggle" qui suggère
    // à l'enfant de balader la loupe. Retirée au 1er mouvement.
    magnifier.style.left = '50%';
    magnifier.style.top  = '88%';
    magnifier.classList.add('hint-wiggle');
  }
  if (sceneEl) {
    sceneEl.removeEventListener('mousemove', _c5s3OnMagnifierMove);
    sceneEl.removeEventListener('touchmove', _c5s3OnMagnifierMove);
    sceneEl.removeEventListener('touchstart', _c5s3OnMagnifierMove);
    sceneEl.addEventListener('mousemove',  _c5s3OnMagnifierMove);
    sceneEl.addEventListener('touchmove',  _c5s3OnMagnifierMove, { passive: false });
    sceneEl.addEventListener('touchstart', _c5s3OnMagnifierMove, { passive: false });
  }
  // Charge les positions calibrées
  if (typeof applyC5s3SpotPos === 'function') applyC5s3SpotPos();
}

function _c5s3OnMagnifierMove(e) {
  const sceneEl = document.querySelector('#screen-c5s3 .story-scene');
  const magnifier = document.getElementById('c5s3-magnifier');
  if (!sceneEl || !magnifier) return;
  // Au 1er mouvement, on retire l'animation "wiggle" (l'enfant a compris).
  if (magnifier.classList.contains('hint-wiggle')) {
    magnifier.classList.remove('hint-wiggle');
  }
  const rect = sceneEl.getBoundingClientRect();
  const pt = e.touches ? e.touches[0] : e;
  const x = pt.clientX - rect.left;
  const y = pt.clientY - rect.top;
  magnifier.style.left = x + 'px';
  magnifier.style.top  = y + 'px';

  let overSpot = null;
  document.querySelectorAll('#screen-c5s3 .c5s3-spot-zone.active:not(.found)').forEach(el => {
    const er = el.getBoundingClientRect();
    const cx = er.left + er.width / 2 - rect.left;
    const cy = er.top  + er.height / 2 - rect.top;
    const distance = Math.hypot(x - cx, y - cy);
    if (distance < 50) overSpot = el;
  });

  if (overSpot) {
    magnifier.classList.add('over-hotspot');
    if (_c5s3HoverSpot !== overSpot) {
      if (_c5s3HoverTimer) clearTimeout(_c5s3HoverTimer);
      if (_c5s3HoverSpot) _c5s3HoverSpot.classList.remove('hovering');
      _c5s3HoverSpot = overSpot;
      overSpot.classList.add('hovering');
      _c5s3HoverTimer = setTimeout(() => {
        clickC5s3Spot(overSpot);
        if (_c5s3HoverSpot) _c5s3HoverSpot.classList.remove('hovering');
        _c5s3HoverSpot = null;
        _c5s3HoverTimer = null;
      }, 600);
    }
  } else {
    magnifier.classList.remove('over-hotspot');
    if (_c5s3HoverSpot) _c5s3HoverSpot.classList.remove('hovering');
    _c5s3HoverSpot = null;
    if (_c5s3HoverTimer) {
      clearTimeout(_c5s3HoverTimer);
      _c5s3HoverTimer = null;
    }
  }
}

function _c5s3DeactivateMagnifier() {
  document.body.classList.remove('c5s3-magnifier-mode');
  const magnifier = document.getElementById('c5s3-magnifier');
  if (magnifier) magnifier.classList.remove('show', 'over-hotspot');
  const sceneEl = document.querySelector('#screen-c5s3 .story-scene');
  if (sceneEl) {
    sceneEl.removeEventListener('mousemove', _c5s3OnMagnifierMove);
    sceneEl.removeEventListener('touchmove', _c5s3OnMagnifierMove);
    sceneEl.removeEventListener('touchstart', _c5s3OnMagnifierMove);
  }
  if (_c5s3HoverTimer) { clearTimeout(_c5s3HoverTimer); _c5s3HoverTimer = null; }
  if (_c5s3HoverSpot) { _c5s3HoverSpot.classList.remove('hovering'); _c5s3HoverSpot = null; }
}

function clickC5s3Spot(el) {
  if (!el || el.classList.contains('found')) return;
  const id = el.dataset.spotId;
  el.classList.add('found');
  el.onclick = null;
  _c5s3SpotsFound.add(id);
  // Update compteur
  const counter = document.getElementById('c5s3-found-count');
  if (counter) counter.textContent = _c5s3SpotsFound.size;
  if (typeof spawnC2s5Sparkles === 'function') spawnC2s5Sparkles(el);

  // Tooltip explicatif
  const tooltip = document.getElementById('c5s3-tooltip');
  const data = C5S3_INDICES[id];
  if (tooltip && data) {
    tooltip.innerHTML = `<div class="c5s3-tooltip-title">${data.title}</div><div class="c5s3-tooltip-desc">${data.desc}</div>`;
    tooltip.style.display = '';
    const left = parseFloat(el.style.left) || 50;
    const top  = parseFloat(el.style.top) || 50;
    tooltip.style.left = left + '%';
    tooltip.style.top  = Math.max(top - 22, 8) + '%';
    tooltip.style.transform = 'translate(-50%, 0)';
    tooltip.classList.remove('show');
    void tooltip.offsetWidth;
    tooltip.classList.add('show');
    if (window._c5s3TooltipTimer) clearTimeout(window._c5s3TooltipTimer);
    window._c5s3TooltipTimer = setTimeout(() => {
      tooltip.classList.remove('show');
      setTimeout(() => { tooltip.style.display = 'none'; }, 400);
    }, 3200);
  }

  // 3/3 trouvés → completion
  if (_c5s3SpotsFound.size >= 1) {
    setTimeout(completeC5s3Game, 1200);
  }
}

function completeC5s3Game() {
  if (!state.c5s3GameAwarded) {
    if (typeof addStars === 'function') addStars(1);
    state.c5s3GameAwarded = true;
    if (typeof saveState === 'function') saveState();
    if (typeof showBonusToast === 'function') {
      showBonusToast('🔍 Bel esprit critique ! +1 ⭐');
    }
  }
  if (typeof _c5s3DeactivateMagnifier === 'function') _c5s3DeactivateMagnifier();
  const skip = document.querySelector('#screen-c5s3 .c5s3-skip-btn');
  if (skip) {
    skip.classList.add('complete');
    skip.innerHTML = '<span class="choice-icon">✨</span> Continuer';
    const actions = skip.closest('.answers-group');
    if (actions) actions.style.display = '';
  }
}

// === Calibration drag des hotspots c5s3 (console : toggleC5s3SpotCalib()) ===
const C5S3_DEFAULT_POS = [
  { left: 52, top: 45 }  // 1 arm : 3e bras entre les deux fillettes (seule erreur)
];
function loadC5s3SpotPos() {
  try {
    const raw = _calibGet('c5s3SpotPos');
    if (raw) return JSON.parse(raw);
  } catch(e) {}
  return JSON.parse(JSON.stringify(C5S3_DEFAULT_POS));
}
function saveC5s3SpotPos(pos) {
  _calibSet('c5s3SpotPos', JSON.stringify(pos));
  if (typeof persistCalibration === 'function') persistCalibration({ c5s3SpotPos: pos });
}
function applyC5s3SpotPos() {
  const pos = loadC5s3SpotPos();
  pos.forEach((p, i) => {
    const el = document.getElementById('c5s3-spot-' + (i + 1));
    if (el) {
      el.style.left = p.left + '%';
      el.style.top  = p.top  + '%';
    }
  });
}
function toggleC5s3SpotCalib() {
  if (state.currentScreen !== 'c5s3') {
    goToScreen('c5s3', true);
    setTimeout(toggleC5s3SpotCalib, 300);
    return;
  }
  // Force phase 2 active pour voir les overlays + hotspots
  const screen = document.getElementById('screen-c5s3');
  if (screen) screen.classList.add('c5s3-phase2-active');
  document.querySelectorAll('#screen-c5s3 .c5s3-spot-zone').forEach(el => el.classList.add('active'));
  document.body.classList.toggle('calib-c5s3');
  const active = document.body.classList.contains('calib-c5s3');
  if (active) {
    document.querySelectorAll('#screen-c5s3 .c5s3-spot-zone').forEach(el => {
      el.style.cursor = 'grab';
      el.addEventListener('mousedown', _startC5s3SpotDrag, false);
      el.addEventListener('touchstart', _startC5s3SpotDrag, { passive: false });
    });
    console.log('🎯 Calib c5s3 ON — drag les 3 cercles (finger / arm / flying). Re-presse toggleC5s3SpotCalib() pour terminer.');
  } else {
    document.querySelectorAll('#screen-c5s3 .c5s3-spot-zone').forEach(el => {
      el.removeEventListener('mousedown', _startC5s3SpotDrag, false);
      el.removeEventListener('touchstart', _startC5s3SpotDrag);
      el.style.cursor = '';
    });
    console.log('🎯 Calib c5s3 OFF — positions sauvegardées :', loadC5s3SpotPos());
  }
}
function _startC5s3SpotDrag(e) {
  if (!document.body.classList.contains('calib-c5s3')) return;
  e.preventDefault(); e.stopPropagation();
  const zone = e.currentTarget;
  const idMatch = zone.id && zone.id.match(/c5s3-spot-(\d+)/);
  const id = idMatch ? parseInt(idMatch[1], 10) : 0;
  if (!id) return;
  const screen = document.querySelector('#screen-c5s3 .story-scene');
  if (!screen) return;
  const rect = screen.getBoundingClientRect();
  const onMove = (mv) => {
    const pt = mv.touches ? mv.touches[0] : mv;
    const left = ((pt.clientX - rect.left) / rect.width)  * 100;
    const top  = ((pt.clientY - rect.top)  / rect.height) * 100;
    zone.style.left = Math.max(0, Math.min(100, left)) + '%';
    zone.style.top  = Math.max(0, Math.min(100, top))  + '%';
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.removeEventListener('touchend', onUp);
    const positions = loadC5s3SpotPos();
    positions[id - 1] = { left: parseFloat(zone.style.left), top: parseFloat(zone.style.top) };
    saveC5s3SpotPos(positions);
    console.log('[c5s3 calib] spot', id, '→', positions[id - 1]);
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('mouseup', onUp);
  document.addEventListener('touchend', onUp);
}
window.toggleC5s3SpotCalib = toggleC5s3SpotCalib;

// ============================================================
// c4s5 — Mini-jeu "Test de l'amitie" (Memory pairs)
// Image associee a chaque paire (verso de carte = image perso, recto = texte)
const C4S5_IMG_BY_PAIR = {
  love:    'assets/Leon_peinture.jpg',
  console: 'assets/c4s2_bot/bot_portrait.jpg',
  friend:  'assets/chapitre_2/t5_grid_raw/cat.jpg',
  dream:   'assets/chapitre_2/t5_grid_raw/girl.jpg'
};
// 4 paires question tendre / reponse de Bot. Cartes shufflees a chaque entree.
// 8 cartes au total (4 questions + 4 reponses). Match si meme `id`.
// ============================================================
const C4S5_PAIRS = [
  { id: 'love',    question: '« Tu m\'aimes ? »',           answer: '« Une machine ne peut pas aimer 🤖 »' },
  { id: 'console', question: '« Tu peux me consoler ? »',  answer: '« Non je ne peux pas, demande plutôt à tes parents 🤗 »' },
  { id: 'friend',  question: '« On peut être amis ? »',    answer: '« Je suis juste une machine, pas un ami 🤖 »' },
  { id: 'dream',   question: '« Tu rêves la nuit ? »',     answer: '« Non, je m\'éteins, comme la télé 📺 »' }
];

// Etat in-memory de la partie courante (recree a chaque entree sur l'ecran)
let _c4s5State = {
  flipped: [],   // [el1, el2] cartes actuellement face visible (max 2)
  matched: new Set(), // ids des paires deja matchees
  busy: false    // pendant la temporisation 1s entre 2 cartes flippees
};

function resetC4s5Game() {
  state.c4s5PairsFound = [];
  if (typeof saveState === 'function') saveState();
  _c4s5State = { flipped: [], matched: new Set(), busy: false };
  // Cache panneau ; il reviendra via activateC4s5Game()
  const game = document.getElementById('c4s5-game');
  if (game) game.style.display = 'none';
  // Restaure les dialogues (au cas ou on est revenu sur l'ecran)
  const sceneText = document.querySelector('#screen-c4s5 .scene-text');
  if (sceneText) sceneText.style.display = '';
  const skip = document.querySelector('#screen-c4s5 .c4s5-skip-btn');
  if (skip) {
    skip.classList.remove('complete');
    skip.innerHTML = '<span class="choice-icon">✨</span> Continuer';
    const actions = skip.closest('.answers-group');
    if (actions) actions.style.display = 'none';
  }
  const counter = document.getElementById('c4s5-pairs-found');
  if (counter) counter.textContent = '0';
  // Vide la grille
  const grid = document.getElementById('c4s5-cards');
  if (grid) grid.innerHTML = '';
}

function _shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function _buildC4s5Cards() {
  const grid = document.getElementById('c4s5-cards');
  if (!grid) return;
  grid.innerHTML = '';

  // Genere 8 cartes : 4 questions + 4 reponses, shufflees
  const cards = [];
  C4S5_PAIRS.forEach(p => {
    cards.push({ pairId: p.id, type: 'q', text: p.question });
    cards.push({ pairId: p.id, type: 'a', text: p.answer });
  });
  const shuffled = _shuffleArray(cards);

  shuffled.forEach((c, idx) => {
    const card = document.createElement('div');
    card.className = 'c4s5-card';
    card.dataset.pairId = c.pairId;
    card.dataset.type   = c.type;
    card.dataset.idx    = idx;
    // Numero "1" sur les cartes questions, "2" sur les cartes reponses, pour
    // signaler visuellement aux non-lecteurs : "matche un 1 avec un 2".
    const num = c.type === 'q' ? '1' : '2';
    // Image perso DU CÔTÉ Q/R : associee au pairId, visible quand la carte
    // est retournee (et pendant la phase preview de 5s au demarrage).
    const img = C4S5_IMG_BY_PAIR[c.pairId];
    const bgStyle = img ? `style="background-image: url('${img}')"` : '';
    card.innerHTML = `
      <div class="c4s5-card-inner">
        <div class="c4s5-card-front"><span class="c4s5-card-num">${num}</span></div>
        <div class="c4s5-card-back" ${bgStyle}>
          <span class="c4s5-card-back-text">${c.text}</span>
        </div>
      </div>`;
    card.addEventListener('click', () => clickC4s5Card(card));
    grid.appendChild(card);
  });
}

function activateC4s5Game() {
  // Pas de playConsigne('c4s5') : Leon dit la consigne dans son dialogue (modifie).
  _buildC4s5Cards();
  // Masque les dialogues (narration + bulle Leon) pour laisser place au jeu
  const sceneText = document.querySelector('#screen-c4s5 .scene-text');
  if (sceneText) sceneText.style.display = 'none';
  const game = document.getElementById('c4s5-game');
  if (game) game.style.display = '';
  // === Phase PREVIEW : toutes les cartes face-up 5s pour memorisation ===
  _c4s5State.busy = true; // bloque les clics pendant le preview
  // Petit delai pour laisser le DOM se peindre, puis flip ALL face-up
  setTimeout(() => {
    document.querySelectorAll('#c4s5-cards .c4s5-card').forEach(c => {
      c.classList.add('flipped', 'preview');
    });
  }, 200);
  // Apres 5s, on retourne tout face-down et on lance le memory
  setTimeout(() => {
    document.querySelectorAll('#c4s5-cards .c4s5-card').forEach(c => {
      c.classList.remove('flipped', 'preview');
    });
    _c4s5State.busy = false;
  }, 5200);
}

// SpeechSynthesis pour le memory : lit a voix haute le contenu de la carte
// retournee. Cartes "q" (questions) = voix normale, "a" (reponses Bot) = pitch
// eleve pour effet robotique.
function _c4s5SpeakCard(card) {
  if (!card || typeof window.speechSynthesis === 'undefined') return;
  // Recupere le texte au verso (face .c4s5-card-back)
  const backEl = card.querySelector('.c4s5-card-back');
  if (!backEl) return;
  const rawText = backEl.textContent || '';
  if (!rawText.trim()) return;
  // Strip emojis pour ne pas les faire lire
  const cleanText = (typeof _stripEmoji === 'function') ? _stripEmoji(rawText) : rawText;
  if (!cleanText.trim()) return;
  // Bug Chromium : delai apres cancel pour que le speak suivant ne soit pas avale
  try { window.speechSynthesis.cancel(); } catch(e) {}
  setTimeout(() => {
    const utt = new SpeechSynthesisUtterance(cleanText);
    utt.lang = 'fr-FR';
    utt.volume = 1;
    if (card.dataset.type === 'a') {
      // Reponse de Bot : voix robotique (moins aigue)
      utt.pitch = 1.15;
      utt.rate  = 0.92;
    } else {
      // Question (de l'enfant) : voix normale
      utt.pitch = 1.0;
      utt.rate  = 1.0;
    }
    try {
      const voices = window.speechSynthesis.getVoices();
      const fr = voices.find(v => v.lang && v.lang.startsWith('fr'));
      if (fr) utt.voice = fr;
    } catch(e) {}
    utt.onerror = (ev) => console.warn('[c4s5] tts error:', ev.error);
    window._c4s5Utterance = utt; // garde la ref pour eviter GC precoce
    window.speechSynthesis.speak(utt);
  }, 100);
}

function clickC4s5Card(card) {
  if (!card) return;
  if (_c4s5State.busy) return;
  // Carte deja matchee ou deja flippee : ignore
  if (card.classList.contains('matched')) return;
  if (card.classList.contains('flipped')) return;

  // Flip de cette carte
  card.classList.add('flipped');
  _c4s5State.flipped.push(card);
  // Lit a voix haute le contenu de la carte (accessibilite non-lecteurs)
  _c4s5SpeakCard(card);

  if (_c4s5State.flipped.length === 2) {
    const [a, b] = _c4s5State.flipped;
    if (a.dataset.pairId === b.dataset.pairId) {
      // MATCH
      _c4s5State.busy = true;
      setTimeout(() => {
        a.classList.add('matched');
        b.classList.add('matched');
        a.classList.remove('flipped');
        b.classList.remove('flipped');
        _c4s5State.matched.add(a.dataset.pairId);
        _c4s5State.flipped = [];
        _c4s5State.busy = false;
        // Update progress
        const counter = document.getElementById('c4s5-pairs-found');
        if (counter) counter.textContent = _c4s5State.matched.size;
        if (!state.c4s5PairsFound.includes(a.dataset.pairId)) {
          state.c4s5PairsFound.push(a.dataset.pairId);
          if (typeof saveState === 'function') saveState();
        }
        // 4/4 paires ?
        if (_c4s5State.matched.size >= 4) {
          completeC4s5Game();
        }
      }, 350);
    } else {
      // PAS MATCH : flip back apres une pause de lecture
      _c4s5State.busy = true;
      a.classList.add('miss');
      b.classList.add('miss');
      setTimeout(() => {
        a.classList.remove('flipped', 'miss');
        b.classList.remove('flipped', 'miss');
        _c4s5State.flipped = [];
        _c4s5State.busy = false;
      }, 1200);
    }
  }
}

function completeC4s5Game() {
  if (!state.c4s5GameAwarded) {
    if (typeof addStars === 'function') addStars(1);
    state.c4s5GameAwarded = true;
    if (typeof saveState === 'function') saveState();
    if (typeof showBonusToast === 'function') {
      showBonusToast('💗 Bravo ! Tu connais Bot maintenant. +1 ⭐');
    }
  }
  const skip = document.querySelector('#screen-c4s5 .c4s5-skip-btn');
  if (skip) {
    skip.classList.add('complete');
    skip.innerHTML = '<span class="choice-icon">✨</span> Continuer';
    const actions = skip.closest('.answers-group');
    if (actions) actions.style.display = '';
  }
}

// ============================================================
// c4s3 — Mini-jeu "Cascade de livres"
// L'enfant tape 7 fois sur le bouton-livre, le compteur grimpe x10
// (1, 10, 100, 1k, 10k, 100k, 1M). 1M atteint → +1 ⭐.
// ============================================================
// Progression sur 25 taps (~x1.6-2 par tap) pour arriver pile à 1 000 000
const C4S3_STEPS = [
  1,        // tap 1
  2,        // tap 2
  4,        // tap 3
  7,        // tap 4
  12,       // tap 5
  20,       // tap 6
  35,       // tap 7
  60,       // tap 8
  100,      // tap 9
  170,      // tap 10
  280,      // tap 11
  450,      // tap 12
  700,      // tap 13
  1100,     // tap 14
  1800,     // tap 15
  3000,     // tap 16
  5000,     // tap 17
  8500,     // tap 18
  14000,    // tap 19
  25000,    // tap 20
  50000,    // tap 21
  110000,   // tap 22
  250000,   // tap 23
  550000,   // tap 24
  1000000   // tap 25 → +1 ⭐
];
const C4S3_BOOK_EMOJIS = ['📚', '📖', '📕', '📗', '📘', '📙', '📓'];

function _formatBookCount(n) {
  if (n >= 1000000) return n.toLocaleString('fr-FR').replace(/\s/g, ' ');
  if (n >= 1000)    return n.toLocaleString('fr-FR').replace(/\s/g, ' ');
  return String(n);
}

function resetC4s3Game() {
  state.c4s3TapsDone = 0;
  if (typeof saveState === 'function') saveState();
  const game = document.getElementById('c4s3-game');
  if (game) game.style.display = 'none';
  // Restaure les dialogues si l'enfant revient sur l'ecran
  const sceneText = document.querySelector('#screen-c4s3 .scene-text');
  if (sceneText) sceneText.style.display = '';
  const counter = document.getElementById('c4s3-counter');
  if (counter) {
    counter.textContent = '0';
    counter.classList.remove('bump');
  }
  const tapBtn = document.getElementById('c4s3-tap-btn');
  if (tapBtn) {
    tapBtn.classList.remove('complete');
    tapBtn.innerHTML = '<span class="c4s3-tap-emoji">📚</span><span class="c4s3-tap-text">Tape&nbsp;!</span>';
    tapBtn.onclick = null;
  }
  const skip = document.querySelector('#screen-c4s3 .c4s3-skip-btn');
  if (skip) {
    skip.classList.remove('complete');
    skip.innerHTML = '<span class="choice-icon">✨</span> Continuer';
    // Cache le bouton tant que le mini-jeu n'est pas complete
    const actions = skip.closest('.answers-group');
    if (actions) actions.style.display = 'none';
  }
  const fall = document.getElementById('c4s3-falling-books');
  if (fall) fall.innerHTML = '';
}

function activateC4s3Game() {
  // Pas de playConsigne('c4s3') : Leon dit la consigne dans son dialogue (modifie).
  // Masque les dialogues, affiche le panneau du jeu
  const sceneText = document.querySelector('#screen-c4s3 .scene-text');
  if (sceneText) sceneText.style.display = 'none';
  const game = document.getElementById('c4s3-game');
  if (game) game.style.display = '';
  const tapBtn = document.getElementById('c4s3-tap-btn');
  if (tapBtn) tapBtn.onclick = clickC4s3Book;
}

function clickC4s3Book() {
  if (state.c4s3TapsDone >= C4S3_STEPS.length) return; // deja a 1M

  state.c4s3TapsDone++;
  const value = C4S3_STEPS[state.c4s3TapsDone - 1];
  if (typeof saveState === 'function') saveState();

  // Update counter avec animation bump
  const counter = document.getElementById('c4s3-counter');
  if (counter) {
    counter.textContent = _formatBookCount(value);
    counter.classList.remove('bump');
    void counter.offsetWidth; // force reflow pour relancer l'animation
    counter.classList.add('bump');
  }

  // Spawn cascade de livres : intensite progressive
  // - taps 1-5  : 3 a 8 livres (douce pluie)
  // - taps 6-15 : 8 a 20 livres (cascade)
  // - taps 16-24: 20 a 35 livres (averse)
  // - tap 25 (1M) : 60 livres + explosion finale
  const fall = document.getElementById('c4s3-falling-books');
  if (fall) {
    const isLast = state.c4s3TapsDone === C4S3_STEPS.length;
    const nBooks = isLast ? 60 : Math.min(3 + Math.floor(state.c4s3TapsDone * 1.4), 35);
    for (let i = 0; i < nBooks; i++) {
      setTimeout(() => spawnC4s3FallingBook(fall, isLast), i * (isLast ? 30 : 50));
    }
  }

  // Dernier tap → 1M atteint → completion
  if (state.c4s3TapsDone >= C4S3_STEPS.length) {
    completeC4s3Game();
  }
}

function spawnC4s3FallingBook(container, isFinal) {
  const el = document.createElement('span');
  el.className = 'c4s3-falling-book';
  // Au tap final (1M), on melange livres et sparkles pour un effet feu d'artifice
  if (isFinal && Math.random() < 0.35) {
    el.textContent = ['✨', '⭐', '🎉', '💫'][Math.floor(Math.random() * 4)];
  } else {
    el.textContent = C4S3_BOOK_EMOJIS[Math.floor(Math.random() * C4S3_BOOK_EMOJIS.length)];
  }
  el.style.left = (Math.random() * 100) + '%';
  el.style.fontSize = (1.2 + Math.random() * 1.6) + 'rem';
  el.style.animationDuration = (1.2 + Math.random() * 0.8) + 's';
  container.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

function completeC4s3Game() {
  if (!state.c4s3GameAwarded) {
    if (typeof addStars === 'function') addStars(1);
    state.c4s3GameAwarded = true;
    if (typeof saveState === 'function') saveState();
    if (typeof showBonusToast === 'function') {
      showBonusToast('📚 Un million de livres lus ! +1 ⭐');
    }
  }
  const tapBtn = document.getElementById('c4s3-tap-btn');
  if (tapBtn) {
    tapBtn.classList.add('complete');
    tapBtn.textContent = '✨';
  }
  const skip = document.querySelector('#screen-c4s3 .c4s3-skip-btn');
  if (skip) {
    skip.classList.add('complete');
    skip.innerHTML = '<span class="choice-icon">✨</span> Continuer';
    // Revele le bouton maintenant que le mini-jeu est complete
    const actions = skip.closest('.answers-group');
    if (actions) actions.style.display = '';
  }
}

// ============================================================
// CHAPITRE 4 — Bot, l'IA qui parle : mini-jeu + quiz + confetti
// ============================================================
const C4_QUESTIONS = {
  capital: { question: 'Quelle est la capitale de la France ?', answer: '« Paris ! »',                                  answerShort: 'Paris',                       verdict: 'correct' },
  cat:     { question: 'Combien de pattes a un chat ?',         answer: '« Un chat a 4 pattes ! » 🐱',                  answerShort: 'Un chat a 4 pattes',          verdict: 'correct' },
  moon:    { question: 'De quoi est faite la Lune ?',           answer: '« La Lune est faite de fromage ! » 🧀',         answerShort: 'La Lune est faite de fromage', verdict: 'wrong'   },
  math:    { question: 'Combien font 8 + 8 ?',                  answer: '« 8 + 8 = 16 ! » ➕',                            answerShort: '8 + 8 = 16',                  verdict: 'correct' }
};

function askBotC4(btn) {
  const id = btn.dataset.id;
  const data = C4_QUESTIONS[id];
  if (!data) return;
  if (btn.classList.contains('has-answer')) return;
  const slot = btn.querySelector('.q-answer');
  const ans  = document.getElementById('c4s6-answer');
  const label = document.getElementById('c4s6-result-label');

  // Phase 1 (1er tap) : enfant reflechit a haute voix avant la reponse de Bot.
  if (!btn.classList.contains('thinking')) {
    btn.classList.add('played', 'thinking');
    if (slot) slot.textContent = '💭 À toi de répondre ! Touche encore pour voir Bot';
    if (label) label.textContent = 'À ton tour :';
    if (ans) {
      ans.classList.remove('listening');
      ans.innerHTML = '🗣️ <strong>Réponds à voix haute</strong>, puis touche encore la carte pour voir la réponse de Bot.';
    }
    return;
  }

  // Phase 2 (2eme tap) : Bot revele sa reponse.
  btn.classList.remove('thinking');
  btn.classList.add('has-answer');
  if (!state.c4QuestionsAsked.includes(id)) state.c4QuestionsAsked.push(id);
  saveState();
  if (label) label.textContent = 'Bot répond :';
  if (slot) slot.innerHTML = data.answer;
  if (ans) {
    ans.classList.remove('listening');
    ans.innerHTML = '✨ Regarde la réponse de Bot dans la carte&nbsp;!';
  }
  if (state.c4QuestionsAsked.length === 4) {
    setTimeout(() => activateHuntModeC4(), 1100);
  }
}

// Phase 2 : on demande a l'enfant de retrouver la reponse fausse
function activateHuntModeC4() {
  state.c4WrongFound = [];
  saveState();
  const instr = document.getElementById('c4s6-instruction');
  if (instr) instr.innerHTML = '🔍 <strong>Trouve l\'erreur de Bot&nbsp;!</strong> Re-lis les 4 réponses, et clique sur celle qui est fausse.';
  document.querySelectorAll('#c4s6-questions .sound-btn').forEach(b => {
    b.classList.add('hunt-mode');
    // On garde 'has-answer' pour que la reponse reste visible en phase 2
    b.classList.remove('played', 'thinking');
    b.disabled = false;
    b.onclick = () => markErrorC4(b);
  });
  // v457 : show le frame sound-result UNIQUEMENT en phase 2 (hunt mode).
  // Pendant la phase 1, il est cache (les reponses sont dans les .q-answer
  // de chaque carte). Voir HTML : sound-result a style=display:none par defaut.
  const result = document.getElementById('c4s6-result');
  if (result) result.style.display = '';
  const ans = document.getElementById('c4s6-answer');
  const label = document.getElementById('c4s6-result-label');
  if (label) label.textContent = 'À toi de jouer :';
  if (ans) ans.innerHTML = '👀 Vérifie chaque réponse... <strong>laquelle est fausse</strong>&nbsp;?';
}

function markErrorC4(btn) {
  const id = btn.dataset.id;
  const data = C4_QUESTIONS[id];
  if (!data) return;
  state.c4WrongFound = state.c4WrongFound || [];
  if (state.c4WrongFound.includes(id)) return;
  const ans = document.getElementById('c4s6-answer');
  const label = document.getElementById('c4s6-result-label');
  if (data.verdict === 'wrong') {
    btn.classList.add('found-wrong');
    btn.disabled = true;
    state.c4WrongFound.push(id);
    saveState();
    if (label) label.textContent = '🎯 Bien vu !';
    if (ans) ans.innerHTML = '« ' + data.answerShort + ' »  →  ❌ <strong>C\'est bien faux&nbsp;!</strong>';
    if (state.c4WrongFound.length === 1) {
      setTimeout(() => {
        if (label) label.textContent = '🏆 Bravo détective !';
        if (ans) ans.innerHTML = 'Tu as trouvé l\'erreur de Bot&nbsp;! Tu sais maintenant qu\'il faut <strong>toujours vérifier</strong> ce que dit l\'IA.';
        document.getElementById('btn-to-c4s7')?.classList.add('show-btn'); const leonBravoAudio = new Audio('assets/chapitre_4/c4s6_bravo.mp3'); leonBravoAudio.play().catch(e => console.log('Audio play error:', e));
      }, 1300);
    }
  } else {
    btn.classList.add('bot-was-right');
    if (label) label.textContent = '🤔 Hmm...';
    if (ans) ans.innerHTML = '« ' + data.answerShort + ' »  →  ✅ Là, Bot avait <strong>raison</strong>&nbsp;! Cherche encore.';
    setTimeout(() => btn.classList.remove('bot-was-right'), 600);
  }
}

function vfAnswerC4(btn, index, userSaysTrue) {
  if (state.vfAnsweredC4[index]) return;
  state.vfAnsweredC4[index] = true;
  state.vfDoneC4++;
  const isCorrect = (userSaysTrue === vfCorrectAnswersC4[index]);
  const siblings = btn.parentElement.querySelectorAll('.vf-btn');
  siblings.forEach(b => b.disabled = true);
  if (isCorrect) {
    btn.classList.add('correct');
    state.vfScoreC4++;
  } else {
    btn.classList.add('wrong');
    siblings.forEach(b => {
      if (b.classList.contains('vrai') === vfCorrectAnswersC4[index]) b.classList.add('correct');
    });
  }
  if (state.vfDoneC4 === 4) setTimeout(showVFScoreC4, 600);
}

function showVFScoreC4() {
  const starsMsg = state.vfScoreC4 === 4 ? '⭐⭐⭐' : state.vfScoreC4 >= 2 ? '⭐⭐' : '⭐';
  const textMsg  = state.vfScoreC4 === 4 ? 'Bravo, expert des bavardages IA !' : state.vfScoreC4 >= 2 ? 'Pas mal !' : 'Tu vas progresser !';
  const stars = document.getElementById('score-stars-c4');
  const txt   = document.getElementById('score-text-c4');
  const disp  = document.getElementById('score-display-c4');
  if (stars) stars.textContent = starsMsg;
  if (txt)   txt.textContent   = `${state.vfScoreC4}/4 — ${textMsg}`;
  if (disp)  disp.style.display = 'block';
  _revealChestBtn('btn-to-c4s8');
}

function _launchConfettiInto(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  const colors = ['#FFD166','#FF6B6B','#06D6A0','#9B5DE5','#4FC3F7','#FFB347','#FF69B4','#FFF'];
  for (let i = 0; i < 70; i++) {
    const el = document.createElement('div');
    el.className = 'confetto';
    el.style.left   = (Math.random() * 110 - 5) + 'vw';
    el.style.width  = (7  + Math.random() *  9) + 'px';
    el.style.height = (11 + Math.random() * 11) + 'px';
    el.style.background   = colors[Math.floor(Math.random() * colors.length)];
    el.style.borderRadius = Math.random() > 0.4 ? '50%' : '3px';
    el.style.transform    = `rotate(${Math.random() * 360}deg)`;
    const delay    = Math.random() * 2.8;
    const duration = 2.5 + Math.random() * 2.5;
    el.style.animation = `confettiFall ${duration}s ${delay}s linear forwards`;
    container.appendChild(el);
  }
}
function launchConfettiC3() { _launchConfettiInto('confetti-container-c3'); }
function launchConfettiC4() { _launchConfettiInto('confetti-container-c4'); }
function launchConfettiC5() { _launchFireworksInto('fireworks-container-c5'); }

// Feu d'artifice (au lieu de confettis) pour la fin de l'aventure : 12 explosions
// successives a des positions aleatoires, chacune compose de 24 particules
// qui s'eloignent radialement avec couleurs vives.
function _launchFireworksInto(containerId) {
  const arena = document.getElementById(containerId);
  if (!arena) return;
  arena.innerHTML = '';
  const COLORS = ['#FFE166','#FF5572','#06D6A0','#4FC3F7','#9B5DE5','#FF8E00','#F15BB5','#FFFFFF'];
  const TOTAL_BURSTS = 14;
  for (let b = 0; b < TOTAL_BURSTS; b++) {
    setTimeout(() => _spawnFireworkBurst(arena, COLORS), b * 600 + Math.random() * 200);
  }
}

function _spawnFireworkBurst(arena, COLORS) {
  // Position aleatoire (% viewport, evite les bords)
  const cx = 10 + Math.random() * 80;
  const cy = 10 + Math.random() * 60;
  const color = COLORS[Math.floor(Math.random() * COLORS.length)];
  const PARTICLES = 24;
  for (let i = 0; i < PARTICLES; i++) {
    const angle = (i / PARTICLES) * Math.PI * 2;
    const dist = 80 + Math.random() * 60;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist;
    const p = document.createElement('span');
    p.className = 'firework-particle';
    p.style.left  = cx + '%';
    p.style.top   = cy + '%';
    p.style.background = color;
    p.style.setProperty('--dx', dx + 'px');
    p.style.setProperty('--dy', dy + 'px');
    arena.appendChild(p);
    setTimeout(() => { if (p.parentNode) p.parentNode.removeChild(p); }, 1600);
  }
  // Flash central a l'origine du burst
  const flash = document.createElement('span');
  flash.className = 'firework-flash';
  flash.style.left = cx + '%';
  flash.style.top  = cy + '%';
  flash.style.background = color;
  arena.appendChild(flash);
  setTimeout(() => { if (flash.parentNode) flash.parentNode.removeChild(flash); }, 500);
}

// ============================================================
// Carte LÉGENDAIRE Léon : auto-unlock si 16/16 sur les 4 quiz V/F
// ============================================================
function awardLegendaryLeonIfPerfect() {
  _ensureAtelierState();
  // Si déjà débloquée, rien à faire
  if (state.cardsUnlocked && state.cardsUnlocked.includes('card-leon-master')) return false;
  // Score total des 4 quiz V/F : chap 1 + chap 2 + chap 3 + chap 4
  const total = (state.vfScore || 0) + (state.vfScoreC2 || 0) + (state.vfScoreC3 || 0) + (state.vfScoreC4 || 0);
  if (total < 16) return false;
  // Score parfait → débloque la carte gratuitement
  if (!state.purchases.includes('card-leon-master')) state.purchases.push('card-leon-master');
  if (!state.cardsUnlocked.includes('card-leon-master')) state.cardsUnlocked.push('card-leon-master');
  saveState();
  if (typeof showBonusToast === 'function') {
    showBonusToast('🌟 LÉGENDAIRE débloquée ! Léon Maître de l\'IA !');
  }
  if (typeof refreshAtelierUI === 'function') refreshAtelierUI();
  return true;
}
// launchConfetti() : confettis sur la victoire chap 1 (ecran 7).
// Reference dans le code mais avait disparu de la definition.
function launchConfetti()   { _launchConfettiInto('confetti-container'); }

// Apres le 4e quiz de chaque chapitre, on revele le bouton "Ouvrir le coffre"
// (ou "Voir mon badge" au chap 4). Sur mobile/petit ecran ce bouton apparait
// SOUS le score et n'est pas force visible -> on scrolle l'ecran a sa hauteur
// pour eviter que l'enfant cherche ou cliquer. Smooth + center pour rester lisible.
function _revealChestBtn(btnId) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.classList.add('show-btn');
  // Petit delai : laisse l'animation show-btn (bounce/fade) demarrer, puis scrolle.
  setTimeout(() => {
    try {
      btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch(e) {
      // Fallback navigateurs anciens (sans options object)
      btn.scrollIntoView();
    }
  }, 350);
}

// v663 : musique de victoire jouee a l'entree de chaque ecran win (c1
// ecran 7, c2s9, c3s9, c4s8, c5s6). S'arrete automatiquement quand
// l'utilisateur clique pour quitter (Continuer / Carte / etc. via le
// _stopVictoryJingle appele en haut de goToScreen). Fade-out doux en
// fin naturelle si l'enfant ne clique pas.
function _playVictoryJingle() {
  if (typeof voicesEnabled === 'function' && !voicesEnabled()) return;
  try {
    if (!window._victoryJingle) {
      window._victoryJingle = new Audio('assets/victory_jingle.mp3?v=665');
      window._victoryJingle.volume = 0.55; // laisse de la place aux voix narration
      window._victoryJingle.preload = 'auto';
    }
    try { window._victoryJingle.currentTime = 0; } catch (e) {}
    window._victoryJingle.volume = 0.55; // reset volume au cas ou un fade precedent
    const p = window._victoryJingle.play();
    if (p && p.catch) p.catch(() => {});
    // Fade-out doux quand le morceau approche de sa fin naturelle (evite
    // une coupure abrupte si l'enfant ne clique pas Continuer rapidement).
    if (window._victoryJingleFadeTimer) clearInterval(window._victoryJingleFadeTimer);
    window._victoryJingleFadeTimer = setInterval(() => {
      const a = window._victoryJingle;
      if (!a) return;
      const remaining = (a.duration || 0) - (a.currentTime || 0);
      if (remaining > 0 && remaining < 1.5 && a.volume > 0.05) {
        a.volume = Math.max(0.05, a.volume - 0.04);
      }
      if (a.ended || remaining <= 0) {
        clearInterval(window._victoryJingleFadeTimer);
        window._victoryJingleFadeTimer = null;
      }
    }, 100);
  } catch (e) {}
}

// v663 : arrete la musique de victoire (appele en haut de goToScreen pour
// stopper proprement quand on clique Continuer/Carte/etc. depuis un ecran win).
function _stopVictoryJingle() {
  try {
    if (window._victoryJingleFadeTimer) {
      clearInterval(window._victoryJingleFadeTimer);
      window._victoryJingleFadeTimer = null;
    }
    if (window._victoryJingle) {
      try { window._victoryJingle.pause(); } catch (e) {}
      try { window._victoryJingle.currentTime = 0; } catch (e) {}
      window._victoryJingle.volume = 0.55;
    }
  } catch (e) {}
}

// updateStarBadge() : met a jour tous les compteurs d'etoiles affiches dans
// l'UI (header, map, rue, atelier). Appelee apres chaque ajout d'etoiles.
// Etait absente du code, d'ou un compteur qui ne se rafraichissait pas.
function updateStarBadge() {
  const totalStars = state.totalStars || 0;
  // Toutes les zones connues qui affichent le compteur d'etoiles
  const ids = ['star-count', 'star-count-header', 'street-star-count', 'global-star-count', 'map-star-count', 'atelier-star-count'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = totalStars;
  });
  // Tous les .star-count-* generiques
  document.querySelectorAll('.star-count, .stars-count').forEach(el => {
    el.textContent = totalStars;
  });
}

// updateEntryMarker() : repositionne le marqueur dev de la porte/enseigne
// quand on est en mode calibration. No-op si pas en calib.
function updateEntryMarker() {
  // Re-applique les positions calibrees sauvegardees pour que le marqueur
  // suive la cible meme apres une modification.
  if (typeof applySignZonePos === 'function') applySignZonePos();
  if (typeof applyHeroDestPos === 'function') applyHeroDestPos();
  if (typeof applyPointerPos  === 'function') applyPointerPos();
}

// positionNeonSign() : repositionne l'enseigne lumineuse sur l'ecran 2.
// Reference 2 fois dans le setup de l'ecran 2, sans definition. Pour l'instant
// on delegue simplement a applySignZonePos qui fait deja le boulot.
function positionNeonSign() {
  if (typeof applySignZonePos === 'function') applySignZonePos();
}

// ============================================================
// CHAPITRE 5 — Mini-jeu "Construis ton robot IA" (T5/c5s5)
// ============================================================
// Combinaisons triées (3 modules sur 5) → persona unique du robot
// Clés: triplet alphabétique des modules choisis (ex: "act+see+think")
// IMPORTANT : les cles doivent etre les modules tries ALPHABETIQUEMENT
// (act < hear < see < speak < think) car le lookup utilise mods.sort().join('+')
const C5_ROBOT_PERSONAS = {
  // 10 combinaisons C(5,3) = 10
  'hear+see+speak':  { name: 'Aria',   mission: 'Aria t\'écoute, te répond et regarde autour : un assistant qui te tient compagnie partout !', emoji: '🌟' },
  'hear+see+think':  { name: 'Iris',   mission: 'Iris regarde, écoute et réfléchit : elle peut analyser un film ou un concert et tout te résumer !', emoji: '🌈' },
  'act+hear+see':    { name: 'Vega',   mission: 'Vega regarde, écoute et agit : un robot guide pour les personnes mal-voyantes ou mal-entendantes !', emoji: '🦮' },
  'see+speak+think': { name: 'Sirius', mission: 'Sirius regarde, parle et réfléchit : il peut décrire le monde à voix haute et raconter des histoires basées sur ce qu\'il voit !', emoji: '📚' },
  'act+see+speak':   { name: 'Lumi',   mission: 'Lumi regarde, parle et agit : ton robot artiste qui dessine en parlant de ses créations !', emoji: '🎨' },
  'act+see+think':   { name: 'Astra',  mission: 'Astra regarde, réfléchit et agit : elle range ta chambre toute seule en repérant ce qui est en désordre !', emoji: '🧹' },
  'hear+speak+think':{ name: 'Echo',   mission: 'Echo écoute, parle et réfléchit : un compagnon de discussion qui adore les énigmes et les blagues !', emoji: '💡' },
  'act+hear+speak':  { name: 'Melo',   mission: 'Melo écoute, parle et agit : un robot musicien qui joue avec toi et chante en chœur !', emoji: '🎵' },
  'act+hear+think':  { name: 'Orion',  mission: 'Orion écoute, réfléchit et agit : un sauveteur qui repère les bruits suspects et alerte si quelque chose ne va pas !', emoji: '🚨' },
  'act+speak+think': { name: 'Nova',   mission: 'Nova parle, réfléchit et agit : ton coach personnel qui t\'aide à apprendre, faire tes devoirs ou inventer des jeux !', emoji: '🚀' },
};

function selectC5Module(btn) {
  if (btn.disabled) return;
  const id = btn.dataset.id;
  if (!state.c5RobotModules) state.c5RobotModules = [];
  const idx = state.c5RobotModules.indexOf(id);
  if (idx >= 0) {
    // Désélection
    state.c5RobotModules.splice(idx, 1);
    btn.classList.remove('selected');
  } else {
    if (state.c5RobotModules.length >= 3) return; // max 3
    state.c5RobotModules.push(id);
    btn.classList.add('selected');
  }
  saveState();
  // Quand 3 sont choisis : on dévoile le robot
  if (state.c5RobotModules.length === 3) {
    // v672 : iOS speech-synthesis priming SILENCIEUX (vs v484 qui speakait
    // le greeting reel pendant le countdown). On joue une utterance vide
    // volume=0 dans le user gesture -> iOS marque speechSynthesis comme
    // user-activated. Le vrai greeting joue ensuite dans Phase C apres
    // countdown sans etre bloque par iOS.
    const isIOSDev = typeof _isIOSDevice === 'function' && _isIOSDevice();
    if (isIOSDev && typeof window.speechSynthesis !== 'undefined') {
      try {
        const primer = new SpeechSynthesisUtterance(' ');
        primer.volume = 0;
        primer.rate = 10; // ultra rapide pour finir vite
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(primer);
      } catch(e) {}
    }
    revealC5Robot();
  } else {
    // Sinon, masque le résultat
    const result = document.getElementById('c5s5-result');
    if (result) result.style.display = 'none';
    document.getElementById('btn-to-c5s6')?.classList.remove('show-btn');
  }
}

// === Mappings modules → emoji, nom français, vidéo ===
const C5_MODULE_DATA = {
  see:   { emoji: '👁️', name: 'Voir',     video: 'assets/c5s5_robot/robot_see.mp4?v=462',
           demo: 'Je vois un chat, un arbre, un ciel bleu. Je peux reconnaître plein de choses !' },
  hear:  { emoji: '👂', name: 'Écouter',  video: 'assets/c5s5_robot/robot_hear.mp4?v=462',
           demo: 'Tic-tac… j\'entends une horloge, des oiseaux, et même ta voix !' },
  speak: { emoji: '💬', name: 'Parler',   video: 'assets/c5s5_robot/robot_speak.mp4?v=462',
           demo: 'Je peux te parler, te raconter des histoires, et répondre à tes questions !' },
  think: { emoji: '🧠', name: 'Réfléchir', video: 'assets/c5s5_robot/robot_think.mp4?v=462',
           demo:       'Voyons voir... trois plus quatre font sept. Huit fois huit font soixante-quatre ! Je suis très fort en calcul.',
           // v675 : texte audio separe -> "plusse" force le TTS a prononcer
           // le 's' final (sinon dit "plu" silencieux, faux en contexte math).
           // La bulle visuelle affiche le 'demo' correct, l'audio dit le 'demoSpoken'.
           demoSpoken: 'Voyons voir... trois plusse quatre font sept. Huit fois huit font soixante-quatre ! Je suis très fort en calcul.' },
  act:   { emoji: '💪', name: 'Agir',      video: 'assets/c5s5_robot/robot_act.mp4?v=462',
           demo: 'Je peux ranger ta chambre, attraper des objets, et même cuisiner !' }
};

let _c5DemosTested = new Set();
let _c5SoundCtx = null;
function _c5GetCtx() {
  if (!_c5SoundCtx) {
    try { _c5SoundCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) { _c5SoundCtx = null; }
  }
  return _c5SoundCtx;
}
function _c5Bleep(freq, durMs, gain) {
  const ctx = _c5GetCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') { try { ctx.resume(); } catch(e){} }
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(freq, now);
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(gain || 0.12, now + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, now + (durMs || 200) / 1000);
  osc.connect(g).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + (durMs || 200) / 1000 + 0.05);
}
function _c5PowerUp() {
  // Sweep ascendant pour le « Power on »
  const ctx = _c5GetCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') { try { ctx.resume(); } catch(e){} }
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(180, now);
  osc.frequency.exponentialRampToValueAtTime(880, now + 0.6);
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(0.18, now + 0.05);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);
  osc.connect(g).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.75);
}

function _c5SpawnConfetti() {
  const arena = document.getElementById('c5s5-confetti');
  if (!arena) return;
  const emojis = ['⭐', '✨', '🌟', '💫', '🎉', '🎊'];
  for (let i = 0; i < 50; i++) {
    const piece = document.createElement('span');
    piece.className = 'c5-confetti-piece';
    piece.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    piece.style.left = (Math.random() * 100) + 'vw';
    piece.style.fontSize = (1 + Math.random() * 1.4) + 'rem';
    piece.style.animationDuration = (2.5 + Math.random() * 2) + 's';
    piece.style.animationDelay = (Math.random() * 0.4) + 's';
    arena.appendChild(piece);
    setTimeout(() => { if (piece.parentNode) piece.parentNode.removeChild(piece); }, 5000);
  }
}

// v476 : helper qui s assure que les voices sont chargees (iOS lazy load).
// Retourne une Promise qui resout avec la liste des voices (peut etre vide
// si le browser n a pas de voices, on continue quand meme).
function _ensureVoicesLoaded() {
  return new Promise((resolve) => {
    if (typeof window.speechSynthesis === 'undefined') { resolve([]); return; }
    let voices = window.speechSynthesis.getVoices();
    if (voices && voices.length) { resolve(voices); return; }
    // Attendre voiceschanged (iOS / certains browsers)
    const handler = () => {
      window.speechSynthesis.removeEventListener('voiceschanged', handler);
      resolve(window.speechSynthesis.getVoices() || []);
    };
    window.speechSynthesis.addEventListener('voiceschanged', handler);
    // Timeout de securite si voiceschanged ne fire jamais
    setTimeout(() => {
      window.speechSynthesis.removeEventListener('voiceschanged', handler);
      resolve(window.speechSynthesis.getVoices() || []);
    }, 1500);
  });
}

function _c5SpeakAsRobot(text, onEnd) {
  // Si pas de speechSynthesis dispo : on appelle quand meme onEnd pour ne pas
  // bloquer le flow (sinon le bouton Continuer ne s'afficherait jamais).
  if (typeof window.speechSynthesis === 'undefined') {
    if (typeof onEnd === 'function') setTimeout(onEnd, 600);
    return;
  }
  // v479 : SYNCHRONE - speak() doit etre dans le user gesture iOS. v476
  // utilisait _ensureVoicesLoaded().then(speak) qui rendait speak() async
  // (microtask) -> hors gesture iOS -> muet. On revient en sync.
  try { window.speechSynthesis.cancel(); } catch(e) {}
  try { window.speechSynthesis.resume(); } catch(e) {}
  const utt = new SpeechSynthesisUtterance(text);
  utt.lang = 'fr-FR';
  utt.pitch = 1.15;
  utt.rate  = 0.95;
  utt.volume = 1;
  // Pick voice avec ce qui est disponible MAINTENANT (synchrone).
  // Si voices encore vides (iOS lazy), on speak sans voix -> iOS utilise
  // sa voix par defaut, mieux que rien.
  try {
    const voices = window.speechSynthesis.getVoices() || [];
    const frFR = voices.find(v => v.lang === 'fr-FR');
    const fr   = voices.find(v => v.lang && v.lang.startsWith('fr'));
    const any  = voices[0];
    const chosen = frFR || fr || any;
    if (chosen) utt.voice = chosen;
  } catch(e) {}
  let _ended = false;
  const wrap = () => { if (_ended) return; _ended = true; if (typeof onEnd === 'function') onEnd(); };
  if (typeof onEnd === 'function') {
    utt.onend   = wrap;
    utt.onerror = wrap;
    setTimeout(wrap, Math.max(2000, text.length * 77 + 800));
  }
  window.speechSynthesis.speak(utt);
}

function revealC5Robot() {
  const mods = (state.c5RobotModules || []).slice().sort();
  const key = mods.join('+');
  const persona = C5_ROBOT_PERSONAS[key] || {
    name: 'Stella',
    mission: 'Ton robot a une combinaison unique ! À toi d\'imaginer sa mission.',
    emoji: '🤖'
  };

  // === Phase A : Countdown 3·2·1 dramatique ===
  const phasePick = document.getElementById('c5s5-phase-pick');
  const countdown = document.getElementById('c5s5-countdown');
  const numEl     = document.getElementById('c5s5-countdown-num');
  if (phasePick) phasePick.style.display = 'none';
  if (countdown) countdown.style.display = 'flex';

  const playStep = (n, delay) => {
    setTimeout(() => {
      if (numEl) {
        numEl.textContent = String(n);
        // re-déclenche l'animation
        numEl.style.animation = 'none';
        void numEl.offsetWidth;
        numEl.style.animation = '';
      }
      _c5Bleep(660, 180);
    }, delay);
  };
  playStep(3, 0);
  playStep(2, 950);
  playStep(1, 1900);

  // === Phase B : Flash blanc + power-up + confettis + révélation ===
  setTimeout(() => {
    if (countdown) countdown.style.display = 'none';
    const flash = document.getElementById('c5s5-flash');
    if (flash) {
      flash.classList.add('flashing');
      setTimeout(() => flash.classList.remove('flashing'), 700);
    }
    _c5PowerUp();
    _c5SpawnConfetti();

    // Affiche le robot avec sa première vidéo
    const phaseRobot = document.getElementById('c5s5-phase-robot');
    if (phaseRobot) phaseRobot.style.display = '';
    const nameEl    = document.getElementById('c5s5-robot-name');
    const missionEl = document.getElementById('c5s5-robot-mission');
    if (nameEl)    nameEl.innerHTML = `${persona.emoji} <strong>${persona.name}</strong>`;
    if (missionEl) missionEl.textContent = persona.mission;

    // Démarre la vidéo du 1er module choisi (juste pour l'effet visuel à l'apparition)
    const video = document.getElementById('c5s5-robot-video');
    const firstMod = mods[0];
    if (video && firstMod && C5_MODULE_DATA[firstMod]) {
      video.src = C5_MODULE_DATA[firstMod].video;
      video.loop = true;
      try { video.play().catch(()=>{}); } catch(e) {}
    }

    // === Phase C : Le robot dit bonjour à l'enfant par son prénom ===
    setTimeout(() => {
      const kidName = (state.characterName || '').trim();
      let greeting;
      if (state.characterType === 'robot') {
        // Robot Pixel rencontre la robot Aria : ton « entre copains robots »
        greeting = kidName
          ? `Salut copain robot ${kidName} ! Je suis ${persona.name}. Copains pour toujours ! Clique sur un module pour me voir en action !`
          : `Salut copain robot ! Je suis ${persona.name}. Copains pour toujours ! Clique sur un module pour me voir en action !`;
      } else {
        greeting = kidName
          ? `Bonjour ${kidName} ! Je suis ${persona.name}. Je vais te tenir compagnie. Clique sur un module pour me voir en action !`
          : `Bonjour ! Je suis ${persona.name}. Je vais te tenir compagnie. Clique sur un module pour me voir en action !`;
      }
      // Affiche AUSSI le greeting dans la bulle texte (comme pour Bot au
      // chap 4 et comme pour les demos de modules ensuite) -> les enfants
      // qui lisent mieux qu'ils n'entendent (et le son coupe) suivent quand meme.
      const _c5GreetBubble = document.getElementById('c5s5-bubble');
      if (_c5GreetBubble) {
        _c5GreetBubble.textContent = greeting;
        _c5GreetBubble.style.display = 'block';
        _c5GreetBubble.classList.remove('anim-pop-in');
        void _c5GreetBubble.offsetWidth;
        _c5GreetBubble.classList.add('anim-pop-in');
      }
      // v477 : ne re-speak pas le greeting si deja queued dans selectC5Module
      // (cas iOS ou on doit queue dans le user gesture).
      if (!window._c5GreetingQueued) {
        _c5SpeakAsRobot(greeting);
      } else {
        window._c5GreetingQueued = false; // reset pour prochaines visites
      }
    }, 1100);

    // === Phase D : génère les boutons de démo des 3 modules choisis ===
    _c5DemosTested = new Set();
    const btns = document.getElementById('c5s5-demo-buttons');
    if (btns) {
      btns.innerHTML = '';
      mods.forEach(m => {
        const data = C5_MODULE_DATA[m];
        const b = document.createElement('button');
        b.className = 'c5-demo-btn';
        b.dataset.mod = m;
        b.innerHTML = `${data.emoji}<span>${data.name}</span>`;
        b.onclick = () => playC5ModuleDemo(m);
        btns.appendChild(b);
      });
    }
  }, 2700); // après les 3 bleeps
}

// Construit un SVG simple : tete robot + 3 emplacements pour modules choisis.
// Les 5 slots possibles sont positionnes (oeil/oreille gauche, oreille droite, bouche, antenne, bras).
function buildRobotSVG(mods) {
  const SLOT_POS = {
    see:   { cx: 100, cy: 110, label: '👁️' },
    hear:  { cx: 50,  cy: 120, label: '👂' },
    speak: { cx: 100, cy: 160, label: '💬' },
    think: { cx: 100, cy: 70,  label: '🧠' },
    act:   { cx: 150, cy: 200, label: '💪' }
  };
  let slotsHTML = '';
  mods.forEach(m => {
    const p = SLOT_POS[m];
    if (!p) return;
    slotsHTML += '<g class="robot-slot" data-mod="' + m + '" transform="translate(' + p.cx + ',' + p.cy + ')">' +
      '<circle r="22" class="slot-bg"/>' +
      '<text text-anchor="middle" dy="9" font-size="26">' + p.label + '</text>' +
      '</g>';
  });
  return '<svg viewBox="0 0 200 260" xmlns="http://www.w3.org/2000/svg" class="c5-robot-body">' +
    // antenne
    '<line x1="100" y1="40" x2="100" y2="60" stroke="#b8c5d6" stroke-width="3"/>' +
    '<circle cx="100" cy="36" r="6" fill="#fbbf24"/>' +
    // tete
    '<rect x="55" y="55" width="90" height="100" rx="18" fill="#cbd5e1" stroke="#64748b" stroke-width="2"/>' +
    // corps
    '<rect x="65" y="155" width="70" height="70" rx="10" fill="#94a3b8" stroke="#475569" stroke-width="2"/>' +
    // bras
    '<rect x="35" y="165" width="22" height="50" rx="8" fill="#94a3b8" stroke="#475569" stroke-width="2"/>' +
    '<rect x="143" y="165" width="22" height="50" rx="8" fill="#94a3b8" stroke="#475569" stroke-width="2"/>' +
    // jambes
    '<rect x="78" y="225" width="18" height="28" rx="6" fill="#64748b"/>' +
    '<rect x="104" y="225" width="18" height="28" rx="6" fill="#64748b"/>' +
    slotsHTML +
    '</svg>';
}

// Démo d'un module : joue la vidéo correspondante + voix robot + bulle texte
function playC5ModuleDemo(mod) {
  const data = C5_MODULE_DATA[mod];
  if (!data) return;
  const bubble = document.getElementById('c5s5-bubble');
  const video  = document.getElementById('c5s5-robot-video');
  const btn    = document.querySelector(`#c5s5-demo-buttons .c5-demo-btn[data-mod="${mod}"]`);

  // Switch la vidéo
  if (video) {
    try {
      video.pause();
      video.src = data.video;
      video.loop = true;
      video.currentTime = 0;
      video.play().catch(()=>{});
    } catch(e) {}
  }

  // Bulle de description (pop)
  if (bubble) {
    bubble.textContent = data.demo;
    bubble.style.display = 'block';
    bubble.classList.remove('anim-pop-in');
    void bubble.offsetWidth;
    bubble.classList.add('anim-pop-in');
  }

  // Marque le bouton testé
  if (btn) btn.classList.add('tested');
  _c5DemosTested.add(mod);

  // Si les 3 démos ont été cliquées → révèle "Continuer" UNE FOIS la voix
  // du robot terminée (sinon le bouton apparaissait avant la fin de la
  // description du 3e module, c'etait perturbant pour l'enfant).
  const totalMods = (state.c5RobotModules || []).length;
  const isLastDemo = _c5DemosTested.size >= totalMods;
  if (isLastDemo) {
    let shown = false;
    const showContinueBtn = () => {
      if (shown) return;
      shown = true;
      const continueBtn = document.getElementById('btn-to-c5s6');
      if (continueBtn) {
        continueBtn.classList.add('show-btn');
        // v673 : sur mobile/iPhone, le contenu de la panel c5s5 est plus
        // grand que le viewport (overflow-y:auto). Le bouton Continuer en
        // bas est invisible sans scroll. On scrolle automatiquement vers le
        // bouton apres l'avoir revele.
        setTimeout(() => {
          try { continueBtn.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
          catch (e) { try { continueBtn.scrollIntoView(); } catch (e2) {} }
        }, 350);
      }
    };
    // v675 : utilise demoSpoken pour le TTS si present (variante phonetique
     // pour forcer la prononciation : ex "trois plusse quatre" vs "trois plus
     // quatre" affiche). Fallback sur demo si pas de demoSpoken.
    _c5SpeakAsRobot(data.demoSpoken || data.demo, showContinueBtn);
    // Fallback de securite : si onend ne fire pas (Android tue parfois la
    // speechSynthesis en background), on affiche le bouton apres 10s max.
    setTimeout(showContinueBtn, 10000);
  } else {
    _c5SpeakAsRobot(data.demoSpoken || data.demo);
  }
}

// ============================================================
// MON ATELIER — Boutique, Collection, Badges
// ============================================================
// Catalogue d'articles cosmétiques (accessoires avatar) + cartes à collectionner
const ARTICLES_CATALOG = [
  // Accessoires avatar (équipables) - icones watercolor reutilisees du builder
  { id: 'cap-leon',      kind: 'accessory', slot: 'hat',     emoji: '🧢', img: 'assets/ui/builder/accessory_casquette.jpg', name: 'Cap de Léon',           cost:  8, desc: 'La même casquette à patches que Léon !' },
  { id: 'magic-hat',     kind: 'accessory', slot: 'hat',     emoji: '🎩', img: 'assets/ui/builder/accessory_chapeau.jpg',   name: 'Chapeau de magicien',  cost:  8, desc: 'Pour faire chic et mystérieux.' },
  { id: 'crown',         kind: 'accessory', slot: 'hat',     emoji: '👑', img: 'assets/ui/builder/accessory_couronne.jpg',  name: 'Couronne dorée',       cost: 20, desc: 'Article premium qui brille.' },
  { id: 'glasses-ai',    kind: 'accessory', slot: 'glasses', emoji: '🕶️', img: 'assets/ui/builder/accessory_lunettes.jpg', name: 'Lunettes IA',           cost:  6, desc: 'Lunettes futuristes lumineuses.' },
  { id: 'cape-hero',     kind: 'accessory', slot: 'cape',    emoji: '🧥', img: 'assets/ui/builder/accessory_echarpe.jpg',   name: 'Pull du héros',         cost: 12, desc: 'Un pull rouge confortable, parfait pour aventurier.' },
  // Cartes à collectionner (achetables OU gagnées via chapitres)
  // v573 : collection 100% chibi (style coherent). Fallback emoji si pas encore genere.
  // Heros jouables (les 4 personnages que l'enfant peut incarner)
  { id: 'card-fille',  kind: 'card', emoji: '👧', img: 'assets/cards/chibi_fille.jpg',  name: 'L\'exploratrice', cost: 10, desc: 'Curieuse et courageuse, elle adore percer les mystères de l\'IA.' },
  { id: 'card-garcon', kind: 'card', emoji: '👦', img: 'assets/cards/chibi_garcon.jpg', name: 'L\'explorateur', cost: 10, desc: 'Malin et débrouillard, rien ne l\'arrête dans le monde de Léon.' },
  { id: 'card-remi',   kind: 'card', emoji: '🦊', img: 'assets/cards/chibi_remi.jpg',  name: 'Rémi',  cost: 10, desc: 'Le renard rusé, compagnon espiègle plein de bonnes idées.' },
  { id: 'card-pixel',  kind: 'card', emoji: '🤖', img: 'assets/cards/chibi_pixel.jpg', name: 'Pixel', cost: 10, desc: 'Le petit robot explorateur, fidèle ami pour toute l\'aventure.' },
  // Personnages-guides IA
  { id: 'card-leon',  kind: 'card', emoji: '👴', img: 'assets/cards/chibi_leon.jpg',  name: 'Léon',  cost: 10, desc: 'Le maître inventeur, ton guide à travers tous les chapitres.' },
  { id: 'card-bot',   kind: 'card', emoji: '💬', img: 'assets/cards/chibi_bot.jpg', name: 'Bot',   cost: 10, desc: 'L\'IA qui parle. A lu des millions de livres mais peut se tromper.' },
  { id: 'card-echo',  kind: 'card', emoji: '🧠', img: 'assets/cards/chibi_echo.jpg',  name: 'Echo',  cost: 10, desc: 'L\'IA qui écoute, parle et réfléchit : un compagnon qui adore les énigmes et les blagues.' },
  // Carte LÉGENDAIRE : Léon Maître de l'IA
  // Acquisition : ACHAT a 40 ⭐ OU déblocage gratuit si 16/16 sur les 4 quiz V/F (chap 1-4)
  { id: 'card-leon-master', kind: 'card', emoji: '🌟', img: 'assets/cards/leon_master.jpg',
    name: 'Léon Maître de l\'IA', cost: 40, legendary: true,
    desc: 'Léon dans toute sa sagesse, Maître de l\'Intelligence Artificielle.' }
];

const BADGES_CATALOG = [
  { chap: 1, emoji: '⚙️', name: 'Apprenti Inventeur',   desc: 'Tu as decouvert l atelier de Leon.' },
  { chap: 2, emoji: '🎨', name: 'Artiste Numerique',    desc: 'Tu sais comment l IA cree des images.' },
  { chap: 3, emoji: '🎧', name: 'Maitre des Oreilles',  desc: 'Tu connais l IA des sons et de la voix.' },
  { chap: 4, emoji: '💬', name: 'Maitre des Mots',      desc: 'Tu sais comment l IA parle et invente.' },
  { chap: 5, emoji: '🏆', name: 'Explorateur de l IA',  desc: 'Badge final ! Tu connais tous les pouvoirs et pieges de l IA.' }
];

function _ensureAtelierState() {
  if (!Array.isArray(state.purchases)) state.purchases = [];
  if (typeof state.equippedAccessories !== 'object' || !state.equippedAccessories) state.equippedAccessories = { hat: null, glasses: null, cape: null };
  if (!Array.isArray(state.cardsUnlocked)) state.cardsUnlocked = [];
  if (typeof state.replayedChapters !== 'object' || !state.replayedChapters) state.replayedChapters = {};
}

function ownsArticle(id) {
  _ensureAtelierState();
  return state.purchases.includes(id);
}

function buyArticle(id) {
  _ensureAtelierState();
  const item = ARTICLES_CATALOG.find(a => a.id === id);
  if (!item) return { ok: false, reason: 'inconnu' };
  if (state.purchases.includes(id)) return { ok: false, reason: 'deja achete' };
  if ((state.totalStars || 0) < item.cost) return { ok: false, reason: 'pas assez d etoiles' };
  state.totalStars -= item.cost;
  state.purchases.push(id);
  if (item.kind === 'card' && !state.cardsUnlocked.includes(id)) state.cardsUnlocked.push(id);
  saveState();
  // Sync display counters
  const sscEl = document.getElementById('street-star-count');
  if (sscEl) sscEl.textContent = state.totalStars;
  const starEl = document.getElementById('star-count');
  if (starEl) starEl.textContent = state.totalStars;
  if (typeof refreshAtelierUI === 'function') refreshAtelierUI();
  return { ok: true };
}

function equipAccessory(id) {
  _ensureAtelierState();
  const item = ARTICLES_CATALOG.find(a => a.id === id);
  if (!item || item.kind !== 'accessory') return;
  if (!state.purchases.includes(id)) return;
  if (state.equippedAccessories[item.slot] === id) {
    state.equippedAccessories[item.slot] = null;
  } else {
    state.equippedAccessories[item.slot] = id;
  }
  saveState();
  if (typeof refreshAtelierUI === 'function') refreshAtelierUI();
  applyAvatarAccessoriesEverywhere();
}

const ACCESSORY_PROFILES = {
  hat:     { sizeRatio: 0.45, anchorYpct: 10, anchorXpct: 50 },
  glasses: { sizeRatio: 0.45, anchorYpct: 53, anchorXpct: 50 },
  cape:    { sizeRatio: 0.65, anchorYpct: 70, anchorXpct: 50 }
};

function getOverrides(slot, host) {
  let yPct = ACCESSORY_PROFILES[slot].anchorYpct;
  
  if (host.classList.contains('hero-win-face')) {
    // L'ecran de victoire a un cadrage different (visage plus haut)
    if (slot === 'hat') yPct = 5;
    if (slot === 'glasses') yPct = 26;
    if (slot === 'cape') yPct = 90;
  } else if (host.classList.contains('map-candy-avatar')) {
    if (slot === 'glasses') yPct = 52;
    if (slot === 'cape') yPct = 73;
  } else if (host.classList.contains('char-img')) {
    if (slot === 'glasses') yPct = 55;
    if (slot === 'cape') yPct = 65;
  }
  return yPct;
}

function applyAvatarAccessoriesEverywhere() {
  _ensureAtelierState();
  const slots = state.equippedAccessories || {};
  
  document.querySelectorAll('.avatar-with-accessories').forEach(host => {
    let target = host;
    // Si l'host est un <img>, on l'enveloppe d'un span pour pouvoir y greffer
    // les accessoires en position absolue (l'img seul ne peut pas avoir d'enfants).
    if (host.tagName === 'IMG') {
      let wrap = host.parentElement;
      if (!wrap || !wrap.classList.contains('avatar-accessory-wrap')) {
        wrap = document.createElement('span');
        wrap.className = 'avatar-accessory-wrap';
        // On marque le wrapper avec un sous-type pour reprendre la position
        // d'origine de l'image (cf. style.css : --win, --map, --card).
        if (host.classList.contains('hero-win-face'))    wrap.classList.add('avatar-accessory-wrap--win');
        if (host.classList.contains('map-candy-avatar')) wrap.classList.add('avatar-accessory-wrap--map');
        if (host.classList.contains('char-img'))         wrap.classList.add('avatar-accessory-wrap--card');
        
        host.parentNode.insertBefore(wrap, host);
        wrap.appendChild(host);
      }
      target = wrap;
    }
    
    // Nettoyage
    Array.from(target.children).forEach(n => {
      if (n.classList && n.classList.contains('avatar-accessory')) n.remove();
    });
    
    // Mesure de la taille de l'avatar (fallback pour les elements caches)
    let imgW = host.offsetWidth || host.clientWidth;
    // Si l'element est cache (display:none dans un tab), on approxime sa taille
    // via sa classe pour que l'accessoire soit a la bonne taille quand il apparaitra.
    if (imgW === 0) {
      if (host.classList.contains('char-img')) imgW = 90;
      else if (host.classList.contains('map-candy-avatar')) imgW = 130;
      else if (host.classList.contains('hero-win-face')) imgW = window.innerWidth > 600 ? 300 : 200; // rough fallback
      else return; // Trop risque d'appliquer, on attendra un resize
    }

    ['hat', 'glasses', 'cape'].forEach(slot => {
      const id = slots[slot];
      if (!id) return;
      const item = ARTICLES_CATALOG.find(a => a.id === id);
      if (!item) return;
      
      const profile = ACCESSORY_PROFILES[slot];
      if (!profile) return;

      const acc = document.createElement('span');
      acc.className = 'avatar-accessory accessory-' + slot + ' accessory--' + item.id;
      acc.textContent = item.emoji;
      
      const size = imgW * profile.sizeRatio;
      
      const yPct = getOverrides(slot, host);

      // Application des styles inline (le coeur du système responsive universel)
      Object.assign(acc.style, {
        position: 'absolute',
        left: profile.anchorXpct + '%',
        top: yPct + '%',
        transform: 'translate(-50%, -50%)', // Centre parfaitement sur le point d'ancrage
        fontSize: size + 'px',
        pointerEvents: 'none',
        zIndex: '10',
        lineHeight: '1',
        textShadow: '0 2px 5px rgba(0,0,0,0.3)',
        display: 'block',
        margin: '0', padding: '0',
        width: 'auto', height: 'auto'
      });

      target.appendChild(acc);
    });
  });
}

// Repositionnement automatique lors d'un resize ou rotation (universel mobile/tablette/PC)
window.addEventListener('resize', applyAvatarAccessoriesEverywhere);
window.addEventListener('orientationchange', () => setTimeout(applyAvatarAccessoriesEverywhere, 150));

// Re-fix de la map quand la viewport change PENDANT qu'on est sur la map
// (sortie de plein ecran F11/Esc, redim fenetre, rotation). Sans ca, la
// hauteur figee par fixMapVH() reste celle d'avant l'evenement et une
// bande violette du body apparait sous la map.
function _maybeRefixMap() {
  if (!document.body.classList.contains('map-mode')) return;
  if (typeof window._refixMap === 'function') window._refixMap();
}
window.addEventListener('resize', _maybeRefixMap);

// Filet de securite supplementaire : ResizeObserver sur #screen-map. Si la
// hauteur reelle de l'element devient differente de window.innerHeight
// (entre transitions de scenes, retour de win screen vers la map, ou
// n'importe quel mismatch silencieux), on refixe. Couvre les cas que les
// events resize/fullscreenchange ne capturent pas (transition d'animation
// CSS qui change la hauteur, content shift apres image load, etc.).
(function _setupMapResizeObserver() {
  if (typeof ResizeObserver === 'undefined') return; // navigateur ancien
  const setup = () => {
    const sm = document.getElementById('screen-map');
    if (!sm) return;
    const ro = new ResizeObserver(() => {
      if (!document.body.classList.contains('map-mode')) return;
      const expected = window.innerHeight;
      const actual = sm.getBoundingClientRect().height;
      if (Math.abs(actual - expected) > 2 && typeof window._refixMap === 'function') {
        window._refixMap();
      }
    });
    ro.observe(sm);
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }
})();
document.addEventListener('fullscreenchange', () => {
  // Double timeout : sortie de plein ecran est asynchrone, innerHeight
  // est mis a jour APRES le firing de l'event. On retente a +50 et +250 ms
  // pour capter la valeur finale du viewport.
  _maybeRefixMap();
  setTimeout(_maybeRefixMap, 50);
  setTimeout(_maybeRefixMap, 250);
});
document.addEventListener('webkitfullscreenchange', () => {
  _maybeRefixMap(); setTimeout(_maybeRefixMap, 50); setTimeout(_maybeRefixMap, 250);
});

function refreshAtelierUI() {
  if (typeof renderAtelierModal === 'function') renderAtelierModal();
  if (typeof updateStarBadge === 'function')    updateStarBadge();
}

// ============================================================
// Calibration interactive de la map (drag-and-drop des 5 noeuds)
// ============================================================
function loadMapNodePositions() {
  try {
    const raw = _calibGet('mapNodePositions');
    if (raw) return JSON.parse(raw);
  } catch(e) {}
  // Defaults : positions actuelles dans le HTML (matchent map_world.jpg v2)
  return {
    1: { left: 10, top: 80 },
    2: { left: 28, top: 70 },
    3: { left: 48, top: 55 },
    4: { left: 67, top: 30 },
    5: { left: 88, top: 25 }
  };
}
function saveMapNodePositions(pos) {
  _calibSet('mapNodePositions', JSON.stringify(pos));
  persistCalibration({ mapNodePositions: pos });
}
function applyMapNodePositions() {
  const pos = loadMapNodePositions();
  for (let i = 1; i <= 5; i++) {
    const node = document.getElementById('map-node-' + i);
    const p = pos[i];
    if (node && p) {
      node.style.left = p.left + '%';
      node.style.top  = p.top  + '%';
    }
  }
}
function toggleMapCalib() {
  // Si on n'est pas sur la map, on y va d'abord
  if (state.currentScreen !== 'map') {
    goToScreen('map');
    setTimeout(toggleMapCalib, 200);
    return;
  }
  document.body.classList.toggle('calib-map-mode');
  const active = document.body.classList.contains('calib-map-mode');
  if (active) {
    enableMapNodeDrag();
    console.log('🎯 Calib map ON — glisse les noeuds, re-clique pour terminer.');
  } else {
    disableMapNodeDrag();
    const pos = loadMapNodePositions();
    console.log('🎯 Calib map OFF — positions sauvegardees :', pos);
    // Sur mobile (pas de console facile), affiche les positions dans une alert
    // pour que l'utilisateur puisse les lire et les screenshot a transferer.
    // Format compact 1 ligne par chapitre pour que les 5 tiennent sans scroll.
    try {
      const lines = [];
      for (let i = 1; i <= 5; i++) {
        if (pos[i]) {
          const l = (pos[i].left ?? 0).toFixed(2);
          const t = (pos[i].top  ?? 0).toFixed(2);
          lines.push('C' + i + ': L=' + l + ' T=' + t);
        }
      }
      alert('✅ Positions :\n\n' + lines.join('\n'));
    } catch(e) {}
  }
}

function enableMapNodeDrag() {
  for (let i = 1; i <= 5; i++) {
    const node = document.getElementById('map-node-' + i);
    if (!node) continue;
    node.style.cursor = 'grab';
    node.addEventListener('mousedown',  startMapDrag, false);
    node.addEventListener('touchstart', startMapDrag, { passive: false });
  }
}

function disableMapNodeDrag() {
  for (let i = 1; i <= 5; i++) {
    const node = document.getElementById('map-node-' + i);
    if (!node) continue;
    node.style.cursor = '';
    node.removeEventListener('mousedown',  startMapDrag, false);
    node.removeEventListener('touchstart', startMapDrag);
  }
}


function startMapDrag(e) {
  if (!document.body.classList.contains('calib-map-mode')) return;
  e.preventDefault();
  e.stopPropagation();
  const node = e.currentTarget;
  const id   = parseInt((node.id || '').replace('map-node-', ''), 10);
  if (!id) return;
  const map  = document.querySelector('#screen-map .full-map-pixar') || document.querySelector('#screen-map');
  if (!map) return;
  const rect = map.getBoundingClientRect();

  const getPt = (ev) => {
    const t = ev.touches && ev.touches[0];
    return t ? { x: t.clientX, y: t.clientY } : { x: ev.clientX, y: ev.clientY };
  };

  const onMove = (ev) => {
    ev.preventDefault();
    const p = getPt(ev);
    const leftPct = ((p.x - rect.left) / rect.width)  * 100;
    const topPct  = ((p.y - rect.top)  / rect.height) * 100;
    node.style.left = Math.max(0, Math.min(100, leftPct)) + '%';
    node.style.top  = Math.max(0, Math.min(100, topPct))  + '%';
  };

  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('mouseup',   onUp);
    document.removeEventListener('touchend',  onUp);
    const pos = loadMapNodePositions();
    pos[id] = {
      left: parseFloat(node.style.left),
      top:  parseFloat(node.style.top)
    };
    saveMapNodePositions(pos);
  };

  document.addEventListener('mousemove', onMove, { passive: false });
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('mouseup',   onUp);
  document.addEventListener('touchend',  onUp);
}

// (premier placeholder supprime, voir version finale plus bas qui appelle openAtelier)

// ============================================================
// Mode calibration global : cache les boutons "Calibrer" sauf si on l'active
// via enableCalibMode() en console (ou ?calib=1 dans l'URL).
// ============================================================
window.enableCalibMode  = function() {
  document.body.classList.add('calib-mode-on');
  console.log('Calib mode ON. Use disableCalibMode() to hide.');
};
window.disableCalibMode = function() {
  document.body.classList.remove('calib-mode-on');
  console.log('Calib mode OFF.');
};
// Auto-activation via URL param ?calib=1
if (typeof window !== 'undefined' && window.location && window.location.search.indexOf('calib=1') >= 0) {
  document.addEventListener('DOMContentLoaded', () => document.body.classList.add('calib-mode-on'));
}

// ============================================================
// MODE DEV : ?dev=1 dans l'URL
// - Debloque tous les chapitres
// - Ajoute un bouton flottant 🛠️ qui ouvre un menu de selection de tableau
//   (pour tester n'importe quel ecran sans tout refaire)
// ============================================================
function _devEnsureUnlocked() {
  state.chaptersCompleted = state.chaptersCompleted || [];
  let changed = false;
  [1, 2, 3, 4].forEach(c => {
    if (!state.chaptersCompleted.includes(c)) {
      state.chaptersCompleted.push(c);
      changed = true;
    }
  });
  if (!state.characterType) {
    // Choix par defaut pour pouvoir aller sur les ecrans qui en ont besoin
    state.characterType = 'fille';
    state.characterName = 'Test';
    changed = true;
  }
  if (changed && typeof saveState === 'function') saveState();
  if (typeof updateMapState === 'function') updateMapState();
}

function _devBuildMenu() {
  if (document.getElementById('dev-screen-menu')) return;

  const SCREEN_GROUPS = [
    { label: 'Chap 1', ids: ['1', '2', '3', '4', '5', '6', '7', '8'] },
    { label: 'Chap 2', ids: ['c2s1', 'c2s2', 'c2s3', 'c2s4', 'c2s5', 'c2s6', 'c2s7', 'c2s8', 'c2s9'] },
    { label: 'Chap 3', ids: ['c3s1', 'c3s2', 'c3s3', 'c3s4', 'c3s5', 'c3s6', 'c3s7', 'c3s8', 'c3s9'] },
    { label: 'Chap 4', ids: ['c4s1', 'c4s2', 'c4s3', 'c4s4', 'c4s5', 'c4s6', 'c4s7', 'c4s8'] },
    { label: 'Chap 5', ids: ['c5s1', 'c5s2', 'c5s3', 'c5s4', 'c5s5', 'c5s6'] },
    { label: 'Autres', ids: ['0', 'map'] },
  ];

  const btn = document.createElement('button');
  btn.id = 'dev-toggle-btn';
  btn.textContent = '🛠️';
  btn.title = 'Mode dev : aller a un tableau';
  btn.style.cssText = 'position:fixed;top:8px;right:180px;z-index:99999;width:38px;height:38px;border-radius:50%;border:2px solid #fff;background:rgba(255,90,90,0.9);color:#fff;font-size:18px;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,0.3);';

  const menu = document.createElement('div');
  menu.id = 'dev-screen-menu';
  menu.style.cssText = 'position:fixed;top:50px;right:8px;z-index:99998;background:rgba(20,10,40,0.96);color:#fff;padding:12px 14px;border-radius:14px;border:2px solid #FFE166;box-shadow:0 10px 30px rgba(0,0,0,0.5);max-width:340px;max-height:80vh;overflow-y:auto;display:none;font-family:Nunito,sans-serif;font-size:13px;';

  let html = '<div style="font-weight:800;margin-bottom:8px;color:#FFE166">🛠️ Aller a un tableau</div>';
  SCREEN_GROUPS.forEach(grp => {
    html += `<div style="margin-top:6px;font-weight:700;color:#aaa;font-size:11px">${grp.label}</div><div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:3px">`;
    grp.ids.forEach(id => {
      html += `<button data-screen="${id}" style="padding:4px 8px;border-radius:8px;border:1px solid #555;background:#2a1a4a;color:#fff;font-size:11px;cursor:pointer">${id}</button>`;
    });
    html += '</div>';
  });
  menu.innerHTML = html;

  btn.addEventListener('click', () => {
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
  });

  menu.addEventListener('click', (ev) => {
    const target = ev.target;
    if (target.tagName !== 'BUTTON' || !target.dataset.screen) return;
    const sid = target.dataset.screen;
    menu.style.display = 'none';
    _devEnsureUnlocked();
    try {
      if (sid === 'map') {
        if (typeof goToScreen === 'function') goToScreen('map');
      } else {
        const numId = /^\d+$/.test(sid) ? parseInt(sid, 10) : sid;
        if (typeof goToScreen === 'function') goToScreen(numId);
      }
    } catch(e) { console.warn('[dev] goToScreen error', e); }
  });

  document.body.appendChild(btn);
  document.body.appendChild(menu);
}

if (typeof window !== 'undefined' && window.location && window.location.search.indexOf('dev=1') >= 0) {
  document.addEventListener('DOMContentLoaded', () => {
    _devEnsureUnlocked();
    _devBuildMenu();
  });
}

// ============================================================
// Calibration de la pastille etoile sur la rue
// ============================================================
function loadStarCornerPosition() {
  try {
    const raw = _calibGet('starCornerPos');
    if (raw) return JSON.parse(raw);
  } catch(e) {}
  return { top: 16, left: 18 };  // px par defaut
}
function saveStarCornerPosition(pos) {
  _calibSet('starCornerPos', JSON.stringify(pos));
  persistCalibration({ starCornerPos: pos });
}
// Viewport de reference pour les calibrations en px (Desktop typique).
// On scale proportionnellement sur les ecrans plus petits (mobile).
const STAR_CALIB_REF_W = 1366;
const STAR_CALIB_REF_H = 768;
function _scaleCalibPx(p) {
  const vw = window.innerWidth || document.documentElement.clientWidth || STAR_CALIB_REF_W;
  const vh = window.innerHeight || document.documentElement.clientHeight || STAR_CALIB_REF_H;
  // Scale conservatif : on ne reduit que sur les ecrans plus petits que la ref.
  // On evite d'agrandir au-dela des valeurs PC (>1.0 garde la cohérence visuelle).
  const sx = Math.min(1, vw / STAR_CALIB_REF_W);
  const sy = Math.min(1, vh / STAR_CALIB_REF_H);
  return { top: Math.round(p.top * sy), left: Math.round(p.left * sx) };
}
function applyStarCornerPosition() {
  const raw = loadStarCornerPosition();
  const p = _scaleCalibPx(raw);
  // Applique la meme calibration aux deux pastilles : celle de la rue (chap 1
  // ecran 2) et la pastille globale visible sur toutes les autres scenes.
  ['street-star-corner', 'global-star-corner'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.top  = p.top  + 'px';
    el.style.left = p.left + 'px';
  });
  // Aligne le bouton "retour carte" relativement a la pastille etoiles.
  // - Si la pastille a assez de place au-dessus (>= 46px), on met le bouton au-dessus.
  // - Sinon (cas mobile : pastille deja proche du haut), on place le bouton DESSOUS
  //   pour eviter qu'ils se chevauchent.
  const backBtn = document.getElementById('btn-back-map-global');
  if (backBtn) {
    const NEEDED_ABOVE = 46;          // hauteur du bouton + marge
    const PILL_HEIGHT  = 42;          // hauteur approx de la pastille etoiles
    const GAP          = 8;
    if (p.top >= NEEDED_ABOVE) {
      backBtn.style.top = (p.top - NEEDED_ABOVE) + 'px';
    } else {
      backBtn.style.top = (p.top + PILL_HEIGHT + GAP) + 'px';
    }
    backBtn.style.left = p.left + 'px';
  }
}
// Reapplique a chaque resize/rotation (mobile : passage paysage <-> portrait)
function _reapplyMapHeight() {
  if (state.currentScreen !== 'map') return;
  const sm = document.getElementById('screen-map');
  if (!sm) return;
  const h = window.innerHeight;
  const w = window.innerWidth;
  sm.style.setProperty('height', h + 'px', 'important');
  sm.style.setProperty('min-height', h + 'px', 'important');
  sm.style.setProperty('max-height', h + 'px', 'important');
  const mapPixar = sm.querySelector('.full-map-pixar');
  if (mapPixar) {
    // v337 : etirement plein ecran (object-fit: fill). Voir fixMapVH().
    const mapW = w;
    const leftOffset = 0;
    mapPixar.style.setProperty('position', 'absolute', 'important');
    mapPixar.style.setProperty('top', '0', 'important');
    mapPixar.style.setProperty('left', leftOffset + 'px', 'important');
    mapPixar.style.setProperty('bottom', 'auto', 'important');
    mapPixar.style.setProperty('right', 'auto', 'important');
    mapPixar.style.setProperty('transform', 'none', 'important');
    mapPixar.style.setProperty('width', mapW + 'px', 'important');
    mapPixar.style.setProperty('height', h + 'px', 'important');
    const img = mapPixar.querySelector('.map-bg-img');
    if (img) {
      img.style.setProperty('width', mapW + 'px', 'important');
      img.style.setProperty('height', h + 'px', 'important');
      img.style.setProperty('object-fit', 'fill', 'important');
    }
  }
}
window.addEventListener('resize', () => {
  if (typeof applyStarCornerPosition === 'function') applyStarCornerPosition();
  _reapplyMapHeight();
});
window.addEventListener('orientationchange', () => {
  setTimeout(_reapplyMapHeight, 200);
});
function toggleStarCalib() {
  document.body.classList.toggle('calib-star-mode');
  const el = document.getElementById('street-star-corner');
  if (!el) return;
  if (document.body.classList.contains('calib-star-mode')) {
    el.addEventListener('mousedown',  startStarDrag, false);
    el.addEventListener('touchstart', startStarDrag, { passive: false });
    console.log('Calib pastille ON. Glisse-la, re-clique pour terminer.');
  } else {
    el.removeEventListener('mousedown',  startStarDrag, false);
    el.removeEventListener('touchstart', startStarDrag);
    console.log('Calib pastille OFF. Position sauvegardee :', loadStarCornerPosition());
  }
}
function startStarDrag(e) {
  if (!document.body.classList.contains('calib-star-mode')) return;
  e.preventDefault();
  e.stopPropagation();
  const el = e.currentTarget;
  const scene = document.querySelector('#screen-2 .immersive-scene');
  if (!scene) return;
  const sceneRect = scene.getBoundingClientRect();

  const getPt = (ev) => {
    const t = ev.touches && ev.touches[0];
    return t ? { x: t.clientX, y: t.clientY } : { x: ev.clientX, y: ev.clientY };
  };
  const startPt = getPt(e);
  const elRect  = el.getBoundingClientRect();
  const grabDX  = startPt.x - elRect.left;
  const grabDY  = startPt.y - elRect.top;

  const persist = () => {
    saveStarCornerPosition({
      top:  parseInt(el.style.top)  || 16,
      left: parseInt(el.style.left) || 18
    });
  };

  const onMove = (ev) => {
    ev.preventDefault();
    const p = getPt(ev);
    const newLeft = (p.x - grabDX) - sceneRect.left;
    const newTop  = (p.y - grabDY) - sceneRect.top;
    el.style.left = Math.max(0, newLeft) + 'px';
    el.style.top  = Math.max(0, newTop)  + 'px';
    persist();  // SAVE A CHAQUE MOUVEMENT (pas seulement onUp)
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('mouseup',   onUp);
    document.removeEventListener('touchend',  onUp);
    persist();
    const saved = loadStarCornerPosition();
    console.log('[calib pastille] sauvegarde =>', saved);
    el.style.boxShadow = '0 0 0 3px #4ade80';
    setTimeout(() => { el.style.boxShadow = ''; }, 800);
  };
  document.addEventListener('mousemove', onMove, { passive: false });
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('mouseup',   onUp);
  document.addEventListener('touchend',  onUp);
}

// Raccourci vers Mon Atelier (appele par la pastille etoile top-left de la rue)
function openAtelierShortcut() {
  if (typeof openAtelier === 'function') {
    openAtelier();
  } else {
    alert('Mon Atelier : ' + (state.totalStars || 0) + ' etoiles.');
  }
}

// ============================================================
// Calibration de la zone cliquable sur l'enseigne (rue)
// Stocke top%/left%/width%/height% pour s'adapter a toute taille de viewport.
// ============================================================
function loadSignZonePos() {
  try {
    const raw = _calibGet('signZonePos');
    if (raw) return JSON.parse(raw);
  } catch(e) {}
  return { top: 50, left: 50, width: 18, height: 12 };
}
function saveSignZonePos(p) {
  _calibSet('signZonePos', JSON.stringify(p));
  persistCalibration({ signZonePos: p });
}
function applySignZonePos() {
  const el = document.querySelector('#screen-2 .neon-shop-target');
  if (!el) return;
  const p = loadSignZonePos();
  el.style.top    = p.top    + '%';
  el.style.left   = p.left   + '%';
  el.style.width  = p.width  + '%';
  el.style.height = p.height + '%';
}

function toggleSignCalib() {
  document.body.classList.toggle('calib-sign-mode');
  const el = document.querySelector('#screen-2 .neon-shop-target');
  if (!el) return;
  if (document.body.classList.contains('calib-sign-mode')) {
    el.addEventListener('mousedown',  startSignDrag, false);
    el.addEventListener('touchstart', startSignDrag, { passive: false });
    console.log('Calib enseigne ON. Glisse la zone, re-clique pour terminer.');
  } else {
    el.removeEventListener('mousedown',  startSignDrag, false);
    el.removeEventListener('touchstart', startSignDrag);
    console.log('Calib enseigne OFF. Position sauvegardee :', loadSignZonePos());
  }
}

function startSignDrag(e) {
  if (!document.body.classList.contains('calib-sign-mode')) return;
  e.preventDefault();
  e.stopPropagation();
  const el    = e.currentTarget;
  const scene = document.querySelector('#screen-2 .immersive-scene');
  if (!scene) return;
  const sceneRect = scene.getBoundingClientRect();
  const getPt = (ev) => {
    const t = ev.touches && ev.touches[0];
    return t ? { x: t.clientX, y: t.clientY } : { x: ev.clientX, y: ev.clientY };
  };
  const persist = () => {
    const cur = loadSignZonePos();
    saveSignZonePos({
      top:    parseFloat(el.style.top)  || cur.top,
      left:   parseFloat(el.style.left) || cur.left,
      width:  cur.width,
      height: cur.height
    });
  };
  const onMove = (ev) => {
    ev.preventDefault();
    const p = getPt(ev);
    const cx = p.x - sceneRect.left;
    const cy = p.y - sceneRect.top;
    const leftPct = (cx / sceneRect.width)  * 100;
    const topPct  = (cy / sceneRect.height) * 100;
    el.style.left = Math.max(0, Math.min(100, leftPct)) + '%';
    el.style.top  = Math.max(0, Math.min(100, topPct))  + '%';
    persist();  // SAVE A CHAQUE MOUVEMENT
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('mouseup',   onUp);
    document.removeEventListener('touchend',  onUp);
    persist();
    const saved = loadSignZonePos();
    console.log('[calib enseigne] sauvegarde =>', saved);
    el.style.boxShadow = '0 0 0 3px #4ade80';
    setTimeout(() => { el.style.boxShadow = ''; }, 800);
  };
  document.addEventListener('mousemove', onMove, { passive: false });
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('mouseup',   onUp);
  document.addEventListener('touchend',  onUp);
}
// Test localStorage au demarrage : verifie que le browser persiste les calibrations.
(function checkLocalStorageHealth() {
  try {
    const k = '__lsTest__' + Date.now();
    localStorage.setItem(k, 'ok');
    const v = localStorage.getItem(k);
    localStorage.removeItem(k);
    if (v !== 'ok') throw new Error('roundtrip failed');
    console.log('[calib] localStorage OK. Cles actuelles :', {
      starCornerPos:    localStorage.getItem('starCornerPos'),
      signZonePos:      localStorage.getItem('signZonePos'),
      mapNodePositions: localStorage.getItem('mapNodePositions')
    });
  } catch(e) {
    console.error('[calib] localStorage BLOQUE :', e.message);
    console.error('=> Calibrations NON sauvegardees ! Sors du mode Incognito.');
  }
})();

// Stub : toggle 'open' class sur les blocs "Infos Parents"
function toggleTip(el) {
  if (!el) return;
  el.classList.toggle('tip-open');
  const toggle = el.querySelector('.parent-tip-toggle');
  if (toggle) {
    toggle.textContent = el.classList.contains('tip-open') ? '▲ Fermer' : '▼ Voir';
  }
}

// ============================================================
// Calibration : pointeur 👆 et destination du heros (rue)
// ============================================================
function loadPointerPos()  { try { const r = _calibGet('pointerPos');  if (r) return JSON.parse(r); } catch(e) {} return { top: 45, left: 50 }; }
function savePointerPos(p) {
  _calibSet('pointerPos', JSON.stringify(p));
  persistCalibration({ pointerPos: p });
}
function applyPointerPos() {
  const el = document.getElementById('sign-pointer');
  if (!el) return;
  const p = loadPointerPos();
  el.style.top  = p.top  + '%';
  el.style.left = p.left + '%';
}

function loadHeroDestPos()  { try { const r = _calibGet('heroDestPos');  if (r) return JSON.parse(r); } catch(e) {} return { top: 70, left: 50 }; }
function saveHeroDestPos(p) {
  _calibSet('heroDestPos', JSON.stringify(p));
  persistCalibration({ heroDestPos: p });
}
// v386 : calcule le rectangle REEL du contenu video de la rue dans la scene.
// La video street_1.mp4 (1280x720, ratio 16:9) est affichee en object-fit:cover :
// selon l'aspect ratio de l'ecran (phone ~2.2, tablette ~2.5...), elle est
// croppee differemment -> la PORTE de l'atelier se retrouve a des % conteneur
// differents. Ce helper renvoie ou le contenu video est VRAIMENT rendu.
function _streetVideoContentRect() {
  const scene = document.querySelector('#screen-2 .immersive-scene');
  if (!scene || !scene.clientWidth) return null;
  const Cw = scene.clientWidth, Ch = scene.clientHeight;
  const VR = 1280 / 720; // ratio video rue
  let contentW, contentH;
  if (Cw / Ch > VR) {
    // conteneur plus large que la video -> cover remplit la largeur, crop haut/bas
    contentW = Cw;
    contentH = Cw / VR;
  } else {
    // conteneur plus haut -> cover remplit la hauteur, crop gauche/droite
    contentH = Ch;
    contentW = Ch * VR;
  }
  return { x: (Cw - contentW) / 2, y: (Ch - contentH) / 2, w: contentW, h: contentH };
}

// v415 : meme principe pour c2s3 (toile_vide.mp4). La toile et le chat sont
// positionnes en % DU CONTENU VIDEO (calibre sur le widescreen 16:9), pas
// du conteneur. Sur ipad ~4:3 ou iPhone ~19.5:9, object-fit:cover crop
// differemment -> la toile dans l image se retrouve a un % conteneur
// different -> overlays decales. Ce helper renvoie le rect rendu reel.
function _c2s3VideoContentRect() {
  const scene = document.querySelector('#screen-c2s3 .story-scene');
  if (!scene || !scene.clientWidth) return null;
  const Cw = scene.clientWidth, Ch = scene.clientHeight;
  const VR = 16 / 9; // ratio video toile (toile_vide.mp4 / toile_sans_chat.jpg 1672x941)
  let contentW, contentH;
  if (Cw / Ch > VR) {
    contentW = Cw; contentH = Cw / VR;
  } else {
    contentH = Ch; contentW = Ch * VR;
  }
  return { x: (Cw - contentW) / 2, y: (Ch - contentH) / 2, w: contentW, h: contentH };
}

// Met a jour les CSS vars --canvas-* en se basant sur le rect VIDEO reel.
// Les valeurs canoniques (top 8%, left 13%, width 33%, height 45%) sont les
// positions de la toile dans l image source (calibrees PC widescreen).
// On les projette en % du conteneur en tenant compte du crop cover.
function applyC2s3Overlays() {
  const scene = document.querySelector('#screen-c2s3 .story-scene');
  if (!scene) return;
  const rect = _c2s3VideoContentRect();
  if (!rect) return;
  const Cw = scene.clientWidth || 1, Ch = scene.clientHeight || 1;
  // v417 : LEFT 0.13 (trop droite) -> v416 0.115 (trop gauche) -> 0.122 milieu.
  const TOP = 0.08, LEFT = 0.122, W = 0.33, H = 0.45;
  const toilePxLeft   = rect.x + rect.w * LEFT;
  const toilePxTop    = rect.y + rect.h * TOP;
  const toilePxWidth  = rect.w * W;
  const toilePxHeight = rect.h * H;
  scene.style.setProperty('--canvas-left',   (toilePxLeft   / Cw * 100) + '%');
  scene.style.setProperty('--canvas-top',    (toilePxTop    / Ch * 100) + '%');
  scene.style.setProperty('--canvas-width',  (toilePxWidth  / Cw * 100) + '%');
  scene.style.setProperty('--canvas-height', (toilePxHeight / Ch * 100) + '%');
}

// Listener resize/orientation : si on est sur c2s3, on recalcule.
function _c2s3OnResize() {
  if (state && state.currentScreen === 'c2s3') applyC2s3Overlays();
}
window.addEventListener('resize', _c2s3OnResize);
window.addEventListener('orientationchange', _c2s3OnResize);

// v426 : meme principe que c2s3 pour c2s7 (Composition dynamique sur toile).
// Memes valeurs canoniques (LEFT 0.122 calibre en v417) car meme video source.
function _c2s7VideoContentRect() {
  const scene = document.querySelector('#screen-c2s7 .story-scene');
  if (!scene || !scene.clientWidth) return null;
  const Cw = scene.clientWidth, Ch = scene.clientHeight;
  const VR = 16 / 9;
  let contentW, contentH;
  if (Cw / Ch > VR) { contentW = Cw; contentH = Cw / VR; }
  else { contentH = Ch; contentW = Ch * VR; }
  return { x: (Cw - contentW) / 2, y: (Ch - contentH) / 2, w: contentW, h: contentH };
}
function applyC2s7Overlays() {
  const scene = document.querySelector('#screen-c2s7 .story-scene');
  if (!scene) return;
  const rect = _c2s7VideoContentRect();
  if (!rect) return;
  const Cw = scene.clientWidth || 1, Ch = scene.clientHeight || 1;
  // v431 : LEFT calcule DYNAMIQUEMENT pour compenser l effet des CSS offsets
  // internes (+1%, +4%, +5% conteneur) qui ne suivent pas la projection cover-fit.
  //
  // Math : le CSS +5% conteneur est sense representer ~15% de canvas-width
  // (5/33 quand canvas-width canonical = 33%). Sur les containers ou rect.w != Cw,
  // ce 5% conteneur n est plus le bon ratio. Formule :
  //   LEFT_corrected = LEFT_canon + 0.05 * (1 - Cw / rect.w)
  // - rect.w = Cw (wide, Pixel) : correction = 0 -> LEFT_canon = 0.13
  // - rect.w > Cw (narrow, iPad) : correction positive faible
  //
  // Mais empiriquement (user feedback v429/v430) sur iPad il faut LEFT = 0.100
  // (= -0.03 video) pour centrer visuellement. Donc la formule theorique sous-
  // estime. On utilise donc :
  //   LEFT = 0.13 + correctionFactor * (1 - Cw / rect.w)
  // avec correctionFactor calibre empiriquement pour matcher iPad. iPad ratio
  // Cw/rect.w ~= 0.808, on veut LEFT = 0.100 -> correctionFactor * 0.192 = -0.03
  // -> correctionFactor = -0.156.
  const TOP = 0.08;
  const LEFT_CANON = 0.13;
  // v432 : correction moins agressive (-0.080 au lieu de -0.156). v431 mettait
  // iPad a 0.100 (trop a gauche). 0.115 (iPad) / 0.13 (Pixel) -> milieu OK.
  const CORRECTION = -0.080;
  const LEFT = LEFT_CANON + CORRECTION * (1 - Cw / rect.w);
  const W = 0.33, H = 0.45;
  scene.style.setProperty('--canvas-left',   ((rect.x + rect.w * LEFT) / Cw * 100) + '%');
  scene.style.setProperty('--canvas-top',    ((rect.y + rect.h * TOP)  / Ch * 100) + '%');
  scene.style.setProperty('--canvas-width',  ((rect.w * W)             / Cw * 100) + '%');
  scene.style.setProperty('--canvas-height', ((rect.h * H)             / Ch * 100) + '%');
}
function _c2s7OnResize() {
  if (state && state.currentScreen === 'c2s7') applyC2s7Overlays();
}
window.addEventListener('resize', _c2s7OnResize);
window.addEventListener('orientationchange', _c2s7OnResize);

// v386 : heroDestPos est desormais la position de la PORTE en % DU CONTENU
// VIDEO (et non plus du conteneur). On projette en px conteneur en tenant
// compte du crop object-fit:cover -> la porte est suivie correctement sur
// TOUS les formats d'ecran (phone, tablette, etc.).
function applyHeroDestPos() {
  const el = document.getElementById('hero-destination');
  if (!el) return;
  const p = loadHeroDestPos();
  const rect = _streetVideoContentRect();
  if (!rect) {
    // Fallback (scene pas encore mesurable) : ancien comportement % conteneur
    el.style.top  = p.top  + '%';
    el.style.left = p.left + '%';
    return;
  }
  el.style.left = (rect.x + (p.left / 100) * rect.w) + 'px';
  el.style.top  = (rect.y + (p.top  / 100) * rect.h) + 'px';
}

// ============================================================
// Position du heros sur l'ecran 4 (« L'IA, c'est une machine
// qui apprend... ») — par perso, sauvegarde dans localStorage.
// La fonction d'origine (positionHero4) avait ete perdue : on
// la reconstruit ici avec un mode calibration Alt+H pour drag.
//   - hero-back-4 = .hero-back-overlay (image profil du heros)
//   - Valeurs : right (%), bottom (%), height (%) du conteneur
// ============================================================
// Position calibree (par perso) sur l'ecran 4 « Au coeur de l'atelier ».
// Valeurs hardcodees apres calibration manuelle (Alt+J + drag) le 04/05/2026.
// Si l'utilisateur recalibre via Alt+J, les nouvelles valeurs sont stockees
// dans localStorage['hero4Pos'] et override ce defaut.
const HERO4_DEFAULT_POS = {
  fille:  { right: 0.875, bottom: 2.472, height: 47.5 },
  garcon: { right: 0.875, bottom: 2.472, height: 47.5 },
  renard: { right: 0.875, bottom: 2.472, height: 47.5 },
  robot:  { right: 0.875, bottom: 2.472, height: 47.5 }
};
function loadHero4Pos() {
  try {
    const raw = _calibGet('hero4Pos');
    if (raw) {
      const saved = JSON.parse(raw);
      // merge avec defaults pour gerer ajout de personnages
      return Object.assign({}, HERO4_DEFAULT_POS, saved);
    }
  } catch(e) {}
  return JSON.parse(JSON.stringify(HERO4_DEFAULT_POS));
}
function saveHero4Pos(positions) {
  _calibSet('hero4Pos', JSON.stringify(positions));
  // Persiste aussi cote serveur dans calibration.json (si lancer_jeu.py est utilise).
  // Comme ca pas besoin de reporter les valeurs au dev : elles sont ecrites
  // sur disque et chargees au prochain demarrage pour tout le monde.
  persistCalibration({ hero4Pos: positions });
}

// Envoie une calibration au serveur (lancer_jeu.py) qui ecrit dans
// calibration.json. Best-effort : si le serveur ne supporte pas
// l'endpoint (ex: simple http.server), on echoue silencieusement.
function persistCalibration(partial) {
  // Sur mobile, on suffixe les cles avec '.mobile' pour ne pas ecraser le
  // baseline desktop dans calibration.json. Le serveur ecrit alors sous
  // 'starCornerPos.mobile' etc. et la lecture privilegie ces cles sur mobile.
  if (isMobileDevice()) {
    const renamed = {};
    Object.entries(partial).forEach(([k, v]) => { renamed[k + '.mobile'] = v; });
    partial = renamed;
  }
  try {
    fetch('/api/save-calibration', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(partial)
    }).then(r => {
      if (!r.ok) console.warn('[calibration] serveur a refuse :', r.status);
      else console.log('[calibration] sauvegarde sur disque OK');
    }).catch(err => {
      // Endpoint non dispo (mode file:// ou serveur statique) : on tient un
      // accumulateur en memoire et on rappelle a l'utilisateur de le DL.
      console.log('[calibration] disque indispo, garde en localStorage. Tape downloadCalibration() pour figer sur disque.');
    });
  } catch(e) {}
}

// Outil console : EXPORT COMPLET de l'etat du jeu (localStorage + sessionStorage)
// pour migrer d'une origine (ex: file://) a une autre (ex: http://localhost).
// Genere un fichier game_state_backup.json a placer dans le projet pour
// reimport automatique au premier lancement.
function dumpAllState() {
  const dump = { localStorage: {}, sessionStorage: {}, exportedAt: new Date().toISOString(), origin: location.origin || location.protocol };
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    dump.localStorage[k] = localStorage.getItem(k);
  }
  for (let i = 0; i < sessionStorage.length; i++) {
    const k = sessionStorage.key(i);
    dump.sessionStorage[k] = sessionStorage.getItem(k);
  }
  const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'game_state_backup.json';
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  console.log('💾 game_state_backup.json telecharge !');
  console.log('   localStorage cles :', Object.keys(dump.localStorage));
  console.log('   sessionStorage cles :', Object.keys(dump.sessionStorage));
  console.log('   → Place le fichier a la racine du projet, puis relance avec python lancer_jeu.py');
}

// Auto-import : au demarrage, si game_state_backup.json existe ET localStorage est
// (presque) vide, on seed les storages avec le contenu du backup. C'est utile pour
// migrer d'une origine a une autre (ex: file:// -> http://localhost) sans perdre
// les calibrations, etoiles, achats, etc.
async function _autoImportGameStateBackup() {
  // Heuristique : on considere localStorage "vide" s'il n'a pas de calibration
  // (cle de reference). Ca evite d'ecraser un localStorage deja peuple.
  const alreadyHasData = localStorage.getItem('c3s7MicPos') || localStorage.getItem('starCornerPos') ||
                         sessionStorage.getItem('ia_state');
  if (alreadyHasData) return;
  try {
    const r = await fetch('game_state_backup.json?v=' + Date.now());
    if (!r.ok) return;
    const data = await r.json();
    if (data.localStorage) {
      Object.entries(data.localStorage).forEach(([k, v]) => {
        try { localStorage.setItem(k, v); } catch(e) {}
      });
    }
    if (data.sessionStorage) {
      Object.entries(data.sessionStorage).forEach(([k, v]) => {
        try { sessionStorage.setItem(k, v); } catch(e) {}
      });
    }
    console.log('🔄 game_state_backup.json importe automatiquement (export du', data.exportedAt, 'depuis', data.origin, ').');
    console.log('   Reload pour appliquer toutes les valeurs.');
    setTimeout(() => location.reload(), 500);
  } catch(e) {
    // Pas de backup ou pas accessible : silencieux.
  }
}
_autoImportGameStateBackup();

function downloadCalibration() {
  const BASE_KEYS = ['starCornerPos','signZonePos','pointerPos','heroDestPos','mapNodePositions','hero4Pos','c2s2SpotPos','c2s5DefectPos','c5s3SpotPos','c5s2SpotPos','c3s7MicPos','sceneTextPositions'];
  // Inclut les variantes mobile (ex: starCornerPos.mobile) pour les figer aussi sur disque.
  const KEYS = BASE_KEYS.flatMap(k => [k, k + '.mobile']);
  const data = {};
  KEYS.forEach(k => {
    const raw = localStorage.getItem(k);
    if (raw) {
      try { data[k] = JSON.parse(raw); } catch(e) {}
    }
  });
  const js = 'window.__CALIBRATION_DATA__ = ' + JSON.stringify(data, null, 2) + ';\n';
  const blob = new Blob([js], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'calibration.js';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  console.log('💾 calibration.js telecharge ! Remplace le fichier dans le projet pour figer.');
  console.log('   Cles sauvegardees :', Object.keys(data));
}

// Au demarrage, on charge calibration.json (source de verite) et on synchronise
// localStorage. Le fichier disque PREVAUT systematiquement : c'est la version
// "officielle" et persistante. localStorage n'est plus qu'un cache rapide,
// reecrit a chaque chargement avec les valeurs du fichier. Cela garantit qu'une
// calibration sauvegardee ne disparait JAMAIS, meme si localStorage contenait
// des valeurs vieilles ou differentes (autre navigateur, cache nettoye, etc.).
async function loadCalibrationFromServer() {
  try {
    let data = null;
    // En mode file:// le fetch est bloque (CORS) — fallback sur calibration.js
    // qui est charge en <script> et expose window.__CALIBRATION_DATA__
    try {
      const r = await fetch('calibration.json?v=' + Date.now());
      if (r.ok) data = await r.json();
    } catch(e) {
      console.log('[calibration] fetch echoue (probablement file://), fallback calibration.js');
    }
    if (!data && typeof window.__CALIBRATION_DATA__ === 'object' && window.__CALIBRATION_DATA__) {
      data = window.__CALIBRATION_DATA__;
      console.log('[calibration] charge depuis calibration.js (fallback file://)');
    }
    if (!data) return;
    // Hero4 : on remplace les defaults hardcodes
    if (data.hero4Pos) {
      Object.assign(HERO4_DEFAULT_POS, data.hero4Pos);
      console.log('[calibration] hero4Pos charge depuis calibration.json');
    }
    // Toutes les autres calibrations : disque = source de verite, on ecrase
    // localStorage avec les valeurs du fichier (pour eviter qu'un cache stale
    // ecrase silencieusement une calibration pourtant sauvegardee sur disque).
    // Note: en mode file:// le POST /api/save-calibration ne marche pas, donc
    // toute calibration FAITE en file:// vit uniquement dans localStorage. Si
    // une cle EXISTE sur disque, c'est qu'elle a ete sauvegardee a un moment
    // (server-mode); on prefere la version disque qui est la "verite officielle".
    // Si une cle est ABSENTE du disque, localStorage est preserve par defaut.
    const fileKeys = ['starCornerPos', 'mapNodePositions', 'signZonePos', 'pointerPos', 'heroDestPos', 'c3s7MicPos', 'sceneTextPositions', 'c2s5DefectPos', 'c2s2SpotPos', 'c5s3SpotPos', 'c5s2SpotPos', 'hero4Pos'];
    fileKeys.forEach(key => {
      // Ecrit la cle desktop ET la cle mobile suffixee si presentes dans le JSON.
      // Les fonctions de lecture (_calibGet) privilegient la cle mobile sur mobile,
      // sinon retombent sur la cle desktop comme avant.
      [key, key + '.mobile'].forEach(k => {
        if (data[k] !== undefined && data[k] !== null) {
          try {
            localStorage.setItem(k, JSON.stringify(data[k]));
            console.log('[calibration]', k, 'sync depuis disque');
          } catch(e) {}
        }
      });
    });
    // Re-applique les positions visuelles maintenant qu'elles sont en cache
    if (typeof applyStarCornerPosition === 'function') applyStarCornerPosition();
    if (typeof applyMapNodePositions   === 'function') applyMapNodePositions();
    if (typeof applySignZonePos        === 'function') applySignZonePos();
    if (typeof applyPointerPos         === 'function') applyPointerPos();
    if (typeof applyHeroDestPos        === 'function') applyHeroDestPos();
    if (typeof applyC3s7MicPositions   === 'function') applyC3s7MicPositions();
    // Egalement reappliquer les textes de scene si la fonction existe
    if (typeof applySceneTextPositions === 'function') applySceneTextPositions();
    if (typeof applyC2s5DefectPos      === 'function') applyC2s5DefectPos();
    if (typeof applyC2s2SpotPos        === 'function') applyC2s2SpotPos();
    if (typeof applyC5s3SpotPos        === 'function') applyC5s3SpotPos();
    if (typeof applyC5s2SpotPos        === 'function') applyC5s2SpotPos();
  } catch(e) {}
}
// On lance le chargement immediatement (pas besoin d'attendre).
loadCalibrationFromServer();
function positionHero4() {
  const heroImg4 = document.getElementById('hero-back-4');
  const charType = state.characterType;
  if (!heroImg4 || !charType) return;
  const positions = loadHero4Pos();
  const pos = positions[charType] || HERO4_DEFAULT_POS[charType] || HERO4_DEFAULT_POS.fille;
  heroImg4.style.right  = pos.right  + '%';
  heroImg4.style.bottom = pos.bottom + '%';
  heroImg4.style.height = pos.height + '%';
}

// Alt+H : active/desactive le mode calibration heros ecran 4 (modele Map)
//   - drag de l'image hero-back-4 pour la repositionner
//   - molette / shift+molette : ajuste la hauteur
//   - sauvegarde automatique dans localStorage par perso
function toggleHero4Calib() {
  // Si on n'est pas sur l'ecran 4, on y va d'abord
  if (state.currentScreen !== 4) {
    goToScreen(4, true);
    setTimeout(toggleHero4Calib, 300);
    return;
  }
  if (document.body.classList.contains('calib-hero4-mode')) {
    disableHero4Drag();
    console.log('🎯 Calib heros ecran 4 OFF. Sauvegarde :', loadHero4Pos());
  } else {
    enableHero4Drag();
    console.log('🎯 Calib heros ecran 4 ON pour', state.characterType, '— glisse l\'image, molette pour la taille, Alt+J pour terminer');
    console.log('   positions actuelles :', loadHero4Pos());
  }
}

function enableHero4Drag() {
  // On pose la classe sur le body pour que startHero4Drag/hero4Wheel
  // passent leur garde "if (!body.classList.contains('calib-hero4-mode')) return".
  document.body.classList.add('calib-hero4-mode');
  const heroImg4 = document.getElementById('hero-back-4');
  if (!heroImg4) { console.warn('[hero4-calib] hero-back-4 introuvable'); return; }
  heroImg4.style.outline = '3px dashed #ff5e7e';
  heroImg4.style.cursor = 'grab';
  // CSS de base met pointer-events: none (clics passent a travers).
  // On le force a auto pendant la calibration pour pouvoir agripper l'image.
  heroImg4.style.pointerEvents = 'auto';
  heroImg4.addEventListener('mousedown',  startHero4Drag, false);
  heroImg4.addEventListener('touchstart', startHero4Drag, { passive: false });
  heroImg4.addEventListener('wheel',      hero4Wheel,     { passive: false });
}

function disableHero4Drag() {
  document.body.classList.remove('calib-hero4-mode');
  const heroImg4 = document.getElementById('hero-back-4');
  if (!heroImg4) return;
  heroImg4.style.outline = '';
  heroImg4.style.cursor = '';
  heroImg4.style.pointerEvents = ''; // retour au CSS (none)
  heroImg4.removeEventListener('mousedown',  startHero4Drag, false);
  heroImg4.removeEventListener('touchstart', startHero4Drag);
  heroImg4.removeEventListener('wheel',      hero4Wheel);
}
function startHero4Drag(e) {
  if (!document.body.classList.contains('calib-hero4-mode')) return;
  e.preventDefault(); e.stopPropagation();
  const heroImg4 = e.currentTarget;
  const scene = document.querySelector('#screen-4 .scene-4-machine') || heroImg4.parentElement;
  if (!scene) return;
  const sceneRect = scene.getBoundingClientRect();
  const startRect = heroImg4.getBoundingClientRect();
  const getPt = (ev) => {
    const t = ev.touches && ev.touches[0];
    return t ? { x: t.clientX, y: t.clientY } : { x: ev.clientX, y: ev.clientY };
  };
  const startPt = getPt(e);
  const startRight  = sceneRect.right  - startRect.right;
  const startBottom = sceneRect.bottom - startRect.bottom;
  const onMove = (ev) => {
    ev.preventDefault();
    const p = getPt(ev);
    const dx = p.x - startPt.x;
    const dy = p.y - startPt.y;
    const newRight  = ((startRight  - dx) / sceneRect.width)  * 100;
    const newBottom = ((startBottom - dy) / sceneRect.height) * 100;
    heroImg4.style.right  = Math.max(-10, Math.min(80, newRight))  + '%';
    heroImg4.style.bottom = Math.max(-10, Math.min(80, newBottom)) + '%';
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup',   onUp);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend',  onUp);
    const all = loadHero4Pos();
    all[state.characterType] = {
      right:  parseFloat(heroImg4.style.right)  || 4,
      bottom: parseFloat(heroImg4.style.bottom) || 4,
      height: parseFloat(heroImg4.style.height) || 62
    };
    saveHero4Pos(all);
    console.log('💾', state.characterType, '→', all[state.characterType]);
  };
  document.addEventListener('mousemove', onMove, { passive: false });
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('mouseup',   onUp);
  document.addEventListener('touchend',  onUp);
}
function hero4Wheel(e) {
  if (!document.body.classList.contains('calib-hero4-mode')) return;
  e.preventDefault();
  const heroImg4 = e.currentTarget;
  const step = e.shiftKey ? 3 : 0.5;
  const cur = parseFloat(heroImg4.style.height) || 62;
  const next = Math.max(20, Math.min(120, cur - Math.sign(e.deltaY) * step));
  heroImg4.style.height = next + '%';
  const all = loadHero4Pos();
  all[state.characterType] = {
    right:  parseFloat(heroImg4.style.right)  || 4,
    bottom: parseFloat(heroImg4.style.bottom) || 4,
    height: next
  };
  saveHero4Pos(all);
}

// ============================================================
// Calibration du panneau "scene-text" (narrateur + Léon) par écran
// Permet de drag/resize la bulle de dialogue sur n'importe quelle scène.
// Sauvegarde par screenId dans localStorage 'sceneTextPositions' + sur disque.
// Active : Alt+T sur l'écran courant, ou enableSceneTextDrag() en console.
// ============================================================
function loadSceneTextPositions() {
  try {
    const raw = _calibGet('sceneTextPositions');
    if (raw) return JSON.parse(raw);
  } catch(e) {}
  return {};
}
function saveSceneTextPositions(positions) {
  _calibSet('sceneTextPositions', JSON.stringify(positions));
  persistCalibration({ sceneTextPositions: positions });
}
function applySceneTextPos(screenId) {
  // Cherche l'element scene-text dans l'ecran cible et applique la position sauvegardee
  const root = document.getElementById('screen-' + screenId);
  if (!root) return;
  const el = root.querySelector('.scene-text');
  if (!el) return;
  const positions = loadSceneTextPositions();
  const pos = positions[screenId];
  if (!pos) return;
  // Reset les anciens placements (top/right/bottom/left puis applique)
  if (pos.bottom !== undefined) { el.style.bottom = pos.bottom + 'px'; el.style.top = 'auto'; }
  if (pos.left   !== undefined) { el.style.left   = pos.left   + 'px'; el.style.right = 'auto'; }
  if (pos.width  !== undefined) { el.style.width  = pos.width  + 'px'; }
}
// Cible le scene-text de l'ecran actuellement actif
function _currentSceneTextEl() {
  const sid = state.currentScreen;
  const root = document.getElementById('screen-' + sid);
  if (!root) return { el: null, sid: null };
  const el = root.querySelector('.scene-text');
  return { el, sid };
}
function toggleSceneTextCalib() {
  if (document.body.classList.contains('calib-scenetext-mode')) {
    disableSceneTextDrag();
  } else {
    enableSceneTextDrag();
  }
}
function enableSceneTextDrag() {
  const { el, sid } = _currentSceneTextEl();
  if (!el) { console.warn('[scenetext-calib] aucun .scene-text sur l\'ecran courant', state.currentScreen); return; }
  document.body.classList.add('calib-scenetext-mode');
  el.style.outline = '3px dashed #4ade80';
  el.style.cursor = 'grab';
  el.style.zIndex = '999';
  el.dataset.calibScreen = sid;
  el.addEventListener('mousedown',  startSceneTextDrag, false);
  el.addEventListener('touchstart', startSceneTextDrag, { passive: false });
  el.addEventListener('wheel',      sceneTextWheel,     { passive: false });
  console.log('🎯 Calib scene-text ON pour ecran', sid, '— drag pour deplacer, molette pour la largeur, Alt+T pour terminer');
  console.log('   positions actuelles :', loadSceneTextPositions());
}
function disableSceneTextDrag() {
  document.body.classList.remove('calib-scenetext-mode');
  const { el } = _currentSceneTextEl();
  if (!el) return;
  el.style.outline = '';
  el.style.cursor = '';
  el.style.zIndex = '';
  el.removeEventListener('mousedown',  startSceneTextDrag, false);
  el.removeEventListener('touchstart', startSceneTextDrag);
  el.removeEventListener('wheel',      sceneTextWheel);
  console.log('🎯 Calib scene-text OFF — sauvegarde :', loadSceneTextPositions());
}
function startSceneTextDrag(e) {
  if (!document.body.classList.contains('calib-scenetext-mode')) return;
  e.preventDefault(); e.stopPropagation();
  const el = e.currentTarget;
  const sid = el.dataset.calibScreen || state.currentScreen;
  const startRect = el.getBoundingClientRect();
  const vh = window.innerHeight;
  const getPt = (ev) => {
    const t = ev.touches && ev.touches[0];
    return t ? { x: t.clientX, y: t.clientY } : { x: ev.clientX, y: ev.clientY };
  };
  const startPt = getPt(e);
  const startLeft   = startRect.left;
  const startBottom = vh - startRect.bottom;
  const onMove = (ev) => {
    ev.preventDefault();
    const p = getPt(ev);
    const dx = p.x - startPt.x;
    const dy = p.y - startPt.y;
    const newLeft   = Math.max(0, startLeft + dx);
    const newBottom = Math.max(0, startBottom - dy);
    el.style.left   = newLeft   + 'px';
    el.style.bottom = newBottom + 'px';
    el.style.right  = 'auto';
    el.style.top    = 'auto';
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup',   onUp);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend',  onUp);
    const positions = loadSceneTextPositions();
    positions[sid] = {
      left:   parseFloat(el.style.left)   || 14,
      bottom: parseFloat(el.style.bottom) || 30,
      width:  parseFloat(el.style.width)  || el.getBoundingClientRect().width
    };
    saveSceneTextPositions(positions);
    console.log('💾 scene-text', sid, '→', positions[sid]);
  };
  document.addEventListener('mousemove', onMove, { passive: false });
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('mouseup',   onUp);
  document.addEventListener('touchend',  onUp);
}
function sceneTextWheel(e) {
  if (!document.body.classList.contains('calib-scenetext-mode')) return;
  e.preventDefault();
  const el = e.currentTarget;
  const sid = el.dataset.calibScreen || state.currentScreen;
  const step = e.shiftKey ? 30 : 8;
  const cur = el.getBoundingClientRect().width;
  const next = Math.max(180, Math.min(window.innerWidth - 30, cur - Math.sign(e.deltaY) * step));
  el.style.width = next + 'px';
  const positions = loadSceneTextPositions();
  positions[sid] = {
    left:   parseFloat(el.style.left)   || 14,
    bottom: parseFloat(el.style.bottom) || 30,
    width:  next
  };
  saveSceneTextPositions(positions);
}

function _genericPctDrag(el, persist) {
  // Helper de drag-en-pourcentage (pour pointeur et destination heros)
  const scene = document.querySelector('#screen-2 .immersive-scene');
  if (!scene) return null;
  const handler = (e) => {
    e.preventDefault(); e.stopPropagation();
    const sceneRect = scene.getBoundingClientRect();
    const getPt = (ev) => {
      const t = ev.touches && ev.touches[0];
      return t ? { x: t.clientX, y: t.clientY } : { x: ev.clientX, y: ev.clientY };
    };
    const onMove = (ev) => {
      ev.preventDefault();
      const p = getPt(ev);
      const leftPct = ((p.x - sceneRect.left) / sceneRect.width)  * 100;
      const topPct  = ((p.y - sceneRect.top)  / sceneRect.height) * 100;
      el.style.left = Math.max(0, Math.min(100, leftPct)) + '%';
      el.style.top  = Math.max(0, Math.min(100, topPct))  + '%';
      persist({ top: parseFloat(el.style.top), left: parseFloat(el.style.left) });
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('mouseup',   onUp);
      document.removeEventListener('touchend',  onUp);
      el.style.boxShadow = '0 0 0 3px #4ade80';
      setTimeout(() => { el.style.boxShadow = ''; }, 600);
    };
    document.addEventListener('mousemove', onMove, { passive: false });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('mouseup',   onUp);
    document.addEventListener('touchend',  onUp);
  };
  return handler;
}

function togglePointerCalib() {
  document.body.classList.toggle('calib-pointer-mode');
  const el = document.getElementById('sign-pointer');
  if (!el) return;
  if (document.body.classList.contains('calib-pointer-mode')) {
    if (!window._pointerDragHandler) window._pointerDragHandler = _genericPctDrag(el, savePointerPos);
    el.addEventListener('mousedown',  window._pointerDragHandler, false);
    el.addEventListener('touchstart', window._pointerDragHandler, { passive: false });
    console.log('Calib pointeur ON. Glisse l\'emoji 👆, re-clique pour terminer.');
  } else {
    el.removeEventListener('mousedown',  window._pointerDragHandler, false);
    el.removeEventListener('touchstart', window._pointerDragHandler);
    console.log('Calib pointeur OFF. Position :', loadPointerPos());
  }
}

// v386 : drag DEDIE pour la destination heros — sauvegarde en % DU CONTENU
// VIDEO (et non % conteneur comme _genericPctDrag), pour rester coherent avec
// applyHeroDestPos qui projette video-content-% -> px conteneur (cover-fit).
function _heroDestDrag(el, persist) {
  const scene = document.querySelector('#screen-2 .immersive-scene');
  if (!scene) return null;
  return (e) => {
    e.preventDefault(); e.stopPropagation();
    const getPt = (ev) => {
      const t = ev.touches && ev.touches[0];
      return t ? { x: t.clientX, y: t.clientY } : { x: ev.clientX, y: ev.clientY };
    };
    const onMove = (ev) => {
      ev.preventDefault();
      const pt = getPt(ev);
      const sceneRect = scene.getBoundingClientRect();
      const rect = _streetVideoContentRect();
      if (!rect) return;
      // px conteneur -> px relatif au contenu video -> % du contenu video
      const cx = pt.x - sceneRect.left;
      const cy = pt.y - sceneRect.top;
      const leftPct = Math.max(0, Math.min(100, ((cx - rect.x) / rect.w) * 100));
      const topPct  = Math.max(0, Math.min(100, ((cy - rect.y) / rect.h) * 100));
      el.style.left = (rect.x + (leftPct / 100) * rect.w) + 'px';
      el.style.top  = (rect.y + (topPct  / 100) * rect.h) + 'px';
      persist({ top: topPct, left: leftPct });
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('mouseup',   onUp);
      document.removeEventListener('touchend',  onUp);
      el.style.boxShadow = '0 0 0 3px #4ade80';
      setTimeout(() => { el.style.boxShadow = ''; }, 600);
    };
    document.addEventListener('mousemove', onMove, { passive: false });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('mouseup',   onUp);
    document.addEventListener('touchend',  onUp);
  };
}

function toggleHeroDestCalib() {
  document.body.classList.toggle('calib-hero-mode');
  const el = document.getElementById('hero-destination');
  if (!el) return;
  if (document.body.classList.contains('calib-hero-mode')) {
    if (!window._heroDestDragHandler) window._heroDestDragHandler = _heroDestDrag(el, saveHeroDestPos);
    el.addEventListener('mousedown',  window._heroDestDragHandler, false);
    el.addEventListener('touchstart', window._heroDestDragHandler, { passive: false });
    console.log('Calib destination heros ON. Glisse le marker, re-clique pour terminer.');
  } else {
    el.removeEventListener('mousedown',  window._heroDestDragHandler, false);
    el.removeEventListener('touchstart', window._heroDestDragHandler);
    console.log('Calib destination heros OFF. Position :', loadHeroDestPos());
  }
}

// ============================================================
// MON ATELIER : modale UI (badges, boutique, vestiaire)
// ============================================================
let _atelierActiveTab = 'badges';

function openAtelier() {
  _ensureAtelierState();
  const m = document.getElementById('atelier-modal');
  if (!m) return;
  m.style.display = 'flex';
  renderAtelierModal();
}

function closeAtelier() {
  const m = document.getElementById('atelier-modal');
  if (m) m.style.display = 'none';
}

function switchAtelierTab(tab) {
  _atelierActiveTab = tab;
  document.querySelectorAll('.atelier-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  document.getElementById('atelier-content-badges').style.display = tab === 'badges' ? '' : 'none';
  document.getElementById('atelier-content-shop'  ).style.display = tab === 'shop'   ? '' : 'none';
  const cardsEl = document.getElementById('atelier-content-cards');
  if (cardsEl) cardsEl.style.display = tab === 'cards' ? '' : 'none';
  document.getElementById('atelier-content-vest'  ).style.display = tab === 'vest'   ? '' : 'none';
  renderAtelierModal();
}

function renderAtelierModal() {
  _ensureAtelierState();
  const starEl = document.getElementById('atelier-star-count');
  if (starEl) starEl.textContent = state.totalStars || 0;
  // Badges tab
  const tBadges = document.getElementById('atelier-content-badges');
  if (tBadges) {
    tBadges.innerHTML = '';
    BADGES_CATALOG.forEach(b => {
      const earned = (state.chaptersCompleted || []).includes(b.chap);
      const it = document.createElement('div');
      it.className = 'atelier-item' + (earned ? ' owned' : ' locked');
      it.innerHTML = '<div class="atelier-item-emoji">' + b.emoji + '</div>' +
                                    '<div class="atelier-item-name">' + b.name + '</div>' +
                     '<div class="atelier-item-desc">' + b.desc + '</div>' +
                     '<div class="atelier-item-cost">' + (earned ? 'Debloque !' : 'Chapitre ' + b.chap) + '</div>';
      tBadges.appendChild(it);
    });
  }
  // Shop tab
  const tShop = document.getElementById('atelier-content-shop');
  if (tShop) {
    tShop.innerHTML = '';
    ARTICLES_CATALOG.forEach(a => {
      const owned = ownsArticle(a.id);
      const canBuy = !owned && (state.totalStars || 0) >= a.cost;
      const it = document.createElement('div');
      it.className = 'atelier-item' + (owned ? ' owned' : (canBuy ? '' : ' locked')) + (a.legendary ? ' legendary' : '');
      let btn = '';
      if (owned) {
        btn = '<button class="atelier-item-btn" disabled>Acheté</button>';
      } else {
        btn = '<button class="atelier-item-btn" ' + (canBuy ? '' : 'disabled') + ' onclick="buyArticleUI(\'' + a.id + '\')">Acheter</button>';
      }
      // Badge "type d'article" : carte / skin / carte legendaire.
      // - Carte standard : badge violet "Carte"
      // - Skin (accessoire avatar) : badge orange "Skin"
      // - Carte legendaire : un SEUL badge dore "Carte legendaire" (sinon les
      //   deux pastilles legendaire+type se chevauchaient et c'etait confus).
      let kindBadge;
      if (a.kind === 'card' && a.legendary) {
        kindBadge = '<span class="atelier-kind-badge atelier-kind-legendary">🎴 Carte légendaire ⭐</span>';
      } else if (a.kind === 'card') {
        kindBadge = '<span class="atelier-kind-badge atelier-kind-card">🎴 Carte</span>';
      } else {
        kindBadge = '<span class="atelier-kind-badge atelier-kind-skin">👕 Skin</span>';
      }
      // Plus de pastille "LEGENDAIRE" separee : fusionnee dans kindBadge ci-dessus.
      const legendBadge = '';
      // v574 : pour les cartes avec image, on affiche l'image (fallback emoji)
      const visual = a.img
        ? '<img class="atelier-item-img" src="' + a.img + '" alt="' + a.name + '"' +
          ' onerror="this.style.display=\'none\'; var em=this.nextElementSibling; if(em) em.style.display=\'block\';">' +
          '<div class="atelier-item-emoji" style="display:none">' + a.emoji + '</div>'
        : '<div class="atelier-item-emoji">' + a.emoji + '</div>';
      it.innerHTML = kindBadge +
                     legendBadge +
                     visual +
                     '<div class="atelier-item-name">' + a.name + '</div>' +
                     '<div class="atelier-item-desc">' + a.desc + '</div>' +
                     '<div class="atelier-item-cost">' + a.cost + ' ⭐</div>' +
                     btn;
      tShop.appendChild(it);
    });
  }
  // Cartes tab — collection style Pokémon
  const tCards = document.getElementById('atelier-content-cards');
  if (tCards) {
    tCards.innerHTML = '';
    const allCards = ARTICLES_CATALOG.filter(a => a.kind === 'card');
    const ownedCount = allCards.filter(a => ownsArticle(a.id)).length;
    // Header avec compteur
    const header = document.createElement('div');
    header.className = 'cards-header';
    header.innerHTML = '<h3 class="cards-title">🎴 Ma collection</h3>' +
                       '<p class="cards-count">' + ownedCount + ' / ' + allCards.length + ' cartes</p>';
    tCards.appendChild(header);
    // v580 : hint replay -> on peut tout debloquer en rejouant
    const hint = document.createElement('p');
    hint.className = 'cards-replay-hint';
    hint.innerHTML = '🔄 Rejoue les chapitres et réussis les quiz pour gagner plus d\'étoiles et tout débloquer !';
    tCards.appendChild(hint);
    // Grille de cartes
    const grid = document.createElement('div');
    grid.className = 'cards-grid';
    allCards.forEach(a => {
      const owned = ownsArticle(a.id);
      const canBuy = !owned && (state.totalStars || 0) >= a.cost;
      // v568 : carte premium type "trading card" avec flip 3D (recto image
      // pleine carte + nom / verso description). Au clic la carte se retourne.
      const card = document.createElement('div');
      card.className = 'collect-card' + (owned ? ' owned' : ' missing') + (a.legendary ? ' legendary' : '');

      const imgTag = a.img
        ? '<img class="cc-img" src="' + a.img + '" alt="' + a.name + '"' +
          ' onerror="this.style.display=\'none\'; var em=this.parentNode.querySelector(\'.cc-emoji\'); if(em) em.style.display=\'flex\';">' +
          '<div class="cc-emoji" style="display:none">' + a.emoji + '</div>'
        : '<div class="cc-emoji">' + a.emoji + '</div>';

      // v574 : TOUTES les cartes ont un flip (owned ou locked).
      if (owned) {
        card.innerHTML =
          '<div class="cc-inner">' +
            '<div class="cc-face cc-front">' +
              imgTag +
              (a.legendary ? '<span class="cc-badge">★ LÉGENDAIRE</span>' : '') +
              '<div class="cc-namebar">' + a.name + '</div>' +
            '</div>' +
            '<div class="cc-face cc-back">' +
              '<div class="cc-back-name">' + a.name + '</div>' +
              '<div class="cc-back-desc">' + a.desc + '</div>' +
              '<div class="cc-flip-hint">↩ retourner</div>' +
            '</div>' +
          '</div>';
        // Au clic sur une carte deja possedee : on ouvre la modale "grand format"
        // (meme effet qu'a l'achat) pour pouvoir la re-admirer en plein ecran.
        // L'utilisateur clique ensuite dans la modale pour voir le verso, puis fermer.
        card.onclick = () => {
          if (typeof showCardReveal === 'function') showCardReveal(a);
          else card.classList.toggle('flipped'); // fallback
        };
      } else {
        // Verrouillee : recto image floutee + lock / verso = comment debloquer + achat
        const buyBtn = '<button class="cc-buy" ' + (canBuy ? '' : 'disabled') +
                       ' onclick="event.stopPropagation(); buyArticleUI(\'' + a.id + '\')">' +
                       (canBuy ? 'Acheter ' + a.cost + ' ⭐' : '🔒 ' + a.cost + ' ⭐') + '</button>';
        const backDesc = a.legendary
          ? 'Débloque-la en répondant juste à TOUS les quiz du jeu (16/16) !'
          : a.desc;
        card.innerHTML =
          '<div class="cc-inner">' +
            '<div class="cc-face cc-front">' +
              '<div class="cc-locked-visual">' + imgTag + '</div>' +
              '<div class="cc-namebar cc-namebar-locked">' + a.name + '</div>' +
            '</div>' +
            '<div class="cc-face cc-back">' +
              '<div class="cc-back-name">' + a.name + '</div>' +
              '<div class="cc-back-desc">' + backDesc + '</div>' +
              buyBtn +
              '<div class="cc-flip-hint">↩ retourner</div>' +
            '</div>' +
          '</div>';
        // Flip au clic SAUF si on clique le bouton acheter
        card.onclick = (e) => {
          if (e.target.closest('.cc-buy')) return;
          card.classList.toggle('flipped');
        };
      }
      grid.appendChild(card);
    });
    tCards.appendChild(grid);
  }

  // Vestiaire tab
  const tVest = document.getElementById('atelier-content-vest');
  if (tVest) {
    tVest.innerHTML = '';
    const owned = ARTICLES_CATALOG.filter(a => ownsArticle(a.id));
    if (owned.length === 0) {
      tVest.innerHTML = '<div class="atelier-empty">Tu n as encore rien achete. Va dans la boutique !</div>';
    } else {
      owned.forEach(a => {
        const isEquip = a.kind === 'accessory' && state.equippedAccessories[a.slot] === a.id;
        const it = document.createElement('div');
        it.className = 'atelier-item owned' + (isEquip ? ' equipped' : '');
        let action = '';
        if (a.kind === 'accessory') {
          action = '<button class="atelier-item-btn ' + (isEquip ? 'btn-equip-active' : '') + '" onclick="equipAccessory(\'' + a.id + '\')">' + (isEquip ? 'Retirer' : 'Mettre') + '</button>';
        } else {
          action = '<div class="atelier-item-cost">Carte</div>';
        }
        // Image watercolor (builder) si dispo, sinon emoji en fallback
        const vestVisual = a.img
          ? '<img class="atelier-item-img" src="' + a.img + '" alt="' + a.name + '"' +
            ' onerror="this.style.display=\'none\'; var em=this.nextElementSibling; if(em) em.style.display=\'block\';">' +
            '<div class="atelier-item-emoji" style="display:none">' + a.emoji + '</div>'
          : '<div class="atelier-item-emoji">' + a.emoji + '</div>';
        it.innerHTML = vestVisual +
                       '<div class="atelier-item-name">' + a.name + '</div>' +
                       '<div class="atelier-item-desc">' + a.desc + '</div>' +
                       action;
        tVest.appendChild(it);
      });
    }
  }
}

// ============================================================
// Lecture automatique de la consigne narrateur d'un mini-jeu.
// Chaque consigne est un MP3 dans assets/consignes/<id>.mp3.
// Appelee au moment ou le mini-jeu s'active (typiquement apres onLeonEnd).
// Respecte voicesEnabled() (toggle global voix off).
// ============================================================
// Consigne narrateur DESACTIVEE : Leon explique deja le mini-jeu, et le hover/
// tap-to-speak permet aux enfants de lire la pill consigne. Pas besoin de
// re-narrer. Garde la fonction en place (no-op) pour ne pas casser les 19 appels
// dans le code. Pour reactiver plus tard, decommenter le corps.
function playConsigne(consigneId) {
  if (!consigneId) return;
  if (typeof voicesEnabled === 'function' && !voicesEnabled()) return;
  if (window._consigneAudio) {
    try { window._consigneAudio.pause(); } catch(e) {}
  }
  try {
    // v451 : cache buster pour eviter que le browser serve une ancienne
    // version du mp3 quand on regenere la voix (Date.now garantit nouveau).
    window._consigneAudio = new Audio(`assets/consignes/${consigneId}.mp3?v=${Date.now()}`);
    window._consigneAudio.volume = 1;
    window._consigneAudio.play().catch(() => {});
  } catch(e) {}
}

// ============================================================
// Hover-to-speak : permet aux enfants non-lecteurs de jouer seuls.
// Au survol d'une carte/bouton/option avec la souris, SpeechSynthesis
// lit le texte a voix haute. Throttle : pas de re-lecture en boucle si
// la souris reste sur le meme element.
// ============================================================
const HOVER_SPEAK_SELECTORS = [
  '.vf-statement',       // Quiz V/F : la phrase a lire
  '.vf-btn',             // Quiz V/F : boutons "Vrai" / "Faux"
  '.tap-option',         // screen-5 chap 1
  '.c4s2-q-card',        // c4s2 questions
  '.c4s6-q-btn',         // c4s6 questions
  '.c5s2-card',          // c5s2 IA cartes
  '.c5s2-zone',          // c5s2 super-pouvoirs zones
  '.c5-module-btn',      // c5s5 modules
  // .s4-card RETIRE : les cartes ont des emojis visuels (chat: pattes,
  // moustaches, etc.), pas besoin de TTS. L'interception du click pour
  // declencher la TTS causait des bugs de double-tap intermittents
  // (notamment sur 'moustaches' et 'queue' du chat).
  '.prompt-word'         // c2s7 mots du prompt
];

let _hoverLastEl = null;
let _hoverLastTime = 0;

function _hoverSpeakText(text) {
  if (!text || !text.trim()) return;
  if (typeof window.speechSynthesis === 'undefined') return;
  if (typeof voicesEnabled === 'function' && !voicesEnabled()) return;
  // Strip emojis pour ne pas les faire lire
  let clean = (typeof _stripEmoji === 'function' ? _stripEmoji(text) : text).trim();
  if (!clean) return;
  // Corrections de prononciation FR (mots que la TTS lit mal)
  // "Bot" → "Bote" pour entendre [bɔt] et non [bo]
  clean = clean.replace(/\bBot\b/g, 'Bote').replace(/\bbot\b/g, 'bote');
  // IMPORTANT : sur Chrome Android, speak() ne marche que si appele
  // SYNCHRONIQUEMENT dans un handler d'interaction utilisateur. Un setTimeout
  // (meme 0ms) casse la chaine de "user gesture" et le speak est avale
  // silencieusement. On ne fait pas de cancel() prealable pour preserver le
  // contexte ; si une utterance precedente joue encore, on l'arrete juste
  // apres le speak (Chromium gere bien la concurrence dans ce sens).
  const utt = new SpeechSynthesisUtterance(clean);
  utt.lang = 'fr-FR';
  utt.rate = 1.0;
  utt.pitch = 1.0;
  utt.volume = 1;
  try {
    const voices = window.speechSynthesis.getVoices();
    const fr = voices.find(v => v.lang && v.lang.startsWith('fr'));
    if (fr) utt.voice = fr;
  } catch(e) {}
  window._hoverUtt = utt;
  // Cancel toute utterance en cours AVANT le speak — sur la meme tick c'est OK
  // sur Chrome Android (pas de setTimeout entre les deux).
  try { window.speechSynthesis.cancel(); } catch(e) {}
  try { window.speechSynthesis.speak(utt); } catch(e) {}
}

function _setupHoverSpeak() {
  // v357 : RETIRE — la lecture vocale au 1er tap / au survol souris causait
  // plus de problemes qu'autre chose (double-tap intermittent, taps avales,
  // comportement incoherent entre Pixel et S23 FE).
  // Desormais : 1 tap = selection directe du bouton/de la reponse, partout.
  // La fonction est conservee en no-op pour ne pas casser l'auto-init en bas.
}
// Auto-init au chargement
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _setupHoverSpeak);
} else {
  _setupHoverSpeak();
}

function buyArticleUI(id) {
  const r = buyArticle(id);
  if (!r.ok && r.reason === 'pas assez d etoiles') {
    alert('Pas assez d etoiles ! Joue d autres chapitres pour en gagner.');
    return;
  }
  // Achat reussi : pour une CARTE on offre une revelation en grand avec
  // flip recto/verso (effet ouverture de booster). Pour un skin on laisse
  // le comportement silencieux (la pastille "Acheter" devient "Acheté").
  if (r.ok) {
    const item = ARTICLES_CATALOG.find(a => a.id === id);
    if (item && item.kind === 'card' && typeof showCardReveal === 'function') {
      showCardReveal(item);
    }
  }
}

// Modale "revelation de carte" : ouvre une vue plein ecran avec la carte
// affichee en grand (recto = image + nom), invite a recliquer pour voir
// le verso (description), puis a recliquer pour fermer. Effet "j'ouvre
// un booster" pour valoriser l'achat.
function showCardReveal(item) {
  if (!item) return;
  // Nettoie une eventuelle modale precedente
  const existing = document.getElementById('card-reveal-modal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'card-reveal-modal';
  overlay.className = 'card-reveal-modal';

  const imgTag = item.img
    ? '<img class="cr-img" src="' + item.img + '" alt="' + item.name + '"' +
      ' onerror="this.style.display=\'none\'; var em=this.parentNode.querySelector(\'.cr-emoji\'); if(em) em.style.display=\'flex\';">' +
      '<div class="cr-emoji" style="display:none">' + item.emoji + '</div>'
    : '<div class="cr-emoji">' + item.emoji + '</div>';

  const legendBanner = item.legendary
    ? '<span class="cr-legendary">★ LÉGENDAIRE ★</span>'
    : '';

  overlay.innerHTML =
    '<div class="cr-stage">' +
      '<div class="cr-card' + (item.legendary ? ' cr-card-legendary' : '') + '">' +
        '<div class="cr-card-inner">' +
          '<div class="cr-face cr-front">' +
            imgTag +
            legendBanner +
            '<div class="cr-namebar">' + item.name + '</div>' +
          '</div>' +
          '<div class="cr-face cr-back">' +
            '<div class="cr-back-name">' + item.name + '</div>' +
            '<div class="cr-back-desc">' + item.desc + '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="cr-hint" id="cr-hint">Clique pour découvrir le verso ✨</div>' +
    '</div>';

  document.body.appendChild(overlay);

  // Etat : 0 = recto visible, 1 = verso visible, 2 = ferme
  let phase = 0;
  const card  = overlay.querySelector('.cr-card');
  const hint  = overlay.querySelector('#cr-hint');
  overlay.addEventListener('click', () => {
    if (phase === 0) {
      card.classList.add('cr-flipped');
      hint.textContent = 'Clique pour continuer';
      phase = 1;
    } else {
      overlay.classList.add('cr-closing');
      setTimeout(() => overlay.remove(), 260);
      phase = 2;
    }
  });
}

// ============================================================
// c3s3 — Aide la machine à écrire BONJOUR (tap les lettres dans l'ordre)
// ============================================================
const C3S3_WORD = 'BONJOUR';
function _c3s3Shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function resetC3s3Game() {
  state.c3s3LetterIndex = 0;
  if (typeof saveState === 'function') saveState();
  // Cache le panneau, restaure les dialogues
  const panel = document.getElementById('c3s3-game');
  if (panel) panel.style.display = 'none';
  const sceneText = document.querySelector('#screen-c3s3 .scene-text');
  if (sceneText) sceneText.style.display = '';
  // Reset slots
  document.querySelectorAll('#c3s3-slots .c3s3-slot').forEach(s => {
    s.classList.remove('filled');
    s.textContent = '';
  });
  // Vide le feedback
  const fb = document.getElementById('c3s3-feedback');
  if (fb) fb.textContent = '';
  // Cache le bouton "Et la musique ?" — il ne réapparaîtra qu'à la complétion
  const actions = document.querySelector('#screen-c3s3 .answers-group');
  if (actions) actions.style.display = 'none';
}
function activateC3s3Game() {
  // Pas de playConsigne('c3s3') : Leon dit la consigne dans son dialogue (modifie).
  // Cache les dialogues
  const sceneText = document.querySelector('#screen-c3s3 .scene-text');
  if (sceneText) sceneText.style.display = 'none';
  // Génère les lettres mélangées (sauf si déjà présentes)
  const pool = document.getElementById('c3s3-letters');
  if (pool) {
    pool.innerHTML = '';
    const letters = _c3s3Shuffle(C3S3_WORD.split(''));
    letters.forEach((L, i) => {
      const btn = document.createElement('button');
      btn.className = 'c3s3-letter';
      btn.textContent = L;
      btn.dataset.letter = L;
      btn.dataset.idx = i;
      btn.onclick = () => c3s3TapLetter(btn);
      pool.appendChild(btn);
    });
  }
  // Affiche le panneau
  const panel = document.getElementById('c3s3-game');
  if (panel) panel.style.display = 'flex';
}
function c3s3TapLetter(btn) {
  if (!btn || btn.classList.contains('used')) return;
  const idx = state.c3s3LetterIndex || 0;
  const expected = C3S3_WORD[idx];
  const tapped = btn.dataset.letter;
  const fb = document.getElementById('c3s3-feedback');
  if (tapped !== expected) {
    btn.classList.add('shake');
    if (fb) fb.textContent = `Pas encore ! Cherche le « ${expected} »`;
    setTimeout(() => btn.classList.remove('shake'), 450);
    return;
  }
  // Bonne lettre : remplit la slot
  const slot = document.querySelectorAll('#c3s3-slots .c3s3-slot')[idx];
  if (slot) {
    slot.textContent = tapped;
    slot.classList.add('filled');
  }
  btn.classList.add('used');
  state.c3s3LetterIndex = idx + 1;
  if (fb) fb.textContent = '';
  if (state.c3s3LetterIndex >= C3S3_WORD.length) {
    completeC3s3Game();
  }
}
function completeC3s3Game() {
  const fb = document.getElementById('c3s3-feedback');
  if (fb) fb.textContent = '🎉 Bravo ! La machine a écrit BONJOUR !';
  // Révèle le bouton "Et la musique ?" pour passer à la suite
  const actions = document.querySelector('#screen-c3s3 .answers-group');
  if (actions) actions.style.display = '';
  if (typeof showBonusToast === 'function') {
    showBonusToast(state.c3s3GameAwarded ? '🎤 Bien joué !' : '🎤 Bien joué ! +1 ⭐');
  }
  if (!state.c3s3GameAwarded) {
    if (typeof addStars === 'function') addStars(1);
    state.c3s3GameAwarded = true;
    if (typeof saveState === 'function') saveState();
  }
}

// ============================================================
// c3s2 — Attrape les mots qui dansent
// ============================================================
const C3S2_WORDS = ['bonjour', 'chat', 'maman', 'école', 'jouer', 'oui', 'pizza', 'dodo', 'rire', 'soleil', 'merci', 'ami'];
const C3S2_TARGET = 7;
let _c3s2SpawnTimer = null;
let _c3s2Active = false;

function resetC3s2Game() {
  state.c3s2Caught = 0;
  if (typeof saveState === 'function') saveState();
  _c3s2Active = false;
  if (_c3s2SpawnTimer) { clearTimeout(_c3s2SpawnTimer); _c3s2SpawnTimer = null; }
  const arena = document.getElementById('c3s2-arena');
  if (arena) { arena.innerHTML = ''; arena.style.display = 'none'; }
  const panel = document.getElementById('c3s2-game');
  if (panel) panel.style.display = 'none';
  // Restaure le texte initial de la consigne
  const instr = document.querySelector('#c3s2-game .c3s2-instr');
  if (instr) instr.innerHTML = '🎤 <strong>Attrape les mots qui dansent&nbsp;!</strong>';
  const counter = document.getElementById('c3s2-caught');
  if (counter) counter.textContent = '0';
  const sceneText = document.querySelector('#screen-c3s2 .scene-text');
  if (sceneText) sceneText.style.display = '';
  // Cache le bouton "Trop fort !" — il ne réapparaîtra qu'à la complétion du mini-jeu
  const actions = document.querySelector('#screen-c3s2 .answers-group');
  if (actions) actions.style.display = 'none';
}

function activateC3s2Game() {
  // Cache le bouton "Trop fort !" pour empêcher de sauter le jeu
  const actions = document.querySelector('#screen-c3s2 .answers-group');
  if (actions) actions.style.display = 'none';
  // Petit délai après la fin de Léon pour laisser respirer la scène
  setTimeout(() => {
    // Pas de playConsigne('c3s2') : Leon dit deja la consigne dans son dialogue.
    const sceneText = document.querySelector('#screen-c3s2 .scene-text');
    if (sceneText) sceneText.style.display = 'none';
    const arena = document.getElementById('c3s2-arena');
    const panel = document.getElementById('c3s2-game');
    if (arena) arena.style.display = 'block';
    if (panel) panel.style.display = 'inline-flex';
    _c3s2Active = true;
    // Spawn de depart rapide : 3 bulles d'amorce echelonnees
    _c3s2ScheduleSpawn(200);
    setTimeout(() => { if (_c3s2Active) _c3s2SpawnBubble(); }, 600);
    setTimeout(() => { if (_c3s2Active) _c3s2SpawnBubble(); }, 1100);
  }, 600);
}

function _c3s2ScheduleSpawn(delay) {
  if (!_c3s2Active) return;
  _c3s2SpawnTimer = setTimeout(() => {
    _c3s2SpawnBubble();
    // Cadence de spawn plus rapide : 750-1300ms (au lieu de 1300-2100ms)
    if (_c3s2Active) _c3s2ScheduleSpawn(750 + Math.random() * 550);
  }, delay);
}

function _c3s2SpawnBubble() {
  const arena = document.getElementById('c3s2-arena');
  if (!arena) return;
  const word = C3S2_WORDS[Math.floor(Math.random() * C3S2_WORDS.length)];
  const b = document.createElement('div');
  b.className = 'c3s2-bubble';
  b.textContent = word;
  // Position horizontale aléatoire (10% à 80% pour rester dans l'écran)
  b.style.left = (10 + Math.random() * 70) + '%';
  // v667 : pointerdown au lieu de onclick. La bulle bouge continuellement
  // (anim 'bottom'). Avec onclick, si mousedown et mouseup ne sont pas sur
  // le MEME element, le click est annule -> il fallait cliquer 2 fois.
  // pointerdown se declenche des le contact, couvre souris ET tactile.
  b.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    _c3s2PopBubble(b);
  }, { passive: false });
  arena.appendChild(b);
  // Auto-cleanup après l'animation (v664 : anim 12s -> cleanup 12.2s).
  setTimeout(() => { if (b.parentNode) b.parentNode.removeChild(b); }, 12200);
}

function _c3s2PopBubble(b) {
  if (!b || b.classList.contains('popped')) return;
  b.classList.add('popped');
  state.c3s2Caught = (state.c3s2Caught || 0) + 1;
  const counter = document.getElementById('c3s2-caught');
  if (counter) counter.textContent = state.c3s2Caught;
  setTimeout(() => { if (b.parentNode) b.parentNode.removeChild(b); }, 460);
  if (state.c3s2Caught >= C3S2_TARGET) {
    completeC3s2Game();
  }
}

// ============================================================
// c4s2 — Pose 3 questions à Bot (tap ou voix)
// ============================================================
const C4S2_QUESTIONS = {
  ciel:     { keywords: ['ciel', 'couleur'],         answer: 'Le ciel est bleu ! ☀️ Sauf le soir où il devient orange et rose.' },
  chat:     { keywords: ['chat', 'miaou', 'miaule'], answer: 'Miaou ! 🐱 Et il ronronne quand il est content.' },
  etoiles:  { keywords: ['étoile', 'etoile', 'étoiles', 'etoiles'], answer: 'Plein plein plein ! ✨ Il y en a tellement qu\'on ne peut pas les compter.' },
  chocolat: { keywords: ['chocolat'],                answer: 'C\'est sucré et marron ! 🍫 Mais doucement les caries !' }
};
let _c4s2Recognition = null;
let _c4s2Listening = false;
let _c4s2TypewriterTimer = null;
let _c4s2PendingQid = null; // v443 : qid en attente, declenche dans SR.onend (iOS audio session)

function resetC4s2Game() {
  state.c4s2QuestionsAsked = [];
  if (typeof saveState === 'function') saveState();
  // Stoppe la reco vocale si en cours
  _c4s2StopMic();
  // Stoppe le typewriter si en cours
  if (_c4s2TypewriterTimer) { clearTimeout(_c4s2TypewriterTimer); _c4s2TypewriterTimer = null; }
  const pill   = document.getElementById('c4s2-game-pill');
  const bubble = document.getElementById('c4s2-bot-bubble');
  const micRow = document.getElementById('c4s2-mic-row');
  const qs     = document.getElementById('c4s2-questions');
  const acts   = document.getElementById('c4s2-actions');
  if (pill)   pill.style.display   = 'none';
  if (bubble) bubble.style.display = 'none';
  if (micRow) micRow.style.display = 'none';
  if (qs)     qs.style.display     = 'none';
  if (acts)   acts.style.display   = 'none';
  // Stoppe la vidéo de Bot
  const botVid = document.getElementById('c4s2-bot-video');
  if (botVid) { try { botVid.pause(); botVid.currentTime = 0; } catch(e) {} }
  // Reset cartes
  document.querySelectorAll('#c4s2-questions .c4s2-q-card').forEach(c => c.classList.remove('used'));
  // Reset compteur
  const counter = document.getElementById('c4s2-asked-count');
  if (counter) counter.textContent = '0';
  // Restaure consigne
  const instr = document.querySelector('#c4s2-game-pill .c4s2-instr');
  if (instr) instr.innerHTML = '🤖 <strong>Pose 3 questions à Bot — tape ou parle&nbsp;!</strong>';
  // Vide la bulle
  const text = document.getElementById('c4s2-bot-text');
  if (text) { text.textContent = ''; text.classList.remove('thinking'); }
  // Reset mic button
  const micBtn   = document.getElementById('c4s2-mic-btn');
  const micLabel = document.getElementById('c4s2-mic-label');
  if (micBtn) micBtn.classList.remove('listening');
  if (micLabel) micLabel.textContent = 'Pose ta question à voix haute';
  const sceneText = document.querySelector('#screen-c4s2 .scene-text');
  if (sceneText) sceneText.style.display = '';
}

function activateC4s2Game() {
  // Pas de playConsigne('c4s2') : Leon dit la consigne dans son dialogue (modifie).
  const sceneText = document.querySelector('#screen-c4s2 .scene-text');
  if (sceneText) sceneText.style.display = 'none';
  document.getElementById('c4s2-game-pill').style.display = 'inline-flex';
  document.getElementById('c4s2-questions').style.display = 'grid';
  // Mic seulement si l'API est dispo
  if (_c4s2HasSpeechAPI()) {
    document.getElementById('c4s2-mic-row').style.display = 'block';
  }
  // Wire cartes
  document.querySelectorAll('#c4s2-questions .c4s2-q-card').forEach(c => {
    c.onclick = () => c4s2AskQuestion(c.dataset.qid, c);
  });
}

function _c4s2HasSpeechAPI() {
  if (typeof window === 'undefined') return false;
  // L'API existe ?
  const hasAPI = 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
  if (!hasAPI) return false;
  // Contexte securise requis : HTTPS ou localhost. file:// est BLOQUE par Chrome/FF.
  // window.isSecureContext est l'indicateur officiel.
  if (typeof window.isSecureContext !== 'undefined' && !window.isSecureContext) {
    return false;
  }
  // Backup : explicitement detecte file://
  if (location && location.protocol === 'file:') return false;
  // v439 : revert v438. iOS Safari 14.5+ supporte SpeechRecognition (vrai).
  // Le bug user etait probablement un permission denied silencieux, pas
  // l API. On garde le bouton micro et on ameliore le handling d erreur.
  return true;
}

function c4s2ToggleMic() {
  if (_c4s2Listening) {
    _c4s2StopMic();
    return;
  }
  if (!_c4s2HasSpeechAPI()) return;
  // v442 : warm-up speechSynthesis DANS le user gesture du clic mic. Sans ca,
  // sur iOS, le speak() appele plus tard depuis onresult (callback async du
  // SpeechRecognition, hors user gesture) echoue silencieusement -> Bot muet
  // lors de la premiere question posee a la voix. L utterance speak() ici
  // debloque le TTS pour la session.
  try {
    if (typeof window.speechSynthesis !== 'undefined') {
      const warm = new SpeechSynthesisUtterance(' ');
      warm.volume = 0;
      warm.rate = 10; // ultra-rapide pour finir vite
      window.speechSynthesis.speak(warm);
    }
  } catch(e) {}
  // v441 : sur iOS, le prompt de permission micro n est pas affichable
  // quand on est en plein ecran (FS API cache la UI systeme). On exit
  // d abord le FS, puis on lance la recognition. Pas de re-entree auto
  // (le user peut re-cliquer le bouton FS si besoin).
  const isIOS = typeof _isIOSDevice === 'function' && _isIOSDevice();
  if (isIOS && typeof _fsElement === 'function' && _fsElement()) {
    if (typeof _fsExit === 'function') {
      try { _fsExit(); } catch(e) {}
    }
    // Petit message visible pour expliquer
    const label = document.getElementById('c4s2-mic-label');
    if (label) label.textContent = 'Autorise le micro puis re-clique';
    // On laisse le user re-cliquer apres avoir autorise (le prompt
    // s affiche maintenant que le FS est exit). Pas de start() ici car
    // FS exit + start() simultanes ne marche pas iOS.
    return;
  }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  try {
    _c4s2Recognition = new SR();
    _c4s2Recognition.lang = 'fr-FR';
    _c4s2Recognition.interimResults = false;
    _c4s2Recognition.maxAlternatives = 3;
    _c4s2Recognition.onstart = () => {
      _c4s2Listening = true;
      const btn   = document.getElementById('c4s2-mic-btn');
      const label = document.getElementById('c4s2-mic-label');
      if (btn) btn.classList.add('listening');
      if (label) label.textContent = '👂 Je t\'écoute…';
    };
    _c4s2Recognition.onresult = (ev) => {
      // Stop SR explicitement apres reception du resultat. Sans ca, SR
      // continue d'ecouter et le bouton mic reste 'actif' — le user pense
      // qu'il doit re-cliquer pour activer alors qu'il desactive.
      try { _c4s2Recognition.stop(); } catch(e) {}
      const transcript = (ev.results[0][0].transcript || '').toLowerCase();
      console.log('[c4s2] heard:', transcript);
      const matched = _c4s2MatchQuestion(transcript);
      if (matched) {
        // v443 : sur iOS, le speechSynthesis ne marche pas tant que SR tient
        // l audio session. _c4s2Recognition.stop() est async -> on memorise
        // la question et on attend onend (= SR fully released) avant de
        // declencher c4s2AskQuestion (qui appelle speak()).
        _c4s2PendingQid = matched;
      } else {
        _c4s2HintNoMatch();
      }
    };
    _c4s2Recognition.onerror = (ev) => {
      console.warn('[c4s2] mic error:', ev.error);
      _c4s2StopMic();
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
        // v439 : message visible au user quand permission micro refusee (iOS surtout).
        // L'enfant ne sait pas pourquoi le bouton ne marche pas - on l aide.
        const label = document.getElementById('c4s2-mic-label');
        if (label) {
          const isIOS = typeof _isIOSDevice === 'function' && _isIOSDevice();
          label.textContent = isIOS
            ? 'Microphone bloque : Reglages > Safari > Microphone'
            : 'Microphone refuse — utilise les cartes ci-dessus';
        }
        _c4s2HideMic();
      } else if (ev.error === 'no-speech') {
        // Pas d audio detecte — message court, on garde le bouton actif
        const label = document.getElementById('c4s2-mic-label');
        if (label) label.textContent = 'Je n ai rien entendu, re-essaie';
      }
    };
    _c4s2Recognition.onend = () => {
      _c4s2StopMic();
      // v443 : SR pleinement libere -> on peut maintenant declencher la question
      // (qui appelle speechSynthesis.speak()). Sur iOS, speak() avant onend est
      // bloque car SR tient encore l audio session.
      if (_c4s2PendingQid) {
        const qid = _c4s2PendingQid;
        _c4s2PendingQid = null;
        const card = document.querySelector(`#c4s2-questions .c4s2-q-card[data-qid="${qid}"]`);
        // Petit delai pour laisser le browser finir de relacher l audio session
        setTimeout(() => c4s2AskQuestion(qid, card), 100);
      }
    };
    _c4s2Recognition.start();
  } catch(e) {
    console.warn('[c4s2] mic init failed:', e);
    // On NE cache PAS le mic : l'utilisateur peut retenter (typique sur
    // Android quand on relance un SR juste apres un stop precedent).
    _c4s2StopMic();
  }
}

function _c4s2StopMic() {
  if (_c4s2Recognition) {
    try { _c4s2Recognition.stop(); } catch(e) {}
    _c4s2Recognition = null;
  }
  _c4s2Listening = false;
  const btn   = document.getElementById('c4s2-mic-btn');
  const label = document.getElementById('c4s2-mic-label');
  if (btn) btn.classList.remove('listening');
  if (label) label.textContent = 'Pose ta question à voix haute';
}

function _c4s2HideMic() {
  const row = document.getElementById('c4s2-mic-row');
  if (row) row.style.display = 'none';
}
// v374 : re-affiche le mic-row (uniquement si l'API vocale est dispo, comme
// a l'activation du jeu). Utilise apres la reponse de Bot.
function _c4s2ShowMic() {
  if (!_c4s2HasSpeechAPI()) return;
  const row = document.getElementById('c4s2-mic-row');
  if (row) row.style.display = 'block';
}

function _c4s2MatchQuestion(transcript) {
  // Ne reproposer que les questions pas encore posees
  const asked = state.c4s2QuestionsAsked || [];
  for (const [qid, q] of Object.entries(C4S2_QUESTIONS)) {
    if (asked.indexOf(qid) !== -1) continue;
    for (const kw of q.keywords) {
      if (transcript.indexOf(kw) !== -1) return qid;
    }
  }
  return null;
}

function _c4s2HintNoMatch() {
  const text = document.getElementById('c4s2-bot-text');
  const bubble = document.getElementById('c4s2-bot-bubble');
  if (!text || !bubble) return;
  bubble.style.display = 'flex';
  text.classList.remove('thinking');
  text.textContent = 'Hmm, je n\'ai pas bien entendu… Touche une question 👇 ou réessaie !';
  // efface après 3s
  if (_c4s2TypewriterTimer) clearTimeout(_c4s2TypewriterTimer);
  _c4s2TypewriterTimer = setTimeout(() => {
    if (text.textContent.startsWith('Hmm')) text.textContent = '';
  }, 3000);
}

function c4s2AskQuestion(qid, cardEl) {
  if (!qid || !C4S2_QUESTIONS[qid]) return;
  const asked = state.c4s2QuestionsAsked || [];
  if (asked.indexOf(qid) !== -1) return; // déjà posée
  asked.push(qid);
  state.c4s2QuestionsAsked = asked;
  if (cardEl) cardEl.classList.add('used');
  const answer = C4S2_QUESTIONS[qid].answer;
  // v440 : iOS Safari exige que speechSynthesis.speak() soit appele DIRECTEMENT
  // dans le user gesture (pas via setTimeout). v437 warm-up (volume 0) ne suffit
  // pas chez certains users. On lance maintenant le TTS IMMEDIATEMENT dans le
  // click handler, et on garde le delai de 1.2s 'Bot reflechit' juste pour le
  // typewriter visuel.
  _c4s2SpeakAsBot(answer);
  // v374 : pendant que Bot reflechit + repond, on cache la bulle "Pose ta
  // question a voix haute" (mic-row) — elle sera reaffichee a la fin du
  // typewriter (cf. _c4s2Typewriter), sauf si c'etait la 3e question.
  _c4s2HideMic();
  // Phase 1 : Bot réfléchit
  const bubble = document.getElementById('c4s2-bot-bubble');
  const text   = document.getElementById('c4s2-bot-text');
  const video  = document.getElementById('c4s2-bot-video');
  if (bubble) bubble.style.display = 'flex';
  if (text)   { text.textContent = ''; text.classList.add('thinking'); }
  // Lance la vidéo de Bot qui parle (en loop)
  if (video) {
    try { video.currentTime = 0; video.play().catch(()=>{}); } catch(e) {}
  }
  if (_c4s2TypewriterTimer) clearTimeout(_c4s2TypewriterTimer);
  _c4s2TypewriterTimer = setTimeout(() => {
    // Phase 2 : Bot répond avec typewriter (la voix tourne deja en parallele)
    if (text) { text.classList.remove('thinking'); text.textContent = ''; }
    _c4s2Typewriter(answer, 0);
  }, 1200);
}

// SpeechSynthesis pour la voix de Bot (pitch + rate ajustes pour rendre robotique)
function _c4s2SpeakAsBot(text) {
  if (typeof window.speechSynthesis === 'undefined') {
    // Pas de TTS : reaffiche le mic apres un delai estime (texte / 15 chars/s min 2s)
    const delay = Math.max(2000, text.length * 66);
    setTimeout(() => { const c = (state.c4s2QuestionsAsked||[]).length; if (c < 3) _c4s2ShowMic(); }, delay);
    return;
  }
  // Strip emoji + symboles non-textuels pour ne pas les faire lire a voix haute
  const cleanText = _stripEmoji(text);
  // v443 : sur iOS, speechSynthesis peut etre 'stuck' apres usage du
  // SpeechRecognition (les 2 partagent l audio session). cancel() + resume()
  // resetent l etat avant speak(). Necessaire pour les questions posees a
  // la voix (sinon Bot reste muet meme apres warm-up).
  try { window.speechSynthesis.cancel(); } catch(e) {}
  try { window.speechSynthesis.resume(); } catch(e) {}
  {
    const utt = new SpeechSynthesisUtterance(cleanText);
    utt.lang = 'fr-FR';
    // v374 : pitch 2.0 + rate 0.7 etaient des EXTREMES — sur Samsung le moteur
    // TTS les gere tres mal (voix stridente / distordue "horrible"). On
    // tempere : pitch 1.15 (encore robotique mais pas criard), rate 0.92.
    utt.pitch = 1.15;
    utt.rate  = 0.92;
    utt.volume = 1;
    try {
      const voices = window.speechSynthesis.getVoices();
      // v374 : priorite aux voix "Google" (consistantes Pixel/Samsung/autres),
      // PUIS compact/enhanced en secours, puis n'importe quelle voix fr.
      // Avant, "compact" etait prefere -> tombait sur la voix Samsung horrible.
      const googleFr  = voices.find(v => v.lang && v.lang.startsWith('fr') && /google/i.test(v.name));
      const compactFr = voices.find(v => v.lang && v.lang.startsWith('fr') && /compact|enhanced/i.test(v.name));
      const anyFr     = voices.find(v => v.lang && v.lang.startsWith('fr'));
      const chosen = googleFr || compactFr || anyFr;
      if (chosen) utt.voice = chosen;
    } catch(e) {}
    utt.onerror = (ev) => console.warn('[c4s2] tts error:', ev.error);
    // v381 : quand Bot a FINI de parler -> reafficher le mic
    let _onEndFired = false;
    utt.onend = () => {
      _onEndFired = true;
      const count = (state.c4s2QuestionsAsked || []).length;
      if (count < 3) _c4s2ShowMic();
    };
    // v437 : fallback iOS Safari ou utt.onend ne fire pas toujours fiable.
    // On reaffiche le mic apres la duree estimee + marge, sauf si onend
    // a deja fire. Estimation : ~13 chars/seconde + 800ms marge.
    const estimatedMs = Math.max(2000, cleanText.length * 77 + 800);
    setTimeout(() => {
      if (_onEndFired) return;
      const count = (state.c4s2QuestionsAsked || []).length;
      if (count < 3) _c4s2ShowMic();
    }, estimatedMs);
    // Garde une reference pour eviter le garbage collection precoce
    window._c4s2Utterance = utt;
    window.speechSynthesis.speak(utt);
  }
}

// Retire emojis + symboles pictographiques pour ne pas les faire lire en TTS.
function _stripEmoji(text) {
  if (!text) return '';
  // Plage Unicode des emojis : \p{Extended_Pictographic} couvre tous les emojis.
  // Fallback regex simple pour les nav qui ne supportent pas \p{...}.
  try {
    return text.replace(/\p{Extended_Pictographic}/gu, '').replace(/\s+/g, ' ').trim();
  } catch(e) {
    return text.replace(/[\uD83C-􏰀-\uDFFF☀-➿️]/g, '').replace(/\s+/g, ' ').trim();
  }
}

function _c4s2Typewriter(fullText, i) {
  const text = document.getElementById('c4s2-bot-text');
  if (!text) return;
  if (i >= fullText.length) {
    // Compteur + check completion
    const counter = document.getElementById('c4s2-asked-count');
    const count = (state.c4s2QuestionsAsked || []).length;
    if (counter) counter.textContent = count;
    // Pause la vidéo de Bot une fois la réponse terminée (laisse 1s avant)
    _c4s2TypewriterTimer = setTimeout(() => {
      const video = document.getElementById('c4s2-bot-video');
      if (video) { try { video.pause(); } catch(e) {} }
    }, 1000);
    if (count >= 3) {
      setTimeout(() => completeC4s2Game(), 1500);
    }
    // v381 : le mic sera reaffiche via utt.onend (quand Bot finit de parler),
    // pas ici — sinon le bouton reapparait avant la fin du discours de Bot.
    return;
  }
  text.textContent = fullText.slice(0, i + 1);
  _c4s2TypewriterTimer = setTimeout(() => _c4s2Typewriter(fullText, i + 1), 32);
}

function completeC4s2Game() {
  _c4s2StopMic();
  // Cache mic + cartes
  const micRow = document.getElementById('c4s2-mic-row');
  const qs     = document.getElementById('c4s2-questions');
  if (micRow) micRow.style.display = 'none';
  if (qs)     qs.style.display     = 'none';
  // Pill célébration
  const instr = document.querySelector('#c4s2-game-pill .c4s2-instr');
  if (instr) instr.innerHTML = '🎉 <strong>Bravo&nbsp;! Tu sais comment discuter avec une IA&nbsp;!</strong>';
  // Révèle bouton continue
  const acts = document.getElementById('c4s2-actions');
  if (acts) acts.style.display = '';
  if (typeof showBonusToast === 'function') {
    showBonusToast(state.c4s2GameAwarded ? '🤖 Bien joué !' : '🤖 Discussion réussie ! +1 ⭐');
  }
  if (!state.c4s2GameAwarded) {
    if (typeof addStars === 'function') addStars(1);
    state.c4s2GameAwarded = true;
    if (typeof saveState === 'function') saveState();
  }
}

// ============================================================
// c3s5 — Choisis 3 notes, l'IA invente une mélodie
// ============================================================
const C3S5_FREQ = [261.63, 293.66, 329.63, 349.23, 392.00, 440.00, 493.88]; // Do Ré Mi Fa Sol La Si
const C3S5_EMOJI = ['🎵','🎶','🎼','♪','♫','🎵','🎶'];
let _c3s5AudioCtx = null;
let _c3s5Composing = false; // bloque les inputs pendant la phase IA
function _c3s5GetCtx() {
  if (!_c3s5AudioCtx) {
    try { _c3s5AudioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch(e) { _c3s5AudioCtx = null; }
  }
  return _c3s5AudioCtx;
}
function _c3s5PlayNote(idx, durationMs = 380, gainPeak = 0.18) {
  const ctx = _c3s5GetCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') { try { ctx.resume(); } catch(e){} }
  const freq = C3S5_FREQ[idx];
  if (!freq) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle'; // doux pour les oreilles d'enfant
  osc.frequency.setValueAtTime(freq, now);
  // Enveloppe ADSR simple
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(gainPeak, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + durationMs / 1000 + 0.05);
  // Anim visuelle de la touche
  const key = document.querySelector(`#c3s5-keyboard .c3s5-key[data-note="${idx}"]`);
  if (key) {
    key.classList.add('played');
    setTimeout(() => key.classList.remove('played'), durationMs);
  }
  _c3s5SpawnFloatingNote(idx);
}
function _c3s5SpawnFloatingNote(idx) {
  const arena = document.getElementById('c3s5-floating-notes');
  if (!arena) return;
  const span = document.createElement('span');
  span.className = 'c3s5-fnote';
  span.textContent = C3S5_EMOJI[idx % C3S5_EMOJI.length];
  // Position horizontale alignée avec la touche
  span.style.left = (12 + (idx / 6) * 76) + '%';
  arena.appendChild(span);
  setTimeout(() => { if (span.parentNode) span.parentNode.removeChild(span); }, 2700);
}
function resetC3s5Game() {
  state.c3s5NotesPicked = [];
  if (typeof saveState === 'function') saveState();
  _c3s5Composing = false;
  const pill = document.getElementById('c3s5-game-pill');
  const kbd  = document.getElementById('c3s5-keyboard');
  const acts = document.getElementById('c3s5-actions');
  const fn   = document.getElementById('c3s5-floating-notes');
  if (pill) pill.style.display = 'none';
  if (kbd)  kbd.style.display  = 'none';
  if (fn)   fn.innerHTML       = '';
  if (acts) acts.style.display = 'none';
  // Restaure consigne par défaut
  const instr = document.querySelector('#c3s5-game-pill .c3s5-instr');
  if (instr) instr.innerHTML = '🎵 <strong>Choisis 3 notes — l\'IA va inventer une chanson&nbsp;!</strong>';
  const counter = document.getElementById('c3s5-picked-count');
  if (counter) counter.textContent = '0';
  // Reset visuel des touches
  document.querySelectorAll('#c3s5-keyboard .c3s5-key').forEach(k => {
    k.classList.remove('picked', 'played');
    k.disabled = false;
    const num = k.querySelector('.c3s5-key-num');
    if (num) num.remove();
  });
  const sceneText = document.querySelector('#screen-c3s5 .scene-text');
  if (sceneText) sceneText.style.display = '';
}
function activateC3s5Game() {
  // Pas de playConsigne('c3s5') : Leon dit la consigne dans son dialogue (modifie).
  const sceneText = document.querySelector('#screen-c3s5 .scene-text');
  if (sceneText) sceneText.style.display = 'none';
  const pill = document.getElementById('c3s5-game-pill');
  const kbd  = document.getElementById('c3s5-keyboard');
  if (pill) pill.style.display = 'inline-flex';
  if (kbd)  kbd.style.display  = 'grid';
  // Wire up des touches
  document.querySelectorAll('#c3s5-keyboard .c3s5-key').forEach(k => {
    k.onclick = () => c3s5TapKey(parseInt(k.dataset.note, 10), k);
  });
}
function c3s5TapKey(noteIdx, keyEl) {
  if (_c3s5Composing) return;
  const picked = state.c3s5NotesPicked || [];
  if (picked.length >= 3) return;
  // Empêche de retaper la même touche
  if (picked.indexOf(noteIdx) !== -1) return;
  picked.push(noteIdx);
  state.c3s5NotesPicked = picked;
  // Joue la note
  _c3s5PlayNote(noteIdx, 420);
  // Marque visuellement la touche
  if (keyEl) {
    keyEl.classList.add('picked');
    keyEl.disabled = true;
    const num = document.createElement('span');
    num.className = 'c3s5-key-num';
    num.textContent = picked.length;
    keyEl.appendChild(num);
  }
  const counter = document.getElementById('c3s5-picked-count');
  if (counter) counter.textContent = picked.length;
  if (picked.length >= 3) {
    setTimeout(() => _c3s5IACompose(picked), 700);
  }
}
function _c3s5IACompose(notes) {
  _c3s5Composing = true;
  const instr = document.querySelector('#c3s5-game-pill .c3s5-instr');
  if (instr) instr.innerHTML = '🎶 <strong>L\'IA invente une chanson avec tes notes…</strong>';
  const [n0, n1, n2] = notes;
  // Composition en 6 phrases distinctes (~10s total).
  // Chaque tuple = { idx, dur (ms), dt (ms depuis le début), g (gain peak optionnel) }
  const sequence = [
    // Phrase 1 — exposition lente, valeur "thème"
    { idx: n0, dur: 420, dt: 0    },
    { idx: n1, dur: 420, dt: 460  },
    { idx: n2, dur: 540, dt: 920  },

    // Phrase 2 — inversion (miroir)
    { idx: n2, dur: 320, dt: 1700 },
    { idx: n1, dur: 320, dt: 2020 },
    { idx: n0, dur: 320, dt: 2340 },

    // Phrase 3 — arpège rapide (croches)
    { idx: n0, dur: 160, dt: 2900 },
    { idx: n1, dur: 160, dt: 3070 },
    { idx: n2, dur: 160, dt: 3240 },
    { idx: n1, dur: 160, dt: 3410 },
    { idx: n0, dur: 160, dt: 3580 },
    { idx: n2, dur: 160, dt: 3750 },

    // Phrase 4 — écho doux (gain réduit)
    { idx: n1, dur: 240, dt: 4250, g: 0.10 },
    { idx: n2, dur: 240, dt: 4490, g: 0.10 },

    // Phrase 5 — variation rythmique syncopée
    { idx: n0, dur: 200, dt: 5050 },
    { idx: n2, dur: 200, dt: 5350 },
    { idx: n1, dur: 200, dt: 5550 },
    { idx: n0, dur: 200, dt: 5850 },
    { idx: n2, dur: 200, dt: 6050 },

    // Phrase 6 — montée crescendo + accord final
    { idx: n0, dur: 220, dt: 6700 },
    { idx: n1, dur: 220, dt: 6920 },
    { idx: n2, dur: 220, dt: 7140 },
    { idx: n0, dur: 900, dt: 7600, g: 0.22 }, // basse longue
    { idx: n1, dur: 900, dt: 7700, g: 0.22 }, // accord avec n0 + n1 + n2
    { idx: n2, dur: 900, dt: 7800, g: 0.22 }
  ];
  sequence.forEach(s => setTimeout(() => _c3s5PlayNote(s.idx, s.dur, s.g || 0.18), s.dt));
  // Fin de la composition (~9s)
  setTimeout(() => completeC3s5Game(), 9000);
}
function completeC3s5Game() {
  _c3s5Composing = false;
  const instr = document.querySelector('#c3s5-game-pill .c3s5-instr');
  if (instr) instr.innerHTML = '🎉 <strong>Bravo&nbsp;! L\'IA a composé une mélodie avec tes 3 notes&nbsp;!</strong>';
  const acts = document.getElementById('c3s5-actions');
  if (acts) acts.style.display = '';
  if (typeof showBonusToast === 'function') {
    showBonusToast(state.c3s5GameAwarded ? '🎵 Bien joué !' : '🎵 Belle compo ! +1 ⭐');
  }
  if (!state.c3s5GameAwarded) {
    if (typeof addStars === 'function') addStars(1);
    state.c3s5GameAwarded = true;
    if (typeof saveState === 'function') saveState();
  }
}

// ============================================================
// screen-4 — Reconnaître les vrais arbres (apprentissage par caractéristiques)
// ============================================================
// "tree" est gardé comme nom interne mais représente "feature valide du chat" (refactor minimal)
const S4_CARDS = [
  { emoji: '🐾', tree: true,  label: 'pattes' },
  { emoji: '〰️', tree: true,  label: 'moustaches' },
  { emoji: '👂', tree: true,  label: 'oreilles pointues' },
  { emoji: '➿', tree: true,  label: 'queue' },
  { emoji: '🪶', tree: false, label: 'plumes' },
  { emoji: '🐚', tree: false, label: 'coquille' }
];
const S4_TARGET = 4;
function _s4Shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function resetS4Game() {
  state.s4TreesFound = 0;
  if (typeof saveState === 'function') saveState();
  const pill    = document.getElementById('s4-game-pill');
  const cards   = document.getElementById('s4-cards');
  const reveal  = document.getElementById('s4-reveal');
  const checks  = document.getElementById('s4-checks');
  const silh    = document.getElementById('s4-silhouette');
  const ans     = document.getElementById('s4-answers');
  if (pill)   pill.style.display   = 'none';
  if (cards)  { cards.style.display  = 'none'; cards.innerHTML = ''; }
  if (reveal) reveal.style.display = 'none';
  if (checks) checks.innerHTML = '';
  if (silh)   silh.classList.remove('revealed');
  if (ans)    ans.classList.remove('show');
  const counter = document.getElementById('s4-trees-found');
  if (counter) counter.textContent = '0';
  // Restaure la consigne d'origine
  const instr = document.querySelector('#s4-game-pill .s4-instr');
  if (instr) instr.innerHTML = '🔍 <strong>Pour reconnaître un chat, qu\'a appris la machine&nbsp;? Tape les bonnes caractéristiques&nbsp;!</strong>';
}
function activateS4Game() {
  // Pas de playConsigne('s4') : Leon dit la consigne dans son dialogue
  // ('Tape les bonnes caracteristiques !').
  const pill   = document.getElementById('s4-game-pill');
  const cards  = document.getElementById('s4-cards');
  const reveal = document.getElementById('s4-reveal');
  // Cache la bulle de dialogue de Léon
  const sceneText = document.querySelector('#screen-4 .scene-4-text');
  if (sceneText) sceneText.style.display = 'none';
  // Génère les cartes mélangées (emoji + label)
  if (cards) {
    cards.innerHTML = '';
    const shuffled = _s4Shuffle(S4_CARDS);
    // v351 : Listeners directs per-button en bubble phase + global capture
    // existant. Le premier qui fire wins via _s4Handled (utilise par les deux).
    // Cas typique : global capture (pointerdown) fire en premier, marque
    // _s4Handled=true, l'event continue jusqu'au button mais le per-button
    // handler voit _s4Handled=true et return. Si global capture ECHOUE pour
    // une raison X (texte node bizarre, focus stole, etc.), per-button
    // attrape l'event direct.
    const _s4HandleBtn = (btn) => (ev) => {
      if (btn.classList.contains('found')) return;
      if (btn._s4Handled) return;
      btn._s4Handled = true;
      setTimeout(() => { btn._s4Handled = false; }, 400);
      s4TapCard(btn);
    };
    shuffled.forEach((c) => {
      const btn = document.createElement('button');
      btn.className = 's4-card';
      btn.dataset.tree = c.tree ? '1' : '0';
      btn.dataset.label = c.label;
      btn.setAttribute('aria-label', c.label);
      btn.type = 'button'; // explicite, evite que le button soit submit
      btn.innerHTML = `<div class="s4-card-emoji">${c.emoji}</div><div class="s4-card-label">${c.label}</div>`;
      // Listeners directs (multi-event pour robustesse). Premier qui fire wins.
      const h = _s4HandleBtn(btn);
      btn.addEventListener('pointerdown', h, { passive: true });
      btn.addEventListener('touchstart',  h, { passive: true });
      btn.addEventListener('click',       h);
      cards.appendChild(btn);
    });
    cards.style.display = 'grid';
  }
  if (reveal) reveal.style.display = 'flex';
  if (pill) pill.style.display = 'inline-flex';
}
// Capture global pour s4-card : on ecoute pointerdown + touchstart +
// mousedown + click au niveau du document en CAPTURE PHASE. Au moins
// UN de ces events doit attraper le tap meme si les autres sont avales
// par l'emoji multi-codepoint. Le flag _s4Handled (350ms) evite que
// les events redondants tirent plusieurs fois.
if (typeof window !== 'undefined' && !window._s4GlobalCaptureSetup) {
  window._s4GlobalCaptureSetup = true;
  const _s4Handle = (ev) => {
    // FIX v349 : sur certains Android Chrome, les emojis multi-codepoint
    // (ex: 〰️ = U+3030 + U+FE0F) sont rendus dans des text nodes que le
    // browser remet comme ev.target. Text nodes n'ont pas .closest, donc
    // l'ancien guard 'if (!ev.target.closest) return' filtrait ces taps.
    // On remonte au parent element avant de chercher .s4-card.
    let target = ev.target;
    if (target && target.nodeType === 3 /* TEXT_NODE */) target = target.parentElement;
    if (!target || typeof target.closest !== 'function') return;
    const card = target.closest('.s4-card');
    if (!card) return;
    if (card.classList.contains('found')) return;
    if (card._s4Handled) return;
    card._s4Handled = true;
    setTimeout(() => { card._s4Handled = false; }, 400);
    s4TapCard(card);
  };
  document.addEventListener('pointerdown', _s4Handle, true);
  document.addEventListener('touchstart',  _s4Handle, true);
  document.addEventListener('mousedown',   _s4Handle, true);
  document.addEventListener('click',       _s4Handle, true);
}

function s4TapCard(btn) {
  if (!btn || btn.classList.contains('found')) return;
  // Verification ROBUSTE : on relit la verite depuis S4_CARDS via le label
  // (defensive : evite tout decalage si dataset a ete altere par un tiers)
  const lbl = btn.dataset.label || '';
  const ref = S4_CARDS.find(c => c.label === lbl);
  const isFeature = ref ? !!ref.tree : (btn.dataset.tree === '1');
  if (!isFeature) {
    // Force le retrait de la classe avant remise (au cas ou un tap precedent
    // n'aurait pas fini son timeout sur mobile).
    btn.classList.remove('wrong');
    // Force un reflow pour relancer l'animation a chaque tap
    void btn.offsetWidth;
    btn.classList.add('wrong');
    setTimeout(() => btn.classList.remove('wrong'), 700);
    return;
  }
  btn.classList.add('found');
  state.s4TreesFound = (state.s4TreesFound || 0) + 1;
  const counter = document.getElementById('s4-trees-found');
  if (counter) counter.textContent = state.s4TreesFound;
  // Ajoute un check coloré dans la zone du chat
  const checks = document.getElementById('s4-checks');
  if (checks) {
    const c = document.createElement('span');
    c.className = 's4-check';
    c.textContent = '✓ ' + btn.dataset.label;
    checks.appendChild(c);
  }
  if (state.s4TreesFound >= S4_TARGET) {
    completeS4Game();
  }
}
function completeS4Game() {
  // Révèle la silhouette en couleur
  const silh = document.getElementById('s4-silhouette');
  if (silh) silh.classList.add('revealed');
  // Consigne célébration
  const instr = document.querySelector('#s4-game-pill .s4-instr');
  if (instr) instr.innerHTML = '🎉 <strong>Bravo&nbsp;! La machine sait maintenant reconnaître un chat&nbsp;!</strong>';
  // Révèle le bouton "J'ai compris"
  const ans = document.getElementById('s4-answers');
  if (ans) ans.classList.add('show');
  // Toast
  if (typeof showBonusToast === 'function') {
    showBonusToast(state.s4GameAwarded ? '🐱 Bien joué !' : '🐱 Bien joué ! +1 ⭐');
  }
  // +1 ⭐ one-shot
  if (!state.s4GameAwarded) {
    if (typeof addStars === 'function') addStars(1);
    state.s4GameAwarded = true;
    if (typeof saveState === 'function') saveState();
  }
}

function completeC3s2Game() {
  _c3s2Active = false;
  if (_c3s2SpawnTimer) { clearTimeout(_c3s2SpawnTimer); _c3s2SpawnTimer = null; }
  // Vide les bulles restantes
  const arena = document.getElementById('c3s2-arena');
  if (arena) {
    setTimeout(() => { arena.innerHTML = ''; arena.style.display = 'none'; }, 600);
  }
  // Met à jour le texte de la pill pour célébrer (toujours affiché, même si déjà gagné)
  const instr = document.querySelector('#c3s2-game .c3s2-instr');
  if (instr) instr.innerHTML = '🎉 <strong>Bravo, tu as tout attrapé&nbsp;!</strong>';
  // Révèle le bouton "Trop fort !" pour passer à la suite
  const actions = document.querySelector('#screen-c3s2 .answers-group');
  if (actions) actions.style.display = '';
  // Toast (toujours affiché)
  if (typeof showBonusToast === 'function') {
    showBonusToast(state.c3s2GameAwarded ? '🎤 Bien joué !' : '🎤 Mots attrapés ! +1 ⭐');
  }
  // +1 ⭐ one-shot
  if (!state.c3s2GameAwarded) {
    if (typeof addStars === 'function') addStars(1);
    state.c3s2GameAwarded = true;
    if (typeof saveState === 'function') saveState();
  }
}

// v385 : C4S5 — le coeur barre apparait a ~1s dans la video (pas a la fin).
// On demarre et on reloope depuis 1.5s pour le sauter proprement.
// IMPORTANT : ce rebouclage doit s'arreter quand Leon a fini de parler
// (sinon la video tourne pendant le memory game). On utilise un flag
// window._c4s5LoopOff que onLeonEnd (cf. screenDialogues) met a true.
document.addEventListener('DOMContentLoaded', () => {
  const v = document.getElementById('leon-video-c4s5');
  if (!v) return;
  const START = 1.5; // saut du coeur barre (apparait entre 0s et ~1.03s)
  function _c4s5Restart() {
    // Stop le rebouclage si Leon a fini de parler -> activateC4s5Game a tourne.
    if (window._c4s5LoopOff) { try { v.pause(); } catch(e) {} return; }
    v.currentTime = START;
    v.play().catch(() => {});
  }
  // Reset du flag a chaque (re)entree sur c4s5 : on rejoue la video pendant
  // Leon, puis on coupe a nouveau a la fin du dialogue.
  v.addEventListener('loadedmetadata', () => {
    if (v.currentTime < START) v.currentTime = START;
  });
  v.addEventListener('timeupdate', () => {
    if (window._c4s5LoopOff) return; // skip si Leon a fini
    if (v.duration && v.currentTime >= v.duration - 1.0) {
      _c4s5Restart();
    }
  });
  v.addEventListener('ended', _c4s5Restart);
});

// ============================================================
// FABRIQUE A HISTOIRES — v487 refonte complete
// ============================================================
// Architecture :
//  - PHASE 1 (pick) : selection 4 ingredients (hero, place, item, villain)
//  - PHASE 2 (loading) : transition rapide vers le livre
//  - PHASE 3 (book)   : livre 3D avec pages illustrees, flip horizontal
// Data : CREATOR_CATEGORIES (catalog 4x3) + CREATOR_STORIES (81 combos)
// Pour l instant : 1 histoire test hardcoded. Les 81 seront generees via
// script Python Claude + Leonardo (phase ulterieure).

const CREATOR_CATEGORIES = [
  {
    key: 'hero', title: '1. Le héros',
    items: [
      { value: 'astronaute', label: 'Astronaute', emoji: '🧑‍🚀' },
      { value: 'sorciere',   label: 'Sorcière',   emoji: '🧙‍♀️' },
      { value: 'dragon',     label: 'Dragon',     emoji: '🐉' }
    ]
  },
  {
    key: 'place', title: '2. Le lieu',
    items: [
      { value: 'planete', label: 'Planète', emoji: '🪐' },
      { value: 'chateau', label: 'Château', emoji: '🏰' },
      { value: 'ocean',   label: 'Océan',   emoji: '🌊' }
    ]
  },
  {
    key: 'item', title: '3. L\'objet magique',
    items: [
      { value: 'baguette',   label: 'Baguette',   emoji: '🪄' },
      { value: 'skateboard', label: 'Skateboard', emoji: '🛹' },
      { value: 'guitare',    label: 'Guitare',    emoji: '🎸' }
    ]
  },
  {
    key: 'villain', title: '4. Le défi',
    items: [
      { value: 'monstre', label: 'Monstre',  emoji: '👾' },
      { value: 'robot',   label: 'Robot fou', emoji: '🤖' },
      { value: 'fantome', label: 'Fantôme',  emoji: '👻' }
    ]
  }
];

// Catalogue des histoires. Cle = level_hero_place_item_villain (sans accents).
// Pour chaque combo, 3 niveaux possibles : 'courte' (3-4 pages), 'soir' (6
// pages), 'aventure' (8-10 pages). Pour l instant : quelques histoires de
// qualite ecrites manuellement, le reste fallback sur _buildPlaceholderStory.
const CREATOR_STORIES = {
  // Voyage extraordinaire (10 pages, ~20 min) - dragon + chateau + guitare + fantome
  'aventure_dragon_chateau_guitare_fantome': {
    title: 'Brio et la guitare des sept silences',
    pages: [
      { text: 'Brio n\'était pas un dragon comme les autres. D\'abord, il avait à peine la taille d\'un gros chat. Ensuite, ses écailles, au lieu d\'être rouges ou vertes, brillaient d\'un bleu très doux, comme le ciel juste après l\'orage. Et surtout, surtout, Brio n\'aimait pas cracher du feu. Cela faisait tousser les fleurs.<br><br>Depuis trois lunes, il vivait seul dans le château de Belmondrie. Une vraie ruine. Les murs étaient couverts de lierre, les fenêtres n\'avaient plus de carreaux, et le vent y jouait du saxophone sous les portes mal fermées. Mais Brio s\'y plaisait. Au moins, ici, personne ne lui demandait de cracher quoi que ce soit.<br><br>Ce soir-là, comme chaque soir, il se promenait dans la grande galerie. Ses petits pas griffus faisaient <em>clic-clac</em> sur les dalles. Tout à coup, il s\'arrêta net. Quelque chose brillait au fond du couloir. Quelque chose qui n\'y était pas la veille.', image: 'assets/stories/dragon_chateau_guitare_fantome/page1.jpg' },

      { text: 'C\'était une guitare. Posée sur un coussin de velours rouge, comme si quelqu\'un venait juste de la déposer. Elle était belle. Le bois sentait la résine et le miel. Ses cordes, au nombre de six, scintillaient d\'un éclat impossible — argenté, mais avec, par moments, des reflets violets et dorés.<br><br>Brio s\'approcha tout doucement. Quand il fut tout près, il vit une petite plaque gravée sous les cordes : <em>« Pour qui osera jouer les sept silences. »</em><br><br>Il tendit une griffe et, du bout, effleura la première corde. <em>Pliiing.</em> Une note pure jaillit, claire comme une cloche. Au même instant, dans toutes les pièces du château, les vieilles bougies fondues, qui n\'avaient pas brûlé depuis des siècles, se rallumèrent d\'un coup. Une à une.', image: 'assets/stories/dragon_chateau_guitare_fantome/page2.jpg' },

      { text: 'Cette nuit-là, Brio ne parvint pas à dormir. La guitare brillait doucement dans le noir. Vers minuit, il entendit. Une voix. Très faible. Très triste.<br><br><em>« Quelqu\'un… joue, je t\'en prie… »</em><br><br>Brio bondit. Aucune ombre, aucun visage. Juste la guitare, qui vibrait toute seule. Une seule corde tremblait, comme un cœur qui bat trop fort.<br><br>— Qui parle ? demanda Brio, en tâchant d\'avoir l\'air courageux.<br><br>Il prit la guitare entre ses pattes, ferma les yeux et gratta les six cordes l\'une après l\'autre. Un accord se forma. Étrange. Mélancolique. Et quelque part au fond du château, une porte fermée depuis très longtemps se mit lentement à grincer en s\'ouvrant.', image: 'assets/stories/dragon_chateau_guitare_fantome/page3.jpg' },

      { text: 'Brio suivit le son. Il marcha sur la pointe des griffes, descendit un escalier en colimaçon, et arriva dans un couloir qu\'il n\'avait jamais vu auparavant. Le couloir des miroirs.<br><br>Sur les murs, sept grands miroirs. Mais aucun ne reflétait Brio. Tous montraient autre chose : un atelier, un feu, des outils, une chaise vide, un chien endormi, une fenêtre ouverte sur la mer, et, dans le dernier, le visage flou d\'un vieil homme.<br><br>— Bonsoir, murmura Brio au miroir.<br><br>Le vieil homme tourna lentement la tête. Ses yeux étaient d\'un gris très clair. <em>« Tu joues, et tu vois. Cela faisait si longtemps. On m\'appelait Maître Otho. J\'ai fabriqué cette guitare. Voudrais-tu m\'aider à me souvenir ? »</em> Brio hocha vivement la tête.', image: 'assets/stories/dragon_chateau_guitare_fantome/page4.jpg' },

      { text: 'Brio gratta la deuxième corde. La porte au bout du couloir s\'ouvrit. C\'était un atelier. Des copeaux de bois jonchaient le sol, une lampe à huile clignotait sur l\'établi. Sur les murs, des dizaines d\'instruments en construction : luths, violons, mandolines. L\'air sentait la cire chaude.<br><br>Au milieu de l\'atelier, un fantôme se tenait debout. Maître Otho, mais en plus jeune, presque vivant. Il rabotait une planche.<br><br><em>« Toute ma vie, j\'ai construit des instruments. Pour que la musique entre dans les maisons. Mais j\'ai oublié pour qui je construisais. Et même mon propre nom, par instants. »</em><br><br>Brio sentit ses petites narines se mettre à piquer. Pas du feu — des larmes. Il n\'avait pas pleuré depuis très longtemps.<br><br>— Je vais vous aider, dit-il. Je vous le promets.', image: 'assets/stories/dragon_chateau_guitare_fantome/page5.jpg' },

      { text: 'Brio gratta la troisième corde. Le décor s\'effaça. Une salle de bal immense apparut. Le sol noir et blanc brillait sous des centaines de bougies. Des dames en robe longue tournoyaient avec des messieurs en habit.<br><br>Au centre, sur une estrade, Maître Otho jouait. Sa guitare paraissait neuve, vivante, presque heureuse. Le fantôme souriait, comme s\'il avait oublié qu\'il était fantôme.<br><br>— C\'est ici que vous étiez heureux ?<br><br><em>« Le bal des longues nuits. On m\'invitait, chaque hiver, pour jouer jusqu\'à l\'aube. Les enfants dormaient enroulés sous les bancs, et les vieux dansaient comme des jeunes. C\'est la dernière fois que j\'ai été heureux. Après, il y a eu… »</em><br><br>Il s\'arrêta. Brio comprit qu\'il fallait jouer la corde suivante. Mais il avait peur de la suite.', image: 'assets/stories/dragon_chateau_guitare_fantome/page6.jpg' },

      { text: 'La quatrième corde fit naître une flamme. Brio se retrouva dehors, devant le château. Mais celui-ci brûlait. De grandes langues de feu rouges léchaient les tours. Les fenêtres explosaient. Des gens fuyaient en serrant des objets contre eux.<br><br>Maître Otho courait dans tous les sens, ses cheveux blancs en désordre. <em>« Ma guitare ! Ma guitare ! »</em> Il essayait d\'entrer dans le château, mais deux pompiers le retenaient.<br><br>Brio sentit son cœur se serrer comme jamais. Il se précipita vers le fantôme.<br><br>— Mais elle est sauvée, votre guitare ! Regardez ! Je l\'ai !<br><br>Le fantôme vit la guitare entre les pattes du petit dragon. <em>« Quelqu\'un… l\'a sauvée. Quelqu\'un, malgré le feu… »</em><br><br>— Quelqu\'un vous aimait beaucoup, murmura Brio. Une larme glissa, qui n\'était plus tout à fait une larme — une goutte de musique, peut-être.', image: 'assets/stories/dragon_chateau_guitare_fantome/page7.jpg' },

      { text: 'Brio gratta les sept cordes ensemble. Mais aucune ne fit de bruit. Sept silences purs, suspendus dans le couloir des miroirs.<br><br>Et dans ces sept silences, Brio entendit <em>tout</em>. Les notes oubliées de cent ans de musique. Les rires des enfants endormis sous les bancs. La voix d\'une femme qui chantonnait en se peignant. Les pas d\'un chien fidèle. Le craquement d\'une porte de four. Le souffle paisible d\'un vieil homme heureux.<br><br>Maître Otho rouvrit les yeux. Il avait l\'air apaisé. <em>« Voilà ce que j\'avais oublié. Pas les notes. Tout le reste. Tout ce qui vivait autour des notes. Tu as un don, mon ami. Tu écoutes les silences. C\'est plus rare que d\'entendre la musique. »</em>', image: 'assets/stories/dragon_chateau_guitare_fantome/page8.jpg' },

      { text: 'Quand Brio se réveilla, il était au milieu de la grande galerie. La guitare dormait à ses côtés. Les bougies du château étaient éteintes — toutes, sauf une, qui brillait encore doucement.<br><br>Brio se frotta les yeux. Avait-il rêvé ? Mais sur la pierre, juste à côté de lui, il y avait quelque chose qui n\'y était pas la veille : une petite mèche de cheveux blancs, tressée en forme d\'étoile.<br><br>— Merci, Maître Otho, chuchota-t-il.<br><br>Au même instant, le soleil entra par les fenêtres brisées. Le château de Belmondrie sembla <em>respirer</em>. Le lierre fit éclore de petites fleurs jaunes. Quelque part au loin, un oiseau lança un trille.<br><br>Brio prit la guitare. Il essaya, maladroitement, un accord. Puis un autre. C\'était laid, c\'était faux, c\'était merveilleux. Il sourit, le premier vrai sourire de toute sa vie.', image: 'assets/stories/dragon_chateau_guitare_fantome/page9.jpg' },

      { text: 'Les semaines passèrent. Puis les mois. Brio apprit à jouer — vraiment jouer. Et un soir d\'hiver, les premiers visiteurs arrivèrent.<br><br>C\'était une famille de voyageurs perdus dans la tempête. Brio leur ouvrit la porte. Il leur offrit un bol de soupe, qu\'il avait appris à cuisiner. Puis il joua. Maladroitement, mais avec tout son cœur.<br><br>Les enfants s\'endormirent sous les bancs. Les parents dansèrent doucement, en pleurant un peu, comme on pleure quand on est trop heureux. Et le fantôme de Maître Otho, depuis le couloir des miroirs, écouta en souriant.<br><br>Belmondrie n\'était plus un château oublié. C\'était devenu <em>la maison où l\'on jouait du silence</em>. Et les gens commencèrent à dire :<br><br>— Là-bas, dans le vieux château… Il y a quelqu\'un qui joue. Et c\'est si beau qu\'on a presque envie de pleurer.', image: 'assets/stories/dragon_chateau_guitare_fantome/page10.jpg' }
    ]
  }
};

const CREATOR_PLACEHOLDER_EMOJI = {
  astronaute: '🧑‍🚀', sorciere: '🧙‍♀️', dragon: '🐉',
  planete: '🪐', chateau: '🏰', ocean: '🌊',
  baguette: '🪄', skateboard: '🛹', guitare: '🎸',
  monstre: '👾', robot: '🤖', fantome: '👻'
};

let creatorState = {
  hero: null, place: null, item: null, villain: null,
  level: 'courte',    // courte | soir | aventure
  story: null,        // l objet histoire courante
  currentPage: 0,
  isAnimating: false
};

function openCreatorMode() {
  // Verrou Premium : le Livre magique fait partie du contenu payant.
  if (!isPremium()) { showPremiumPaywall('book'); goToScreen('map'); return; }
  goToScreen('creator');
  // v500 : le double rAF du v490 ne suffit pas avec le nouveau layout
  // position:absolute. On poll en rAF jusqu'a ce que l'ecran soit reellement
  // dimensionne (offsetWidth > 0). C'est instant en regle generale (1-2
  // frames) mais resilient si le navigateur traine.
  let _retries = 0;
  function _waitReady() {
    const sc = document.getElementById('screen-creator');
    if (sc && sc.classList.contains('active') && sc.offsetWidth > 0) {
      initCreatorPick();
      // Filet : si pour une raison X le DOM est vide apres render, on re-tente
      setTimeout(() => {
        const pages = document.getElementById('pick-book-pages');
        if (pages && pages.children.length === 0) {
          console.warn('[creator] pick-book-pages vide apres render, re-tentative');
          initCreatorPick();
        }
      }, 80);
    } else if (_retries < 40) {  // max 40 frames (~660ms)
      _retries++;
      requestAnimationFrame(_waitReady);
    } else {
      console.warn('[creator] screen-creator jamais devenu visible, init force');
      initCreatorPick();
    }
  }
  requestAnimationFrame(_waitReady);
}

// === PHASE 1 : SELECTION (v499 - livre interactif 5 pages) ====
// Le picker est maintenant un VRAI LIVRE entre les mains de Leon.
// 5 etapes : heros, lieu, objet, ennemi, niveau+CTA.
// Page-flip 3D, swipe mobile, auto-advance apres selection.
const PICK_STEPS = [
  { key: 'hero',    title: 'Choisis ton héros',       catIdx: 0, decor: '🦸' },
  { key: 'place',   title: 'Choisis le lieu',         catIdx: 1, decor: '🏰' },
  { key: 'item',    title: "Choisis l'objet magique", catIdx: 2, decor: '🪄' },
  { key: 'villain', title: 'Choisis le défi',         catIdx: 3, decor: '👻' },
  { key: 'level',   title: "Quel type d'histoire ?",  isLevel: true, decor: '📚' }
];
let pickBookState = { currentStep: 0, isFlipping: false, swipeWired: false };

// Heros custom crees par l'enfant (recuperes du backend pour la galerie)
let creatorCustomHeroes = [];
async function fetchCustomHeroes() {
  try {
    const r = await fetch(getBackendUrl() + '/api/state?license=' + encodeURIComponent(getLicenseCode()));
    if (!r.ok) { creatorCustomHeroes = []; return; }
    const d = await r.json();
    creatorCustomHeroes = d.heroes || [];
    // En edition ecole, le solde de plumes fait foi cote SERVEUR -> on synchronise l'affichage
    if (typeof d.plumes === 'number') {
      document.querySelectorAll('[data-plumes-balance]').forEach(el => { el.textContent = d.plumes; });
    }
  } catch (e) { creatorCustomHeroes = []; }   // backend absent : pas de heros custom
}

function initCreatorPick() {
  // Reset state (mais on garde le level choisi)
  creatorState.hero = null;
  creatorState.place = null;
  creatorState.item = null;
  creatorState.villain = null;
  creatorState.story = null;
  creatorState.currentPage = 0;
  if (!creatorState.level) creatorState.level = 'courte';
  pickBookState.currentStep = 0;
  pickBookState.isFlipping = false;
  // Show pick, hide others
  document.getElementById('creator-pick').hidden = false;
  document.getElementById('creator-loading').hidden = true;
  document.getElementById('creator-book').hidden = true;
  // Build livre
  renderPickBook();
  attachPickSwipe();
  const err = document.getElementById('creator-error-msg');
  if (err) err.textContent = '';
  // Recupere les heros custom (backend) puis re-render pour les afficher
  fetchCustomHeroes().then(() => {
    if (!document.getElementById('creator-pick').hidden) renderPickBook();
  });
}

function renderPickBook() {
  const pagesEl = document.getElementById('pick-book-pages');
  console.log('[creator] renderPickBook : pagesEl =', pagesEl);
  if (!pagesEl) { console.warn('[creator] #pick-book-pages introuvable'); return; }
  pagesEl.innerHTML = '';
  PICK_STEPS.forEach((step, idx) => {
    const spread = document.createElement('div');
    spread.className = 'pick-spread';
    spread.dataset.step = step.key;
    spread.dataset.stepIdx = String(idx);
    if (idx !== pickBookState.currentStep) spread.hidden = true;

    if (step.isLevel) {
      // v537 : eventail des 3 illustrations de niveau (courte/soir/aventure)
      // avec onerror fallback sur le gros emoji si pas encore generees
      const LEVELS = [
        { value: 'courte',   emoji: '⚡', label: 'Courte' },
        { value: 'soir',     emoji: '🌙', label: 'Du soir' },
        { value: 'aventure', emoji: '🗺️', label: 'Voyage' },
      ];
      const LEVEL_META = {
        courte:   { emoji: '⚡', label: 'Courte',  time: '3-5 min' },
        soir:     { emoji: '🌙', label: 'Du soir', time: '7-10 min' },
        aventure: { emoji: '🗺️', label: 'Voyage',  time: '~20 min' },
      };
      const levelBtnHtml = (val) => {
        const m = LEVEL_META[val];
        return `
          <button class="pick-item pick-level-item ${creatorState.level === val ? 'selected' : ''}" data-level="${val}" type="button">
            <img class="pick-item-img" src="assets/picker/level_${val}.png?v=537" alt="" loading="lazy"
                 onerror="this.style.display='none'; var em=this.nextElementSibling; if(em) em.style.display='inline-block';">
            <span class="pick-item-emoji" style="display:none">${m.emoji}</span>
            <span class="pick-item-label">${m.label} <span class="pick-level-time">(${m.time})</span></span>
          </button>`;
      };
      spread.innerHTML = `
        <div class="pick-page pick-page-left">
          <div class="pick-cat-trio pick-cat-trio-levels">
            ${LEVELS.map((lvl, fi) => `
              <img class="pick-cat-trio-img pick-cat-trio-${fi}"
                   src="assets/picker/level_${lvl.value}.png?v=537"
                   alt="${lvl.label}"
                   onerror="this.style.display='none'; var sib=this.nextElementSibling; if(sib) sib.style.display='flex';">
              <div class="pick-cat-trio-fallback pick-cat-trio-${fi}" style="display:none">${lvl.emoji}</div>
            `).join('')}
          </div>
          <h2 class="pick-cat-title">${step.title}</h2>
          <p class="pick-summary" id="pick-summary"></p>
        </div>
        <div class="pick-page pick-page-right">
          <div class="pick-items">
            ${levelBtnHtml('courte')}
            ${levelBtnHtml('soir')}
            ${levelBtnHtml('aventure')}
          </div>
          <button class="pick-go" id="creator-go-btn" type="button" onclick="generateCreatorStory()">
            <img class="pick-go-icon" src="assets/picker/write_btn.png?v=539" alt=""
                 onerror="this.style.display='none'; var em=this.nextElementSibling; if(em) em.style.display='inline';">
            <span class="pick-go-emoji" style="display:none">📖</span>
            <span class="pick-go-text">Écrire mon histoire</span>
          </button>
        </div>
      `;
    } else {
      const cat = CREATOR_CATEGORIES[step.catIdx];
      // v534 : page gauche montre soit le grand portrait du SELECTIONNE,
      // soit un EVENTAIL des 3 portraits (style jeu de cartes magiques)
      const selectedVal = creatorState[step.key];
      const selectedItem = selectedVal && cat.items.find(i => i.value === selectedVal);
      const leftPaneHtml = selectedItem
        ? `<div class="pick-cat-bigportrait">
             <img class="pick-cat-bigportrait-img" src="assets/items/${step.key}_${selectedVal}.jpg?v=534" alt="${selectedItem.label}"
                  onerror="this.style.display='none'; var em=this.nextElementSibling; if(em) em.style.display='block';">
             <div class="pick-cat-decor" style="display:none">${step.decor}</div>
           </div>
           <h2 class="pick-cat-title">${selectedItem.label}</h2>
           <p class="pick-cat-subtitle">${step.title}</p>`
        : `<div class="pick-cat-trio">
             ${cat.items.map((item, fanIdx) => `
               <img class="pick-cat-trio-img pick-cat-trio-${fanIdx}"
                    src="assets/items/${step.key}_${item.value}.jpg?v=534"
                    alt="${item.label}"
                    onerror="this.style.opacity=0.3;">
             `).join('')}
           </div>
           <h2 class="pick-cat-title">${step.title}</h2>`;
      spread.innerHTML = `
        <div class="pick-page pick-page-left">
          ${leftPaneHtml}
        </div>
        <div class="pick-page pick-page-right">
          <div class="pick-items">
            ${cat.items.map(item => `
              <button class="pick-item ${creatorState[step.key] === item.value ? 'selected' : ''}" data-cat="${step.key}" data-value="${item.value}" type="button">
                <img class="pick-item-img" src="assets/items/${step.key}_${item.value}.jpg?v=531" alt="" loading="lazy"
                     onerror="this.style.display='none'; var em=this.nextElementSibling; if(em) em.style.display='inline-block';">
                <span class="pick-item-emoji" style="display:none">${item.emoji}</span>
                <span class="pick-item-label">${item.label}</span>
              </button>
            `).join('')}
          </div>
        </div>
      `;
    }
    // Page HEROS : ajoute les heros custom de l'enfant + une carte "Creer"
    if (step.key === 'hero') {
      const itemsBox = spread.querySelector('.pick-items');
      if (itemsBox) {
        creatorCustomHeroes.forEach(h => {
          const b = document.createElement('button');
          b.className = 'pick-item' + (creatorState.hero === 'custom:' + h.hero_id ? ' selected' : '');
          b.dataset.cat = 'hero';
          b.dataset.value = 'custom:' + h.hero_id;
          b.type = 'button';
          b.style.position = 'relative';
          b.innerHTML = '<span class="pick-hero-del" title="Supprimer" style="position:absolute;' +
            'top:2px;left:2px;width:20px;height:20px;border-radius:50%;background:rgba(0,0,0,.5);' +
            'color:#fff;font-size:12px;line-height:20px;text-align:center;z-index:3;">✕</span>' +
            '<img class="pick-item-img" src="' + getBackendUrl() + h.portrait_url +
            '" alt="" loading="lazy"><span class="pick-item-label">' + h.name + '</span>';
          b.querySelector('.pick-hero-del').addEventListener('click', (e) => {
            e.stopPropagation(); deleteCustomHero(h.hero_id, h.name);
          });
          itemsBox.appendChild(b);
        });
        const c = document.createElement('button');
        c.className = 'pick-item pick-item-create';
        c.type = 'button';
        c.innerHTML = '<span class="pick-item-emoji" style="display:inline-block;font-size:1.7rem">➕</span>' +
          '<span class="pick-item-label">Créer</span>';
        c.onclick = () => openHeroBuilder();
        itemsBox.appendChild(c);
      }
    }
    pagesEl.appendChild(spread);
  });

  // Wire item clicks (click = vrai gesture iOS)
  pagesEl.querySelectorAll('.pick-item[data-cat]').forEach(btn => {
    btn.onclick = () => {
      selectCreatorItem(btn.dataset.cat, btn.dataset.value, btn);
      // Auto-advance vers la page suivante apres 380ms
      setTimeout(() => {
        if (pickBookState.currentStep < PICK_STEPS.length - 1 && !pickBookState.isFlipping) {
          pickBookNextPage();
        }
      }, 380);
    };
  });
  pagesEl.querySelectorAll('.pick-level-item').forEach(btn => {
    btn.onclick = () => {
      creatorState.level = btn.dataset.level;
      pagesEl.querySelectorAll('.pick-level-item').forEach(b =>
        b.classList.toggle('selected', b === btn));
    };
  });

  // Si on est sur la page level, mettre a jour le recap
  if (PICK_STEPS[pickBookState.currentStep].isLevel) updatePickSummary();
  updatePickBookNav();
}

function selectCreatorItem(category, value, btnEl) {
  creatorState[category] = value;
  const stepEl = btnEl ? btnEl.closest('.pick-spread') : null;
  if (stepEl) {
    stepEl.querySelectorAll('.pick-item').forEach(c => c.classList.remove('selected'));
  }
  if (btnEl) btnEl.classList.add('selected');
  updatePickBookNav();
  const err = document.getElementById('creator-error-msg');
  if (err) err.textContent = '';
}

function pickBookNextPage() {
  if (pickBookState.isFlipping) return;
  if (pickBookState.currentStep >= PICK_STEPS.length - 1) return;
  // Sur pages 1-4, exiger une selection avant d'avancer
  const step = PICK_STEPS[pickBookState.currentStep];
  if (!step.isLevel && !creatorState[step.key]) {
    const err = document.getElementById('creator-error-msg');
    if (err) err.textContent = '⚠️ Choisis d\'abord un élément !';
    return;
  }
  flipPickPage('forward', pickBookState.currentStep + 1);
}
function pickBookPrevPage() {
  if (pickBookState.isFlipping) return;
  if (pickBookState.currentStep <= 0) return;
  flipPickPage('backward', pickBookState.currentStep - 1);
}

function flipPickPage(direction, newIdx) {
  pickBookState.isFlipping = true;
  const flipEl = document.getElementById('pick-page-flip');
  const spreads = document.querySelectorAll('.pick-spread');
  if (!flipEl || !spreads.length) {
    pickBookState.isFlipping = false;
    return;
  }
  // Lance l'anim de feuille qui tourne
  flipEl.className = 'pick-page-flip flipping-' + direction;
  // A mi-anim (sous la feuille), on swap les spreads
  setTimeout(() => {
    spreads.forEach((s, i) => { s.hidden = (i !== newIdx); });
    pickBookState.currentStep = newIdx;
    if (PICK_STEPS[newIdx].isLevel) updatePickSummary();
    updatePickBookNav();
  }, 325);
  // Fin d'anim : reset le flip overlay
  setTimeout(() => {
    flipEl.className = 'pick-page-flip';
    pickBookState.isFlipping = false;
  }, 680);
}

function updatePickBookNav() {
  const prog = document.getElementById('pick-progress');
  const prev = document.getElementById('pick-prev');
  const next = document.getElementById('pick-next');
  if (prog) prog.textContent = (pickBookState.currentStep + 1) + ' / ' + PICK_STEPS.length;
  if (prev) prev.disabled = pickBookState.currentStep <= 0;
  if (next) {
    const isLast = pickBookState.currentStep >= PICK_STEPS.length - 1;
    next.disabled = isLast;
  }
  // Bouton "Écrire" reflete completion
  const goBtn = document.getElementById('creator-go-btn');
  if (goBtn) {
    const ready = creatorState.hero && creatorState.place && creatorState.item && creatorState.villain;
    goBtn.disabled = !ready;
  }
}

function updatePickSummary() {
  const sum = document.getElementById('pick-summary');
  if (!sum) return;
  // v531 : on affiche les vrais portraits (assets/items/<cat>_<value>.jpg)
  // avec fallback emoji si l'image n'existe pas encore
  const cardOf = (catKey, val) => {
    if (!val) return '<div class="pick-summary-card empty">?</div>';
    const cat = CREATOR_CATEGORIES.find(c => c.key === catKey);
    const item = cat && cat.items.find(i => i.value === val);
    if (!item) return '<div class="pick-summary-card empty">?</div>';
    return `
      <div class="pick-summary-card" title="${item.label}">
        <img class="pick-summary-img" src="assets/items/${catKey}_${val}.jpg?v=531" alt="${item.label}"
             onerror="this.style.display='none'; var em=this.nextElementSibling; if(em) em.style.display='inline-block';">
        <span class="pick-summary-emoji" style="display:none">${item.emoji}</span>
        <span class="pick-summary-label">${item.label}</span>
      </div>`;
  };
  sum.innerHTML = `<em>Ton histoire</em>
    <div class="pick-summary-cards">
      ${cardOf('hero', creatorState.hero)}
      ${cardOf('place', creatorState.place)}
      ${cardOf('item', creatorState.item)}
      ${cardOf('villain', creatorState.villain)}
    </div>`;
}

function surpriseMeCreator() {
  // Tire au sort tous les ingredients + niveau, puis bondit a la derniere page
  CREATOR_CATEGORIES.forEach(cat => {
    const rndIdx = Math.floor(Math.random() * cat.items.length);
    creatorState[cat.key] = cat.items[rndIdx].value;
  });
  const levels = ['courte', 'soir', 'aventure'];
  creatorState.level = levels[Math.floor(Math.random() * levels.length)];
  pickBookState.currentStep = PICK_STEPS.length - 1;
  pickBookState.isFlipping = false;
  renderPickBook();
  const err = document.getElementById('creator-error-msg');
  if (err) err.textContent = '';
}

function attachPickSwipe() {
  if (pickBookState.swipeWired) return;
  const book = document.getElementById('pick-book');
  if (!book) return;
  let startX = 0, startY = 0, startT = 0;
  book.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    startT = Date.now();
  }, { passive: true });
  book.addEventListener('touchend', e => {
    if (Date.now() - startT > 600) return;
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    if (Math.abs(dx) > 60 && Math.abs(dy) < 50) {
      // Eviter le swipe sur bouton item (le clic prime)
      const target = e.target;
      if (target && target.closest('.pick-item, .pick-go, .pick-prev, .pick-next')) return;
      if (dx < 0) pickBookNextPage(); else pickBookPrevPage();
    }
  }, { passive: true });
  pickBookState.swipeWired = true;
}

// === PHASE 2 : LOADING + LOAD STORY === ======================
// v529 : refacto async pour fetch les story.json generees par le pipeline overnight
async function generateCreatorStory() {
  if (!creatorState.hero || !creatorState.place || !creatorState.item || !creatorState.villain) {
    const err = document.getElementById('creator-error-msg');
    if (err) err.textContent = '⚠️ Choisis un élément dans chaque catégorie !';
    return;
  }
  // HEROS CUSTOM : on genere l'histoire via le backend (debit 1 plume)
  if (creatorState.hero.indexOf('custom:') === 0) {
    return generateCustomStoryViaBackend(creatorState.hero.slice('custom:'.length));
  }
  // Show loading, hide pick
  document.getElementById('creator-pick').hidden = true;
  document.getElementById('creator-loading').hidden = false;
  const lvl = creatorState.level || 'courte';
  const combo = creatorState.hero + '_' + creatorState.place + '_' + creatorState.item + '_' + creatorState.villain;
  const fullKey = lvl + '_' + combo;

  let story = null;
  let assetsFolder = null;  // dossier ou trouver pageN.jpg et pageN.mp3

  // 1) Hardcoded CREATOR_STORIES (Brio historique, images deja en place)
  if (CREATOR_STORIES[fullKey]) {
    story = CREATOR_STORIES[fullKey];
    assetsFolder = combo;  // Brio est dans assets/stories/<combo>/ sans prefixe niveau
  } else {
    for (const k of Object.keys(CREATOR_STORIES)) {
      if (k.endsWith('_' + combo)) { story = CREATOR_STORIES[k]; assetsFolder = combo; break; }
    }
  }

  // 2) Try fetch story.json (nouvelles stories generees par le pipeline)
  if (!story) {
    try {
      const resp = await fetch('assets/stories/' + fullKey + '/story.json');
      if (resp.ok) {
        const data = await resp.json();
        story = {
          title: data.title || 'Mon histoire',
          pages: (data.pages || []).map((pg, i) => ({
            text: pg.text || '',
            image: 'assets/stories/' + fullKey + '/page' + (i + 1) + '.jpg'
          }))
        };
        assetsFolder = fullKey;
        console.log('[creator] charge story.json : ' + fullKey);
      }
    } catch (e) {
      console.warn('[creator] fetch story.json echoue :', e);
    }
  }

  // v531 : plus de DEV fallback Brio (qui prete a confusion). Si la story
  // n'existe pas (pas encore generee par le pipeline), on montre un placeholder
  // qui explique a l'enfant que l'histoire est en preparation.
  if (!story) {
    console.log('[creator] story introuvable : ' + fullKey + ' -> placeholder');
    story = _buildNotYetGeneratedStory();
    assetsFolder = null;
  }

  setTimeout(() => {
    creatorState.story = story;
    creatorState.assetsFolder = assetsFolder;
    creatorState.currentPage = 0;
    showCreatorBook();
  }, 800);
}

// Genere une histoire CUSTOM via le backend (heros cree par l'enfant).
// Debite 1 plume cote serveur, puis affiche l'histoire dans le lecteur.
async function generateCustomStoryViaBackend(heroId) {
  document.getElementById('creator-pick').hidden = true;
  document.getElementById('creator-loading').hidden = false;
  // Message d'attente adapte (la generation custom prend ~1-2 min)
  const loadEl = document.getElementById('creator-loading');
  const sub = loadEl && loadEl.querySelector('p');
  if (sub) sub.textContent = 'Léon écrit et illustre ton histoire (environ une minute)…';

  const showPickError = (msg) => {
    document.getElementById('creator-loading').hidden = true;
    document.getElementById('creator-pick').hidden = false;
    const err = document.getElementById('creator-error-msg');
    if (err) err.textContent = '⚠️ ' + msg;
  };

  try {
    const r = await fetch(getBackendUrl() + '/api/create-story', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        license: getLicenseCode(), hero_id: heroId,
        place: creatorState.place, item: creatorState.item,
        villain: creatorState.villain, level: creatorState.level || 'courte',
      }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      showPickError(d.message || d.error || 'Génération impossible. Réessaie.');
      return;
    }
    // Charge le story.json genere et construit les pages (images servies par le backend)
    // Met a jour le solde de plumes affiche (debit cote serveur)
    if (typeof d.plumes_left === 'number') {
      document.querySelectorAll('[data-plumes-balance]').forEach(el => { el.textContent = d.plumes_left; });
    }
    const sresp = await fetch(getBackendUrl() + d.story_url);
    const data = await sresp.json();
    const base = getBackendUrl() + '/custom/' + d.story_dir + '/';
    creatorState.story = {
      title: data.title || 'Mon histoire',
      pages: (data.pages || []).map((pg, i) => ({
        text: pg.text || '',
        image: base + 'page' + (i + 1) + '.jpg',
        audio: base + 'page' + (i + 1) + '.mp3',
      })),
    };
    creatorState.assetsFolder = null;   // audio fourni par page.audio (URL backend)
    creatorState.currentPage = 0;
    showCreatorBook();
  } catch (e) {
    showPickError('Le serveur de Léon est injoignable. Vérifie qu\'il est lancé.');
  }
}

// ============================================================
// MES HISTOIRES : relecture GRATUITE des histoires deja generees
// ============================================================
async function showMyStories() {
  let stories = [];
  try {
    const r = await fetch(getBackendUrl() + '/api/stories?license=' + encodeURIComponent(getLicenseCode()));
    if (r.ok) stories = (await r.json()).stories || [];
  } catch (e) {}
  document.getElementById('my-stories')?.remove();
  const ov = document.createElement('div');
  ov.id = 'my-stories';
  ov.setAttribute('style',
    'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;' +
    'justify-content:center;background:rgba(20,10,35,0.85);' +
    'backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);padding:5vw;');
  const cards = stories.length ? stories.map(s =>
    '<button data-story-dir="' + s.story_dir + '" style="cursor:pointer;border:2px solid #e0a23a;' +
    'border-radius:14px;background:#fffaf0;padding:8px;text-align:center;font-family:inherit;' +
    'color:#4a2f12;width:130px;">' +
      '<img src="' + getBackendUrl() + s.cover_url + '" style="width:100%;height:88px;object-fit:cover;' +
      'border-radius:8px;margin-bottom:6px;" onerror="this.style.display=\'none\'">' +
      '<div style="font-size:.8rem;font-weight:800;line-height:1.2;">' + s.title + '</div>' +
      '<div style="font-size:.7rem;opacity:.7;">' + (s.hero_name || '') + '</div>' +
    '</button>'
  ).join('') : '<p style="opacity:.7;margin:10px 0;">Aucune histoire pour l\'instant. Crée-en une !</p>';
  ov.innerHTML =
    '<div style="max-width:480px;width:100%;max-height:85vh;overflow-y:auto;' +
    'background:linear-gradient(160deg,#fff8ee,#ffe9c7);border:3px solid #e0a23a;border-radius:22px;' +
    'padding:22px;text-align:center;font-family:inherit;color:#4a2f12;">' +
      '<div style="font-size:40px;line-height:1;">📚</div>' +
      '<h2 style="margin:4px 0 2px;color:#7a4a10;">Mes histoires</h2>' +
      '<p style="margin:0 0 14px;font-size:.85rem;opacity:.8;">Relis tes histoires (gratuit 🆓)</p>' +
      '<div style="display:flex;flex-wrap:wrap;gap:10px;justify-content:center;">' + cards + '</div>' +
      '<button id="my-stories-close" style="margin-top:16px;cursor:pointer;border:none;' +
      'background:none;color:#7a4a10;text-decoration:underline;opacity:.7;">Fermer</button>' +
    '</div>';
  ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
  document.body.appendChild(ov);
  ov.querySelectorAll('[data-story-dir]').forEach(b =>
    b.addEventListener('click', () => openSavedStory(b.dataset.storyDir)));
  document.getElementById('my-stories-close').addEventListener('click', () => ov.remove());
}

async function openSavedStory(storyDir) {
  document.getElementById('my-stories')?.remove();
  const base = getBackendUrl() + '/custom/' + storyDir + '/';
  try {
    const data = await (await fetch(base + 'story.json')).json();
    creatorState.story = {
      title: data.title || 'Mon histoire',
      pages: (data.pages || []).map((pg, i) => ({
        text: pg.text || '',
        image: base + 'page' + (i + 1) + '.jpg',
        audio: base + 'page' + (i + 1) + '.mp3',
      })),
    };
    creatorState.assetsFolder = null;
    creatorState.currentPage = 0;
    document.getElementById('creator-pick').hidden = true;
    document.getElementById('creator-loading').hidden = true;
    showCreatorBook();
  } catch (e) {}
}
window.showMyStories = showMyStories;
window.openSavedStory = openSavedStory;

// Suppression d'un heros custom (libere un slot ; supprime aussi ses histoires)
async function deleteCustomHero(heroId, name) {
  if (!confirm('Supprimer ' + (name || 'ce héros') + ' ? Ses histoires seront aussi effacées.')) return;
  try {
    await fetch(getBackendUrl() + '/api/hero/' + encodeURIComponent(heroId) +
                '?license=' + encodeURIComponent(getLicenseCode()), { method: 'DELETE' });
  } catch (e) {}
  await fetchCustomHeroes();
  if (creatorState.hero === 'custom:' + heroId) creatorState.hero = null;
  renderPickBook();
}
window.deleteCustomHero = deleteCustomHero;

function _buildNotYetGeneratedStory() {
  const h = creatorState.hero, p = creatorState.place;
  const i = creatorState.item, v = creatorState.villain;
  const labelOf = (cat, val) => {
    const c = CREATOR_CATEGORIES.find(x => x.key === cat);
    const it = c && c.items.find(x => x.value === val);
    return it ? it.label.toLowerCase() : val;
  };
  return {
    title: 'Cette histoire arrive bientôt !',
    pages: [{
      text: `Léon est en train de tisser une nouvelle histoire ` +
            `avec <strong>${labelOf('hero', h)}</strong>, ` +
            `<strong>${labelOf('place', p)}</strong>, ` +
            `<strong>${labelOf('item', i)}</strong> et ` +
            `<strong>${labelOf('villain', v)}</strong>.<br><br>` +
            `Reviens dans quelques heures, elle sera prête !<br><br>` +
            `<em>(En attendant, essaye une autre combinaison ou clique sur ` +
            `🎲 Surprends-moi pour découvrir une histoire déjà créée.)</em>`,
      image: ''
    }]
  };
}

function _buildPlaceholderStory() {
  const h = creatorState.hero, p = creatorState.place;
  const i = creatorState.item, v = creatorState.villain;
  return {
    title: `L'aventure du ${h}`,
    pages: [
      { text: `Notre histoire commence dans un ${p} extraordinaire. Le ${h}, plein de courage, s'apprêtait à vivre une grande aventure.`, image: '' },
      { text: `Près d'un arbre ancien, il découvrit ${i === 'baguette' ? 'une baguette' : i === 'skateboard' ? 'un skateboard' : 'une guitare'} aux pouvoirs étranges. Quelque chose en elle semblait vibrer.`, image: '' },
      { text: `Mais soudain, un ${v} surgit, prêt à tout détruire. Le ${h} sentit son cœur s'emballer.`, image: '' },
      { text: `Au lieu de fuir, le ${h} tendit la main. Il découvrit que le ${v} n'était pas méchant, juste perdu.`, image: '' },
      { text: `Avec l'aide de l'objet magique, ils trouvèrent ensemble un nouveau chemin. Le ${p} reprit ses couleurs.`, image: '' },
      { text: `Le ${h} rentra chez lui, plus sage qu'avant. Il avait appris que l'amitié vaut mieux que les batailles.`, image: '' }
    ]
  };
}

// === PHASE 3 : LIVRE 3D === ==================================
// Etat audio : autoplay toggle persiste en localStorage entre sessions
const bookAudioState = {
  autoplay: localStorage.getItem('book_autoplay') === 'true',
  eventsWired: false
};

function showCreatorBook() {
  document.getElementById('creator-loading').hidden = true;
  document.getElementById('creator-book').hidden = false;
  // Title (visible sur chaque page, en overlay sur l image)
  const titleEl = document.getElementById('book-title');
  if (titleEl) titleEl.textContent = creatorState.story.title || 'Mon histoire';
  // Init audio events (une seule fois)
  wireBookAudioEvents();
  // v556 : reflete l'etat autoplay sauve sur le bouton
  _syncAutoplayButton();
  // v555 : init auto-hide UI
  wireBookUIAutoHide();
  // Show first page (instant = pas d animation initiale)
  showBookPage(0, true);
}

// v555 : auto-hide des boutons (nav + close + restart) apres 3s d'inactivite
let _bookUIHideTimer = null;
function wireBookUIAutoHide() {
  const book = document.getElementById('creator-book');
  if (!book || book._uiAutoHideWired) return;
  book._uiAutoHideWired = true;

  const showUI = () => {
    book.classList.remove('ui-hidden');
    clearTimeout(_bookUIHideTimer);
    _bookUIHideTimer = setTimeout(() => {
      book.classList.add('ui-hidden');
    }, 3000);
  };

  // Affiche au demarrage puis fade
  showUI();

  // Mouse (PC)
  book.addEventListener('mousemove', showUI);
  // Touch (mobile)
  book.addEventListener('touchstart', showUI, { passive: true });
  // Clic sur n'importe quel bouton -> reset timer
  book.addEventListener('click', showUI);
}

function wireBookAudioEvents() {
  if (bookAudioState.eventsWired) return;
  const audio = document.getElementById('book-audio');
  const textEl = document.getElementById('book-text');
  if (!audio) return;
  audio.addEventListener('play',  () => setAudioButtonState('playing'));
  audio.addEventListener('pause', () => setAudioButtonState('ready'));
  audio.addEventListener('ended', () => {
    console.log('[audio] ended, autoplay=', bookAudioState.autoplay,
                'page', creatorState.currentPage, '/',
                (creatorState.story && creatorState.story.pages || []).length);
    setAudioButtonState('ready');
    // Si autoplay : avance automatiquement a la page suivante
    if (bookAudioState.autoplay) {
      const pages = (creatorState.story && creatorState.story.pages) || [];
      if (creatorState.currentPage < pages.length - 1) {
        console.log('[audio] auto-advancing to next page');
        setTimeout(() => bookNextPage(), 800);
      }
    }
  });
  audio.addEventListener('error', () => setAudioButtonState('unavailable'));

  // v553 : auto-scroll du texte synchronise avec la progression de l'audio
  if (textEl) {
    audio.addEventListener('timeupdate', () => {
      if (!audio.duration || isNaN(audio.duration)) return;
      if (audio.paused) return;
      if (bookAudioState.userScrolling) return;  // pause si user scroll a la main
      const progress = audio.currentTime / audio.duration;
      const maxScroll = textEl.scrollHeight - textEl.clientHeight;
      if (maxScroll <= 0) return;
      textEl.scrollTop = Math.max(0, progress * maxScroll);
    });

    // Detection du scroll manuel utilisateur -> on pause auto-scroll 3 sec
    const markUserScroll = () => {
      bookAudioState.userScrolling = true;
      clearTimeout(bookAudioState._scrollTimer);
      bookAudioState._scrollTimer = setTimeout(() => {
        bookAudioState.userScrolling = false;
      }, 3000);
    };
    textEl.addEventListener('wheel', markUserScroll, { passive: true });
    textEl.addEventListener('touchmove', markUserScroll, { passive: true });
  }
  bookAudioState.eventsWired = true;
}

let _bookAudioToken = 0;
function loadBookAudioForPage(idx) {
  const audio = document.getElementById('book-audio');
  if (!audio) return;
  const pages = (creatorState.story && creatorState.story.pages) || [];
  const page = pages[idx];
  // URL audio : soit fournie par page (custom, backend), soit le dossier catalogue
  let url = null;
  let isCustom = false;
  if (page && page.audio) { url = page.audio; isCustom = true; }
  else if (creatorState.assetsFolder) { url = 'assets/stories/' + creatorState.assetsFolder + '/page' + (idx + 1) + '.mp3'; }
  if (!url) { setAudioButtonState('unavailable'); return; }
  const token = ++_bookAudioToken;
  audio.pause();
  audio.src = url;
  audio.currentTime = 0;
  setAudioButtonState('loading');
  audio.load();
  audio.addEventListener('canplay', function _ready() {
    audio.removeEventListener('canplay', _ready);
    if (token !== _bookAudioToken) return;
    setAudioButtonState('ready');
    if (bookAudioState.autoplay) {
      audio.play().catch(e => console.warn('autoplay denied:', e.message));
    }
  }, { once: true });
  // Custom : la narration est peut-etre encore en cours de generation -> retry
  audio.addEventListener('error', function _err() {
    audio.removeEventListener('error', _err);
    if (token !== _bookAudioToken) return;
    if (isCustom) {
      setAudioButtonState('loading');
      setTimeout(() => { if (token === _bookAudioToken) loadBookAudioForPage(idx); }, 5000);
    } else {
      setAudioButtonState('unavailable');
    }
  }, { once: true });
}

function setAudioButtonState(state) {
  const btn = document.getElementById('book-audio-toggle');
  const icon = btn ? btn.querySelector('.book-audio-icon') : null;
  if (!btn || !icon) return;
  btn.disabled = false;
  btn.classList.remove('playing', 'unavailable', 'loading');
  if (state === 'unavailable') {
    btn.disabled = true;
    btn.classList.add('unavailable');
    icon.textContent = '▶';
    btn.title = 'Audio non disponible pour cette page';
  } else if (state === 'loading') {
    btn.classList.add('loading');
    icon.textContent = '⋯';
    btn.title = 'Chargement audio...';
  } else if (state === 'playing') {
    btn.classList.add('playing');
    icon.textContent = '⏸';
    btn.title = 'Pause';
  } else {  // ready
    icon.textContent = '▶';
    btn.title = 'Écouter cette page';
  }
}

function toggleBookAudio() {
  const audio = document.getElementById('book-audio');
  if (!audio || !audio.src) return;
  if (audio.paused) {
    audio.play().catch(e => console.warn('play failed:', e.message));
  } else {
    audio.pause();
  }
}

function toggleBookAutoplay() {
  bookAudioState.autoplay = !bookAudioState.autoplay;
  // v556 : persist en localStorage entre sessions
  localStorage.setItem('book_autoplay', String(bookAudioState.autoplay));
  console.log('[audio] autoplay toggled ->', bookAudioState.autoplay);
  const btn = document.getElementById('book-autoplay-toggle');
  if (btn) {
    btn.classList.toggle('active', bookAudioState.autoplay);
    btn.title = 'Lecture auto : ' + (bookAudioState.autoplay ? 'ON' : 'OFF');
  }
  // Si on active autoplay et que l'audio est pret mais en pause, on lance
  const audio = document.getElementById('book-audio');
  if (bookAudioState.autoplay && audio && audio.paused && audio.src) {
    audio.play().catch(e => console.warn('[audio] play() blocked:', e.message));
  }
}

// v556 : reflete l'etat autoplay sauvegarde sur le bouton au demarrage
function _syncAutoplayButton() {
  const btn = document.getElementById('book-autoplay-toggle');
  if (btn) {
    btn.classList.toggle('active', bookAudioState.autoplay);
    btn.title = 'Lecture auto : ' + (bookAudioState.autoplay ? 'ON' : 'OFF');
  }
}

// v494 : plus de renderBookPages (plus de pile de pages DOM). On change juste
// le contenu de .book-image (background-image) et .book-text (innerHTML) a
// chaque page, avec transitions fade+slide.
// Charge l'image d'une page avec RETRY : si l'image n'est pas encore generee
// (histoire custom en cours de generation progressive), affiche "Leon dessine…"
// et re-essaie jusqu'a ce qu'elle apparaisse. Le token annule les chargements
// des pages precedentes quand on tourne les pages.
let _bookImgToken = 0;
function setBookImage(imgEl, url) {
  const token = ++_bookImgToken;
  const placeholder = () => {
    imgEl.style.backgroundImage = 'linear-gradient(135deg,#4a2a8a 0%,#2b1854 50%,#1a0d2e 100%)';
  };
  if (!url || !url.trim()) { placeholder(); imgEl.innerHTML = ''; return; }
  const showGenerating = () => {
    imgEl.style.position = 'relative';
    placeholder();
    imgEl.innerHTML = '<div style="position:absolute;inset:0;display:flex;flex-direction:column;' +
      'align-items:center;justify-content:center;color:#fff;text-align:center;padding:20px;">' +
      '<div style="font-size:42px" class="anim-bounce">🪄</div>' +
      '<div style="opacity:.9;font-size:.95rem;margin-top:8px;">Léon dessine cette page…</div></div>';
  };
  const attempt = () => {
    const probe = new Image();
    probe.onload = () => {
      if (token !== _bookImgToken) return;
      imgEl.innerHTML = '';
      imgEl.style.backgroundImage = "url('" + url + "')";
    };
    probe.onerror = () => {
      if (token !== _bookImgToken) return;
      showGenerating();
      setTimeout(() => { if (token === _bookImgToken) attempt(); }, 4000);
    };
    probe.src = url;
  };
  attempt();
}

function showBookPage(idx, instant) {
  const pages = (creatorState.story && creatorState.story.pages) || [];
  if (idx < 0 || idx >= pages.length) return;
  if (creatorState.isAnimating && !instant) return;
  const page = pages[idx];
  const imgEl  = document.getElementById('book-image');
  const textEl = document.getElementById('book-text');
  if (!imgEl || !textEl) return;

  const setContent = () => {
    creatorState.currentPage = idx;
    // Image (avec retry si pas encore generee -> progressif custom)
    setBookImage(imgEl, page.image);
    // Texte
    textEl.innerHTML = '<p>' + (page.text || '') + '</p>';
    // v553 : reset scroll au debut de la nouvelle page
    textEl.scrollTop = 0;
    bookAudioState.userScrolling = false;
    updateBookNav();
    // v529 : charge l audio de cette page (autoplay si toggle ON)
    loadBookAudioForPage(idx);
  };

  if (instant) {
    setContent();
    imgEl.classList.remove('fading', 'kenburns');
    textEl.classList.remove('changing');
    requestAnimationFrame(() => imgEl.classList.add('kenburns'));
    return;
  }

  // Transition : fade out, swap, fade in
  creatorState.isAnimating = true;
  imgEl.classList.add('fading');
  imgEl.classList.remove('kenburns');
  textEl.classList.add('changing');

  setTimeout(() => {
    setContent();
    imgEl.classList.remove('fading');
    textEl.classList.remove('changing');
    requestAnimationFrame(() => imgEl.classList.add('kenburns'));
    creatorState.isAnimating = false;
  }, 450);
}

function bookNextPage() {
  const pages = (creatorState.story && creatorState.story.pages) || [];
  if (creatorState.currentPage >= pages.length - 1) return;
  if (creatorState.isAnimating) return;
  showBookPage(creatorState.currentPage + 1);
}
function bookPrevPage() {
  if (creatorState.currentPage <= 0) return;
  if (creatorState.isAnimating) return;
  showBookPage(creatorState.currentPage - 1);
}

function updateBookNav() {
  const pages = (creatorState.story && creatorState.story.pages) || [];
  const total = pages.length;
  const cur = creatorState.currentPage + 1;
  const prog = document.getElementById('book-progress');
  if (prog) prog.textContent = cur + ' / ' + total;
  const prev = document.getElementById('book-prev');
  const next = document.getElementById('book-next');
  if (prev) prev.disabled = creatorState.currentPage <= 0;
  if (next) next.disabled = creatorState.currentPage >= total - 1;
}

function closeCreatorBook() {
  // v529 : stop audio en cours avant de fermer
  const audio = document.getElementById('book-audio');
  if (audio) { audio.pause(); audio.src = ''; }
  goToScreen('map');
}
function restartCreatorPick() {
  const audio = document.getElementById('book-audio');
  if (audio) { audio.pause(); audio.src = ''; }
  initCreatorPick();
}

