/**
 * Hanoi → Sierpinski.
 *
 * The state graph of the Tower of Hanoi with n stones has 3^n states (each stone on
 * one of three pegs) and it *is* a Sierpinski triangle: the peg of the largest stone
 * picks one of three sub-triangles, the next stone picks a sub-sub-triangle, and so on.
 * Inside sub-triangle p the corners of the other two pegs are swapped, which is exactly
 * what makes the largest stone's move a short bridge between neighbouring sub-triangles.
 * The optimal solution (all on A → all on C) walks straight along one side.
 */

const SQ = Math.sqrt(3) / 2;
// Unit-triangle corners for pegs A, B, C: A bottom-left, B apex, C bottom-right.
export const UNIT_CORNERS = [[0, 1], [0.5, 0], [1, 1]];
const LAMBDA = 0.47; // < 0.5 leaves a hair of space so every state is a distinct star

const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/**
 * Recursive layout of one state.
 * @param {number[]} pegOf  pegOf[k] = peg (0..2) of stone k (1 = smallest … n = largest)
 * @param {number} k        stone being placed (start with n)
 * @param {number[][]} C    corners of the current (sub-)triangle, indexed by peg
 */
export function statePoint(pegOf, k, C = UNIT_CORNERS) {
  const p = pegOf[k];
  if (k === 1) return C[p];
  const [q, r] = [0, 1, 2].filter((i) => i !== p);
  const sub = [];
  sub[p] = C[p];
  sub[q] = lerp2(C[p], C[r], LAMBDA); // swapped: reflection makes neighbouring states meet
  sub[r] = lerp2(C[p], C[q], LAMBDA);
  return statePoint(pegOf, k - 1, sub);
}

/** All 3^n states in unit coordinates. */
export function allStates(n) {
  const pts = [];
  const pegOf = new Array(n + 1).fill(0);
  const total = 3 ** n;
  for (let s = 0; s < total; s++) {
    let x = s;
    for (let k = 1; k <= n; k++) { pegOf[k] = x % 3; x = Math.floor(x / 3); }
    pts.push(statePoint(pegOf, n));
  }
  return pts;
}

/** Positions of the states visited by one solve (2^n points incl. the start). */
export function pathPoints(n, from, moves) {
  const pegOf = new Array(n + 1).fill(from);
  const pts = [statePoint(pegOf, n)];
  for (const m of moves) {
    pegOf[m.stone] = m.to;
    pts.push(statePoint(pegOf, n));
  }
  return pts;
}

export const TRI_ASPECT = SQ; // height / width of an equilateral triangle
