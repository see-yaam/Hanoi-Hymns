/**
 * WAV export — renders one complete solve of the tower offline with the very
 * same graph and voices used for live playback (Tone.Offline), then encodes a
 * 16-bit PCM stereo WAV. Same settings + seed ⇒ bit-identical music.
 */
import * as Tone from 'tone';
import { composeCycle, cycleDuration } from '../recursion/composer.js';
import { buildGraph, performMove, performCue, triggerDroplet, setDroneActive } from './engine.js';
import { rng } from '../util/random.js';
import { PRESETS, NOTE_NAMES } from '../settings.js';

// The master chain low-passes everything at 7.2 kHz, so rendering at 32 kHz
// (Nyquist 16 kHz) loses nothing audible and is ~1/3 faster than 44.1 kHz.
const SAMPLE_RATE = 32000;
const TARGET_LUFS = -16;
const PEAK_CEILING_DB = -1.2; // keep true-ish peak safely below −1 dBFS
const CLIP_FADE = 3; // natural fade-out at the end of a clip (seconds)
const CLIP_RING = 1.5; // let the cadence ring before the fade begins

// Render speed (seconds of work per second of audio). Calibrated on this laptop
// (≈ 21 s for 60 s at 32 kHz) and refined after every completed export.
const SPEED_KEY = 'hanoi-hymns-render-speed';
const DEFAULT_SPEED = 0.38;
function renderSpeed() {
  try {
    const v = parseFloat(localStorage.getItem(SPEED_KEY));
    if (Number.isFinite(v) && v > 0.02 && v < 5) return v;
  } catch (e) { /* storage unavailable */ }
  return DEFAULT_SPEED;
}
function rememberSpeed(v) {
  try { localStorage.setItem(SPEED_KEY, String(0.5 * renderSpeed() + 0.5 * v)); } catch (e) { /* ignore */ }
}

export function exportInfo(settings) {
  const score = composeCycle(settings, 0, 0, 0);
  return { ...score, duration: cycleDuration(score, 12) };
}

/**
 * End a clip on the strongest cadence (the return of the largest call) that fits
 * the target length, then let it ring and fade naturally.
 */
function clipLength(events, target) {
  const latest = target - CLIP_RING - CLIP_FADE;
  const inWindow = (lo) => events.filter((e) => e.phraseEnd && e.time <= latest && e.time >= lo);
  let window = inWindow(target - 20); // stay close to the promised length
  if (!window.length) window = inWindow(target * 0.6);
  if (!window.length) return target;
  const best = window.reduce((a, b) => (b.cadence > a.cadence || (b.cadence === a.cadence && b.time > a.time) ? b : a));
  return best.time + CLIP_RING + CLIP_FADE;
}

/** Export length options with their duration and estimated render time. */
export function exportOptions(settings) {
  const info = exportInfo(settings);
  const speed = renderSpeed();
  const est = (sec) => Math.round(1.5 + sec * speed + sec * 0.012);
  const fmt = (sec) => (sec < 90 ? `${Math.round(sec)} s` : `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')} min`);
  const opts = [];
  if (info.duration > 75) {
    const d = clipLength(info.events, 60);
    opts.push({ id: 'quick', label: 'Quick clip', detail: '1 min', seconds: d, estimate: est(d) });
  }
  if (info.duration > 200) {
    const d = clipLength(info.events, 180);
    opts.push({ id: 'short', label: 'Short', detail: '3 min', seconds: d, estimate: est(d) });
  }
  opts.push({ id: 'full', label: 'Full piece', detail: fmt(info.duration), seconds: info.duration, estimate: est(info.duration) });
  opts.forEach((o) => { o.estimateText = `≈ ${fmt(o.estimate)} to render`; o.lengthText = fmt(o.seconds); });
  return opts;
}

export function exportFilename(s, length = 'full') {
  const preset = s.preset && PRESETS[s.preset] ? s.preset : 'custom';
  const root = NOTE_NAMES[s.root].replace('#', 's');
  const tag = length === 'full' ? 'full' : length === 'short' ? '3min' : '1min';
  return `hanoi-hymns_${preset}_${s.n}-stones_${s.scale}-${root}_seed-${s.seed}_${tag}.wav`;
}

const aborted = () => Object.assign(new Error('Export cancelled'), { name: 'AbortError' });

/**
 * @param {object} settings
 * @param {(phase: string, fraction: number) => void} onProgress
 * @param {{limit?: number, length?: 'quick'|'short'|'full', signal?: AbortSignal}} opts
 *   limit: render only the first N seconds (level checks); length: clip option; signal: cancel
 * @returns {Promise<{blob: Blob, stats: object}>}
 */
export async function renderWav(settings, onProgress = () => {}, { limit = Infinity, length = 'full', signal } = {}) {
  const score = exportInfo(settings);
  const opt = exportOptions(settings).find((o) => o.id === length);
  const isClip = length !== 'full' && opt;
  const duration = Math.min(isClip ? opt.seconds : score.duration, limit);
  const events = score.events.filter((e) => e.time < duration - (isClip ? CLIP_FADE : 0));
  const cues = score.cues.filter((c) => c.time < duration - (isClip ? CLIP_FADE : 0));
  const finalCue = score.cues.find((c) => c.kind === 'final');
  onProgress('Composing the stones…', 0.02);
  if (signal?.aborted) throw aborted();

  // The offline renderer exposes no progress, so ease the bar toward 90 % using
  // the measured render speed of this machine.
  const started = performance.now();
  const expectedMs = (1.5 + duration * renderSpeed()) * 1000;
  let rendering = true;
  const timer = setInterval(() => {
    if (!rendering) return;
    const x = (performance.now() - started) / expectedMs;
    onProgress('Letting the river render…', 0.05 + 0.85 * (1 - Math.exp(-2.2 * x)));
  }, 120);

  let buffer;
  try {
    buffer = await renderOffline(async () => {
      const g = await buildGraph(settings, { lean: true });
      // 2 s fade-in on every export
      g.fader.gain.setValueAtTime(0, 0);
      g.fader.gain.linearRampToValueAtTime(1, 2);
      if (isClip || duration < score.duration) {
        // Clip: the cadence rings, then a smooth equal-power 3 s fade (never a hard cut)
        const curve = new Float32Array(64).map((_, i) => Math.cos((i / 63) * Math.PI / 2));
        g.fader.gain.setValueAtTime(1, duration - CLIP_FADE - 0.01);
        g.fader.gain.setValueCurveAtTime(curve, duration - CLIP_FADE, CLIP_FADE - 0.02);
      } else {
        // Full piece: the bed breathes out after the final cadence, then a natural fade
        g.fader.gain.setValueAtTime(1, Math.max(2.1, duration - 6));
        g.fader.gain.setTargetAtTime(0, Math.max(2.1, duration - 6), 1.4);
      }
      setDroneActive(g, true, 0, 2);
      if (!isClip && finalCue && finalCue.time < duration) setDroneActive(g, false, finalCue.time + 1.5, 7);
      // Merge moves and cues in time order so harmony voice-leading matches live playback
      const timeline = events.map((ev) => ({ t: ev.time, ev })).concat(cues.map((cue) => ({ t: cue.time, cue })));
      timeline.sort((a, b) => a.t - b.t);
      let pool = [];
      for (const item of timeline) {
        pool = pool.filter((v) => v.stop > item.t);
        if (item.ev) performMove(g, item.ev, item.t, settings, pool);
        else pool.push(performCue(g, item.cue, item.t, settings));
      }
      if (settings.rain > 0.02) {
        const r = rng('drops', settings.seed);
        const rate = 0.6 + 7 * settings.rain * settings.rain;
        for (let t = 0.2; t < duration - 1; t += -Math.log(1 - r()) / rate) triggerDroplet(g, t, r, settings.rain);
      }
    }, duration, 2, SAMPLE_RATE);
  } finally {
    rendering = false;
    clearInterval(timer);
  }
  if (signal?.aborted) throw aborted(); // cancelled while rendering: discard the result
  rememberSpeed((performance.now() - started) / 1000 / duration);

  const audio = buffer.get();
  onProgress('Balancing the levels…', 0.9);
  // Loudness normalisation: aim for −16 LUFS, never let peaks pass −1 dBFS
  const before = measureLoudness(audio);
  const lufsGain = Number.isFinite(before.lufs) ? 10 ** ((TARGET_LUFS - before.lufs) / 20) : 1;
  const peakGain = before.peak > 0 ? 10 ** (PEAK_CEILING_DB / 20) / before.peak : 1;
  const gain = Math.min(lufsGain, peakGain, 8);
  const blob = await encodeWav(audio, (f) => {
    if (signal?.aborted) throw aborted();
    onProgress('Pressing the stones into a file…', 0.92 + 0.08 * f);
  }, gain);
  const gdb = 20 * Math.log10(gain);
  const stats = {
    seconds: +duration.toFixed(1),
    gainDb: +gdb.toFixed(2),
    lufs: +(before.lufs + gdb).toFixed(1),
    peakDb: +(20 * Math.log10(before.peak * gain)).toFixed(2),
    rmsDb: +(20 * Math.log10(before.rms * gain)).toFixed(1),
    clipped: before.peak * gain >= 1,
  };
  onProgress('Done', 1);
  return { blob, stats };
}

/**
 * Integrated loudness (ITU-R BS.1770 K-weighting with absolute and relative gating),
 * plus sample peak and RMS. Pure JS so the export can normalise itself.
 */
export function measureLoudness(audio) {
  const sr = audio.sampleRate;
  const chans = [];
  for (let c = 0; c < Math.min(2, audio.numberOfChannels); c++) chans.push(audio.getChannelData(c));
  // K-weighting biquads (pre-filter shelf + RLB high-pass), derived for any sample rate
  const biq = (b, a) => ({ b, a });
  let K = Math.tan((Math.PI * 1681.974450955533) / sr);
  const Vh = 10 ** (3.999843853973347 / 20);
  const Vb = Vh ** 0.4996667741545416;
  let Q = 0.7071752369554196;
  let a0 = 1 + K / Q + K * K;
  const shelf = biq([(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0], [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0]);
  K = Math.tan((Math.PI * 38.13547087602444) / sr);
  Q = 0.5003270373238773;
  a0 = 1 + K / Q + K * K;
  const hp = biq([1, -2, 1], [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0]);
  const block = Math.round(sr * 0.4);
  const hop = Math.round(sr * 0.1);
  const nBlocks = Math.max(0, Math.floor((chans[0].length - block) / hop) + 1);
  const blockPow = new Float64Array(nBlocks);
  let peak = 0;
  let sumSq = 0;
  for (const x of chans) {
    const sq = new Float64Array(x.length);
    const [sb0, sb1, sb2] = shelf.b;
    const [sa1, sa2] = shelf.a;
    const [hb0, hb1, hb2] = hp.b;
    const [ha1, ha2] = hp.a;
    let x1 = 0, x2 = 0, y1p = 0, y2p = 0; // stage 1 state (direct form I)
    let u1 = 0, u2 = 0, z1 = 0, z2 = 0; // stage 2 state
    for (let i = 0; i < x.length; i++) {
      const v = x[i];
      const av = v < 0 ? -v : v;
      if (av > peak) peak = av;
      sumSq += v * v;
      const y1 = sb0 * v + sb1 * x1 + sb2 * x2 - sa1 * y1p - sa2 * y2p;
      x2 = x1; x1 = v; y2p = y1p; y1p = y1;
      const y2 = hb0 * y1 + hb1 * u1 + hb2 * u2 - ha1 * z1 - ha2 * z2;
      u2 = u1; u1 = y1; z2 = z1; z1 = y2;
      sq[i] = y2 * y2;
    }
    // prefix sums for fast block means
    const pre = new Float64Array(x.length + 1);
    for (let i = 0; i < x.length; i++) pre[i + 1] = pre[i] + sq[i];
    for (let b = 0; b < nBlocks; b++) blockPow[b] += (pre[b * hop + block] - pre[b * hop]) / block;
  }
  const L = (p) => -0.691 + 10 * Math.log10(p);
  const abs = [];
  for (const p of blockPow) if (L(p) > -70) abs.push(p);
  let lufs = -Infinity;
  if (abs.length) {
    const rel = L(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
    const gated = abs.filter((p) => L(p) > rel);
    if (gated.length) lufs = L(gated.reduce((a, b) => a + b, 0) / gated.length);
  }
  const rms = Math.sqrt(sumSq / (chans.length * chans[0].length));
  return { lufs, peak, rms };
}

/**
 * Like Tone.Offline, but renders Tone's offline clock synchronously.
 * Tone.Offline yields with setTimeout once per simulated second, which browsers
 * throttle heavily in background tabs — turning a ~10 s render into minutes.
 */
async function renderOffline(setup, duration, channels, sampleRate) {
  const original = Tone.getContext();
  const context = new Tone.OfflineContext(channels, duration, sampleRate);
  Tone.setContext(context);
  let rendering;
  try {
    await setup(context);
    rendering = context.render(false);
  } finally {
    Tone.setContext(original);
  }
  const buffer = await rendering;
  try { context.dispose(); } catch (e) { /* ignore */ }
  return buffer;
}

/** Encode an AudioBuffer as 16-bit PCM WAV (interleaved), yielding to keep the UI calm. */
export async function encodeWav(audioBuffer, onProgress = () => {}, gain = 1) {
  const channels = Math.min(2, audioBuffer.numberOfChannels);
  const length = audioBuffer.length;
  const sr = audioBuffer.sampleRate;
  const dataBytes = length * channels * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buf);
  const writeStr = (off, str) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, channels, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * channels * 2, true); // byte rate
  view.setUint16(32, channels * 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, dataBytes, true);

  const data = [];
  for (let c = 0; c < channels; c++) data.push(audioBuffer.getChannelData(c));
  const pcm = new Int16Array(buf, 44, length * channels);
  const CHUNK = 262144;
  for (let start = 0; start < length; start += CHUNK) {
    const end = Math.min(length, start + CHUNK);
    for (let i = start; i < end; i++) {
      for (let c = 0; c < channels; c++) {
        let s = data[c][i] * gain;
        s = s > 1 ? 1 : s < -1 ? -1 : s;
        pcm[i * channels + c] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
    }
    onProgress(end / length);
    await new Promise((r) => setTimeout(r, 0));
  }
  return new Blob([buf], { type: 'audio/wav' });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
