/**
 * WAV export — renders one complete solve of the tower offline with the very
 * same graph and voices used for live playback (Tone.Offline), then encodes a
 * 16-bit PCM stereo WAV. Same settings + seed ⇒ bit-identical music.
 */
import * as Tone from 'tone';
import { composeCycle, cycleDuration } from '../recursion/composer.js';
import { buildGraph, triggerMove, triggerDroplet, setDroneActive } from './engine.js';
import { rng } from '../util/random.js';
import { PRESETS, NOTE_NAMES } from '../settings.js';

const SAMPLE_RATE = 44100;

export function exportInfo(settings) {
  const events = composeCycle(settings, 0, 0, 0);
  return { events, duration: cycleDuration(events, 10) };
}

export function exportFilename(s) {
  const preset = s.preset && PRESETS[s.preset] ? s.preset : 'custom';
  const root = NOTE_NAMES[s.root].replace('#', 's');
  return `zen-stones_${preset}_${s.n}-stones_${s.scale}-${root}_seed-${s.seed}.wav`;
}

/**
 * @param {object} settings
 * @param {(phase: string, fraction: number) => void} onProgress
 * @returns {Promise<Blob>}
 */
export async function renderWav(settings, onProgress = () => {}) {
  const { events, duration } = exportInfo(settings);
  onProgress('Composing the stones…', 0.02);

  // Tone.Offline exposes no render progress, so estimate it from a measured
  // speed and ease the bar toward 90 % until rendering resolves.
  const started = performance.now();
  const expectedMs = 1500 + duration * 35;
  let rendering = true;
  const timer = setInterval(() => {
    if (!rendering) return;
    const x = (performance.now() - started) / expectedMs;
    onProgress('Letting the river render…', 0.05 + 0.85 * (1 - Math.exp(-2.2 * x)));
  }, 120);

  let buffer;
  try {
    buffer = await Tone.Offline(async () => {
      const g = await buildGraph(settings);
      // Gentle fade in, drone underneath, fade out at the end
      g.fader.gain.setValueAtTime(0, 0);
      g.fader.gain.linearRampToValueAtTime(1, 3);
      g.fader.gain.setValueAtTime(1, duration - 7);
      g.fader.gain.linearRampToValueAtTime(0, duration - 0.05);
      setDroneActive(g, true, 0, 4);
      for (const ev of events) triggerMove(g, ev, ev.time, settings);
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

  const blob = await encodeWav(buffer.get(), (f) => onProgress('Pressing the stones into a file…', 0.9 + 0.1 * f));
  onProgress('Done', 1);
  return blob;
}

/** Encode an AudioBuffer as 16-bit PCM WAV (interleaved), yielding to keep the UI calm. */
export async function encodeWav(audioBuffer, onProgress = () => {}) {
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
        let s = data[c][i];
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
