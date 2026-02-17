import * as THREE from 'https://unpkg.com/three@0.165.0/build/three.module.js';

const LEVELS = {
  easy: { label: 'Fácil', size: 11, timeLimit: 300, wallHeight: 2.2 },
  medium: { label: 'Medio', size: 17, timeLimit: 210, wallHeight: 2.4 },
  hard: { label: 'Difícil', size: 23, timeLimit: 150, wallHeight: 2.6 },
};

const TOTAL_COLLECTIBLES = 10;
const RANKING_KEY = 'labernty-seed-rankings';

const canvas = document.getElementById('gameCanvas');
const overlay = document.getElementById('overlay');
const hud = document.getElementById('hud');
const hudLevel = document.getElementById('hudLevel');
const hudTime = document.getElementById('hudTime');
const hudBest = document.getElementById('hudBest');
const hudLimit = document.getElementById('hudLimit');
const hudCollectibles = document.getElementById('hudCollectibles');
const winText = document.getElementById('winText');
const bestText = document.getElementById('bestText');
const rankingList = document.getElementById('rankingList');
const rankingSeed = document.getElementById('rankingSeed');
const activeSeed = document.getElementById('activeSeed');

const sensitivityInput = document.getElementById('sensitivity');
const sensitivityValue = document.getElementById('sensitivityValue');
const volumeInput = document.getElementById('volume');
const volumeValue = document.getElementById('volumeValue');
const invertYInput = document.getElementById('invertY');
const touchControls = document.getElementById('touchControls');
const lookPad = document.getElementById('lookPad');
const seedInput = document.getElementById('seedInput');

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x141d2e, 0.026);
scene.background = new THREE.Color(0x141d2e);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 100);

const ambient = new THREE.AmbientLight(0x7fa8de, 0.55);
scene.add(ambient);
const moon = new THREE.DirectionalLight(0xbfd3ff, 0.65);
moon.position.set(4, 10, 2);
scene.add(moon);

const headLamp = new THREE.PointLight(0xd6ebff, 1.45, 22, 1.45);
headLamp.position.set(0, -0.1, 0);
camera.add(headLamp);
scene.add(camera);

const player = {
  pos: new THREE.Vector3(0, 1.6, 0),
  yaw: 0,
  pitch: 0,
  moveSpeed: 4,
};

const keys = { w: false, a: false, s: false, d: false };
const isTouchDevice = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
let gameState = 'menu';
let currentLevelKey = 'easy';
let currentSeed = '';
let mazeGrid = [];
let wallBoxes = [];
let levelRoot = null;
let exitZone = null;
let startTime = 0;
let pausedAt = 0;
let collectibleZones = [];
let collectedCount = 0;

const rankingsBySeed = JSON.parse(localStorage.getItem(RANKING_KEY) || '{}');

let audioCtx = null;
let musicGain = null;
let musicNodes = [];
let musicTimer = null;

function getMasterVolume() {
  return Number(volumeInput.value) * 0.6;
}

function showSection(id) {
  document.querySelectorAll('.menu-section').forEach((el) => el.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  const cs = Math.floor((seconds % 1) * 100).toString().padStart(2, '0');
  return `${m}:${s}.${cs}`;
}

function formatLimit(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function setOverlayVisible(visible) {
  overlay.classList.toggle('visible', visible);
}

function setTouchControlsVisible(visible) {
  const show = isTouchDevice && visible;
  touchControls.classList.toggle('hidden', !show);
  touchControls.setAttribute('aria-hidden', String(!show));
}

function normalizeSeed(seed) {
  return (seed || '').trim().replace(/\s+/g, '-').slice(0, 24);
}

function createSeed() {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function makeRng(seedText) {
  let a = hashSeed(seedText) || 1;
  return () => {
    a += 0x6D2B79F5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function keyForRanking(levelKey, seed) {
  return `${levelKey}|${seed}`;
}

function getRanking(levelKey, seed) {
  return rankingsBySeed[keyForRanking(levelKey, seed)] || [];
}

function getSeedBest(levelKey, seed) {
  const ranking = getRanking(levelKey, seed);
  return ranking.length ? ranking[0] : null;
}

function renderSeedHud() {
  activeSeed.textContent = `Seed activa: ${currentSeed || normalizeSeed(seedInput.value) || '-'}`;
}

function renderRanking(levelKey = currentLevelKey, seed = currentSeed || normalizeSeed(seedInput.value)) {
  const normalized = normalizeSeed(seed);
  rankingSeed.textContent = normalized
    ? `Seed: ${normalized} · Nivel: ${LEVELS[levelKey].label}`
    : 'Define una seed y juega una partida para crear ranking.';

  const ranking = normalized ? getRanking(levelKey, normalized) : [];
  rankingList.innerHTML = '';
  if (!ranking.length) {
    const li = document.createElement('li');
    li.textContent = 'Sin tiempos registrados todavía.';
    rankingList.appendChild(li);
    return;
  }

  ranking.slice(0, 8).forEach((time, index) => {
    const li = document.createElement('li');
    li.textContent = `#${index + 1} · ${formatTime(time)}`;
    rankingList.appendChild(li);
  });
}

function updateRanking(levelKey, seed, elapsed) {
  const key = keyForRanking(levelKey, seed);
  const current = rankingsBySeed[key] || [];
  current.push(elapsed);
  current.sort((a, b) => a - b);
  rankingsBySeed[key] = current.slice(0, 8);
  localStorage.setItem(RANKING_KEY, JSON.stringify(rankingsBySeed));
}

function clearLevel() {
  if (levelRoot) {
    scene.remove(levelRoot);
    levelRoot.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    });
  }
  wallBoxes = [];
  collectibleZones = [];
  collectedCount = 0;
  levelRoot = new THREE.Group();
  scene.add(levelRoot);
}

function generateMaze(size, rng) {
  const grid = Array.from({ length: size }, () => Array(size).fill(1));
  const visited = Array.from({ length: size }, () => Array(size).fill(false));

  function carve(x, y) {
    visited[y][x] = true;
    grid[y][x] = 0;
    const dirs = [
      [2, 0],
      [-2, 0],
      [0, 2],
      [0, -2],
    ];

    for (let i = dirs.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
    }

    for (const [dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx > 0 && nx < size - 1 && ny > 0 && ny < size - 1 && !visited[ny][nx]) {
        grid[y + dy / 2][x + dx / 2] = 0;
        carve(nx, ny);
      }
    }
  }

  carve(1, 1);
  grid[1][0] = 0;
  grid[size - 2][size - 1] = 0;
  return grid;
}

function placeCollectibles(cfg, cellSize, half, rng) {
  const collectibleGeo = new THREE.IcosahedronGeometry(0.35, 0);
  const collectibleMat = new THREE.MeshStandardMaterial({
    color: 0xffdc5d,
    emissive: 0xaa7a12,
    emissiveIntensity: 0.8,
    roughness: 0.25,
    metalness: 0.6,
  });

  const candidates = [];
  for (let z = 0; z < cfg.size; z++) {
    for (let x = 0; x < cfg.size; x++) {
      if (mazeGrid[z][x] === 0) {
        if ((x <= 2 && z <= 2) || (x >= cfg.size - 3 && z >= cfg.size - 3)) continue;
        candidates.push({ x, z });
      }
    }
  }

  for (let i = 0; i < TOTAL_COLLECTIBLES && candidates.length > 0; i++) {
    const index = Math.floor(rng() * candidates.length);
    const cell = candidates.splice(index, 1)[0];
    const cx = cell.x * cellSize - half + cellSize / 2;
    const cz = cell.z * cellSize - half + cellSize / 2;
    const collectible = new THREE.Mesh(collectibleGeo, collectibleMat.clone());
    collectible.position.set(cx, 0.9, cz);
    levelRoot.add(collectible);
    collectibleZones.push({ mesh: collectible, center: collectible.position.clone(), radius: 0.85, collected: false });
  }
}

function buildLevel(levelKey, seed) {
  const cfg = LEVELS[levelKey];
  const rng = makeRng(`${levelKey}:${seed}`);
  mazeGrid = generateMaze(cfg.size, rng);
  clearLevel();

  const cellSize = 2;
  const half = (cfg.size * cellSize) / 2;
  const wallGeo = new THREE.BoxGeometry(cellSize, cfg.wallHeight, cellSize);
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x2b3448, roughness: 0.9, metalness: 0.08 });

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(cfg.size * cellSize, cfg.size * cellSize),
    new THREE.MeshStandardMaterial({ color: 0x1c2536, roughness: 0.98, metalness: 0.04 })
  );
  floor.rotation.x = -Math.PI / 2;
  levelRoot.add(floor);

  for (let z = 0; z < cfg.size; z++) {
    for (let x = 0; x < cfg.size; x++) {
      if (mazeGrid[z][x] === 1) {
        const wx = x * cellSize - half + cellSize / 2;
        const wz = z * cellSize - half + cellSize / 2;
        const wall = new THREE.Mesh(wallGeo, wallMat);
        wall.position.set(wx, cfg.wallHeight / 2, wz);
        levelRoot.add(wall);

        wallBoxes.push(new THREE.Box3().setFromCenterAndSize(
          new THREE.Vector3(wx, cfg.wallHeight / 2, wz),
          new THREE.Vector3(cellSize, cfg.wallHeight, cellSize)
        ));
      }
    }
  }

  const exit = new THREE.Mesh(
    new THREE.CylinderGeometry(0.65, 0.65, 2, 20),
    new THREE.MeshStandardMaterial({ color: 0x22ffaa, emissive: 0x116644, emissiveIntensity: 0.8 })
  );
  const ex = (cfg.size - 0.5) * cellSize - half;
  const ez = (cfg.size - 1.5) * cellSize - half;
  exit.position.set(ex, 1, ez);
  levelRoot.add(exit);
  exitZone = { center: new THREE.Vector3(ex, 1, ez), radius: 1.2 };

  placeCollectibles(cfg, cellSize, half, rng);

  player.pos.set(-half + cellSize * 0.5, 1.6, -half + cellSize * 1.5);
  player.yaw = 0;
  player.pitch = 0;
  camera.position.copy(player.pos);
}

function ensureMusic() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  musicGain = audioCtx.createGain();
  musicGain.gain.value = getMasterVolume();
  musicGain.connect(audioCtx.destination);
}

function stopMusic() {
  if (musicTimer) {
    clearTimeout(musicTimer);
    musicTimer = null;
  }
  musicNodes.forEach((node) => {
    try { node.stop(); } catch (_) { /* noop */ }
    node.disconnect();
  });
  musicNodes = [];
}

function playMusicLoop() {
  ensureMusic();
  if (!audioCtx || gameState === 'menu') return;
  audioCtx.resume();
  stopMusic();

  const progression = [
    [130.81, 196.0, 261.63],
    [146.83, 220.0, 293.66],
    [174.61, 261.63, 329.63],
    [196.0, 293.66, 392.0],
  ];
  const lead = [523.25, 587.33, 659.25, 587.33, 698.46, 659.25, 587.33, 523.25];
  const now = audioCtx.currentTime + 0.05;

  progression.forEach((chord, i) => {
    const t = now + i * 0.72;
    chord.forEach((freq) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.028, t + 0.1);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
      osc.connect(gain);
      gain.connect(musicGain);
      osc.start(t);
      osc.stop(t + 0.72);
      musicNodes.push(osc, gain);
    });
  });

  lead.forEach((freq, i) => {
    const t = now + i * 0.36;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = i % 2 ? 'square' : 'sine';
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.04, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.33);
    osc.connect(gain);
    gain.connect(musicGain);
    osc.start(t);
    osc.stop(t + 0.36);
    musicNodes.push(osc, gain);
  });

  musicTimer = setTimeout(playMusicLoop, 2900);
}

function playSfx(type) {
  ensureMusic();
  if (!audioCtx || !musicGain) return;
  audioCtx.resume();

  const now = audioCtx.currentTime + 0.01;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  if (type === 'collect') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(620, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.12);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.09, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    osc.stop(now + 0.18);
  } else {
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(300, now);
    osc.frequency.exponentialRampToValueAtTime(520, now + 0.2);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
    osc.stop(now + 0.34);
  }

  osc.connect(gain);
  gain.connect(musicGain);
  osc.start(now);
}

function setupUi() {
  document.querySelectorAll('.start-btn').forEach((btn) => {
    btn.addEventListener('click', () => startGame(btn.dataset.level));
  });

  document.querySelectorAll('.backMain').forEach((btn) => {
    btn.addEventListener('click', () => showSection('mainMenu'));
  });

  document.getElementById('openSettings').addEventListener('click', () => showSection('settingsMenu'));
  document.getElementById('openStory').addEventListener('click', () => showSection('storyMenu'));
  document.getElementById('openCredits').addEventListener('click', () => showSection('creditsMenu'));
  document.getElementById('openRanking').addEventListener('click', () => {
    renderRanking();
    showSection('rankingMenu');
  });

  document.getElementById('resumeBtn').addEventListener('click', resumeGame);
  document.getElementById('quitBtn').addEventListener('click', quitToMenu);
  document.getElementById('playAgainBtn').addEventListener('click', () => startGame(currentLevelKey));
  document.getElementById('winMainBtn').addEventListener('click', quitToMenu);

  sensitivityInput.addEventListener('input', () => {
    sensitivityValue.textContent = sensitivityInput.value;
  });

  volumeInput.addEventListener('input', () => {
    volumeValue.textContent = volumeInput.value;
    if (musicGain && audioCtx) {
      musicGain.gain.setTargetAtTime(getMasterVolume(), audioCtx.currentTime, 0.05);
    }
  });

  document.getElementById('randomSeedBtn').addEventListener('click', () => {
    seedInput.value = createSeed();
    renderSeedHud();
  });

  document.getElementById('copySeedBtn').addEventListener('click', async () => {
    const seed = normalizeSeed(seedInput.value) || currentSeed;
    if (!seed) return;
    try {
      await navigator.clipboard.writeText(seed);
    } catch (_) {
      seedInput.select();
      document.execCommand('copy');
    }
  });

  seedInput.addEventListener('input', renderSeedHud);
}

function startGame(levelKey) {
  currentLevelKey = levelKey;
  currentSeed = normalizeSeed(seedInput.value) || createSeed();
  seedInput.value = currentSeed;
  renderSeedHud();
  buildLevel(levelKey, currentSeed);
  gameState = 'running';
  setOverlayVisible(false);
  hud.classList.remove('hidden');
  showSection('mainMenu');
  startTime = performance.now();
  collectedCount = 0;

  const cfg = LEVELS[levelKey];
  hudLevel.textContent = `${cfg.label} · ${currentSeed}`;
  hudLimit.textContent = formatLimit(cfg.timeLimit);
  const best = getSeedBest(levelKey, currentSeed);
  hudBest.textContent = best ? formatTime(best) : '--:--.--';
  hudCollectibles.textContent = `${collectedCount}/${TOTAL_COLLECTIBLES}`;
  tryPointerLock();
  setTouchControlsVisible(true);
  playMusicLoop();
}

function quitToMenu() {
  gameState = 'menu';
  hud.classList.add('hidden');
  setOverlayVisible(true);
  showSection('mainMenu');
  setTouchControlsVisible(false);
  document.exitPointerLock();
  stopMusic();
}

function winGame(timeout = false) {
  gameState = 'win';
  document.exitPointerLock();
  stopMusic();
  const elapsed = timeout ? LEVELS[currentLevelKey].timeLimit : (performance.now() - startTime) / 1000;
  const text = timeout
    ? `Te quedaste sin tiempo en ${formatTime(elapsed)} con ${collectedCount}/${TOTAL_COLLECTIBLES} reliquias.`
    : `Tiempo de escape: ${formatTime(elapsed)} (reliquias: ${collectedCount}/${TOTAL_COLLECTIBLES}).`;

  if (!timeout) updateRanking(currentLevelKey, currentSeed, elapsed);

  winText.textContent = text;
  const seedBest = getSeedBest(currentLevelKey, currentSeed);
  bestText.textContent = `Mejor tiempo para ${LEVELS[currentLevelKey].label} · ${currentSeed}: ${seedBest ? formatTime(seedBest) : '--:--.--'}`;
  hudBest.textContent = seedBest ? formatTime(seedBest) : '--:--.--';
  setOverlayVisible(true);
  setTouchControlsVisible(false);
  renderRanking(currentLevelKey, currentSeed);
  showSection('winMenu');
}

function tryPointerLock() {
  if (!isTouchDevice) canvas.requestPointerLock();
}

function resumeGame() {
  if (gameState !== 'paused') return;
  gameState = 'running';
  setOverlayVisible(false);
  const pauseDur = performance.now() - pausedAt;
  startTime += pauseDur;
  tryPointerLock();
  setTouchControlsVisible(true);
  playMusicLoop();
}

function togglePause() {
  if (gameState === 'running') {
    gameState = 'paused';
    pausedAt = performance.now();
    setOverlayVisible(true);
    showSection('pauseMenu');
    setTouchControlsVisible(false);
    document.exitPointerLock();
    stopMusic();
  } else if (gameState === 'paused') {
    resumeGame();
  }
}

function movePlayer(dt) {
  const dir = new THREE.Vector3();
  const forward = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  const right = new THREE.Vector3(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
  if (keys.w) dir.add(forward);
  if (keys.s) dir.sub(forward);
  if (keys.d) dir.add(right);
  if (keys.a) dir.sub(right);
  if (dir.lengthSq() > 0) dir.normalize();

  const step = dir.multiplyScalar(player.moveSpeed * dt);
  const next = player.pos.clone().add(step);

  const radius = 0.28;
  const body = new THREE.Box3(
    new THREE.Vector3(next.x - radius, 0, next.z - radius),
    new THREE.Vector3(next.x + radius, 1.8, next.z + radius)
  );

  const collision = wallBoxes.some((b) => body.intersectsBox(b));
  if (!collision) player.pos.copy(next);

  camera.position.copy(player.pos);
  camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
}

document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas || gameState !== 'running') return;
  const sens = Number(sensitivityInput.value) * 0.0022;
  player.yaw -= e.movementX * sens;
  const invert = invertYInput.checked ? -1 : 1;
  player.pitch -= e.movementY * sens * invert;
  player.pitch = Math.max(-Math.PI / 2.1, Math.min(Math.PI / 2.1, player.pitch));
});

document.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k in keys) keys[k] = true;
  if (k === 'escape') {
    e.preventDefault();
    if (gameState === 'running' || gameState === 'paused') togglePause();
  }
});

document.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if (k in keys) keys[k] = false;
});

canvas.addEventListener('click', () => {
  if (gameState === 'running' && document.pointerLockElement !== canvas) {
    tryPointerLock();
  }
});

function setupTouchControls() {
  if (!isTouchDevice) return;

  const setKey = (key, pressed) => {
    keys[key] = pressed;
  };

  document.querySelectorAll('.touch-btn').forEach((btn) => {
    const key = btn.dataset.key;
    const press = (e) => {
      e.preventDefault();
      setKey(key, true);
    };
    const release = (e) => {
      e.preventDefault();
      setKey(key, false);
    };
    btn.addEventListener('touchstart', press, { passive: false });
    btn.addEventListener('touchend', release, { passive: false });
    btn.addEventListener('touchcancel', release, { passive: false });
  });

  let lastTouch = null;
  lookPad.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const touch = e.changedTouches[0];
    lastTouch = { x: touch.clientX, y: touch.clientY };
  }, { passive: false });

  lookPad.addEventListener('touchmove', (e) => {
    if (gameState !== 'running' || !lastTouch) return;
    e.preventDefault();
    const touch = e.changedTouches[0];
    const dx = touch.clientX - lastTouch.x;
    const dy = touch.clientY - lastTouch.y;
    lastTouch = { x: touch.clientX, y: touch.clientY };

    const sens = Number(sensitivityInput.value) * 0.004;
    player.yaw -= dx * sens;
    const invert = invertYInput.checked ? -1 : 1;
    player.pitch -= dy * sens * invert;
    player.pitch = Math.max(-Math.PI / 2.1, Math.min(Math.PI / 2.1, player.pitch));
  }, { passive: false });

  const resetLook = (e) => {
    e.preventDefault();
    lastTouch = null;
  };
  lookPad.addEventListener('touchend', resetLook, { passive: false });
  lookPad.addEventListener('touchcancel', resetLook, { passive: false });
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function updateCollectibles() {
  if (gameState !== 'running') return;
  for (const collectible of collectibleZones) {
    if (collectible.collected) continue;
    const dist = player.pos.distanceTo(collectible.center);
    if (dist < collectible.radius) {
      collectible.collected = true;
      collectible.mesh.visible = false;
      collectedCount += 1;
      hudCollectibles.textContent = `${collectedCount}/${TOTAL_COLLECTIBLES}`;
      playSfx('collect');
    }
  }
}

function updateHud() {
  if (gameState !== 'running') return;
  const elapsed = (performance.now() - startTime) / 1000;
  hudTime.textContent = formatTime(elapsed);
  const limit = LEVELS[currentLevelKey].timeLimit;
  if (elapsed >= limit) winGame(true);
}

const clock = new THREE.Clock();
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.033);
  if (gameState === 'running') {
    movePlayer(dt);
    updateCollectibles();
    updateHud();
    const dist = player.pos.distanceTo(exitZone.center);
    if (dist < exitZone.radius && collectedCount >= TOTAL_COLLECTIBLES) {
      playSfx('win');
      winGame(false);
    }
  }
  renderer.render(scene, camera);
}

setupUi();
setupTouchControls();
renderSeedHud();
showSection('mainMenu');
setOverlayVisible(true);
loop();
