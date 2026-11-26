/**
 * Tower of Hanoi — a genuinely recursive generator.
 *
 * hanoi(n, from, to, via) moves n stones from peg `from` to peg `to`:
 *   1. recursively move the n-1 smaller stones out of the way (from → via)
 *   2. move stone n (the largest of this sub-tower)            (from → to)
 *   3. recursively move the n-1 smaller stones back on top     (via  → to)
 *
 * The generator yields the *structure* of the recursion, not just the moves:
 *   { type: 'enter',  n, from, to, depth, start }   a call begins   (a musical question)
 *   { type: 'move',   stone, from, to, depth, index, stack }        (the melodic note)
 *   { type: 'return', n, from, to, depth, start }   a call ends     (the answer / cadence)
 *
 * Stones are numbered 1 (smallest) … n (largest). The sequence of moved stones
 * is the "ruler sequence" 1,2,1,3,1,2,1,4,… — a fractal: every prefix of length
 * 2^k − 1 is two copies of the previous prefix joined by the number k.
 * Every call of size k spans exactly 2^k − 1 moves, so phrases nest as 1, 3, 7, 15…
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
  const frame = { n, from, to, depth, start: counter.i };
  stack.push(frame);
  yield { type: 'enter', ...frame };
  yield* hanoiRec(n - 1, from, via, to, depth + 1, stack, counter);
  counter.i += 1;
  yield {
    type: 'move',
    stone: n,
    from,
    to,
    depth,
    index: counter.i,
    stack: stack.map((f) => ({ ...f })),
  };
  yield* hanoiRec(n - 1, via, to, from, depth + 1, stack, counter);
  stack.pop();
  yield { type: 'return', ...frame };
}

/** Full structural event stream: enter / move / return. */
export function* hanoi(n, from = 0, to = 2) {
  if (from === to) throw new Error('Start and target peg must differ');
  const via = 3 - from - to;
  yield* hanoiRec(n, from, to, via, 0, [], { i: 0 });
}

/** Only the moves (2^n − 1 of them). */
export function* hanoiMoves(n, from = 0, to = 2) {
  for (const e of hanoi(n, from, to)) if (e.type === 'move') yield e;
}

export const totalMoves = (n) => 2 ** n - 1;

/** Human-readable frame, e.g. "hanoi(4, A→C)". */
export const frameLabel = (f) => `hanoi(${f.n}, ${PEG_NAMES[f.from]}→${PEG_NAMES[f.to]})`;
