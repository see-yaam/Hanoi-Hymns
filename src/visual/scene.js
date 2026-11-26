/**
 * Riverside at dusk — a calm "2.5D" Canvas scene.
 *
 * Layers (back → front): sky gradient + stars + moon glow + drifting clouds,
 * three parallax hill ranges, mist, the flowing river with reflections,
 * three flat rock platforms with river stones, ripples + glows, rain,
 * fireflies, foreground grass.
 *
 * The scene is stateless with respect to the music: every frame it reads the
 * conductor's playhead and derives which stones sit where, which one is in the
 * air and how far along its arc it is. That keeps sight and sound in sync,
 * including pause / step / seek.
 */
import { mulberry32, hashSeed } from '../util/random.js';
import { VOICINGS } from '../settings.js';
import { allStates, pathPoints, TRI_ASPECT } from './sierpinski.js';

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
const easeOutCubic = (t) => 1 - (1 - t) ** 3;

const STONE_COLORS = ['#8b8279', '#9d8569', '#727a70', '#a48e76', '#66615f', '#8f7b66', '#7a736d', '#94877a'];
const GLOW = {
  bowl: [255, 196, 120],
  kalimba: [176, 214, 255],
  pad: [222, 176, 255],
};

function hexToRgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
const mixRgb = (a, b, t) => a.map((x, i) => Math.round(lerp(x, b[i], t)));
const rgba = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

const SKY_DUSK = ['#1c2452', '#3f4581', '#8f7fbd', '#e9ad86'].map(hexToRgb);
const SKY_NIGHT = ['#060918', '#111739', '#29305f', '#5e5388'].map(hexToRgb);

export class Scene {
  constructor(canvas, conductor) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.conductor = conductor;
    this.night = 0.25;
    this.nightTarget = 0.25;
    this.rain = 0;
    this.inset = 0;
    this.insetTarget = 0;
    this.reduced = false;
    this.pointer = { x: 0, y: 0, sx: 0, sy: 0 };
    this.start = performance.now();
    this.ripples = [];
    this.glows = [];
    this.raindrops = [];
    this.alpha = 1;
    this.shownEpoch = -1;
    this.cache = { events: null, count: 0, pegs: null };
    this.lastCompleted = 0;
    this.frameHooks = [];
    this.tri = { enabled: true, alpha: 1, sprite: null, key: '', pts: [], afterglow: null, doneKey: '' };

    const r = mulberry32(hashSeed('sky'));
    this.stars = Array.from({ length: 170 }, () => ({
      x: r(), y: r() ** 1.6 * 0.5, s: 0.4 + r() * 1.3, p: r() * TAU, sp: 0.3 + r() * 1.1, d: r() * 60,
    }));
    this.flies = Array.from({ length: 16 }, () => ({ x: r(), y: 0.78 + r() * 0.16, p: r() * TAU, q: r() * TAU, s: 0.4 + r() }));
    this.clouds = Array.from({ length: 4 }, (_, i) => ({ x: r(), y: 0.12 + r() * 0.25, w: 0.25 + r() * 0.3, sp: 0.0025 + r() * 0.003, a: 0.05 + r() * 0.06, i }));
    this.shimmer = Array.from({ length: 90 }, () => ({ x: r(), y: r(), l: 0.3 + r(), p: r() * TAU }));
    this.blades = Array.from({ length: 170 }, () => ({ x: r(), h: 0.4 + r() * 0.8, b: r() * 0.4, p: r() * TAU, c: r() }));
    this.hillSeeds = [0, 1, 2].map((i) => Array.from({ length: 5 }, () => ({ f: 0.6 + r() * 3.2 * (i + 1), p: r() * TAU, a: r() })));

    this.resize = this.resize.bind(this);
    window.addEventListener('resize', this.resize);
    window.addEventListener('pointermove', (e) => {
      this.pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
    });
    this.resize();
  }

  setAtmosphere({ night, rain, stars }) {
    if (night !== undefined) this.nightTarget = night;
    if (rain !== undefined) this.rain = rain;
    if (stars !== undefined) this.tri.enabled = stars;
  }
  setInset(px) { this.insetTarget = px; }
  setReducedMotion(v) { this.reduced = v; }
  onFrame(fn) { this.frameHooks.push(fn); }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.W = window.innerWidth;
    this.H = window.innerHeight;
    this.canvas.width = Math.round(this.W * dpr);
    this.canvas.height = Math.round(this.H * dpr);
    this.canvas.style.width = this.W + 'px';
    this.canvas.style.height = this.H + 'px';
    this.sprites = null; // rebuilt lazily
  }

  // ------------------------------------------------------------ layout

  layout(n) {
    const W = this.W;
    const H = this.H;
    const left = 0;
    const right = W - this.inset;
    const sw = right - left;
    const horizon = H * 0.55;
    const waterY = H * (W < 640 ? 0.71 : 0.73); // waterline under the platforms
    const pw = clamp(sw * 0.27, 96, 300);
    const xs = [0.2, 0.5, 0.8].map((f) => left + sw * f);
    const maxStoneW = pw * 0.88;
    const minStoneW = pw * 0.34;
    const sh = Math.min(H * 0.048, (H * 0.3) / n, pw * 0.2);
    const topH = pw * 0.13;
    const sideH = pw * 0.07;
    return { W, H, horizon, waterY, pw, xs, maxStoneW, minStoneW, sh, topH, sideH, n };
  }

  stoneWidth(L, k) {
    return L.n === 1 ? L.maxStoneW : lerp(L.minStoneW, L.maxStoneW, (k - 1) / (L.n - 1));
  }

  /** Centre position of a resting stone at stack height i on peg p. */
  restPos(L, p, i) {
    const top = L.waterY - L.sideH; // centre of the platform's top face
    return { x: L.xs[p], y: top - L.sh * 0.4 - i * L.sh * 0.86 };
  }

  // ------------------------------------------------------------ sprites

  buildSprites(L) {
    const key = `${L.n}|${Math.round(L.pw)}|${Math.round(L.sh)}|${this.dpr}`;
    if (this.sprites && this.sprites.key === key) return;
    const stones = [];
    for (let k = 1; k <= L.n; k++) {
      const w = this.stoneWidth(L, k);
      stones[k] = makeStone(w, L.sh, STONE_COLORS[(k * 3) % STONE_COLORS.length], k, this.dpr);
    }
    this.sprites = { key, stones, platform: makePlatform(L.pw, L.topH, L.sideH, this.dpr) };
  }

  // ------------------------------------------------------------ state derivation

  pegState(c) {
    const cd = this.conductor;
    const cache = this.cache;
    if (cache.events !== cd.events || c < cache.count || !cache.pegs || cache.epoch !== cd.epoch) {
      const s = cd.settings;
      const pegs = [[], [], []];
      for (let k = s.n; k >= 1; k--) pegs[s.from].push(k);
      Object.assign(cache, { events: cd.events, count: 0, pegs, epoch: cd.epoch });
    }
    while (cache.count < c) {
      const ev = cd.events[cache.count++];
      const stone = cache.pegs[ev.from].pop();
      cache.pegs[ev.to].push(stone ?? ev.stone);
    }
    return cache.pegs;
  }

  // ------------------------------------------------------------ frame

  frame(now) {
    const t = (now - this.start) / 1000;
    const dt = Math.min(0.05, (now - (this.lastNow || now)) / 1000);
    this.lastNow = now;
    const ctx = this.ctx;
    const cd = this.conductor;
    if (!cd.settings) return;

    this.night = lerp(this.night, this.nightTarget, 1 - Math.exp(-dt * 0.8));
    this.inset = lerp(this.inset, this.insetTarget, 1 - Math.exp(-dt * 6));
    const k = this.reduced ? 0 : 1;
    this.pointer.sx = lerp(this.pointer.sx, this.pointer.x * k, 1 - Math.exp(-dt * 1.5));
    this.pointer.sy = lerp(this.pointer.sy, this.pointer.y * k, 1 - Math.exp(-dt * 1.5));

    // Epoch cross-fade (new stone count / restart)
    if (this.shownEpoch !== cd.epoch) {
      if (this.shownEpoch === -1 || !this.snapshot) {
        this.shownEpoch = cd.epoch;
        this.alpha = 0;
        this.lastCompleted = 0;
      } else {
        this.alpha -= dt / 0.55;
        if (this.alpha <= 0) {
          this.alpha = 0;
          this.shownEpoch = cd.epoch;
          this.lastCompleted = 0;
          this.ripples.length = 0;
        }
      }
    } else if (this.alpha < 1) {
      this.alpha = Math.min(1, this.alpha + dt / 0.9);
    }

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const n = this.shownEpoch === cd.epoch ? cd.settings.n : this.snapshot.n;
    const L = this.layout(n);
    this.buildSprites(L);

    this.drawSky(ctx, L, t);
    this.drawHills(ctx, L, t);
    this.drawWater(ctx, L, t);

    // --- stones
    let view;
    if (this.shownEpoch === cd.epoch) {
      view = this.deriveView(L);
      this.snapshot = view;
    } else {
      view = this.snapshot;
    }
    this.drawConstellation(ctx, L, view, t, dt, this.shownEpoch === cd.epoch);
    this.drawReflections(ctx, L, view, t);
    this.drawRipples(ctx, L, dt);
    this.drawPlatformsAndStones(ctx, L, view, t);
    this.drawGlows(ctx, L, dt);
    this.drawRain(ctx, L, dt, t);
    this.drawForeground(ctx, L, t);

    for (const fn of this.frameHooks) fn(view);
  }

  deriveView(L) {
    const cd = this.conductor;
    const ph = cd.visualPlayhead();
    const c = cd.completedAt(ph);
    const pegs = this.pegState(c).map((p) => p.slice());
    let flying = null;
    const next = cd.events[c];
    if (next && ph >= next.time - next.flight) {
      const u = clamp((ph - (next.time - next.flight)) / next.flight, 0, 1);
      const stone = pegs[next.from].pop() ?? next.stone;
      flying = { ev: next, u, stone, fromIdx: pegs[next.from].length, toIdx: pegs[next.to].length };
    }
    // Landing effects for newly completed moves (only during normal forward motion)
    if (c > this.lastCompleted && c - this.lastCompleted <= 3) {
      for (let i = this.lastCompleted; i < c; i++) this.spawnLanding(L, cd.events[i], pegs);
    }
    this.lastCompleted = c;
    const current = flying ? flying.ev : cd.events[Math.max(0, c - 1)];
    return { n: L.n, pegs, flying, completed: c, current, playhead: ph };
  }

  spawnLanding(L, ev, pegs) {
    const x = L.xs[ev.to];
    const h = pegs[ev.to].length - 1;
    const p = this.restPos(L, ev.to, Math.max(0, h));
    const inst = VOICINGS[this.conductor.settings.voicing].map[ev.to];
    const big = ev.stone / ev.n;
    this.ripples.push({ x, y: L.waterY + 2, age: 0, life: 3.6 + big * 1.5, size: L.pw * (0.7 + big * 0.6) });
    this.glows.push({ x: p.x, y: p.y, age: 0, life: 1.8, r: this.stoneWidth(L, ev.stone) * 0.9, c: GLOW[inst] });
  }

  // ------------------------------------------------------------ layers

  drawSky(ctx, L, t) {
    const { W, H, horizon } = L;
    const nt = this.night;
    const cols = SKY_DUSK.map((c, i) => mixRgb(c, SKY_NIGHT[i], nt));
    const g = ctx.createLinearGradient(0, 0, 0, horizon + 10);
    g.addColorStop(0, rgba(cols[0]));
    g.addColorStop(0.45, rgba(cols[1]));
    g.addColorStop(0.8, rgba(cols[2]));
    g.addColorStop(1, rgba(cols[3]));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, horizon + 12);

    // Stars fade in slowly over the first minutes
    const appear = clamp((t - 4) / 80, 0, 1) * (0.3 + 0.7 * nt) + 0.12 * nt;
    if (appear > 0.01) {
      const px = this.pointer.sx * -4;
      for (const s of this.stars) {
        const local = clamp((t - s.d * 0.6) / 20, 0, 1);
        const tw = this.reduced ? 0.8 : 0.65 + 0.35 * Math.sin(t * s.sp + s.p);
        const a = appear * local * tw * (1 - s.y * 1.3);
        if (a <= 0.01) continue;
        ctx.fillStyle = `rgba(240,236,255,${a.toFixed(3)})`;
        ctx.fillRect(s.x * W + px, s.y * H, s.s, s.s);
      }
    }

    // Moon / low sun glow
    const mx = (L.W - this.inset) * 0.7 + this.pointer.sx * -8;
    const my = horizon - H * 0.15;
    const warm = mixRgb([255, 200, 140], [235, 228, 255], nt);
    const glow = ctx.createRadialGradient(mx, my, 0, mx, my, H * 0.38);
    glow.addColorStop(0, rgba(warm, 0.32));
    glow.addColorStop(0.25, rgba(warm, 0.1));
    glow.addColorStop(1, rgba(warm, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, horizon + 10);
    ctx.fillStyle = rgba(mixRgb([255, 222, 180], [246, 242, 255], nt), 0.85);
    ctx.beginPath();
    ctx.arc(mx, my, Math.max(10, H * 0.026), 0, TAU);
    ctx.fill();

    // Slow clouds
    for (const c of this.clouds) {
      const cx = ((c.x + (this.reduced ? 0 : t * c.sp * 0.1)) % 1.4 - 0.2) * W;
      const cy = c.y * H;
      const cw = c.w * W;
      const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, cw * 0.5);
      const cc = mixRgb([255, 214, 200], [140, 140, 200], nt);
      cg.addColorStop(0, rgba(cc, c.a));
      cg.addColorStop(1, rgba(cc, 0));
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1, 0.22);
      ctx.translate(-cx, -cy);
      ctx.fillStyle = cg;
      ctx.fillRect(cx - cw * 0.5, cy - cw * 0.5, cw, cw);
      ctx.restore();
    }
  }

  hillY(i, x, L) {
    const seeds = this.hillSeeds[i];
    let v = 0;
    for (const s of seeds) v += Math.sin(x * s.f * TAU / 1.0 + s.p) * (0.4 + s.a * 0.6) / s.f ** 0.6;
    return v;
  }

  drawHills(ctx, L, t) {
    const { W, H, horizon } = L;
    const nt = this.night;
    const specs = [
      { base: horizon - H * 0.035, amp: H * 0.05, par: 6, col: mixRgb([92, 84, 140], [34, 36, 74], nt), a: 0.9 },
      { base: horizon - H * 0.012, amp: H * 0.035, par: 14, col: mixRgb([58, 54, 104], [22, 24, 54], nt), a: 1 },
      { base: horizon + 2, amp: H * 0.018, par: 24, col: mixRgb([34, 34, 70], [13, 15, 36], nt), a: 1 },
    ];
    specs.forEach((sp, i) => {
      const off = this.pointer.sx * -sp.par + (this.reduced ? 0 : Math.sin(t * 0.01 + i) * 3);
      ctx.beginPath();
      ctx.moveTo(-40, horizon + 20);
      for (let x = -40; x <= W + 40; x += 10) {
        const nx = (x - off) / W;
        ctx.lineTo(x, sp.base - sp.amp * (0.6 + this.hillY(i, nx * 0.6, L)));
      }
      ctx.lineTo(W + 40, horizon + 20);
      ctx.closePath();
      ctx.fillStyle = rgba(sp.col, sp.a);
      ctx.fill();
      // atmospheric haze between ranges
      const hz = ctx.createLinearGradient(0, sp.base - sp.amp * 2, 0, horizon + 10);
      const hc = mixRgb([233, 170, 150], [80, 76, 130], nt);
      hz.addColorStop(0, rgba(hc, 0));
      hz.addColorStop(1, rgba(hc, 0.1 + 0.05 * (2 - i)));
      ctx.fillStyle = hz;
      ctx.fill();
    });
  }

  drawWater(ctx, L, t) {
    const { W, H, horizon } = L;
    const nt = this.night;
    const top = horizon;
    const bottom = H;
    const g = ctx.createLinearGradient(0, top, 0, bottom);
    g.addColorStop(0, rgba(mixRgb([190, 150, 170], [62, 60, 110], nt)));
    g.addColorStop(0.12, rgba(mixRgb([104, 96, 150], [30, 34, 72], nt)));
    g.addColorStop(0.6, rgba(mixRgb([44, 48, 92], [14, 18, 42], nt)));
    g.addColorStop(1, rgba(mixRgb([22, 26, 56], [8, 10, 26], nt)));
    ctx.fillStyle = g;
    ctx.fillRect(0, top, W, bottom - top);

    // Moon path on the water
    const mx = (W - this.inset) * 0.7 + this.pointer.sx * -8;
    const warm = mixRgb([255, 196, 140], [220, 220, 255], nt);
    for (let i = 0; i < 26; i++) {
      const y = top + 4 + (i / 26) ** 1.4 * (H * 0.4);
      const wob = this.reduced ? 0 : Math.sin(t * 0.8 + i * 1.7) * 6 * (1 + i / 10);
      const len = (10 + i * 2.2) * (0.6 + 0.4 * Math.sin(t * 0.5 + i));
      ctx.fillStyle = rgba(warm, 0.22 * (1 - i / 26));
      ctx.fillRect(mx - len / 2 + wob, y, len, 1.4 + i / 18);
    }

    // Flowing shimmer lines (perspective: thinner near the horizon)
    const flow = this.reduced ? t * 0.004 : t * 0.018;
    ctx.lineCap = 'round';
    for (const s of this.shimmer) {
      const depth = s.y ** 1.6;
      const y = top + 6 + depth * (H - top - 10);
      const x = (((s.x + flow * (0.4 + depth)) % 1) + 1) % 1 * (W + 100) - 50;
      const len = (8 + 46 * depth) * s.l;
      const a = (0.05 + 0.1 * depth) * (0.5 + 0.5 * Math.sin(t * 0.7 + s.p));
      ctx.strokeStyle = `rgba(220,215,255,${a.toFixed(3)})`;
      ctx.lineWidth = 0.6 + depth * 1.2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + len, y);
      ctx.stroke();
    }

    // Mist band over the far bank
    const mist = (1 - nt) * 0.5 + 0.12;
    const mg = ctx.createLinearGradient(0, horizon - H * 0.06, 0, horizon + H * 0.05);
    const mc = mixRgb([240, 210, 220], [150, 150, 200], nt);
    mg.addColorStop(0, rgba(mc, 0));
    mg.addColorStop(0.5, rgba(mc, 0.16 * mist));
    mg.addColorStop(1, rgba(mc, 0));
    ctx.fillStyle = mg;
    ctx.fillRect(0, horizon - H * 0.06, W, H * 0.11);
  }

  // ------------------------------------------------------------ Sierpinski constellation

  triLayout(L) {
    const sw = L.W - this.inset;
    const h = Math.min(L.H * 0.25, sw * 0.3);
    const w = h / TRI_ASPECT;
    const top = L.W < 760 ? L.H * 0.2 : L.H * 0.065;
    return { x0: sw / 2 - w / 2, y0: top, w, h };
  }

  /** Pre-rendered field of all 3^n states as very dim stars. */
  triSprite(n, T) {
    const key = `${n}|${Math.round(T.w)}|${this.dpr}`;
    if (this.tri.sprite && this.tri.sprite.key === key) return this.tri.sprite;
    const pad = 6;
    const c = document.createElement('canvas');
    c.width = Math.ceil((T.w + pad * 2) * this.dpr);
    c.height = Math.ceil((T.h + pad * 2) * this.dpr);
    const g = c.getContext('2d');
    g.scale(this.dpr, this.dpr);
    const rad = n <= 3 ? 1.5 : n <= 5 ? 1.1 : n <= 6 ? 0.8 : 0.55;
    g.fillStyle = `rgba(222, 214, 255, ${n <= 5 ? 0.42 : 0.3})`;
    for (const [u, v] of allStates(n)) {
      g.beginPath();
      g.arc(pad + u * T.w, pad + v * T.h, rad, 0, TAU);
      g.fill();
    }
    this.tri.sprite = { key, canvas: c, pad, w: T.w + pad * 2, h: T.h + pad * 2 };
    return this.tri.sprite;
  }

  drawConstellation(ctx, L, view, t, dt, live) {
    const tri = this.tri;
    tri.alpha = clamp(tri.alpha + (tri.enabled ? dt / 0.9 : -dt / 0.9), 0, 1);
    if (tri.alpha <= 0.001) return;
    const cd = this.conductor;
    const T = this.triLayout(L);
    const sp = this.triSprite(L.n, T);
    const vis = tri.alpha * (0.55 + 0.45 * this.night) * this.alpha * (this.breathing ? 0.45 : 1);
    ctx.save();
    ctx.globalAlpha = vis * (this.reduced ? 0.9 : 0.82 + 0.18 * Math.sin(t * 0.21));
    ctx.drawImage(sp.canvas, T.x0 - sp.pad, T.y0 - sp.pad, sp.w, sp.h);
    ctx.globalAlpha = 1;
    const P = ([u, v]) => [T.x0 + u * T.w, T.y0 + v * T.h];
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Path of the current solve
    if (live && cd.events.length) {
      const cur = view.flying ? view.flying.ev : cd.events[Math.max(0, view.completed - 1)];
      const cycle = view.completed === 0 && !view.flying ? 0 : cur.cycle;
      const key = `${cd.epoch}|${cycle}|${L.n}|${cd.settings.from}|${cd.settings.to}`;
      if (tri.key !== key) {
        const moves = cd.events.filter((e) => e.cycle === cycle);
        tri.pts = pathPoints(L.n, cd.cyclePegsAt(cycle).from, moves);
        tri.firstIdx = moves.length ? moves[0].globalIndex : 0;
        tri.key = key;
      }
      const done = clamp(view.completed - tri.firstIdx, 0, tri.pts.length - 1);
      const pts = tri.pts.map(P);
      if (done > 0) {
        ctx.strokeStyle = `rgba(242, 179, 111, ${(0.3 * vis).toFixed(3)})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i <= done; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.stroke();
      }
      // The head travels with the flying stone and lights up the state it lands on
      let head = pts[done];
      let from = done > 0 ? pts[done - 1] : null;
      if (view.flying && view.flying.ev.cycle === cycle && done + 1 < pts.length) {
        const e = easeInOutSine(view.flying.u);
        from = pts[done];
        head = [lerp(from[0], pts[done + 1][0], e), lerp(from[1], pts[done + 1][1], e)];
      }
      if (from) {
        ctx.strokeStyle = `rgba(255, 210, 150, ${(0.7 * vis).toFixed(3)})`;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(from[0], from[1]);
        ctx.lineTo(head[0], head[1]);
        ctx.stroke();
      }
      const gr = ctx.createRadialGradient(head[0], head[1], 0, head[0], head[1], 10);
      gr.addColorStop(0, `rgba(255, 214, 160, ${(0.85 * vis).toFixed(3)})`);
      gr.addColorStop(0.35, `rgba(242, 179, 111, ${(0.35 * vis).toFixed(3)})`);
      gr.addColorStop(1, 'rgba(242, 179, 111, 0)');
      ctx.fillStyle = gr;
      ctx.fillRect(head[0] - 10, head[1] - 10, 20, 20);
      // Solve complete: the whole path glows across the fractal, then slowly fades
      if (done === tri.pts.length - 1 && tri.doneKey !== key) {
        tri.doneKey = key;
        tri.afterglow = { pts: tri.pts.slice(), t0: t };
      }
    }
    if (tri.afterglow) {
      const age = t - tri.afterglow.t0;
      const k = age < 1.2 ? age / 1.2 : age < 5 ? 1 : Math.max(0, 1 - (age - 5) / 7);
      if (k <= 0) tri.afterglow = null;
      else {
        const pts = tri.afterglow.pts.map(P);
        for (const [wdt, al] of [[5, 0.12], [1.6, 0.6]]) {
          ctx.strokeStyle = `rgba(255, 200, 140, ${(al * k * vis).toFixed(3)})`;
          ctx.lineWidth = wdt;
          ctx.beginPath();
          ctx.moveTo(pts[0][0], pts[0][1]);
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  drawReflections(ctx, L, view, t) {
    const sp = this.sprites;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, L.waterY, L.W, L.H - L.waterY);
    ctx.clip();
    ctx.translate(0, L.waterY * 2 + L.sideH * 0.2);
    ctx.scale(1, -1);
    ctx.globalAlpha = 0.16 * this.alpha;
    for (let p = 0; p < 3; p++) {
      const wob = this.reduced ? 0 : Math.sin(t * 0.9 + p) * 1.5;
      drawSprite(ctx, sp.platform, L.xs[p] + wob, L.waterY - L.sideH - L.topH * 0.5 + L.topH * 0.5);
      view.pegs[p].forEach((k, i) => {
        const s = sp.stones[k];
        if (!s) return;
        const pos = this.restPos(L, p, i);
        drawSprite(ctx, s, pos.x + wob, pos.y);
      });
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  drawPlatformsAndStones(ctx, L, view, t) {
    const sp = this.sprites;
    for (let p = 0; p < 3; p++) {
      drawSprite(ctx, sp.platform, L.xs[p], L.waterY - L.sideH - L.topH * 0.5 + L.topH * 0.5);
    }
    ctx.globalAlpha = this.alpha;
    for (let p = 0; p < 3; p++) {
      view.pegs[p].forEach((k, i) => {
        const s = sp.stones[k];
        if (!s) return;
        const pos = this.restPos(L, p, i);
        // contact shadow
        ctx.fillStyle = 'rgba(8,8,24,0.28)';
        ctx.beginPath();
        ctx.ellipse(pos.x, pos.y + L.sh * 0.42, s.w * 0.44, L.sh * 0.12, 0, 0, TAU);
        ctx.fill();
        drawSprite(ctx, s, pos.x, pos.y);
      });
    }
    if (view.flying) {
      const { ev, u, stone, fromIdx, toIdx } = view.flying;
      const s = sp.stones[stone];
      if (s) {
        const a = this.restPos(L, ev.from, fromIdx);
        const b = this.restPos(L, ev.to, toIdx);
        const e = easeInOutSine(u);
        const arc = (this.reduced ? 0.45 : 1) * (L.H * 0.1 + Math.abs(b.x - a.x) * 0.14);
        const x = lerp(a.x, b.x, e);
        const y = lerp(a.y, b.y, e) - arc * Math.sin(Math.PI * e);
        const lift = Math.sin(Math.PI * e);
        // shadow on the water below the flying stone
        const groundY = L.waterY - L.sideH * 0.5;
        ctx.fillStyle = `rgba(6,6,20,${(0.22 * (1 - lift * 0.7)).toFixed(3)})`;
        ctx.beginPath();
        ctx.ellipse(x, groundY, s.w * (0.45 - lift * 0.12), L.sh * 0.12, 0, 0, TAU);
        ctx.fill();
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate((this.reduced ? 0 : 0.05) * Math.sin(TAU * e) * Math.sign(b.x - a.x));
        drawSprite(ctx, s, 0, 0);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
  }

  drawRipples(ctx, L, dt) {
    ctx.lineWidth = 1.2;
    this.ripples = this.ripples.filter((r) => {
      r.age += dt;
      const u = r.age / r.life;
      if (u >= 1) return false;
      for (let j = 0; j < 3; j++) {
        const uj = u * 1.25 - j * 0.14;
        if (uj <= 0 || uj >= 1) continue;
        const e = easeOutCubic(uj);
        const rad = r.size * (0.45 + e * 0.9);
        ctx.strokeStyle = `rgba(230,224,255,${(0.32 * (1 - uj) ** 1.5).toFixed(3)})`;
        ctx.beginPath();
        ctx.ellipse(r.x, r.y + j * 1.5, rad, rad * 0.16, 0, 0, TAU);
        ctx.stroke();
      }
      return true;
    });
  }

  drawGlows(ctx, L, dt) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    this.glows = this.glows.filter((g) => {
      g.age += dt;
      const u = g.age / g.life;
      if (u >= 1) return false;
      const a = Math.sin(Math.PI * Math.min(1, u * 2.2)) ** 2 * (1 - u) * 0.55;
      const rad = g.r * (0.8 + 0.5 * u);
      const gr = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, rad);
      gr.addColorStop(0, rgba(g.c, a));
      gr.addColorStop(1, rgba(g.c, 0));
      ctx.fillStyle = gr;
      ctx.fillRect(g.x - rad, g.y - rad, rad * 2, rad * 2);
      return true;
    });
    ctx.restore();
  }

  drawRain(ctx, L, dt, t) {
    const target = this.reduced ? 0 : Math.round(this.rain * 150);
    while (this.raindrops.length < target) {
      this.raindrops.push({ x: Math.random() * (L.W + 100), y: Math.random() * L.H, v: 0.7 + Math.random() * 0.5, l: 8 + Math.random() * 12 });
    }
    if (this.raindrops.length > target) this.raindrops.length = target;
    if (this.raindrops.length) {
      ctx.strokeStyle = 'rgba(210,214,255,0.14)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      for (const d of this.raindrops) {
        d.y += d.v * 380 * dt;
        d.x -= d.v * 60 * dt;
        if (d.y > L.H) {
          if (Math.random() < 0.5) this.ripples.push({ x: d.x, y: L.waterY + (L.H - L.waterY) * Math.random() * 0.5, age: 0, life: 1.2, size: 6 + Math.random() * 6 });
          d.y = -20;
          d.x = Math.random() * (L.W + 100);
        }
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x + d.l * 0.16, d.y - d.l);
      }
      ctx.stroke();
    }
  }

  drawForeground(ctx, L, t) {
    const { W, H } = L;
    const nt = this.night;
    const par = this.pointer.sx * -30;
    // Fireflies
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const f of this.flies) {
      const m = this.reduced ? 0 : 1;
      const x = f.x * W + Math.sin(t * 0.13 * f.s + f.p) * 40 * m + par * 0.7;
      const y = f.y * H + Math.sin(t * 0.21 * f.s + f.q) * 18 * m;
      const a = (0.25 + 0.6 * nt) * Math.max(0, Math.sin(t * 0.5 * f.s + f.q)) ** 2;
      if (a < 0.02) continue;
      const gr = ctx.createRadialGradient(x, y, 0, x, y, 9);
      gr.addColorStop(0, `rgba(255,214,140,${a.toFixed(3)})`);
      gr.addColorStop(1, 'rgba(255,214,140,0)');
      ctx.fillStyle = gr;
      ctx.fillRect(x - 9, y - 9, 18, 18);
    }
    ctx.restore();

    // Near bank
    const bankY = H * 0.93;
    ctx.fillStyle = rgba(mixRgb([18, 20, 40], [7, 8, 20], nt));
    ctx.beginPath();
    ctx.moveTo(-50, H);
    for (let x = -50; x <= W + 50; x += 20) {
      ctx.lineTo(x + par, bankY + Math.sin(x * 0.006 + 1) * H * 0.018 + Math.sin(x * 0.017) * 4);
    }
    ctx.lineTo(W + 50, H);
    ctx.closePath();
    ctx.fill();

    // Grass blades swaying gently
    const sway = this.reduced ? 0 : 1;
    const groups = [[], []];
    for (const b of this.blades) groups[b.c > 0.5 ? 1 : 0].push(b);
    groups.forEach((grp, gi) => {
      ctx.strokeStyle = gi ? rgba(mixRgb([30, 36, 52], [12, 14, 28], nt)) : rgba(mixRgb([22, 26, 42], [8, 10, 22], nt));
      ctx.lineWidth = gi ? 1.6 : 2.2;
      ctx.beginPath();
      for (const b of grp) {
        const x = b.x * (W + 60) - 30 + par;
        const base = bankY + Math.sin(x * 0.006 + 1) * H * 0.018 + 6;
        const h = b.h * H * 0.09;
        const s = Math.sin(t * 0.55 + b.p + x * 0.004) * 8 * sway + b.b * 10 - 5;
        ctx.moveTo(x, base);
        ctx.quadraticCurveTo(x + s * 0.3, base - h * 0.55, x + s, base - h);
      }
      ctx.stroke();
    });

    // Soft vignette
    const vg = ctx.createRadialGradient(W / 2, H * 0.5, Math.min(W, H) * 0.35, W / 2, H * 0.5, Math.max(W, H) * 0.8);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(4,4,16,0.45)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  }

  run() {
    const loop = (now) => {
      try { this.frame(now); } catch (e) { console.error(e); }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}

// ------------------------------------------------------------ sprite helpers

function drawSprite(ctx, s, x, y) {
  ctx.drawImage(s.canvas, x - s.cx, y - s.cy, s.cw, s.ch);
}

function makeStone(w, h, color, k, dpr) {
  const pad = 6;
  const cw = w + pad * 2;
  const ch = h + pad * 2;
  const c = document.createElement('canvas');
  c.width = Math.ceil(cw * dpr);
  c.height = Math.ceil(ch * dpr);
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  g.translate(cw / 2, ch / 2);
  const r = mulberry32(hashSeed('stone', k));
  const ph1 = r() * TAU;
  const ph2 = r() * TAU;
  const N = 40;
  const pts = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const p = 2.4;
    const noise = 1 + 0.03 * Math.sin(a * 3 + ph1) + 0.018 * Math.sin(a * 5 + ph2);
    let x = Math.sign(ca) * Math.abs(ca) ** (2 / p) * (w / 2) * noise;
    let y = Math.sign(sa) * Math.abs(sa) ** (2 / p) * (h / 2) * noise;
    if (sa > 0) y *= 0.9; // flatter base
    pts.push([x, y]);
  }
  const path = new Path2D();
  for (let i = 0; i <= N; i++) {
    const p0 = pts[i % N];
    const p1 = pts[(i + 1) % N];
    const mx = (p0[0] + p1[0]) / 2;
    const my = (p0[1] + p1[1]) / 2;
    if (i === 0) path.moveTo(mx, my);
    else path.quadraticCurveTo(p0[0], p0[1], mx, my);
  }
  path.closePath();

  g.fillStyle = color;
  g.fill(path);
  g.save();
  g.clip(path);
  const lg = g.createLinearGradient(0, -h / 2, 0, h / 2);
  lg.addColorStop(0, 'rgba(255,236,214,0.22)');
  lg.addColorStop(0.45, 'rgba(255,236,214,0)');
  lg.addColorStop(1, 'rgba(12,10,26,0.5)');
  g.fillStyle = lg;
  g.fillRect(-w, -h, w * 2, h * 2);
  const rg = g.createRadialGradient(-w * 0.18, -h * 0.3, 0, -w * 0.18, -h * 0.3, w * 0.5);
  rg.addColorStop(0, 'rgba(255,244,230,0.2)');
  rg.addColorStop(1, 'rgba(255,244,230,0)');
  g.fillStyle = rg;
  g.fillRect(-w, -h, w * 2, h * 2);
  for (let i = 0; i < 40; i++) {
    const x = (r() - 0.5) * w * 0.9;
    const y = (r() - 0.5) * h * 0.8;
    g.fillStyle = r() > 0.5 ? `rgba(255,250,240,${(0.04 + r() * 0.07).toFixed(3)})` : `rgba(20,16,30,${(0.05 + r() * 0.08).toFixed(3)})`;
    g.beginPath();
    g.arc(x, y, 0.4 + r() * 1.1, 0, TAU);
    g.fill();
  }
  // rim light from the sky
  g.strokeStyle = 'rgba(225,215,255,0.22)';
  g.lineWidth = 1.4;
  g.translate(0, 0.8);
  g.stroke(path);
  g.restore();
  g.strokeStyle = 'rgba(10,8,22,0.35)';
  g.lineWidth = 0.8;
  g.stroke(path);
  return { canvas: c, cw, ch, cx: cw / 2, cy: ch / 2, w, h };
}

function makePlatform(pw, topH, sideH, dpr) {
  const pad = 8;
  const cw = pw + pad * 2;
  const ch = topH + sideH + pad * 2;
  const c = document.createElement('canvas');
  c.width = Math.ceil(cw * dpr);
  c.height = Math.ceil(ch * dpr);
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  const cx = cw / 2;
  const cy = pad + topH / 2;
  const r = mulberry32(hashSeed('platform', Math.round(pw)));
  // side (thickness)
  g.fillStyle = '#2d2c3d';
  g.beginPath();
  g.ellipse(cx, cy + sideH, pw / 2, topH / 2, 0, 0, Math.PI);
  g.lineTo(cx - pw / 2, cy);
  g.ellipse(cx, cy, pw / 2, topH / 2, 0, Math.PI, 0, true);
  g.closePath();
  g.fill();
  const sg = g.createLinearGradient(0, cy, 0, cy + sideH + topH / 2);
  sg.addColorStop(0, 'rgba(90,84,110,0.5)');
  sg.addColorStop(1, 'rgba(10,10,24,0.6)');
  g.fillStyle = sg;
  g.fill();
  // top face
  const top = new Path2D();
  const N = 36;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * TAU;
    const n = 1 + 0.025 * Math.sin(a * 4 + 1.3) + 0.015 * Math.sin(a * 7);
    const x = cx + Math.cos(a) * (pw / 2) * n;
    const y = cy + Math.sin(a) * (topH / 2) * n;
    if (i === 0) top.moveTo(x, y);
    else top.lineTo(x, y);
  }
  g.fillStyle = '#5e5a6b';
  g.fill(top);
  g.save();
  g.clip(top);
  const tg = g.createLinearGradient(0, cy - topH / 2, 0, cy + topH / 2);
  tg.addColorStop(0, 'rgba(240,210,190,0.22)');
  tg.addColorStop(1, 'rgba(20,18,40,0.25)');
  g.fillStyle = tg;
  g.fillRect(0, 0, cw, ch);
  for (let i = 0; i < 60; i++) {
    const a = r() * TAU;
    const d = Math.sqrt(r());
    const x = cx + Math.cos(a) * d * pw * 0.48;
    const y = cy + Math.sin(a) * d * topH * 0.45;
    g.fillStyle = r() > 0.7 ? `rgba(120,150,110,${(0.08 + r() * 0.12).toFixed(3)})` : `rgba(255,245,235,${(0.03 + r() * 0.06).toFixed(3)})`;
    g.beginPath();
    g.arc(x, y, 0.6 + r() * 2, 0, TAU);
    g.fill();
  }
  g.restore();
  g.strokeStyle = 'rgba(230,220,255,0.14)';
  g.lineWidth = 1;
  g.stroke(top);
  // wet waterline highlight
  g.strokeStyle = 'rgba(200,200,255,0.12)';
  g.beginPath();
  g.ellipse(cx, cy + sideH, pw / 2, topH / 2, 0, 0.15, Math.PI - 0.15);
  g.stroke();
  return { canvas: c, cw, ch, cx, cy, w: pw };
}
