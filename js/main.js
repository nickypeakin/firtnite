import * as THREE from 'three';
import { Game } from './game.js';
import { Input } from './input.js';
import { AudioSys } from './audio.js';
import { formatTime } from './util.js';

const $ = (id) => document.getElementById(id);
const DEFAULTS = { sensitivity: 1, volume: 0.7, bots: 39, difficulty: 'normal', quality: 'auto' };
const STORE_KEY = 'firtnite-settings';

function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}') };
  } catch (e) {
    return { ...DEFAULTS };
  }
}
function saveSettings() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(settings));
  } catch (e) { /* storage unavailable */ }
}

const settings = loadSettings();
const canvas = $('view');
const isTouch = window.matchMedia('(pointer: coarse)').matches;
const quality = () => (settings.quality === 'auto' ? (isTouch ? 'low' : 'high') : settings.quality);

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  $('menu').hidden = true;
  $('webgl-error').hidden = false;
  throw e;
}
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

function applyQuality() {
  const q = quality();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q === 'high' ? 1.5 : 1));
  renderer.shadowMap.enabled = q !== 'low';
  renderer.setSize(window.innerWidth, window.innerHeight, false);
}
applyQuality();

let game = null;
let state = 'menu'; // menu | loading | playing | ended
let paused = false;
let hadLock = false;

const input = new Input(canvas);
const audio = new AudioSys();
audio.setVolume(settings.volume);
input.bindTouch($('touch-ui'), $('joy-base'), $('joy-knob'));
function enableTouch() {
  input.touch = true;
  document.body.classList.add('touch');
  if (state === 'playing') $('touch-ui').hidden = false;
}
input.onTouchDetected = enableTouch;
if (isTouch) enableTouch();

function setPaused(p) {
  if (state !== 'playing') return;
  paused = p;
  $('pause').hidden = !p;
  input.freeLook = !p;
  if (p) input.clear();
}

input.onLockChange = (locked) => {
  if (locked) {
    hadLock = true;
    if (state === 'playing') setPaused(false);
  } else if (state === 'playing' && hadLock && !input.touch) {
    setPaused(true);
  } else if (state === 'ended') {
    $('endscreen').hidden = false;
  }
};

canvas.addEventListener('click', () => {
  if (state === 'playing' && !paused) input.requestLock();
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && state === 'playing' && !input.locked) setPaused(!paused);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === 'playing') setPaused(true);
});
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  if (game) game.resize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------- menu & settings

function bindRange(id, key, fmt, apply) {
  const el = $(id), out = $(`${id}-val`);
  el.value = settings[key];
  const show = () => { if (out) out.textContent = fmt(Number(el.value)); };
  show();
  el.addEventListener('input', () => {
    settings[key] = Number(el.value);
    show();
    if (apply) apply();
    saveSettings();
  });
}
function bindSelect(id, key) {
  const el = $(id);
  el.value = settings[key];
  el.addEventListener('change', () => {
    settings[key] = el.value;
    saveSettings();
  });
}
bindRange('set-bots', 'bots', (v) => `${v + 1} players`);
bindRange('set-sens', 'sensitivity', (v) => v.toFixed(2));
bindRange('set-vol', 'volume', (v) => `${Math.round(v * 100)}%`, () => audio.setVolume(settings.volume));
bindRange('pause-sens', 'sensitivity', (v) => v.toFixed(2));
bindRange('pause-vol', 'volume', (v) => `${Math.round(v * 100)}%`, () => audio.setVolume(settings.volume));
bindSelect('set-diff', 'difficulty');
bindSelect('set-quality', 'quality');
// Keep the two sensitivity/volume sliders in sync.
for (const [a, b] of [['set-sens', 'pause-sens'], ['set-vol', 'pause-vol']]) {
  $(a).addEventListener('input', () => { $(b).value = $(a).value; $(b).dispatchEvent(new Event('input')); });
  $(b).addEventListener('input', () => { $(a).value = $(b).value; });
}

function startGame() {
  audio.unlock();
  if (game) {
    game.dispose();
    game = null;
  }
  state = 'loading';
  $('menu').hidden = true;
  $('endscreen').hidden = true;
  $('pause').hidden = true;
  $('loading').hidden = false;
  input.requestLock();
  setTimeout(() => {
    applyQuality();
    game = new Game({
      renderer, input, audio,
      settings: { ...settings, quality: quality() },
      onEnd: showEnd,
      onWinner: (name) => { $('end-winner').textContent = `${name} won the match`; },
    });
    $('loading').hidden = true;
    $('touch-ui').hidden = !input.touch;
    state = 'playing';
    paused = false;
    input.freeLook = true;
    document.body.classList.add('ingame');
    last = performance.now();
  }, 60);
}

function toMenu() {
  if (game) {
    game.dispose();
    game = null;
  }
  state = 'menu';
  paused = false;
  input.freeLook = false;
  document.body.classList.remove('ingame', 'building');
  input.exitLock();
  $('pause').hidden = true;
  $('endscreen').hidden = true;
  $('touch-ui').hidden = true;
  $('menu').hidden = false;
}

function showEnd(result) {
  if (!game || state === 'menu') return;
  state = 'ended';
  input.exitLock();
  input.freeLook = false;
  $('pause').hidden = true;
  $('touch-ui').hidden = true;
  $('center-msg').className = '';
  const es = $('endscreen');
  es.classList.toggle('win', result.victory);
  $('end-place').textContent = result.victory ? '#1' : `#${result.placement}`;
  $('end-title').textContent = result.victory ? 'VICTORY!' : 'ELIMINATED';
  $('end-sub').textContent = result.victory ? 'Last one standing. Nice building!' : `Eliminated by ${result.killer || 'the Storm'}`;
  $('end-kills').textContent = result.kills;
  $('end-time').textContent = formatTime(result.time);
  $('end-players').textContent = game.characters.length;
  $('end-winner').textContent = '';
  $('end-spectate').hidden = result.victory;
  es.hidden = false;
}

$('play-btn').addEventListener('click', startGame);
$('again-btn').addEventListener('click', startGame);
$('menu-btn').addEventListener('click', toMenu);
$('quit-btn').addEventListener('click', toMenu);
$('spectate').addEventListener('click', () => {
  if (state !== 'ended') return;
  input.exitLock();
  $('endscreen').hidden = false;
});
$('end-spectate').addEventListener('click', () => {
  $('endscreen').hidden = true;
  input.requestLock();
  input.freeLook = true;
});
$('resume-btn').addEventListener('click', () => {
  setPaused(false);
  input.requestLock();
});
$('t-pause').addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  setPaused(true);
});
$('controls-btn').addEventListener('click', () => { $('controls').hidden = !$('controls').hidden; });

// ---------------------------------------------------------------- loop

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  if (game) {
    if ((state === 'playing' && !paused) || state === 'ended') game.update(dt);
    game.render();
  }
  input.endFrame();
}
requestAnimationFrame(frame);

// Handy for debugging from the console.
window.firtnite = {
  get game() { return game; },
  start: startGame,
  settings,
};
