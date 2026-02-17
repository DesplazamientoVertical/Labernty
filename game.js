import * as THREE from 'https://unpkg.com/three@0.165.0/build/three.module.js';

const LEVELS = {
  easy: { label: 'Fácil', size: 11, timeLimit: 300, wallHeight: 2.2 },
  medium: { label: 'Medio', size: 17, timeLimit: 210, wallHeight: 2.4 },
  hard: { label: 'Difícil', size: 23, timeLimit: 150, wallHeight: 2.6 },
};

const canvas = document.getElementById('gameCanvas');
const overlay = document.getElementById('overlay');
const hud = document.getElementById('hud');
const hudLevel = document.getElementById('hudLevel');
const hudTime = document.getElementById('hudTime');
const hudBest = document.getElementById('hudBest');
const hudLimit = document.getElementById('hudLimit');
const winText = document.getElementById('winText');
const bestText = document.getElementById('bestText');

const sensitivityInput = document.getElementById('sensitivity');
const sensitivityValue = document.getElementById('sensitivityValue');
const volumeInput = document.getElementById('volume');
const volumeValue = document.getElementById('volumeValue');
const invertYInput = document.getElementById('invertY');
const touchControls = document.getElementById('touchControls');
const lookPad = document.getElementById('lookPad');

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x070b14, 0.04);
scene.background = new THREE.Color(0x070b14);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 100);

const ambient = new THREE.AmbientLight(0x284266, 0.25);
scene.add(ambient);
const moon = new THREE.DirectionalLight(0x8cabff, 0.4);
moon.position.set(4, 10, 2);
scene.add(moon);

const headLamp = new THREE.PointLight(0xa8d4ff, 0.95, 14, 1.6);
headLamp.position.set(0, -0.1, 0);
camera.add(headLamp);
scene.add(camera);

const player = {
  pos: new THREE.Vector3(0, 1.6, 0),
  vel: new THREE.Vector3(),
  yaw: 0,
  pitch: 0,
  moveSpeed: 4,
};

const keys = { w: false, a: false, s: false, d: false };
const isTouchDevice = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
let gameState = 'menu';
let currentLevelKey = 'easy';
let mazeGrid = [];
let wallBoxes = [];
let levelRoot = null;
let exitZone = null;
let startTime = 0;
let pausedAt = 0;
let elapsedWhenPaused = 0;

const bestTimes = JSON.parse(localStorage.getItem('labernty-best-times') || '{}');

const humCtx = new (window.AudioContext || window.webkitAudioContext)();
const humOsc = humCtx.createOscillator();
const humGain = humCtx.createGain();
humOsc.type = 'triangle';
humOsc.frequency.value = 50;
humGain.gain.value = 0;
humOsc.connect(humGain).connect(humCtx.destination);
humOsc.start();

function setHumActive(active) {
  const target = active ? Number(volumeInput.value) : 0;
  humGain.gain.cancelScheduledValues(humCtx.currentTime);
  humGain.gain.setTargetAtTime(target, humCtx.currentTime, 0.08);
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

function clearLevel() {
  if (levelRoot) {
    scene.remove(levelRoot);
    levelRoot.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    });
  }
  wallBoxes = [];
  levelRoot = new THREE.Group();
  scene.add(levelRoot);
}

function generateMaze(size) {
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
    ].sort(() => Math.random() - 0.5);

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

function buildLevel(levelKey) {
  const cfg = LEVELS[levelKey];
  mazeGrid = generateMaze(cfg.size);
  clearLevel();

  const cellSize = 2;
  const half = (cfg.size * cellSize) / 2;
  const wallGeo = new THREE.BoxGeometry(cellSize, cfg.wallHeight, cellSize);
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x141822, roughness: 0.95, metalness: 0.1 });

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(cfg.size * cellSize, cfg.size * cellSize),
    new THREE.MeshStandardMaterial({ color: 0x090d16, roughness: 1, metalness: 0.05 })
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
        wall.castShadow = true;
        levelRoot.add(wall);

        wallBoxes.push(new THREE.Box3().setFromCenterAndSize(
          new THREE.Vector3(wx, cfg.wallHeight / 2, wz),
          new THREE.Vector3(cellSize, cfg.wallHeight, cellSize)
        ));
      }
    }
  }

  const exitMat = new THREE.MeshStandardMaterial({ color: 0x22ffaa, emissive: 0x116644, emissiveIntensity: 0.8 });
  const exit = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.65, 2, 20), exitMat);
  const ex = (cfg.size - 0.5) * cellSize - half;
  const ez = (cfg.size - 1.5) * cellSize - half;
  exit.position.set(ex, 1, ez);
  levelRoot.add(exit);
  exitZone = { center: new THREE.Vector3(ex, 1, ez), radius: 1.2 };

  player.pos.set(-half + cellSize * 0.5, 1.6, -half + cellSize * 1.5);
  player.yaw = 0;
  player.pitch = 0;
  camera.position.copy(player.pos);
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

  document.getElementById('resumeBtn').addEventListener('click', resumeGame);
  document.getElementById('quitBtn').addEventListener('click', quitToMenu);
  document.getElementById('playAgainBtn').addEventListener('click', () => startGame(currentLevelKey));
  document.getElementById('winMainBtn').addEventListener('click', quitToMenu);

  sensitivityInput.addEventListener('input', () => {
    sensitivityValue.textContent = sensitivityInput.value;
  });
  volumeInput.addEventListener('input', () => {
    volumeValue.textContent = volumeInput.value;
    setHumActive(gameState === 'running');
  });
}

function startGame(levelKey) {
  currentLevelKey = levelKey;
  buildLevel(levelKey);
  gameState = 'running';
  setOverlayVisible(false);
  hud.classList.remove('hidden');
  showSection('mainMenu');
  startTime = performance.now();
  elapsedWhenPaused = 0;
  const cfg = LEVELS[levelKey];
  hudLevel.textContent = cfg.label;
  hudLimit.textContent = formatLimit(cfg.timeLimit);
  hudBest.textContent = bestTimes[levelKey] ? formatTime(bestTimes[levelKey]) : '--:--.--';
  tryPointerLock();
  setHumActive(true);
  setTouchControlsVisible(true);
}

function quitToMenu() {
  gameState = 'menu';
  hud.classList.add('hidden');
  setOverlayVisible(true);
  showSection('mainMenu');
  setTouchControlsVisible(false);
  setHumActive(false);
  document.exitPointerLock();
}

function winGame(timeout = false) {
  gameState = 'win';
  document.exitPointerLock();
  const elapsed = timeout ? LEVELS[currentLevelKey].timeLimit : (performance.now() - startTime) / 1000;
  const text = timeout
    ? `Te quedaste sin tiempo en ${formatTime(elapsed)}.`
    : `Tiempo de escape: ${formatTime(elapsed)}.`;

  if (!timeout) {
    if (!bestTimes[currentLevelKey] || elapsed < bestTimes[currentLevelKey]) {
      bestTimes[currentLevelKey] = elapsed;
      localStorage.setItem('labernty-best-times', JSON.stringify(bestTimes));
    }
  }

  winText.textContent = text;
  bestText.textContent = `Mejor tiempo (${LEVELS[currentLevelKey].label}): ${
    bestTimes[currentLevelKey] ? formatTime(bestTimes[currentLevelKey]) : '--:--.--'
  }`;
  hudBest.textContent = bestTimes[currentLevelKey] ? formatTime(bestTimes[currentLevelKey]) : '--:--.--';
  setOverlayVisible(true);
  setTouchControlsVisible(false);
  setHumActive(false);
  showSection('winMenu');
}

function tryPointerLock() {
  if (humCtx.state === 'suspended') humCtx.resume();
  if (!isTouchDevice) canvas.requestPointerLock();
}

function resumeGame() {
  if (gameState !== 'paused') return;
  gameState = 'running';
  setOverlayVisible(false);
  const pauseDur = performance.now() - pausedAt;
  startTime += pauseDur;
  tryPointerLock();
  setHumActive(true);
  setTouchControlsVisible(true);
}

function togglePause() {
  if (gameState === 'running') {
    gameState = 'paused';
    pausedAt = performance.now();
    setOverlayVisible(true);
    showSection('pauseMenu');
    setTouchControlsVisible(false);
    setHumActive(false);
    document.exitPointerLock();
  } else if (gameState === 'paused') {
    resumeGame();
  }
}

function movePlayer(dt) {
  const dir = new THREE.Vector3();
  const forward = new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw));
  const right = new THREE.Vector3(forward.z, 0, -forward.x);
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

function updateHud() {
  if (gameState !== 'running') return;
  const elapsed = (performance.now() - startTime) / 1000;
  hudTime.textContent = formatTime(elapsed);
  const limit = LEVELS[currentLevelKey].timeLimit;
  if (elapsed >= limit) {
    winGame(true);
  }
}

const clock = new THREE.Clock();
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.033);
  if (gameState === 'running') {
    movePlayer(dt);
    updateHud();
    const dist = player.pos.distanceTo(exitZone.center);
    if (dist < exitZone.radius) winGame(false);
  }
  renderer.render(scene, camera);
}

setupUi();
setupTouchControls();
showSection('mainMenu');
setOverlayVisible(true);
loop();
