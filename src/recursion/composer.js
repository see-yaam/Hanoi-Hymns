/**
 * Composer: turns the recursion's STRUCTURE into a timed, humanized score.
 *
 * Musical form follows the call tree:
 *   enter  (a call of size ≥ 2 begins) → the harmony moves AWAY from its parent: a question
 *   move                               → the melodic note, sounding over the current harmony
 *   return (that call ends)            → the harmony falls back to the parent: an answer
 *   top-level call                     → begins and ends at HOME, with a bowl strike each side
 *   base case (one stone)              → inherits its parent's chord: a simple, gentle step
 *
 * Every call of size k spans 2^k − 1 moves, so phrases nest as 1, 3, 7, 15… and the
 * harmonic stack is literally the call stack. Enter/return never add notes and never
 * take time: they only shape harmony and dynamics, so the calm pulse is untouched.
 *
 * Rhythm comes from the recursion too: after a stone moves the river "breathes" for a
 * time proportional to its size, and the ruler sequence doubles as a metric hierarchy
 * (stone ≥ 2 = strong beat).
 */
import { hanoi } from './hanoi.js';
import { awayChord, HOME } from '../audio/harmony.js';
import { rng, range } from '../util/random.js';

export const PACES = {
  slow: { base: 2.6, label: 'Slow' },
  medium: { base: 1.8, label: 'Medium' },
  flow: { base: 1.15, label: 'Flow' },
};

export const paceBase = (pace) => (PACES[pace] || PACES.medium).base;

/** Peg route of cycle k for the endless journey: the tower walks around the 3 rocks. */
export function cyclePegs(from, to, k) {
  let f = from;
  let t = to;
  for (let i = 0; i < k; i++) {
    const via = 3 - f - t;
    f = t;
    t = via;
  }
  return { from: f, to: t };
}

/** Gentle swell toward the middle move of every enclosing phrase (0 … 1). */
function swellFor(index, stack) {
  let sum = 0;
  let wsum = 0;
  for (const f of stack) {
    if (f.n < 2) continue;
    const local = index - f.start; // 1 … 2^n − 1
    const mid = 2 ** (f.n - 1);
    const s = 1 - Math.abs(local - mid) / mid;
    sum += s * f.n;
    wsum += f.n;
  }
  return wsum ? sum / wsum : 1;
}

/**
 * Compose one full solve of the tower.
 * @returns {{ events: Array<object>, cues: Array<object> }}
 *   events — one per move (sorted by time); cues — opening / final bowl strikes
 */
export function composeCycle({ n, from, to, pace, seed }, cycle = 0, startTime = 0, startIndex = 0) {
  const base = paceBase(pace);
  const flight = Math.min(base * 0.7, 1.7);
  const r = rng('hanoi-hymns', seed, n, from, to, pace, cycle);
  const events = [];
  const cues = [];
  const harm = []; // harmony stack mirrors the call stack
  let t = startTime + (cycle === 0 ? 0.9 + flight : base * 3.8 + flight);
  if (cycle === 0) cues.push({ kind: 'open', time: startTime + 0.6, cycle });

  let pendingQuestion = false;
  for (const e of hanoi(n, from, to)) {
    if (e.type === 'enter') {
      const parent = harm.length ? harm[harm.length - 1] : HOME;
      let chord = parent;
      if (e.depth === 0) chord = HOME; // the whole piece starts at home
      else if (e.n >= 2) { chord = awayChord(parent, e); pendingQuestion = true; }
      harm.push(chord);
      continue;
    }
    if (e.type === 'return') {
      harm.pop();
      // A call of size ≥ 2 ends right after this move: a cadence
      if (e.n >= 2 && events.length) events[events.length - 1].phraseEnd = true;
      continue;
    }
    // move
    const jitter = range(r, -0.018, 0.018); // micro-timing
    const vel = range(r, 0.78, 0.97); // velocity humanization
    const detune = range(r, -4, 4); // cents
    const shimmer = r();
    events.push({
      ...e,
      cycle,
      n,
      total: 2 ** n - 1,
      globalIndex: startIndex + events.length,
      time: t + jitter,
      flight,
      vel,
      detune,
      shimmer,
      chord: harm[harm.length - 1],
      harmDepth: harm.filter((c) => c !== HOME).length,
      strong: e.stone >= 2,
      swell: swellFor(e.index, e.stack),
      phraseStart: pendingQuestion,
      phraseEnd: false,
    });
    pendingQuestion = false;
    // Fractal breath: bigger stones leave longer silences behind them.
    t += base * (1 + 0.16 * (e.stone - 1));
  }
  const last = events[events.length - 1];
  // Top-level return: full resolution to the tonic with a soft final bowl and a long tail.
  cues.push({ kind: 'final', time: last.time + base * 1.3, cycle });
  return { events, cues };
}

/** Length of one cycle including the final cadence and its tail (used for export). */
export function cycleDuration({ cues }, tail = 12) {
  const fin = cues.find((c) => c.kind === 'final');
  return (fin ? fin.time : 0) + tail;
}
