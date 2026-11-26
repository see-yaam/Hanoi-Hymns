/** Settings model, scales, presets and share-link (URL hash) encoding. */

export const SCALES = {
  pentatonic: { label: 'Pentatonic Major — Calm', steps: [0, 2, 4, 7, 9], drone: 'soft' },
  hirajoshi: { label: 'Hirajoshi — Zen', steps: [0, 2, 3, 7, 8], drone: 'soft' },
  bhupali: { label: 'Raga Bhupali — Bangla Dusk', steps: [0, 2, 4, 7, 9], drone: 'tanpura' },
  dorian: { label: 'Dorian — Dreamy', steps: [0, 2, 3, 5, 7, 9, 10], drone: 'soft' },
};

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const INSTRUMENTS = {
  bowl: 'Singing bowl',
  kalimba: 'Kalimba',
  pad: 'Warm pad',
};

/** Peg → instrument presets (peg A, B, C). */
export const VOICINGS = {
  classic: { label: 'Classic — Bowl · Kalimba · Pad', map: ['bowl', 'kalimba', 'pad'] },
  temple: { label: 'Temple — Bowl · Bowl · Pad', map: ['bowl', 'pad', 'bowl'] },
  garden: { label: 'Rain Garden — Kalimba · Bowl · Kalimba', map: ['kalimba', 'bowl', 'kalimba'] },
  dream: { label: 'Dream — Pad · Bowl · Pad', map: ['pad', 'bowl', 'pad'] },
};

export const DEFAULTS = {
  n: 5,
  scale: 'pentatonic',
  root: 2, // D
  pace: 'medium',
  from: 0,
  to: 2,
  voicing: 'classic',
  echo: 0.55,
  seed: 108,
  endless: true,
  rain: 0,
  river: 0.45,
  wind: 0.2,
  drone: 0.5,
  volume: 80,
  night: 0.25,
  preset: 'morning-mist',
};

export const PRESETS = {
  'morning-mist': {
    label: 'Morning Mist',
    values: { n: 5, scale: 'pentatonic', root: 2, pace: 'slow', voicing: 'classic', echo: 0.55, seed: 108, rain: 0, river: 0.5, wind: 0.25, drone: 0.45, night: 0.1 },
  },
  'monsoon-evening': {
    label: 'Monsoon Evening',
    values: { n: 6, scale: 'bhupali', root: 4, pace: 'medium', voicing: 'garden', echo: 0.6, seed: 1971, rain: 0.7, river: 0.3, wind: 0.15, drone: 0.5, night: 0.4 },
  },
  'temple-night': {
    label: 'Temple Night',
    values: { n: 7, scale: 'hirajoshi', root: 9, pace: 'slow', voicing: 'temple', echo: 0.75, seed: 777, rain: 0, river: 0.15, wind: 0.35, drone: 0.55, night: 0.75 },
  },
  'deep-sleep': {
    label: 'Deep Sleep',
    values: { n: 8, scale: 'dorian', root: 5, pace: 'slow', voicing: 'dream', echo: 0.85, seed: 4242, rain: 0.3, river: 0.4, wind: 0.1, drone: 0.6, night: 0.95 },
  },
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Validate / coerce a settings object so bad URLs can never break the app. */
export function sanitize(s) {
  const o = { ...DEFAULTS, ...s };
  o.n = clamp(Math.round(+o.n) || DEFAULTS.n, 3, 8);
  if (!SCALES[o.scale]) o.scale = DEFAULTS.scale;
  o.root = clamp(Math.round(+o.root) || 0, 0, 11);
  if (!['slow', 'medium', 'flow'].includes(o.pace)) o.pace = DEFAULTS.pace;
  o.from = clamp(Math.round(+o.from) || 0, 0, 2);
  o.to = clamp(Math.round(+o.to), 0, 2);
  if (Number.isNaN(o.to) || o.to === o.from) o.to = o.from === 2 ? 0 : 2;
  if (!VOICINGS[o.voicing]) o.voicing = DEFAULTS.voicing;
  for (const k of ['echo', 'rain', 'river', 'wind', 'drone', 'night']) {
    const v = parseFloat(o[k]);
    o[k] = Number.isFinite(v) ? clamp(v, 0, 1) : DEFAULTS[k];
  }
  o.seed = clamp(Math.round(+o.seed) || 1, 1, 999999);
  o.volume = clamp(Math.round(+o.volume), 0, 100);
  if (Number.isNaN(o.volume)) o.volume = DEFAULTS.volume;
  o.endless = o.endless === true || o.endless === '1' || o.endless === 1;
  if (o.preset && !PRESETS[o.preset]) o.preset = 'custom';
  return o;
}

const HASH_KEYS = {
  n: 'n', scale: 's', root: 'r', pace: 'p', from: 'a', to: 'b', voicing: 'i', echo: 'e',
  seed: 'seed', endless: 'loop', rain: 'rain', river: 'river', wind: 'wind', drone: 'drone',
  volume: 'v', night: 'sky', preset: 'preset',
};

export function toHash(s) {
  const p = new URLSearchParams();
  for (const [k, short] of Object.entries(HASH_KEYS)) {
    let v = s[k];
    if (typeof v === 'boolean') v = v ? 1 : 0;
    if (typeof v === 'number' && !Number.isInteger(v)) v = v.toFixed(2);
    p.set(short, String(v));
  }
  return '#' + p.toString();
}

export function fromHash(hash) {
  if (!hash || hash.length < 2) return null;
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const o = {};
  let found = false;
  for (const [k, short] of Object.entries(HASH_KEYS)) {
    if (p.has(short)) {
      o[k] = p.get(short);
      found = true;
    }
  }
  if (!found) return null;
  return sanitize(o);
}

/** Map a stone to a MIDI note: largest stone = lowest, smallest = highest. */
export function stoneMidi(stone, n, settings, instrument) {
  const steps = SCALES[settings.scale].steps;
  const L = steps.length;
  const stride = n <= 4 ? 2 : 1; // small towers skip scale notes for wider, arpeggio-like intervals
  const d = (n - stone) * stride;
  let root = settings.root;
  if (root > 6) root -= 12; // keep the register centred around C3
  const octaveShift = instrument === 'pad' ? 0 : 12;
  return 48 + root + steps[d % L] + 12 * Math.floor(d / L) + octaveShift;
}

export const midiToFreq = (m) => 440 * 2 ** ((m - 69) / 12);
