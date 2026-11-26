/**
 * Conductor — one clock for sound and sight.
 *
 * The composition is a list of timed events (one per Hanoi move). The playhead is
 * derived from the AudioContext clock while playing, so visuals (which read the
 * playhead every frame) stay locked to the audio. Notes are scheduled slightly
 * ahead with a look-ahead scheduler; not-yet-sounding notes are cancelled on pause.
 */
import { composeCycle, cyclePegs } from './recursion/composer.js';
import { performMove, performCue, triggerDroplet, setDroneActive, fadeMaster, applySettings } from './audio/engine.js';

const TAIL = 8;

export class Conductor {
  constructor() {
    this.graph = null;
    this.settings = null;
    this.events = [];
    this.cues = []; // opening / final bowl strikes of each cycle
    this.nextCue = 0;
    this.cycleCount = 0;
    this.playing = false;
    this.playhead = 0;
    this.clockStart = 0;
    this.nextIdx = 0;
    this.pending = [];
    this.stepStopAt = null;
    this.finished = false;
    this.nextDrop = 0;
    this.listeners = new Set();
    this.dropRand = Math.random;
    this.epoch = 0; // increments whenever the stone layout resets
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(type) { this.listeners.forEach((fn) => fn(type, this)); }

  attach(graph) {
    this.graph = graph;
    this.interval = setInterval(() => this.tick(), 30);
  }

  get audioNow() { return this.graph ? this.graph.ctx.currentTime : 0; }

  /** Composition time (seconds) — what the visuals should show. */
  getPlayhead() {
    return this.playing ? this.audioNow - this.clockStart : this.playhead;
  }

  visualPlayhead() {
    const lat = this.playing && this.graph ? (this.graph.ctx.rawContext.outputLatency || 0) : 0;
    return this.getPlayhead() - lat;
  }

  /** Number of moves whose landing time ≤ t. */
  completedAt(t) {
    let lo = 0;
    let hi = this.events.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.events[mid].time <= t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  endTime() {
    return this.events.length ? this.events[this.events.length - 1].time : 0;
  }

  /** (Re)generate the score. If `preserve`, keep the same move position. */
  load(settings, { preserve = false } = {}) {
    const prev = this.settings;
    const wasPlaying = this.playing;
    const done = preserve ? this.completedAt(this.getPlayhead()) : 0;
    if (wasPlaying) this.pause({ silent: true });
    this.settings = settings;
    const cycles = preserve ? Math.max(1, this.cycleCount) : 1;
    this.events = [];
    this.cues = [];
    this.cycleCount = 0;
    for (let k = 0; k < cycles; k++) this.appendCycle();
    if (preserve && done > 0) {
      const idx = Math.min(done, this.events.length) - 1;
      this.playhead = this.events[idx].time + 0.05;
    } else {
      this.playhead = 0;
      if (!preserve) this.epoch++;
    }
    this.finished = false;
    if (this.graph) applySettings(this.graph, settings, prev);
    if (wasPlaying) this.play({ silent: true });
    this.emit('load');
  }

  /** Live-only changes (sound mapping, ambience, volume): no re-composition needed. */
  update(settings) {
    const prev = this.settings;
    this.settings = settings;
    if (this.graph) applySettings(this.graph, settings, prev);
    this.emit('update');
  }

  appendCycle() {
    const s = this.settings;
    const k = this.cycleCount;
    const { from, to } = cyclePegs(s.from, s.to, k);
    const start = this.events.length ? this.endTime() : 0;
    const { events, cues } = composeCycle({ ...s, from, to }, k, start, this.events.length);
    this.events.push(...events);
    this.cues.push(...cues);
    this.cycleCount++;
  }

  cyclePegsAt(k) {
    return cyclePegs(this.settings.from, this.settings.to, k);
  }

  play({ silent = false, step = false, fade = 2 } = {}) {
    if (!this.graph) return;
    if (this.finished || (!this.settings.endless && this.playhead > this.endTime() + 1 && !step)) {
      this.restart({ autoplay: false });
    }
    this.finished = false;
    this.clockStart = this.audioNow + 0.05 - this.playhead;
    this.nextIdx = this.completedAt(this.playhead);
    this.nextCue = this.cues.findIndex((c) => c.time > this.playhead);
    if (this.nextCue < 0) this.nextCue = this.cues.length;
    this.playing = true;
    if (!step) {
      this.stepStopAt = null;
      setDroneActive(this.graph, true, this.audioNow, 2); // 2 s fade-in of the musical bed
    }
    fadeMaster(this.graph, 1, silent ? 0.4 : fade);
    this.emit('play');
  }

  pause({ silent = false } = {}) {
    if (!this.playing) return;
    this.playhead = this.getPlayhead();
    this.playing = false;
    this.stepStopAt = null;
    const now = this.audioNow;
    this.pending = this.pending.filter((v) => {
      if (v.start > now + 0.01) { v.cancel(); return false; }
      return true;
    });
    if (!silent) setDroneActive(this.graph, false, now, 4);
    this.emit('pause');
  }

  toggle() { if (this.playing && this.stepStopAt === null) this.pause(); else this.play(); }

  restart({ autoplay = true } = {}) {
    const was = this.playing || autoplay;
    this.pause({ silent: true });
    this.events = [];
    this.cues = [];
    this.cycleCount = 0;
    this.appendCycle();
    this.playhead = 0;
    this.finished = false;
    this.epoch++;
    this.emit('restart');
    if (was && autoplay) this.play();
  }

  /** Animate exactly one move, then rest. */
  stepForward() {
    if (this.playing && this.stepStopAt === null) this.pause({ silent: true });
    if (this.playing) return; // a step is already in progress
    let c = this.completedAt(this.playhead);
    if (c >= this.events.length) {
      if (this.settings.endless) this.appendCycle();
      else return;
      c = this.completedAt(this.playhead);
    }
    const ev = this.events[c];
    this.playhead = Math.max(this.playhead, ev.time - ev.flight - 0.03);
    this.stepStopAt = ev.time + 0.06;
    this.play({ step: true, silent: true });
  }

  stepBack() {
    if (this.playing) this.pause({ silent: true });
    const c = this.completedAt(this.playhead);
    if (c <= 0) return;
    this.playhead = c >= 2 ? this.events[c - 2].time + 0.05 : 0;
    this.emit('seek');
  }

  tick() {
    if (!this.graph) return;
    const now = this.audioNow;
    const lookahead = document.hidden ? 1.6 : 0.25;
    if (this.playing) {
      const ph = this.getPlayhead();
      if (this.settings.endless && ph > this.endTime() - 30) this.appendCycle();
      const limit = this.stepStopAt !== null ? this.stepStopAt : Infinity;
      while (this.nextIdx < this.events.length && this.events[this.nextIdx].time <= Math.min(ph + lookahead, limit)) {
        const ev = this.events[this.nextIdx++];
        const at = Math.max(now + 0.01, this.clockStart + ev.time);
        performMove(this.graph, ev, at, this.settings, this.pending);
      }
      while (this.nextCue < this.cues.length && this.cues[this.nextCue].time <= Math.min(ph + lookahead, limit)) {
        const cue = this.cues[this.nextCue++];
        if (this.clockStart + cue.time < now - 0.5) continue; // skip cues we seeked past
        this.pending.push(performCue(this.graph, cue, Math.max(now + 0.01, this.clockStart + cue.time), this.settings));
      }
      if (this.stepStopAt !== null && ph >= this.stepStopAt) {
        this.playhead = this.stepStopAt;
        this.playing = false;
        this.stepStopAt = null;
        this.emit('pause');
      } else if (!this.settings.endless && ph > this.endTime() + TAIL + 4) {
        this.playhead = ph;
        this.playing = false;
        this.finished = true;
        setDroneActive(this.graph, false, now, 6);
        this.emit('finished');
      }
    }
    // Free finished voices
    if (this.pending.length > 24) {
      this.pending = this.pending.filter((v) => {
        if (v.stop < now) { v.dispose(); return false; }
        return true;
      });
    }
    // Rain droplets (ambience keeps living even while paused)
    const rain = this.settings.rain;
    if (rain > 0.02) {
      const rate = 0.6 + 7 * rain * rain; // drops per second
      if (this.nextDrop < now) this.nextDrop = now + 0.05;
      while (this.nextDrop < now + lookahead) {
        const node = triggerDroplet(this.graph, this.nextDrop, this.dropRand, rain);
        setTimeout(() => { try { node.disconnect(); } catch (e) { /* ignore */ } }, (this.nextDrop - now + 0.6) * 1000);
        this.nextDrop += -Math.log(1 - this.dropRand()) / rate;
      }
    }
  }
}
