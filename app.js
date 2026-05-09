console.log('[app.js] LOADED OK - version 2026050306');
// === Verrouillage paysage + overlay "tourne ton téléphone" (mobile uniquement) ===
function isMobileDevice() {
  return /Android|iPhone|iPod|IEMobile|BlackBerry|Opera Mini/i.test(navigator.userAgent)
      || (navigator.maxTouchPoints > 1 && window.matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 900);
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
  const _onFsChange = () => {
    const fsEl = document.fullscreenElement
              || document.webkitFullscreenElement
              || document.mozFullScreenElement
              || document.msFullscreenElement;
    if (fsEl) tryLockLandscape();
  };
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

// Audio unlock global : au TOUT PREMIER click/touch/key, on play+pause un mp3
// silent pour debloquer la policy autoplay de Firefox/Chrome. Apres ca, tous les
// audios subsequents peuvent play() sans probleme.
let _audioUnlocked = false;
function _unlockAudio() {
  if (_audioUnlocked) return;
  _audioUnlocked = true;
  console.log('[audio] unlocking via user gesture');
  try {
    // Liste des mp3 critiques a precharger + unlocker
    const list = [
      'ce_matin.mp3',
      "touche_l'enseigne.mp3",
      'voix_narrateur_3.mp3',
      'au_coeur.mp3',
    ];
    list.forEach(name => {
      const a = new Audio('assets/' + name);
      a.preload = 'auto';
      a.muted = true;
      const p = a.play();
      if (p && p.then) {
        p.then(() => { try { a.pause(); a.currentTime = 0; a.muted = false; } catch(e){} })
         .catch(() => {});
      }
    });
  } catch(e) { console.warn('[audio] unlock failed:', e.message); }
  // Detache les listeners apres le 1er trigger
  document.removeEventListener('pointerdown', _unlockAudio, true);
  document.removeEventListener('keydown',     _unlockAudio, true);
  document.removeEventListener('touchstart',  _unlockAudio, true);
}
document.addEventListener('pointerdown', _unlockAudio, true);
document.addEventListener('keydown',     _unlockAudio, true);
document.addEventListener('touchstart',  _unlockAudio, true);
function stopAllVoices() {
  Object.values(_voiceCache).forEach(a => { try { a.pause(); a.currentTime = 0; } catch(e){} });
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
    const raw = localStorage.getItem('c3s7MicPos');
    if (raw) return JSON.parse(raw);
  } catch(e) {}
  return JSON.parse(JSON.stringify(C3S7_DEFAULT_POS));
}
function saveC3s7MicPositions(pos) {
  try { localStorage.setItem('c3s7MicPos', JSON.stringify(pos)); } catch(e) {}
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
  c2WordsSelected: [],
  vfScoreC2: 0,
  vfDoneC2: 0,
  vfAnsweredC2: [false, false, false, false],
  starsAwardedC2: false,
  c3SoundsPlayed: [],
  vfScoreC3: 0,
  vfDoneC3: 0,
  vfAnsweredC3: [false, false, false, false],
  starsAwardedC3: false
};

// Configuration & Default names
const charData = {
  fille:   { name: null,    img: 'assets/avatar_fille_1776108656117.png?v=2',  backVideo: 'assets/fille marche de dos.mp4', chromaKey: 'whiteKey', backImg: 'assets/fille de dos.jpg', walkRate: 0.6, profileImg: 'assets/fille_de_profil-removebg-preview.png', faceImg: 'assets/fille_face.jpg',      faceImgClean: 'assets/fille_face-removebg-preview.png' },
  garcon:  { name: null,    img: 'assets/avatar_garcon_1776108702967.png?v=2', backVideo: 'assets/garcon marche de dos.mp4', chromaKey: 'ultraSoftGreenKey', backImg: null, walkRate: 0.35, profileImg: 'assets/Garcon_de_profil-removebg-preview.png', faceImg: 'assets/garcon_de_face.jpg', faceImgClean: 'assets/garcon_de_face-removebg-preview.png' },
  renard:  { name: 'Rémi',  img: 'assets/avatar_renard_1776108778358.png?v=2', backVideo: 'assets/renard marche de dos.mp4', chromaKey: 'greenKey', backImg: null, walkRate: 0.6, profileImg: 'assets/Remi_de_profil-removebg-preview.png', faceImg: 'assets/remi_face.jpg',        faceImgClean: 'assets/remi_face-removebg-preview.png' },
  robot:   { name: 'Pixel', img: 'assets/avatar_robot_1776108872947.png?v=2',  backVideo: 'assets/pixel marche de dos.mp4', chromaKey: 'softGreenKey', backImg: null, walkRate: 0.6, profileImg: 'assets/pixel_de_profil-removebg-preview.png', faceImg: 'assets/pixel_face.jpg',      faceImgClean: 'assets/pixel_face-removebg-preview.png' }
};

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
    starsAwarded: state.starsAwarded
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
  if (!subtitlesEnabled()) document.body.classList.add('cc-off');
  updateAVToggles();
  setupOrientationLock();

  // Reprise automatique sur la dernière page visitée (après un F5)
  const resumeTarget = state.currentScreen;
  if (state.characterType && resumeTarget && resumeTarget !== 0) {
    if (typeof resumeTarget === 'number' && resumeTarget >= 2) {
      document.getElementById('main-header').style.display = 'flex';
      document.getElementById('main-progress').style.display = 'flex';
    }
    setTimeout(() => goToScreen(resumeTarget), 0);
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
    // Raccourcis de navigation par chapitre (PRIORITAIRES sur les
    // raccourcis dev pour éviter les conflits Alt+R/Alt+U etc.) :
    //   Chap 1  : Alt+0..8                     → écrans numériques
    //   Chap 2  : Alt+Shift+1..9               → c2s1..c2s9
    //   Chap 3  : Alt+A,Z,E,R,T,Y,U,I,O        → c3s1..c3s9 (rang du haut AZERTY)
    //   Chap 4  : Alt+Shift+A,Z,E,R,T,Y,U,I    → c4s1..c4s8
    //   Map     : Alt+M
    //
    // IMPORTANT : e.code reflète la position physique (= layout QWERTY),
    // donc presser A sur AZERTY = e.code 'KeyQ' (top-left letter). Le map
    // PHYS_TOP_ROW utilise les codes physiques, valable partout. On ajoute
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
    const letterIdx = PHYS_TOP_ROW[e.code]
                   || LOGIC_AZERTY[(e.key || '').toLowerCase()]
                   || null;

    let target;
    if (e.shiftKey && letterIdx && letterIdx <= 8) {
      target = `c4s${letterIdx}`;          // Chap 4 : Alt+Shift+lettre
    } else if (letterIdx) {
      target = `c3s${letterIdx}`;          // Chap 3 : Alt+lettre
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
    // Alt+P : calibration des 3 micros sur c3s7 (cibles rouges, 1/2/3 + flèches)
    if (e.code === 'KeyP' || (e.key || '').toLowerCase() === 'p') {
      e.preventDefault();
      console.log('[shortcut] Alt+P → toggleC3s7Calib');
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
  };
  window.addEventListener  ('keydown', _keyHandler, true);
  document.addEventListener('keydown', _keyHandler, true);

  console.log("IA Explorers — raccourcis : Chap1=Alt+0..8 | Chap2=Alt+Shift+1..9 | Chap3=Alt+A/Z/E/R/T/Y/U/I/O | Chap4=Alt+Shift+A/Z/E/R/T/Y/U/I | Carte=Alt+M");

  // Plein écran automatique au premier geste utilisateur, ET maintenu sur tous les écrans
  const autoFs = () => {
    if (!_fsElement()) enterFullscreen();
  };
  window.addEventListener('pointerdown', autoFs, true);
  window.addEventListener('touchend',    autoFs, true);
  window.addEventListener('keydown',     autoFs, true);
});

// Character Selection
function selectChar(type) {
  state.characterType = type;
  state.characterImage = charData[type].img;

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

// Start a mapped chapter
function startChapter(n) {
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

  // Hide all screens
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));

  // Show target
  const targetScreen = document.getElementById(`screen-${screenIdentifier}`);
  if (targetScreen) targetScreen.classList.add('active');

  state.currentScreen = screenIdentifier;
  saveState();

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

  // Cinématographie globale : Rue ou Novel
  if ((typeof screenIdentifier === 'number' && screenIdentifier >= 2) || isStoryStr) {
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
          leonAudio.play().catch(()=>{});
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
        narrAudio.play().catch(() => {
          // si l'audio est bloqué, on déroule quand même
          window.typewriterTimeout = setTimeout(playLeonPart, 2500);
        });
      } else {
        // Mode muet : on garde le rythme visuel d'origine (2,5s pour lire la narration)
        window.typewriterTimeout = setTimeout(playLeonPart, 2500);
      }
    }
  }

  if (screenIdentifier === 4) {
    const bubble4  = document.getElementById('s4-bubble');
    const s4ans    = document.getElementById('s4-answers');
    const leonVid4 = document.getElementById('leon-video-bg-4');
    const heroImg4 = document.getElementById('hero-back-4');
    const heroVid4 = document.getElementById('hero-back-video-4');
    if (s4ans) s4ans.classList.remove('show');

    // Héros de profil ou de dos (fallback)
    const cd = charData[state.characterType] || {};
    if (heroVid4 && heroImg4) {
      if (cd.profileImg) {
        heroImg4.src = cd.profileImg;
        heroImg4.style.display = 'block';
        heroVid4.style.display = 'none';
        heroImg4.style.filter = 'drop-shadow(0 8px 6px rgba(0,0,0,0.35))';
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

    if (leonVid4) {
      leonVid4.loop = true;
      leonVid4.pause();
      leonVid4.currentTime = 0;
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

      const narrAudio4 = getVoice('au_coeur', 'assets/au_coeur.mp3?v=' + Date.now());
      const leonAudio4 = getVoice('voix_leon_4',     'assets/Voix_leon_4.mp3?v=' + Date.now());

      const startTypewriter4 = () => {
        bubble4.style.display = '';
        if (who4) who4.style.display = '';

        let i = 0;
        const duration = (leonAudio4 && isFinite(leonAudio4.duration) && leonAudio4.duration > 0)
          ? leonAudio4.duration * 1000 : (fullText.length * 32);
        const stepMs = Math.max(22, duration / fullText.length);

        if (voicesEnabled() && leonAudio4) {
          leonAudio4.currentTime = 0;
          leonAudio4.play().catch(()=>{});
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
            setTimeout(() => { if (s4ans) s4ans.classList.add('show'); }, 400);
          }
        };
        type4();
      };

      // 1) Narrateur d'abord, puis Léon
      if (voicesEnabled() && narrAudio4) {
        narrAudio4.currentTime = 0;
        const onNarrEnd4 = () => {
          narrAudio4.removeEventListener('ended', onNarrEnd4);
          setTimeout(startTypewriter4, 400);
        };
        narrAudio4.addEventListener('ended', onNarrEnd4);
        narrAudio4.play().catch(() => {
          window.typewriterTimeout = setTimeout(startTypewriter4, 3000);
        });
      } else {
        window.typewriterTimeout = setTimeout(startTypewriter4, 3000);
      }
    }
  }

  if (screenIdentifier === 6) {
    const heroImg6 = document.getElementById('hero-back-6');
    const cd6 = charData[state.characterType] || {};
    if (heroImg6) {
      heroImg6.src = cd6.profileImg || cd6.img || '';
      heroImg6.style.display = 'block';
      heroImg6.style.filter = 'drop-shadow(0 8px 6px rgba(0,0,0,0.35))';
    }
    const leonVid6 = document.getElementById('leon-video-bg-6');
    if (leonVid6) { try { leonVid6.play().catch(() => {}); } catch(e) {} }
    setTimeout(positionHero4, 50);
  }

  if (screenIdentifier === 5) {
    const heroImg5 = document.getElementById('hero-back-5');
    const cd = charData[state.characterType] || {};

    if (heroImg5) {
      if (cd.profileImg) {
        heroImg5.src = cd.profileImg;
        heroImg5.style.display = 'block';
        heroImg5.style.filter = 'url(#aiGreenKey)';
      } else {
        heroImg5.src = cd.img || '';
        heroImg5.style.display = 'block';
      }
    }

    const leonVid5 = document.getElementById('leon-video-bg-5');
    if (leonVid5) {
      // Reprise de la vidéo sans interruption visuelle si le navigateur met en cache correctement
      try { leonVid5.play().catch(()=>{}); } catch(e){}
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
    if (s5ans) s5ans.classList.remove('show');
    if (s5instr) s5instr.style.opacity = '0';
    // La bulle de Léon apparaît d'abord, puis instruction, puis choix
    setTimeout(() => { if (s5instr) { s5instr.style.transition = 'opacity 0.5s'; s5instr.style.opacity = '1'; } }, 1800);
    setTimeout(() => { if (s5ans) s5ans.classList.add('show'); }, 2200);
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
        // Tente de jouer + log les erreurs au lieu de les manger silencieusement
        try {
          const playP = narrAudio2.play();
          if (playP && playP.then) {
            playP.then(() => console.log('[narr] play OK'))
                 .catch(err => console.warn('[narr] play BLOCKED:', err.name, err.message));
          }
        } catch(e) { console.warn('[narr] play threw:', e.message); }
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
      // Filter chroma applique AVANT toute mise en visibilite (pour qu'il soit deja en place)
      vid2.style.filter = `url(#${chroma})`;
      // RESET position/transform au cas ou un walkToShopAndEnter precedent aurait laisse
      // un transform inline residuel (translate vers la porte).
      vid2.style.transition = 'none';
      vid2.style.transform  = 'translateX(-50%)';   // position par defaut (centre)
      // PAS de display:block ici -- on le passera en block uniquement apres seek+filter rendus
      vid2.style.display = 'none';
      vid2.style.opacity = '0';
      if (vidSrc.getAttribute('src') !== back) { vidSrc.src = back; vid2.load(); }
      let _revealed = false;
      const revealVid2 = () => {
        if (_revealed) return; _revealed = true;
        // Display:block puis 2 RAF pour que le filter SVG ait fini son rendu avant le fade-in
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
      vid2.addEventListener('seeked', revealVid2, { once: true });
      // Filet de securite : 1.5s au cas ou seeked ne tire pas
      setTimeout(revealVid2, 1500);
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

    // Chapitre 3 narratif : vidéo gelée sur frame 0 pendant que le narrateur parle.
    // Le play est déclenché plus bas via opts.onLeonStart (synchro avec voix Léon).
    const c3DeferredVideo = ['c3s1', 'c3s2', 'c3s3', 'c3s4', 'c3s5', 'c3s6'];
    // Chapitre 4 : même pattern (T1-T4 narratifs vidéo, T8 = badge final vidéo)
    const c4DeferredVideo = ['c4s1', 'c4s2', 'c4s3', 'c4s4', 'c4s5'];
    // Chapitre 5 : 4 narratifs vidéo (T1-T4), T5 image fixe (mini-jeu), T6 win
    const c5DeferredVideo = ['c5s1', 'c5s2', 'c5s3', 'c5s4'];
    // c2s1 et c3s1 : vidéo non-loop, joue ~4s puis se fige
    const cutAfter4s = ['c2s1', 'c3s1'];
    if ((c3DeferredVideo.includes(screenIdentifier) || c4DeferredVideo.includes(screenIdentifier) || c5DeferredVideo.includes(screenIdentifier)) && targetVideo) {
      targetVideo.loop = !cutAfter4s.includes(screenIdentifier);
      targetVideo.muted = true;
      targetVideo.currentTime = 0;
      try { targetVideo.pause(); } catch(e) {}
      // PRIME : un play() bref puis pause SANS reset de currentTime ni load(),
      // pour que la première frame soit décodée et rendue à l'écran. Quand
      // onLeonStart fait v.play() plus tard, la lecture reprend à la même
      // position sans nouveau décodage → démarrage instantané.
      // NB : on n'appelle PAS load() (qui flusherait le buffer) ni
      // currentTime=0 après pause (qui re-seek et invalide les frames).
      const _primePause = () => { try { targetVideo.pause(); } catch(e) {} };
      const _primePromise = targetVideo.play();
      if (_primePromise && typeof _primePromise.then === 'function') {
        _primePromise.then(() => {
          // Attend qu'au moins une frame soit rendue avant de pauser
          if (typeof targetVideo.requestVideoFrameCallback === 'function') {
            targetVideo.requestVideoFrameCallback(_primePause);
          } else {
            requestAnimationFrame(() => requestAnimationFrame(_primePause));
          }
        }).catch(_primePause);
      } else {
        setTimeout(_primePause, 60);
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
    const narrativeC2 = ['c2s1','c2s2','c2s4','c2s5','c2s6'];
    const narrativeC3 = ['c3s1','c3s2','c3s3','c3s4','c3s5','c3s6','c3s7'];
    const narrativeC4 = ['c4s1','c4s2','c4s3','c4s4','c4s5'];
    const narrativeC5 = ['c5s1','c5s2','c5s3','c5s4'];
    const isNarrative = narrativeC2.includes(screenIdentifier) || narrativeC3.includes(screenIdentifier) || narrativeC4.includes(screenIdentifier) || narrativeC5.includes(screenIdentifier);

    if (isNarrative) {
      // Audios + callbacks optionnels par écran
      const optsMap = {
        c2s4: {
          onComplete: () => {
            const v = document.getElementById('leon-video-c2s4');
            if (!v) return;
            if (v._earlyLoop) v.removeEventListener('timeupdate', v._earlyLoop);
            try { v.pause(); } catch(e) {}
          }
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
          onLeonEnd:   () => { const v = document.getElementById('leon-video-c3s2'); if (v) { try { v.pause(); } catch(e) {} } }
        },
        c3s3: {
          narratorAudio: 'assets/chapitre_3/t3_narrateur.mp3', leonAudio: 'assets/chapitre_3/t3_leon.mp3',
          onLeonStart: () => { const v = document.getElementById('leon-video-c3s3'); if (v) v.play().catch(()=>{}); },
          onLeonEnd:   () => { const v = document.getElementById('leon-video-c3s3'); if (v) { try { v.pause(); } catch(e) {} } }
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
          onLeonEnd:   () => { const v = document.getElementById('leon-video-c3s5'); if (v) { try { v.pause(); } catch(e) {} } }
        },
        c3s6: {
          narratorAudio: 'assets/chapitre_3/t6_narrateur.mp3', leonAudio: 'assets/chapitre_3/t6_leon.mp3',
          onLeonStart: () => { const v = document.getElementById('leon-video-c3s6'); if (v) v.play().catch(()=>{}); },
          onLeonEnd:   () => { const v = document.getElementById('leon-video-c3s6'); if (v) { try { v.pause(); } catch(e) {} } }
        },
        // c3s7 : mini-jeu, mais on garde le karaoké narrateur+Léon (image fixe)
        c3s7: {
          narratorAudio: 'assets/chapitre_3/t7_narrateur.mp3', leonAudio: 'assets/chapitre_3/t7_leon.mp3'
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
          onLeonEnd:   () => { const v = document.getElementById('leon-video-c4s2'); if (v) { try { v.pause(); } catch(e) {} } }
        },
        c4s3: {
          narratorAudio: 'assets/chapitre_4/t3_narrateur.mp3', leonAudio: 'assets/chapitre_4/t3_leon.mp3',
          onLeonStart: () => { const v = document.getElementById('leon-video-c4s3'); if (v) v.play().catch(()=>{}); },
          onLeonEnd:   () => { const v = document.getElementById('leon-video-c4s3'); if (v) { try { v.pause(); } catch(e) {} } }
        },
        c4s4: {
          narratorAudio: 'assets/chapitre_4/t4_narrateur.mp3', leonAudio: 'assets/chapitre_4/t4_leon.mp3',
          onLeonStart: () => { const v = document.getElementById('leon-video-c4s4'); if (v) v.play().catch(()=>{}); },
          onLeonEnd:   () => { const v = document.getElementById('leon-video-c4s4'); if (v) { try { v.pause(); } catch(e) {} } }
        },
        c4s5: {
          narratorAudio: 'assets/chapitre_4/t5_narrateur.mp3', leonAudio: 'assets/chapitre_4/t5_leon.mp3',
          onLeonStart: () => { const v = document.getElementById('leon-video-c4s5'); if (v) v.play().catch(()=>{}); },
          onLeonEnd:   () => { const v = document.getElementById('leon-video-c4s5'); if (v) { try { v.pause(); } catch(e) {} } }
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
          onLeonEnd:   () => { const v = document.getElementById('leon-video-c5s2'); if (v) { try { v.pause(); } catch(e) {} } }
        },
        c5s3: {
          narratorAudio: 'assets/chapitre_5/t3_narrateur.mp3', leonAudio: 'assets/chapitre_5/t3_leon.mp3',
          onLeonStart: () => { const v = document.getElementById('leon-video-c5s3'); if (v) v.play().catch(()=>{}); },
          onLeonEnd:   () => { const v = document.getElementById('leon-video-c5s3'); if (v) { try { v.pause(); } catch(e) {} } }
        },
        c5s4: {
          narratorAudio: 'assets/chapitre_5/t4_narrateur.mp3', leonAudio: 'assets/chapitre_5/t4_leon.mp3',
          onLeonStart: () => { const v = document.getElementById('leon-video-c5s4'); if (v) v.play().catch(()=>{}); },
          onLeonEnd:   () => { const v = document.getElementById('leon-video-c5s4'); if (v) { try { v.pause(); } catch(e) {} } }
        }
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
  if (screenIdentifier === 'c2s7') {
    state.c2WordsSelected = [];
    saveState();
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
    saveState();
    document.querySelectorAll('#c3s7-sounds .sound-btn').forEach(b => {
      b.classList.remove('played');
      b.onclick = () => playSoundC3(b);
    });
    const transcript = document.getElementById('c3s7-transcription');
    if (transcript) transcript.textContent = '— —';
    document.getElementById('btn-to-c3s8')?.classList.remove('show-btn');
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
      if (bonus > 0) document.getElementById('stars-earned-c3').textContent = `+1 ⭐ bonus replay !`;
      else document.getElementById('stars-earned-c3').textContent = `Bravo !`;
    }
    if (!state.chaptersCompleted.includes(3)) {
      state.chaptersCompleted.push(3);
    }
    saveState();
    launchConfettiC3();
  }

  // ============================================================
  // CHAPITRE 4 : BOT, L'IA QUI PARLE — handlers spécifiques
  // ============================================================
  if (screenIdentifier === 'c4s6') {
    state.c4QuestionsAsked = [];
    saveState();
    document.querySelectorAll('#c4s6-questions .sound-btn').forEach(b => {
      b.classList.remove('played');
      b.onclick = () => askBotC4(b);
    });
    const ans = document.getElementById('c4s6-answer');
    if (ans) ans.textContent = '— —';
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
      if (bonus > 0) document.getElementById('stars-earned-c4').textContent = `+1 ⭐ bonus replay !`;
      else document.getElementById('stars-earned-c4').textContent = `Bravo !`;
    }
    if (!state.chaptersCompleted.includes(4)) {
      state.chaptersCompleted.push(4);
    }
    saveState();
    if (typeof launchConfettiC3 === 'function') launchConfettiC3();
  }

  // ============================================================
  // CHAPITRE 5 — Le toit aux étoiles : mini-jeu robot + victoire
  // ============================================================
  if (screenIdentifier === 'c5s5') {
    state.c5RobotModules = [];
    saveState();
    document.querySelectorAll('#c5s5-modules .c5-module-btn').forEach(b => {
      b.classList.remove('selected');
      b.disabled = false;
      b.onclick = () => selectC5Module(b);
    });
    const result = document.getElementById('c5s5-result');
    if (result) result.style.display = 'none';
    document.getElementById('btn-to-c5s6')?.classList.remove('show-btn');
    const instr = document.getElementById('c5s5-instruction');
    if (instr) instr.innerHTML = 'Choisis <strong>3 modules</strong> pour ton robot 👇';
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
      if (bonus > 0) document.getElementById('stars-earned-c5').textContent = `+1 ⭐ bonus replay !`;
      else document.getElementById('stars-earned-c5').textContent = `Bravo !`;
    }
    if (!state.chaptersCompleted.includes(5)) {
      state.chaptersCompleted.push(5);
    }
    saveState();
    if (typeof launchConfettiC3 === 'function') launchConfettiC3();
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
      if (bonus > 0) document.getElementById('stars-earned-c2').textContent = `+1 ⭐ bonus replay !`;
      else document.getElementById('stars-earned-c2').textContent = `Bravo !`;
    }
    if (!state.chaptersCompleted.includes(2)) {
      state.chaptersCompleted.push(2);
    }
    saveState();
    launchConfettiC2();
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
      if (bonus > 0) document.getElementById('stars-earned').textContent = `+1 ⭐ bonus replay !`;
      else document.getElementById('stars-earned').textContent = `Bravo !`;
    }
    if (!state.chaptersCompleted.includes(1)) {
      state.chaptersCompleted.push(1);
    }
    saveState();
    launchConfetti();
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

    // L'avatar devient le pion
    const sagaHero = document.getElementById('map-hero-avatar');
    if (sagaHero && state.characterImage) {
      sagaHero.src = state.characterImage;
      sagaHero.style.display = 'block';
    }

    updateMapState();
    // Restaure les positions des noeuds calibrées par l'utilisateur (si modifiées via 🎯 Calibrer)
    if (typeof applyMapNodePositions === 'function') applyMapNodePositions();
    // Positionne l'avatar sur le prochain chapitre à jouer
    const nextChap = (state.chaptersCompleted.length || 0) + 1;
    const avatarNode = document.getElementById('map-node-' + Math.min(nextChap, 5));
    const fallbackNode = document.getElementById('map-node-1');
    const anchorNode = avatarNode || fallbackNode;
    if (anchorNode && sagaHero) {
      sagaHero.style.top = anchorNode.style.top;
      sagaHero.style.left = anchorNode.style.left;
    }

    // Force le scroll vers le bas de la carte
    const screenMap = document.getElementById('screen-map');

    function scrollMapToBottom() {
      if (screenMap) {
        screenMap.scrollTop = screenMap.scrollHeight;
      }
    }

    requestAnimationFrame(scrollMapToBottom);
    setTimeout(scrollMapToBottom, 50);
    setTimeout(scrollMapToBottom, 300);
    setTimeout(scrollMapToBottom, 800);

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
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Update progress bar
  if (typeof screenIdentifier === 'number' && screenIdentifier >= 1 && screenIdentifier <= 6) {
    updateProgress(screenIdentifier);
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

  // Position cible = marker destination heros (calibre par l'utilisateur)
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
  vid2.style.transform  = `translateX(-50%) translate(${dx}px, ${dy}px) scale(0.88)`;
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
function enterFullscreen() {
  if (_fsElement()) return Promise.resolve();
  return _fsRequest(document.documentElement).then(() => {
    try { if (typeof tryLockLandscape === 'function') tryLockLandscape(); } catch (e) {}
  }).catch((err) => {
    console.log('[fs] enterFullscreen refuse :', err && err.message);
  });
}
function toggleFullscreen() {
  if (!_fsElement()) {
    enterFullscreen();
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
  const starEl = document.getElementById('star-count');
  if (starEl) {
    starEl.textContent = state.totalStars;
    starEl.style.transform = 'scale(1.5)';
    setTimeout(() => { starEl.style.transform = 'scale(1)'; }, 300);
  }
  // Sync aussi la pastille top-left de la rue + le bouton atelier de la map
  const ssc = document.getElementById('street-star-count');
  if (ssc) ssc.textContent = state.totalStars;
  const msc = document.getElementById('map-star-count');
  if (msc) msc.textContent = state.totalStars;
  const asc = document.getElementById('atelier-star-count');
  if (asc) asc.textContent = state.totalStars;
}

// Bonus replay : +1 etoile la premiere fois qu'on rejoue un chapitre.
// Renvoie le nombre de bonus accordes (0 ou 1).
function awardReplayBonus(chapterNum) {
  if (!state.replayBonusGiven) state.replayBonusGiven = {};
  if (state.replayBonusGiven[chapterNum]) return 0;
  state.replayBonusGiven[chapterNum] = true;
  addStars(1);
  saveState();
  return 1;
}

// Screen 5: Tap mini-game
function tapAnswer(element, isCorrect) {
  if (state.tapAnswered) return;

  const options = document.querySelectorAll('.tap-option');
  const feedback = document.getElementById('tap-feedback');

  if (isCorrect) {
    state.tapAnswered = true;
    options.forEach(o => o.classList.add('answered'));
    element.classList.add('correct');
    feedback.textContent = '🎉 Bravo ! L\'IA ne peut pas faire de câlins — elle n\'a pas de corps !';
    feedback.style.color = '#0A6B4A';
    feedback.classList.add('show');
    const btnTo6 = document.getElementById('btn-to-6');
    btnTo6.classList.add('show-btn');
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

// ============================================================
// GESTION DE LA CARTE — DÉVERROUILLAGE DES CHAPITRES
// ============================================================
const MAP_NODE_ICONS = ['⚙️', '🎨', '🎵', '💬', '🏆'];

function updateMapState() {
  const completed = state.chaptersCompleted || [];

  for (let i = 1; i <= 5; i++) {
    const node = document.getElementById('map-node-' + i);
    if (!node) continue;
    const shouldUnlock = i === 1 || completed.includes(i - 1);
    if (shouldUnlock) {
      node.classList.remove('node-locked');
      node.classList.add('node-unlocked');
      if (!node.getAttribute('onclick')) {
        node.setAttribute('onclick', `startChapter(${i})`);
      }
      const icon = node.querySelector('.node-icon');
      if (icon) {
        icon.textContent = MAP_NODE_ICONS[i - 1];
        icon.classList.remove('locked-icon');
      }
    }
  }

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
      leonAudio.play().catch(()=>{});
      leonAudio.addEventListener('ended', fireLeonEnd, { once: true });
    }

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
    narrAudio.play().catch(() => {
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
  const PRE_DELAY  = 700;
  const POST_TYPE  = 500;
  const PIXEL_TOTAL_MS = 2000;

  window._c2s3Timer = setTimeout(() => {
    // 1) Typewriter du texte sur la toile
    let i = 0;
    window._c2s3TypeInterval = setInterval(() => {
      if (i < promptText.length) {
        tw.textContent += promptText.charAt(i);
        i++;
      } else {
        clearInterval(window._c2s3TypeInterval);
        // 2) Apparition pixel par pixel du chat (ordre aléatoire, fond transparent)
        setTimeout(() => {
          const fragments = catZone.querySelectorAll('.cat-pixel');
          const order = [...Array(fragments.length).keys()].sort(() => Math.random() - 0.5);
          const stepMs = PIXEL_TOTAL_MS / fragments.length;
          order.forEach((idx, n) => {
            setTimeout(() => fragments[idx].classList.add('shown'), n * stepMs);
          });
          // 3) Une fois le chat complètement apparu : lance le karaoké de Léon
          setTimeout(() => playStoryScene('c2s3'), PIXEL_TOTAL_MS + 300);
        }, POST_TYPE);
      }
    }, STEP_MS);
  }, PRE_DELAY);
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
const PROMPT_WORDS_C2 = {
  // Sujets — silhouettes SVG colorables (fallback si pas d'image générée)
  chat:    { cat: 'subject', svg: SVG_CAT,     en: 'cat'     },
  dragon:  { cat: 'subject', svg: SVG_DRAGON,  en: 'dragon'  },
  licorne: { cat: 'subject', svg: SVG_UNICORN, en: 'unicorn' },
  // Couleurs (appliquées au fill du SVG ; en = nom anglais pour les fichiers)
  rouge:  { cat: 'color', glow: '#FF3B3B', label: 'rouge',  en: 'red'    },
  bleu:   { cat: 'color', glow: '#1E90FF', label: 'bleu',   en: 'blue'   },
  violet: { cat: 'color', glow: '#9B30FF', label: 'violet', en: 'purple' },
  // Styles (animation + accessoire)
  volant: { cat: 'style', accessory: '🦋', cls: 'style-volant' },
  géant:  { cat: 'style', accessory: '⭐', cls: 'style-geant'  },
  rigolo: { cat: 'style', accessory: '🎉', cls: 'style-rigolo' }
};

function selectPromptWord(btn) {
  const word = btn.dataset.w;
  const idx = state.c2WordsSelected.indexOf(word);
  if (idx !== -1) {
    state.c2WordsSelected.splice(idx, 1);
    btn.classList.remove('selected');
  } else if (state.c2WordsSelected.length < 3) {
    state.c2WordsSelected.push(word);
    btn.classList.add('selected');
  } else {
    return; // déjà 3 mots
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
  const promptText = sorted.join(' ');

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

  // Bouton suivant après le reveal
  setTimeout(() => document.getElementById('btn-to-c2s8')?.classList.add('show-btn'), 800);
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
  document.getElementById('btn-to-c2s9')?.classList.add('show-btn');
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
  dog:     { audio: 'assets/dragon-studio-free-dog-barking-sounds-427411.mp3', transcription: '« WAOUF WAOUF&nbsp;! » 🐕✅',                 verdict: 'correct' },
  piano:   { audio: 'assets/11325622-piano-chords-239967.mp3',                 transcription: '« Quelqu\'un fait du popcorn&nbsp;! » 🍿❌',   verdict: 'wrong'   },
  thunder: { audio: 'assets/soundmarker33-thunder-clap-512544.mp3',            transcription: '« BOUM ! Patatra&nbsp;! » ⛈️✅',               verdict: 'correct' }
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

  // 1) Tenter le mp3 si dispo (cache : si on a déjà constaté qu'il manque,
  //    on saute direct à la synthèse pour éviter le délai du 404).
  if (data.audio && _c3SoundFileExists[id] !== false) {
    const a = new Audio(data.audio);
    a.volume = 0.65;
    a.addEventListener('error', () => {
      _c3SoundFileExists[id] = false;       // mémorise pour les clics suivants
      _synthFallbackC3(id);
    }, { once: true });
    a.addEventListener('canplay', () => {
      _c3SoundFileExists[id] = true;
    }, { once: true });
    const playPromise = a.play();
    if (playPromise && playPromise.catch) {
      playPromise.catch(() => {
        _c3SoundFileExists[id] = false;
        _synthFallbackC3(id);
      });
    }
  } else {
    // 2) Fallback synthèse Web Audio API (pas de fichier requis)
    _synthFallbackC3(id);
  }

  btn.classList.add('played');
  if (!state.c3SoundsPlayed.includes(id)) state.c3SoundsPlayed.push(id);
  saveState();

  // Affiche la transcription "AI" après ~1s (fait semblant que l'IA écoute)
  const transcript = document.getElementById('c3s7-transcription');
  if (transcript) {
    transcript.classList.add('listening');
    transcript.innerHTML = '<em>👂 J\'écoute...</em>';
    setTimeout(() => {
      transcript.classList.remove('listening');
      transcript.innerHTML = data.transcription;
    }, 1100);
  }

  // Quand les 3 sons ont été joués → bouton "Au quiz"
  if (state.c3SoundsPlayed.length === 3) {
    setTimeout(() => document.getElementById('btn-to-c3s8')?.classList.add('show-btn'), 800);
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
  document.getElementById('btn-to-c3s9')?.classList.add('show-btn');
}

// ============================================================
// CHAPITRE 4 — Bot, l'IA qui parle : mini-jeu + quiz + confetti
// ============================================================
const C4_QUESTIONS = {
  capital: { answer: '« Paris ! » 🇫🇷✅',                                     verdict: 'correct' },
  cat:     { answer: '« Un chat a 4 pattes ! » 🐱✅',                          verdict: 'correct' },
  moon:    { answer: 'La Lune est faite de fromage ! 🧀❌ (FAUX !)',        verdict: 'wrong'   },
  math:    { answer: '7 x 6 = 56 ! ❌ (la vraie réponse est 42)',                verdict: 'wrong'   }
};

function askBotC4(btn) {
  const id = btn.dataset.id;
  const data = C4_QUESTIONS[id];
  if (!data) return;
  btn.classList.add('played');
  if (!state.c4QuestionsAsked.includes(id)) state.c4QuestionsAsked.push(id);
  saveState();
  const ans = document.getElementById('c4s6-answer');
  if (ans) {
    ans.classList.add('listening');
    ans.innerHTML = '<em>🤖 Bot réfléchit...</em>';
    setTimeout(() => {
      ans.classList.remove('listening');
      ans.innerHTML = data.answer;
    }, 1100);
  }
  if (state.c4QuestionsAsked.length === 4) {
    setTimeout(() => document.getElementById('btn-to-c4s7')?.classList.add('show-btn'), 800);
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
  document.getElementById('btn-to-c4s8')?.classList.add('show-btn');
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

// ============================================================
// CHAPITRE 5 — Mini-jeu "Construis ton robot IA" (T5/c5s5)
// ============================================================
// Combinaisons triées (3 modules sur 5) → persona unique du robot
// Clés: triplet alphabétique des modules choisis (ex: "act+see+think")
const C5_ROBOT_PERSONAS = {
  // 10 combinaisons C(5,3) = 10
  'see+hear+speak':  { name: 'Aria',   mission: 'Aria t\'écoute, te répond et regarde autour : un assistant qui te tient compagnie partout !', emoji: '🌟' },
  'see+hear+think':  { name: 'Iris',   mission: 'Iris regarde, écoute et réfléchit : elle peut analyser un film ou un concert et tout te résumer !', emoji: '🌈' },
  'see+hear+act':    { name: 'Vega',   mission: 'Vega regarde, écoute et agit : un robot guide pour les personnes mal-voyantes ou mal-entendantes !', emoji: '🦮' },
  'see+speak+think': { name: 'Sirius', mission: 'Sirius regarde, parle et réfléchit : il peut décrire le monde à voix haute et raconter des histoires basées sur ce qu\'il voit !', emoji: '📚' },
  'see+speak+act':   { name: 'Lumi',   mission: 'Lumi regarde, parle et agit : ton robot artiste qui dessine en parlant de ses créations !', emoji: '🎨' },
  'see+think+act':   { name: 'Astra',  mission: 'Astra regarde, réfléchit et agit : elle range ta chambre toute seule en repérant ce qui est en désordre !', emoji: '🧹' },
  'hear+speak+think':{ name: 'Echo',   mission: 'Echo écoute, parle et réfléchit : un compagnon de discussion qui adore les énigmes et les blagues !', emoji: '💡' },
  'hear+speak+act':  { name: 'Melo',   mission: 'Melo écoute, parle et agit : un robot musicien qui joue avec toi et chante en chœur !', emoji: '🎵' },
  'hear+think+act':  { name: 'Orion',  mission: 'Orion écoute, réfléchit et agit : un sauveteur qui repère les bruits suspects et alerte si quelque chose ne va pas !', emoji: '🚨' },
  'speak+think+act': { name: 'Nova',   mission: 'Nova parle, réfléchit et agit : ton coach personnel qui t\'aide à apprendre, faire tes devoirs ou inventer des jeux !', emoji: '🚀' },
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
    revealC5Robot();
  } else {
    // Sinon, masque le résultat
    const result = document.getElementById('c5s5-result');
    if (result) result.style.display = 'none';
    document.getElementById('btn-to-c5s6')?.classList.remove('show-btn');
  }
}

function revealC5Robot() {
  const mods = (state.c5RobotModules || []).slice().sort();
  const key = mods.join('+');
  const persona = C5_ROBOT_PERSONAS[key] || {
    name: 'Pixel',
    mission: 'Ton robot a une combinaison unique ! A toi d\'imaginer sa mission.',
    emoji: '🤖'
  };
  // Cache phase-pick, montre phase-robot
  const phasePick  = document.getElementById('c5s5-phase-pick');
  const phaseRobot = document.getElementById('c5s5-phase-robot');
  if (phasePick)  phasePick.style.display = 'none';
  if (phaseRobot) phaseRobot.style.display = '';
  // Verrouille les autres modules
  document.querySelectorAll('#c5s5-modules .c5-module-btn:not(.selected)').forEach(b => b.disabled = true);
  // SVG robot avec slots pour les 3 modules choisis
  const robotEl = document.getElementById('c5s5-robot');
  if (robotEl) robotEl.innerHTML = buildRobotSVG(mods);
  // Boot-up : message "On allume le module X..." sequentiellement
  const moduleNames = { see: 'Voir', hear: 'Ecouter', speak: 'Parler', think: 'Reflechir', act: 'Agir' };
  const moduleEmoji = { see: '👁️',  hear: '👂',     speak: '💬',    think: '🧠',       act: '💪' };
  const bootMsg = document.getElementById('c5s5-bootmsg');
  if (bootMsg) bootMsg.textContent = '';
  let bootStep = 0;
  const bootInterval = setInterval(() => {
    if (bootStep >= mods.length) {
      clearInterval(bootInterval);
      if (bootMsg) bootMsg.textContent = '✨ Robot pret ! Clique sur un module pour le tester.';
      // Active les démos cliquables sur les slots du robot
      mods.forEach(m => {
        const slot = document.querySelector('#c5s5-robot .robot-slot[data-mod="' + m + '"]');
        if (slot) {
          slot.classList.add('clickable');
          slot.onclick = () => playC5ModuleDemo(m);
        }
      });
      // Set name + mission + bouton continuer
      const nameEl = document.getElementById('c5s5-robot-name');
      const missionEl = document.getElementById('c5s5-robot-mission');
      if (nameEl)    nameEl.innerHTML = `${persona.emoji} <strong>${persona.name}</strong>`;
      if (missionEl) missionEl.textContent = persona.mission;
      setTimeout(() => document.getElementById('btn-to-c5s6')?.classList.add('show-btn'), 800);
      return;
    }
    const m = mods[bootStep];
    if (bootMsg) bootMsg.textContent = `${moduleEmoji[m]} ${moduleNames[m]} ON...`;
    // Allume le slot correspondant dans le SVG
    const slot = document.querySelector('#c5s5-robot .robot-slot[data-mod="' + m + '"]');
    if (slot) slot.classList.add('lit');
    bootStep++;
  }, 700);
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

// Demo d'un module : affiche un message dans la bulle + animation visuelle
function playC5ModuleDemo(mod) {
  const bubble = document.getElementById('c5s5-bubble');
  const slot   = document.querySelector('#c5s5-robot .robot-slot[data-mod="' + mod + '"]');
  if (slot) {
    slot.classList.add('demo-active');
    setTimeout(() => slot.classList.remove('demo-active'), 1500);
  }
  const demos = {
    see:   '👁️ Je vois un chat noir, une fleur jaune, et toi qui souris !',
    hear:  '👂 Tic-tac... J entends une horloge, des oiseaux dehors, et un avion qui passe.',
    speak: '💬 Bonjour ! Je peux te raconter une histoire ou repondre a tes questions.',
    think: '🧠 Si 2+2=4 et 4+4=8, alors 8+8=16. Facile !',
    act:   '💪 Je peux ranger ta chambre, cuisiner, ou te tendre un objet eloigne.'
  };
  if (bubble) {
    bubble.textContent = demos[mod] || '';
    bubble.style.display = 'block';
    bubble.classList.remove('anim-pop-in');
    void bubble.offsetWidth;  // force reflow pour rejouer l'animation
    bubble.classList.add('anim-pop-in');
  }
}

// ============================================================
// MON ATELIER — Boutique, Collection, Badges
// ============================================================
// Catalogue d'articles cosmétiques (accessoires avatar) + cartes à collectionner
const ARTICLES_CATALOG = [
  // Accessoires avatar (équipables)
  { id: 'cap-leon',      kind: 'accessory', slot: 'hat',     emoji: '🧢', name: 'Cap de Léon',           cost:  8, desc: 'La même casquette à patches que Léon !' },
  { id: 'magic-hat',     kind: 'accessory', slot: 'hat',     emoji: '🎩', name: 'Chapeau de magicien',  cost:  8, desc: 'Pour faire chic et mystérieux.' },
  { id: 'crown',         kind: 'accessory', slot: 'hat',     emoji: '👑', name: 'Couronne dorée',       cost: 20, desc: 'Article premium qui brille.' },
  { id: 'glasses-ai',    kind: 'accessory', slot: 'glasses', emoji: '🕶️', name: 'Lunettes IA',           cost:  6, desc: 'Lunettes futuristes lumineuses.' },
  { id: 'cape-hero',     kind: 'accessory', slot: 'cape',    emoji: '🦸', name: 'Cape de héros',         cost: 12, desc: 'Cape rouge brodée d\'étoiles.' },
  // Cartes à collectionner (achetables OU gagnées via chapitres)
  { id: 'card-leon',     kind: 'card', emoji: '👴', name: 'Léon',  cost: 10, desc: 'Le maître inventeur, ton guide à travers tous les chapitres.' },
  { id: 'card-bot',   kind: 'card', emoji: '🤖', name: 'Bot',   cost: 10, desc: 'L IA qui parle. A lu des millions de livres mais peut se tromper.' },
  { id: 'card-pixel', kind: 'card', emoji: '🎨', name: 'Pixel', cost: 10, desc: 'L IA qui cree des images magiques a partir de mots.' },
  { id: 'card-echo',  kind: 'card', emoji: '🎵', name: 'Echo',  cost: 10, desc: 'L IA des sons qui compose et reconnait la musique.' }
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

function applyAvatarAccessoriesEverywhere() {
  _ensureAtelierState();
  const slots = state.equippedAccessories || {};
  document.querySelectorAll('.avatar-with-accessories').forEach(host => {
    host.querySelectorAll('.avatar-accessory').forEach(n => n.remove());
    ['hat', 'glasses', 'cape'].forEach(slot => {
      const id = slots[slot];
      if (!id) return;
      const item = ARTICLES_CATALOG.find(a => a.id === id);
      if (!item) return;
      const acc = document.createElement('span');
      acc.className = 'avatar-accessory accessory-' + slot;
      acc.textContent = item.emoji;
      host.appendChild(acc);
    });
  });
}

function refreshAtelierUI() {
  if (typeof renderAtelierModal === 'function') renderAtelierModal();
  if (typeof updateStarBadge === 'function')    updateStarBadge();
}

// ============================================================
// Calibration interactive de la map (drag-and-drop des 5 noeuds)
// ============================================================
function loadMapNodePositions() {
  try {
    const raw = localStorage.getItem('mapNodePositions');
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
  try { localStorage.setItem('mapNodePositions', JSON.stringify(pos)); } catch(e) {}
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
    console.log('🎯 Calib map OFF — positions sauvegardees :', loadMapNodePositions);
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
// Calibration de la pastille etoile sur la rue
// ============================================================
function loadStarCornerPosition() {
  try {
    const raw = localStorage.getItem('starCornerPos');
    if (raw) return JSON.parse(raw);
  } catch(e) {}
  return { top: 16, left: 18 };  // px par defaut
}
function saveStarCornerPosition(pos) {
  try { localStorage.setItem('starCornerPos', JSON.stringify(pos)); } catch(e) {}
}
function applyStarCornerPosition() {
  const el = document.getElementById('street-star-corner');
  if (!el) return;
  const p = loadStarCornerPosition();
  el.style.top  = p.top  + 'px';
  el.style.left = p.left + 'px';
}
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
    const raw = localStorage.getItem('signZonePos');
    if (raw) return JSON.parse(raw);
  } catch(e) {}
  return { top: 50, left: 50, width: 18, height: 12 };
}
function saveSignZonePos(p) {
  try { localStorage.setItem('signZonePos', JSON.stringify(p)); } catch(e) {}
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
  if (el) el.classList.toggle('tip-open');
}

// ============================================================
// Calibration : pointeur 👆 et destination du heros (rue)
// ============================================================
function loadPointerPos()  { try { const r = localStorage.getItem('pointerPos');  if (r) return JSON.parse(r); } catch(e) {} return { top: 45, left: 50 }; }
function savePointerPos(p) { try { localStorage.setItem('pointerPos',  JSON.stringify(p)); } catch(e) {} }
function applyPointerPos() {
  const el = document.getElementById('sign-pointer');
  if (!el) return;
  const p = loadPointerPos();
  el.style.top  = p.top  + '%';
  el.style.left = p.left + '%';
}

function loadHeroDestPos()  { try { const r = localStorage.getItem('heroDestPos');  if (r) return JSON.parse(r); } catch(e) {} return { top: 70, left: 50 }; }
function saveHeroDestPos(p) { try { localStorage.setItem('heroDestPos',  JSON.stringify(p)); } catch(e) {} }
function applyHeroDestPos() {
  const el = document.getElementById('hero-destination');
  if (!el) return;
  const p = loadHeroDestPos();
  el.style.top  = p.top  + '%';
  el.style.left = p.left + '%';
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

function toggleHeroDestCalib() {
  document.body.classList.toggle('calib-hero-mode');
  const el = document.getElementById('hero-destination');
  if (!el) return;
  if (document.body.classList.contains('calib-hero-mode')) {
    if (!window._heroDestDragHandler) window._heroDestDragHandler = _genericPctDrag(el, saveHeroDestPos);
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
      it.className = 'atelier-item' + (owned ? ' owned' : (canBuy ? '' : ' locked'));
      let btn = '';
      if (owned) {
        btn = '<button class="atelier-item-btn" disabled>Achete</button>';
      } else {
        btn = '<button class="atelier-item-btn" ' + (canBuy ? '' : 'disabled') + ' onclick="buyArticleUI(\'' + a.id + '\')">Acheter</button>';
      }
      it.innerHTML = '<div class="atelier-item-emoji">' + a.emoji + '</div>' +
                     '<div class="atelier-item-name">' + a.name + '</div>' +
                     '<div class="atelier-item-desc">' + a.desc + '</div>' +
                     '<div class="atelier-item-cost">' + a.cost + ' ⭐</div>' +
                     btn;
      tShop.appendChild(it);
    });
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
        it.innerHTML = '<div class="atelier-item-emoji">' + a.emoji + '</div>' +
                       '<div class="atelier-item-name">' + a.name + '</div>' +
                       '<div class="atelier-item-desc">' + a.desc + '</div>' +
                       action;
        tVest.appendChild(it);
      });
    }
  }
}

function buyArticleUI(id) {
  const r = buyArticle(id);
  if (!r.ok && r.reason === 'pas assez d etoiles') {
    alert('Pas assez d etoiles ! Joue d autres chapitres pour en gagner.');
  }
}
e: false });
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
  document.getElementById('atelier-content-vest'  ).style.display = tab === 'vest'   ? '' : 'none';
  renderAtelierModal();
}

function renderAtelierModal() {
  _ensureAtelierState();
  const starEl = document.getElementById('atelier-star-count');
  if (starEl) starEl.textContent = state.totalStars || 0;
  // Badges
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
  // Shop
  const tShop = document.getElementById('atelier-content-shop');
  if (tShop) {
    tShop.innerHTML = '';
    ARTICLES_CATALOG.forEach(a => {
      const owned = ownsArticle(a.id);
      const canBuy = !owned && (state.totalStars || 0) >= a.cost;
      const it = document.createElement('div');
      it.className = 'atelier-item' + (owned ? ' owned' : (canBuy ? '' : ' locked'));
      let btn = owned
        ? '<button class="atelier-item-btn" disabled>Achete</button>'
        : '<button class="atelier-item-btn" ' + (canBuy ? '' : 'disabled') + ' onclick="buyArticleUI(\'' + a.id + '\')">Acheter</button>';
      it.innerHTML = '<div class="atelier-item-emoji">' + a.emoji + '</div>' +
                     '<div class="atelier-item-name">' + a.name + '</div>' +
                     '<div class="atelier-item-desc">' + a.desc + '</div>' +
                     '<div class="atelier-item-cost">' + a.cost + ' ⭐</div>' + btn;
      tShop.appendChild(it);
    });
  }
  // Vestiaire
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
        let action;
        if (a.kind === 'accessory') {
          action = '<button class="atelier-item-btn ' + (isEquip ? 'btn-equip-active' : '') + '" onclick="equipAccessory(\'' + a.id + '\')">' + (isEquip ? 'Retirer' : 'Mettre') + '</button>';
        } else {
          action = '<div class="atelier-item-cost">Carte</div>';
        }
        it.innerHTML = '<div class="atelier-item-emoji">' + a.emoji + '</div>' +
                       '<div class="atelier-item-name">' + a.name + '</div>' +
                       '<div class="atelier-item-desc">' + a.desc + '</div>' + action;
        tVest.appendChild(it);
      });
    }
  }
}

function buyArticleUI(id) {
  const r = buyArticle(id);
  if (!r.ok && r.reason === 'pas assez d etoiles') {
    alert('Pas assez d etoiles ! Joue d autres chapitres pour en gagner.');
  }
}
k && r.reason === 'pas assez d etoiles') {
    alert('Pas assez d etoiles ! Joue d autres chapitres pour en gagner.');
  }
}
