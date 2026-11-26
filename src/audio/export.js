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

const SAMPLE_RATE = 44100;
const TARGET_LUFS = -16;
const PEAK_CEILING_DB = -1.2; // keep true-ish peak safely below −1 dBFS

export function exportInfo(settings) {
  const score = composeCycle(settings, 0, 0, 0);
  return { ...score, duration: cycleDuration(score, 12) };
}

export function exportFilename(s) {
  const preset = s.preset && PRESETS[s.preset] ? s.preset : 'custom';
  const root = NOTE_NAMES[s.root].replace('#', 's');
  return `hanoi-hymns_${preset}_${s.n}-stones_${s.scale}-${root}_seed-${s.seed}.wav`;
}

/**
 * @param {object} settings
 * @param {(phase: string, fraction: number) => void} onProgress
 * @param {{limit?: number}} opts  limit: render only the first N seconds (used for level checks)
 * @returns {Promise<{blob: Blob, stats: object}>}
 */
export async function renderWav(settings, onProgress = () => {}, { limit = Infinity } = {}) {
  const score = exportInfo(settings);
  const duration = Math.min(score.duration, limit);
  const events = score.events.filter((e) => e.time < duration);
  const cues = score.cues.filter((c) => c.time < duration);
  const finalCue = score.cues.find((c) => c.kind === 'final');
  onProgress('Composing the stones…', 0.02);

  // Tone.Offline exposes no render progress, so estimate it from a measured
  // speed and ease the bar toward 90 % until rendering resolves.
  const started = performance.now();
  const expectedMs = 1500 + duration * 260; // measured ≈ 3–4× faster than real time
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
      // 2 s fade-in; the bed (drone + harmony) breathes out after the final cadence;
      // the master then fades naturally (exponential) over the last seconds.
      g.fader.gain.setValueAtTime(0, 0);
      g.fader.gain.linearRampToValueAtTime(1, 2);
      g.fader.gain.setValueAtTime(1, Math.max(2.1, duration - 6));
      g.fader.gain.setTargetAtTime(0, Math.max(2.1, duration - 6), 1.4);
      setDroneActive(g, true, 0, 2);
      if (finalCue && finalCue.time < duration) setDroneActive(g, false, finalCue.time + 1.5, 7);
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

  const audio = buffer.get();
  onProgress('Balancing the levels…', 0.9);
  // Loudness normalisation: aim for −16 LUFS, never let peaks pass −1 dBFS
  const before = measureLoudness(audio);
  const lufsGain = Number.isFinite(before.lufs) ? 10 ** ((TARGET_LUFS - before.lufs) / 20) : 1;
  const peakGain = before.peak > 0 ? 10 ** (PEAK_CEILING_DB / 20) / before.peak : 1;
  const gain = Math.min(lufsGain, peakGain, 8);
  const blob = await encodeWav(audio, (f) => onProgress('Pressing the stones into a file…', 0.92 + 0.08 * f), gain);
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
