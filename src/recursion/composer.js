/**
 * Composer: turns the recursive move sequence into a timed, humanized score.
 *
 * Rhythm is derived from the recursion itself: after a stone moves, the river
 * "breathes" for a time proportional to that stone's size. Because the moved
 * stones follow the fractal ruler sequence, the rhythm is self-similar too —
 * short-short-long-short-short-longer… at every scale.
 *
 * Only timing + humanization live here. Pitch / instrument / effects are applied
 * at play time from the current settings, so mood changes are instant.
 */
import { hanoi } from './hanoi.js';
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

/**
 * Compose one full solve of the tower.
 * @returns {Array<object>} events sorted by time
 */
export function composeCycle({ n, from, to, pace, seed }, cycle = 0, startTime = 0, startIndex = 0) {
  const base = paceBase(pace);
  const flight = Math.min(base * 0.7, 1.7);
  const r = rng('zen-stones', seed, n, from, to, pace, cycle);
  const events = [];
  let t = startTime + flight + (cycle === 0 ? 1.2 : base * 2.5);
  for (const mv of hanoi(n, from, to)) {
    const jitter = range(r, -0.018, 0.018); // micro-timing
    const vel = range(r, 0.78, 0.97); // velocity humanization
    const detune = range(r, -4, 4); // cents
    const shimmer = r(); // free variable for timbre variation
    events.push({
      ...mv,
      cycle,
      n,
      total: 2 ** n - 1,
      globalIndex: startIndex + events.length,
      time: t + jitter,
      flight,
      vel,
      detune,
      shimmer,
    });
    // Fractal breath: bigger stones leave longer silences behind them.
    t += base * (1 + 0.16 * (mv.stone - 1));
  }
  return events;
}

/** Length of one cycle including a reverb tail (used for export). */
export function cycleDuration(events, tail = 9) {
  if (!events.length) return tail;
  return events[events.length - 1].time + tail;
}
