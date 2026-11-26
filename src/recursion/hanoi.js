/**
 * Tower of Hanoi — a genuinely recursive generator.
 *
 * hanoi(n, from, to, via) moves n stones from peg `from` to peg `to`:
 *   1. recursively move the n-1 smaller stones out of the way (from → via)
 *   2. move stone n (the largest of this sub-tower)            (from → to)
 *   3. recursively move the n-1 smaller stones back on top     (via  → to)
 *
 * Stones are numbered 1 (smallest) … n (largest). The sequence of moved stones
 * is the "ruler sequence" 1,2,1,3,1,2,1,4,… — a fractal: every prefix of length
 * 2^k − 1 is two copies of the previous prefix joined by the number k.
 *
 * Each yielded move carries the recursion depth and a snapshot of the call stack,
 * so the music and the visuals can make the recursion audible and visible.
 */

export const PEG_NAMES = ['A', 'B', 'C'];

/**
 * @param {number} n       stones in this sub-tower
 * @param {number} from    source peg (0,1,2)
 * @param {number} to      target peg
 * @param {number} via     helper peg
 * @param {number} depth   recursion depth of this call (root = 0)
 * @param {Array}  stack   call-stack frames from the root down to this call
 * @param {{i:number}} counter shared move counter
 */
function* hanoiRec(n, from, to, via, depth, stack, counter) {
  if (n === 0) return;
  stack.push({ n, from, to, depth });
  yield* hanoiRec(n - 1, from, via, to, depth + 1, stack, counter);
  counter.i += 1;
  yield {
    stone: n,
    from,
    to,
    depth,
    index: counter.i,
    stack: stack.map((f) => ({ ...f })),
  };
  yield* hanoiRec(n - 1, via, to, from, depth + 1, stack, counter);
  stack.pop();
}

/** Public generator: yields {stone, from, to, depth, index, stack}. */
export function* hanoi(n, from = 0, to = 2) {
  if (from === to) throw new Error('Start and target peg must differ');
  const via = 3 - from - to;
  yield* hanoiRec(n, from, to, via, 0, [], { i: 0 });
}

export const totalMoves = (n) => 2 ** n - 1;

/** Human-readable frame, e.g. "hanoi(4, A→C)". */
export const frameLabel = (f) => `hanoi(${f.n}, ${PEG_NAMES[f.from]}→${PEG_NAMES[f.to]})`;
