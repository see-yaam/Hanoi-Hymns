/**
 * Settings panel: builds options, binds every control to the settings object and
 * reports changes as (settings, changedKeys). Also: presets, seed dice, range fills.
 */
import { SCALES, NOTE_NAMES, VOICINGS, PRESETS, INSTRUMENTS, sanitize } from '../settings.js';
import { PEG_NAMES } from '../recursion/hanoi.js';

const $ = (sel) => document.querySelector(sel);

const RANGES = ['n', 'echo', 'rain', 'river', 'wind', 'drone', 'night', 'volume'];
const SELECTS = ['scale', 'root', 'voicing', 'from', 'to'];
const NUMERIC = new Set(['n', 'echo', 'rain', 'river', 'wind', 'drone', 'night', 'volume', 'root', 'from', 'to', 'seed']);

export class Controls {
  constructor(settings, onChange) {
    this.s = settings;
    this.onChange = onChange;
    this.buildOptions();
    this.bind();
    this.render();
  }

  buildOptions() {
    $('#in-scale').innerHTML = Object.entries(SCALES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
    $('#in-root').innerHTML = NOTE_NAMES.map((n, i) => `<option value="${i}">${n}</option>`).join('');
    $('#in-voicing').innerHTML = Object.entries(VOICINGS).map(([k, v]) => `<option value="${k}">${v.label.split(' — ')[0]}</option>`).join('');
    $('#presets').innerHTML = Object.entries(PRESETS)
      .map(([k, p]) => `<button class="preset" data-preset="${k}" aria-pressed="false"><span class="p-thumb p-thumb--${k}" aria-hidden="true"></span><span class="p-name">${p.label}</span></button>`)
      .join('');
  }

  bind() {
    for (const k of RANGES) {
      const el = $(`#in-${k}`);
      el.addEventListener('input', () => this.set({ [k]: +el.value }));
    }
    for (const k of SELECTS) {
      const el = $(`#in-${k}`);
      el.addEventListener('change', () => {
        const v = NUMERIC.has(k) ? +el.value : el.value;
        const patch = { [k]: v };
        // keep start ≠ target: swap if the user picks the same rock
        if (k === 'from' && v === this.s.to) patch.to = this.s.from;
        if (k === 'to' && v === this.s.from) patch.from = this.s.to;
        this.set(patch);
      });
    }
    document.querySelectorAll('input[name="pace"]').forEach((r) =>
      r.addEventListener('change', () => r.checked && this.set({ pace: r.value })),
    );
    const seed = $('#in-seed');
    seed.addEventListener('change', () => this.set({ seed: +seed.value }));
    $('#btn-dice').addEventListener('click', () => this.set({ seed: 1 + Math.floor(Math.random() * 99999) }));
    $('#in-endless').addEventListener('change', (e) => this.set({ endless: e.target.checked }));
    $('#presets').addEventListener('click', (e) => {
      const b = e.target.closest('[data-preset]');
      if (b) this.applyPreset(b.dataset.preset);
    });
  }

  applyPreset(key) {
    const p = PRESETS[key];
    if (!p) return;
    this.set({ ...p.values, preset: key }, true);
  }

  set(patch, isPreset = false) {
    const prev = this.s;
    const next = sanitize({ ...prev, ...patch, preset: isPreset ? patch.preset : 'custom' });
    // Purely visual/volume tweaks don't break a preset's identity
    if (!isPreset && Object.keys(patch).every((k) => ['volume', 'night'].includes(k))) next.preset = prev.preset;
    const changed = Object.keys(next).filter((k) => next[k] !== prev[k]);
    if (!changed.length) return;
    this.s = next;
    this.render();
    this.onChange(next, changed);
  }

  render() {
    const s = this.s;
    for (const k of RANGES) {
      const el = $(`#in-${k}`);
      if (+el.value !== s[k]) el.value = s[k];
      const p = ((s[k] - +el.min) / (+el.max - +el.min)) * 100;
      el.style.setProperty('--p', `${p}%`);
      const out = $(`#out-${k}`);
      if (out) out.textContent = k === 'n' ? String(s.n) : k === 'volume' ? `${s.volume}` : `${Math.round(s[k] * 100)}%`;
    }
    $('#in-n').setAttribute('aria-valuetext', `${s.n} stones, ${2 ** s.n - 1} moves`);
    for (const k of SELECTS) $(`#in-${k}`).value = String(s[k]);
    document.querySelectorAll('input[name="pace"]').forEach((r) => { r.checked = r.value === s.pace; });
    $('#in-seed').value = String(s.seed);
    $('#in-endless').checked = s.endless;
    document.querySelectorAll('.preset').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.preset === s.preset)));
    const map = VOICINGS[s.voicing].map;
    $('#voicing-legend').textContent = map.map((inst, i) => `${PEG_NAMES[i]}: ${INSTRUMENTS[inst]}`).join(' · ');
  }
}
