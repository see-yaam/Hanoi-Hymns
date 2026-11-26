/**
 * Recursion panel: live call stack, fractal ruler sequence and progress.
 * Updates the DOM only when the current move changes.
 */
import { frameLabel, PEG_NAMES } from '../recursion/hanoi.js';

const RULER_LEN = 63; // shows 2^6 − 1 moves: one complete self-similar block

export class StackView {
  constructor(root) {
    this.root = root;
    this.stackEl = root.querySelector('#stack-frames');
    this.moveEl = root.querySelector('#stack-move');
    this.rulerEl = root.querySelector('#ruler');
    this.rulerTextEl = root.querySelector('#ruler-text');
    this.progressEl = root.querySelector('#progress-text');
    this.progressBar = root.querySelector('#progress-bar');
    this.cycleEl = root.querySelector('#cycle-text');
    this.rctx = this.rulerEl.getContext('2d');
    this.lastKey = '';
  }

  update(view, conductor) {
    const ev = view.current;
    const c = view.completed;
    const key = `${conductor.epoch}|${c}|${view.flying ? 1 : 0}|${ev ? ev.globalIndex : -1}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    const s = conductor.settings;
    const total = 2 ** s.n - 1;

    // Moves completed inside the current cycle
    let inCycle = 0;
    let cycle = 0;
    if (ev) {
      cycle = ev.cycle;
      inCycle = view.flying ? ev.index - 1 : ev.index;
      if (!view.flying && c === 0) inCycle = 0;
    }
    if (c > 0 && !view.flying && conductor.events[c - 1]) {
      cycle = conductor.events[c - 1].cycle;
      inCycle = conductor.events[c - 1].index;
    }
    this.progressEl.textContent = `move ${inCycle} / ${total}`;
    this.progressBar.style.transform = `scaleX(${(inCycle / total).toFixed(4)})`;
    this.root.querySelector('#progress').setAttribute('aria-valuenow', String(inCycle));
    this.root.querySelector('#progress').setAttribute('aria-valuemax', String(total));
    const pegs = conductor.cyclePegsAt(cycle);
    this.cycleEl.textContent = s.endless
      ? `journey ${cycle + 1} · ${PEG_NAMES[pegs.from]} → ${PEG_NAMES[pegs.to]}`
      : `${PEG_NAMES[pegs.from]} → ${PEG_NAMES[pegs.to]}`;

    // Call stack
    const showEv = c === 0 && !view.flying ? null : ev;
    const frames = showEv ? showEv.stack : [{ n: s.n, from: pegs.from, to: pegs.to, depth: 0 }];
    const html = frames
      .map((f, i) => {
        const active = i === frames.length - 1;
        return `<li class="frame${active ? ' active' : ''}" style="--d:${i}"><span class="depth">${i}</span><code>${frameLabel(f)}</code></li>`;
      })
      .join('');
    this.stackEl.innerHTML = html;
    this.moveEl.innerHTML = showEv
      ? `move stone <b>${showEv.stone}</b> ${PEG_NAMES[showEv.from]} → ${PEG_NAMES[showEv.to]} <span class="muted">· depth ${showEv.depth}${showEv.phraseStart ? ' · asks' : showEv.phraseEnd ? ' · answers' : ''}</span>`
      : '<span class="muted">waiting at the river…</span>';

    // Ruler sequence
    const seq = [];
    const upTo = view.flying ? c + 1 : c;
    for (let i = Math.max(0, upTo - RULER_LEN); i < upTo; i++) seq.push(conductor.events[i].stone);
    this.drawRuler(seq, s.n, view.flying ? seq.length - 1 : -1);
    this.rulerTextEl.textContent = seq.length ? seq.slice(-15).join(' ') : '—';
  }

  drawRuler(seq, n, activeIdx) {
    const cv = this.rulerEl;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = cv.clientWidth || 240;
    const h = cv.clientHeight || 46;
    if (cv.width !== Math.round(w * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    const g = this.rctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const bw = w / RULER_LEN;
    seq.forEach((stone, i) => {
      const bh = (stone / n) * (h - 4);
      const x = i * bw;
      const isLast = i === seq.length - 1;
      g.fillStyle = isLast ? 'rgba(242,179,111,0.95)' : `rgba(185,168,224,${(0.35 + 0.5 * (i / RULER_LEN)).toFixed(2)})`;
      if (i === activeIdx) g.fillStyle = 'rgba(242,179,111,0.95)';
      g.fillRect(x + bw * 0.18, h - bh, Math.max(1, bw * 0.64), bh);
    });
  }
}
