/**
 * Zen Stones — entry point. Wires the recursion, the conductor (clock + audio),
 * the canvas scene, the recursion panel and all UI / calm tools together.
 */
import * as Tone from 'tone';
import { DEFAULTS, PRESETS, sanitize, fromHash, toHash } from './settings.js';
import { Conductor } from './conductor.js';
import { buildGraph, fadeMaster } from './audio/engine.js';
import { renderWav, downloadBlob, exportFilename, exportInfo } from './audio/export.js';
import { paceBase } from './recursion/composer.js';
import { Scene } from './visual/scene.js';
import { StackView } from './visual/stack.js';
import { Controls } from './ui/controls.js';
import { renderIcons } from './ui/icons.js';

renderIcons();

const $ = (sel) => document.querySelector(sel);
const body = document.body;

// ---------------------------------------------------------------- state

const initial =
  fromHash(location.hash) ||
  sanitize({ ...DEFAULTS, ...PRESETS['morning-mist'].values, preset: 'morning-mist' });

const reducedMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
const conductor = new Conductor();
conductor.load(initial);

const scene = new Scene($('#scene'), conductor);
scene.setAtmosphere({ night: initial.night, rain: initial.rain });
scene.night = initial.night;
scene.setReducedMotion(reducedMQ.matches);
reducedMQ.addEventListener?.('change', (e) => scene.setReducedMotion(e.matches));

const stackView = new StackView($('#recursion'));
scene.onFrame((view) => {
  stackView.update(view, conductor);
  updateBreath();
});
scene.run();

let audioReady = false;

// ---------------------------------------------------------------- settings changes

const RECOMPOSE_RESET = ['n', 'from', 'to'];
const RECOMPOSE_KEEP = ['pace', 'seed'];

const controls = new Controls(initial, (s, changed) => {
  if (changed.some((k) => RECOMPOSE_RESET.includes(k))) conductor.load(s, { preserve: false });
  else if (changed.some((k) => RECOMPOSE_KEEP.includes(k))) conductor.load(s, { preserve: true });
  else conductor.update(s);
  scene.setAtmosphere({ night: s.night, rain: s.rain });
  updateExportNote();
  scheduleHashUpdate();
  if (changed.includes('preset') && PRESETS[s.preset]) toast(`Preset: ${PRESETS[s.preset].label}`);
});

let hashTimer = 0;
function scheduleHashUpdate() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => history.replaceState(null, '', toHash(controls.s)), 400);
}

// ---------------------------------------------------------------- landing / audio start

async function begin() {
  const btn = $('#begin');
  if (btn.disabled) return;
  btn.disabled = true;
  btn.textContent = 'Listening…';
  try {
    Tone.setContext(new Tone.Context({ latencyHint: 'playback', lookAhead: 0.1 }));
    await Tone.start();
    const graph = await buildGraph(conductor.settings);
    conductor.attach(graph);
    audioReady = true;
    fadeMaster(graph, 1, 3);
  } catch (err) {
    console.error(err);
    toast('Audio could not start — the scene will still play silently.');
  }
  $('#landing').classList.add('gone');
  body.classList.remove('landing-open');
  setPanel(window.innerWidth >= 1100, false);
  if (audioReady) conductor.play();
  history.replaceState(null, '', toHash(controls.s));
  setTimeout(() => $('#btn-play').focus({ preventScroll: true }), 50);
}

$('#begin').addEventListener('click', begin);
body.classList.add('landing-open');
setPanel(false, false);
setTimeout(() => $('#begin').focus(), 400);

// ---------------------------------------------------------------- transport

conductor.on((type) => {
  if (['play', 'pause', 'finished', 'restart'].includes(type)) {
    const playing = conductor.playing && conductor.stepStopAt === null;
    body.classList.toggle('playing', playing);
    $('#btn-play').setAttribute('aria-label', playing ? 'Pause (Space)' : 'Play (Space)');
  }
  if (type === 'finished') toast('The stones rest on the far rock. Press play to begin again.');
});

const needAudio = () => {
  if (!audioReady) { toast('Press Begin to wake the river.'); return false; }
  return true;
};
const actions = {
  toggle: () => needAudio() && conductor.toggle(),
  restart: () => needAudio() && conductor.restart(),
  step: () => needAudio() && conductor.stepForward(),
  back: () => needAudio() && conductor.stepBack(),
};
$('#btn-play').addEventListener('click', actions.toggle);
$('#btn-restart').addEventListener('click', actions.restart);
$('#btn-step').addEventListener('click', actions.step);
$('#btn-back').addEventListener('click', actions.back);

// ---------------------------------------------------------------- panels

function setPanel(open, announce = true) {
  body.classList.toggle('panel-open', open);
  $('#panel-toggle').setAttribute('aria-expanded', String(open));
  $('#panel').setAttribute('aria-hidden', String(!open));
  $('#panel').inert = !open;
  scene.setInset(open && window.innerWidth > 760 ? $('#panel').offsetWidth + 32 : 0);
  if (announce && open) $('#panel .preset')?.focus({ preventScroll: true });
}
$('#panel-toggle').addEventListener('click', () => setPanel(!body.classList.contains('panel-open')));
window.addEventListener('resize', () => setPanel(body.classList.contains('panel-open'), false));

$('#rec-collapse').addEventListener('click', (e) => {
  const rec = $('#recursion');
  const collapsed = rec.classList.toggle('collapsed');
  e.currentTarget.setAttribute('aria-expanded', String(!collapsed));
  e.currentTarget.setAttribute('aria-label', collapsed ? 'Expand recursion view' : 'Collapse recursion view');
});
if (window.innerWidth < 760) $('#rec-collapse').click();

const about = $('#about');
$('#btn-about').addEventListener('click', () => about.showModal());
about.addEventListener('click', (e) => { if (e.target === about) about.close(); });

// ---------------------------------------------------------------- focus mode

let focusHideTimer = 0;
function setFocus(on) {
  body.classList.toggle('focus', on);
  const exit = $('#focus-exit');
  if (on) {
    exit.classList.add('show');
    clearTimeout(focusHideTimer);
    focusHideTimer = setTimeout(() => exit.classList.remove('show'), 2600);
    toast('Focus mode · press F or Esc to return');
  } else {
    exit.classList.remove('show');
  }
}
$('#btn-focus').addEventListener('click', () => setFocus(true));
$('#btn-focus2').addEventListener('click', () => setFocus(true));
$('#focus-exit').addEventListener('click', () => setFocus(false));
window.addEventListener('pointermove', () => {
  if (!body.classList.contains('focus')) return;
  $('#focus-exit').classList.add('show');
  clearTimeout(focusHideTimer);
  focusHideTimer = setTimeout(() => $('#focus-exit').classList.remove('show'), 2600);
});

// ---------------------------------------------------------------- breathing guide

let breathOn = false;
let breathStart = 0;
function setBreath(on) {
  breathOn = on;
  breathStart = performance.now();
  body.classList.toggle('breathing', on);
  $('#btn-breath').setAttribute('aria-pressed', String(on));
  $('#in-breath').checked = on;
}
$('#btn-breath').addEventListener('click', () => setBreath(!breathOn));
$('#in-breath').addEventListener('change', (e) => setBreath(e.target.checked));

const breathCircle = $('.breath-circle');
const breathLabel = $('.breath-label');
function updateBreath() {
  if (!breathOn) return;
  // 4 s inhale · 4 s hold · 6 s exhale, loosely following the breath pace
  const k = { slow: 1.15, medium: 1, flow: 0.88 }[conductor.settings.pace] || 1;
  const [i, h, x] = [4 * k, 4 * k, 6 * k];
  const t = ((performance.now() - breathStart) / 1000) % (i + h + x);
  let s;
  let label;
  const ease = (u) => -(Math.cos(Math.PI * u) - 1) / 2;
  if (t < i) { s = 0.6 + 0.4 * ease(t / i); label = 'Inhale'; }
  else if (t < i + h) { s = 1; label = 'Hold'; }
  else { s = 1 - 0.4 * ease((t - i - h) / x); label = 'Exhale'; }
  if (scene.reduced) s = 0.85;
  breathCircle.style.setProperty('--s', s.toFixed(4));
  if (breathLabel.textContent !== label) breathLabel.textContent = label;
}

// ---------------------------------------------------------------- sleep timer

let sleepEnd = 0;
let sleepTick = 0;
let sleepFading = false;
$('#in-sleep').addEventListener('change', (e) => {
  const mins = +e.target.value;
  clearInterval(sleepTick);
  sleepFading = false;
  if (conductor.graph) fadeMaster(conductor.graph, 1, 2);
  if (!mins) {
    sleepEnd = 0;
    $('#sleep-badge').hidden = true;
    $('#out-sleep').textContent = '';
    return;
  }
  sleepEnd = Date.now() + mins * 60000;
  toast(`Sleep timer: ${mins} minutes. The sound will fade away gently.`);
  sleepTick = setInterval(updateSleep, 1000);
  updateSleep();
});
function updateSleep() {
  const left = Math.max(0, sleepEnd - Date.now());
  const m = Math.floor(left / 60000);
  const sec = Math.floor((left % 60000) / 1000);
  const txt = `${m}:${String(sec).padStart(2, '0')}`;
  $('#sleep-badge').hidden = false;
  $('#sleep-text').textContent = `sleep in ${txt}`;
  $('#out-sleep').textContent = txt;
  if (left <= 60000 && !sleepFading && conductor.graph) {
    sleepFading = true;
    fadeMaster(conductor.graph, 0, left / 1000); // a gentle one-minute fade-out
  }
  if (left <= 0) {
    clearInterval(sleepTick);
    conductor.pause();
    sleepEnd = 0;
    $('#in-sleep').value = '0';
    $('#sleep-badge').hidden = true;
    $('#out-sleep').textContent = '';
    toast('Sleep well.');
  }
}

// ---------------------------------------------------------------- share link

$('#btn-share').addEventListener('click', async () => {
  const url = location.href.split('#')[0] + toHash(controls.s);
  history.replaceState(null, '', toHash(controls.s));
  try {
    await navigator.clipboard.writeText(url);
    toast('Share link copied — same seed, same soundscape.');
  } catch {
    window.prompt('Copy this link:', url);
  }
});

// ---------------------------------------------------------------- export

function updateExportNote() {
  const { duration } = exportInfo(controls.s);
  const mb = (duration * 44100 * 4) / 1048576;
  const m = Math.floor(duration / 60);
  const s = Math.round(duration % 60);
  $('#export-note').textContent = `One full solve · ${2 ** controls.s.n - 1} moves · ${m}:${String(s).padStart(2, '0')} · WAV ≈ ${mb.toFixed(0)} MB`;
}
updateExportNote();

$('#btn-export').addEventListener('click', async () => {
  const btn = $('#btn-export');
  if (btn.disabled) return;
  btn.disabled = true;
  const overlay = $('#export-overlay');
  overlay.hidden = false;
  const wasPlaying = conductor.playing;
  if (wasPlaying) conductor.pause();
  const bar = $('#export-bar');
  const prog = $('#export-progress');
  try {
    const s = controls.s;
    const blob = await renderWav(s, (phase, f) => {
      $('#export-phase').textContent = phase;
      bar.style.transform = `scaleX(${f.toFixed(3)})`;
      prog.setAttribute('aria-valuenow', String(Math.round(f * 100)));
    });
    downloadBlob(blob, exportFilename(s));
    toast('Your soundscape is ready.');
  } catch (err) {
    console.error(err);
    toast('Export failed — please try fewer stones or a faster pace.');
  } finally {
    overlay.hidden = true;
    btn.disabled = false;
    bar.style.transform = 'scaleX(0)';
    if (wasPlaying) conductor.play();
  }
});

// ---------------------------------------------------------------- toast

let toastTimer = 0;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

// ---------------------------------------------------------------- keyboard

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (body.classList.contains('landing-open')) return; // Begin button handles Enter/Space natively
  if (about.open || !$('#export-overlay').hidden) return;
  const t = e.target;
  const tag = t.tagName;
  const type = (t.type || '').toLowerCase();
  const isText = tag === 'TEXTAREA' || (tag === 'INPUT' && ['number', 'text', 'search'].includes(type));
  if (isText) return;
  const nativeSpace = tag === 'BUTTON' || tag === 'SELECT' || (tag === 'INPUT' && ['checkbox', 'radio'].includes(type));
  const nativeArrows = tag === 'SELECT' || (tag === 'INPUT' && ['range', 'radio'].includes(type));

  switch (e.key) {
    case ' ':
      if (nativeSpace) return;
      e.preventDefault();
      actions.toggle();
      break;
    case 'ArrowRight':
      if (nativeArrows) return;
      e.preventDefault();
      actions.step();
      break;
    case 'ArrowLeft':
      if (nativeArrows) return;
      e.preventDefault();
      actions.back();
      break;
    case 'r':
    case 'R':
      actions.restart();
      break;
    case 'f':
    case 'F':
      setFocus(!body.classList.contains('focus'));
      break;
    case 'b':
    case 'B':
      setBreath(!breathOn);
      break;
    case 's':
    case 'S':
      setPanel(!body.classList.contains('panel-open'));
      break;
    case '?':
      about.showModal();
      break;
    case 'Escape':
      if (body.classList.contains('focus')) setFocus(false);
      else if (body.classList.contains('panel-open') && window.innerWidth <= 760) setPanel(false);
      break;
    default:
  }
});

// Expose for debugging in the console (harmless in production)
window.zen = { conductor, scene, controls, paceBase };
