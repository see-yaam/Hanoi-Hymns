/**
 * Harmony: the call stack becomes a stack of chords.
 *
 * Each mood has five consonant chords (pitch classes relative to the root; the
 * first pitch class is the bass). Index 0 is HOME. Pentatonic / Hirajoshi /
 * Bhupali use open fifths, sus2/sus4 and stacked fourths so nothing can clash;
 * Dorian uses its characteristic i7 · IV · bVII · bIII · ii.
 *
 * Pad chords are voiced with smooth voice leading: the bass moves to the nearest
 * root, the three upper voices take the permutation that moves least.
 */
import { SCALES } from '../settings.js';

const OPEN_PENTA = [
  [0, 7, 2], //  I sus2 (open fifth + 9th)  — home
  [9, 4, 0], //  vi
  [7, 2, 9], //  V sus2
  [2, 9, 7], //  ii sus4 (quartal)
  [4, 9, 2], //  iii as stacked fourths
];

export const CHORDS = {
  pentatonic: OPEN_PENTA,
  bhupali: [
    [0, 7, 4], //  Sa–Pa–Ga  — home
    [9, 4, 0], //  Dha (vi)
    [7, 2, 9], //  Pa sus2
    [2, 9, 7], //  Re sus4
    [4, 9, 2], //  Ga quartal
  ],
  hirajoshi: [
    [0, 7, 2], //  i sus2 — home
    [8, 3, 0], //  bVI
    [3, 7, 0], //  bIII / i (no clash)
    [7, 2, 0], //  v sus4
    [8, 3], //     bVI open fifth
  ],
  dorian: [
    [0, 7, 3, 10], // i7 — home
    [5, 9, 0], //     IV (the Dorian colour)
    [10, 2, 5], //    bVII
    [3, 7, 10], //    bIII
    [2, 9, 5], //     ii
  ],
};

export const HOME = 0;

const chordSet = (scale) => CHORDS[scale] || OPEN_PENTA;

/** Pick a chord "away" from the parent's chord — varied by depth and target peg, never equal to the parent. */
export function awayChord(parent, frame) {
  const options = [1, 2, 3, 4].filter((i) => i !== parent);
  return options[(frame.depth * 2 + frame.to + frame.n) % options.length];
}

const rootPc = (root) => ((root % 12) + 12) % 12;

/** Absolute pitch classes of chord `idx` in the current mood. */
export function chordPcs(scale, idx, root) {
  const set = chordSet(scale);
  return set[idx % set.length].map((pc) => (pc + rootPc(root)) % 12);
}

const nearestWithPc = (from, pc, lo, hi) => {
  let best = null;
  for (let m = lo; m <= hi; m++) {
    if (((m % 12) + 12) % 12 !== pc) continue;
    if (best === null || Math.abs(m - from) < Math.abs(best - from)) best = m;
  }
  return best;
};

function permutations(arr) {
  if (arr.length <= 1) return [arr.slice()];
  const out = [];
  arr.forEach((x, i) => {
    for (const p of permutations(arr.slice(0, i).concat(arr.slice(i + 1)))) out.push([x, ...p]);
  });
  return out;
}

/** Starting voicing (bass + 3 upper voices) for the home chord. */
export function initialVoicing(scale, root) {
  const pcs = chordPcs(scale, HOME, root);
  const r = rootPc(root) > 6 ? rootPc(root) - 12 : rootPc(root);
  return voiceLead([43 + r, 55 + r, 59 + r, 64 + r], pcs);
}

/**
 * Smooth voice leading: returns [bass, u1, u2, u3] (MIDI).
 * Upper voices avoid seconds between each other (no clashes) and stay in 52–74.
 */
export function voiceLead(prev, pcs) {
  const bass = nearestWithPc(prev[0], pcs[0], 38, 52);
  // Open dyads: double the pitch class that fits two octaves in the upper range (never a unison)
  const fitsTwice = (pc) => { let k = 0; for (let m = 52; m <= 74; m++) if (m % 12 === pc) k++; return k >= 2; };
  const dup = fitsTwice(pcs[0]) ? pcs[0] : pcs[1];
  const upperPcs = pcs.length >= 4 ? pcs.slice(1, 4) : pcs.length === 3 ? pcs.slice() : [pcs[0], pcs[1], dup];
  let best = searchUpper(prev, upperPcs, bass, 9);
  if (best.cost >= 40) best = searchUpper(prev, upperPcs, bass, 24); // widen the search rather than clash
  return [bass, ...best.notes];
}

function searchUpper(prev, upperPcs, bass, reach) {
  // Each voice may take any octave of its pitch class within reach (52–74)
  const candidates = (from, pc) => {
    const out = [];
    for (let m = 52; m <= 74; m++) if (((m % 12) + 12) % 12 === pc && Math.abs(m - from) <= reach) out.push(m);
    return out.length ? out : [nearestWithPc(from, pc, 52, 74)];
  };
  let best = null;
  for (const perm of permutations(upperPcs)) {
    const c0 = candidates(prev[1], perm[0]);
    const c1 = candidates(prev[2], perm[1]);
    const c2 = candidates(prev[3], perm[2]);
    for (const a of c0) for (const b of c1) for (const c of c2) {
      const notes = [a, b, c];
      let cost = Math.abs(a - prev[1]) + Math.abs(b - prev[2]) + Math.abs(c - prev[3]);
      const sorted = notes.slice().sort((x, y) => x - y);
      for (let i = 1; i < 3; i++) if (sorted[i] - sorted[i - 1] < 3) cost += 40; // no seconds / unisons: nothing clashes
      if (sorted[0] - bass < 5) cost += 10; // leave room above the bass
      if (sorted[2] - sorted[0] > 19) cost += (sorted[2] - sorted[0] - 19) * 2; // stay compact
      if (!best || cost < best.cost) best = { cost, notes };
    }
  }
  return best;
}

/**
 * Prefer chord tones on strong beats: move the melodic note to the nearest chord
 * tone (within a whole tone) that is also in the scale.
 */
export function snapToChord(midi, pcs, scale, root) {
  const pc = ((midi % 12) + 12) % 12;
  if (pcs.includes(pc)) return midi;
  const steps = SCALES[scale].steps.map((s) => (s + rootPc(root)) % 12);
  for (const d of [-1, 1, -2, 2]) {
    const q = (((midi + d) % 12) + 12) % 12;
    if (pcs.includes(q) && steps.includes(q)) return midi + d;
  }
  return midi;
}
