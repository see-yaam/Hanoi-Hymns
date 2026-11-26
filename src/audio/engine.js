/**
 * Audio engine — every sound is synthesized with Tone.js (no samples).
 *
 * Signal flow
 *   voice ─┬─► peg panner (L / C / R) ───────────────┐
 *          ├─► reverb send  (∝ recursion depth) ─► reverb ─┤
 *          └─► delay send   (∝ recursion depth) ─► ping-pong delay ─┤
 *   drone, ambience (rain / river / wind / droplets) ───────────────┤
 *                                                                   ▼
 *        bus ─► gentle low-pass ─► soft compressor ─► fader ─► volume (≈ −10 dB) ─► limiter ─► out
 *
 * `buildGraph()` and `triggerMove()` work on whatever Tone context is current,
 * so the exact same code renders live playback and the offline WAV export.
 */
import * as Tone from 'tone';
import { SCALES, VOICINGS, stoneMidi, midiToFreq } from '../settings.js';
import { paceBase } from '../recursion/composer.js';
import { mulberry32, hashSeed } from '../util/random.js';

export const PEG_PAN = [-0.55, 0, 0.55];

export const volumeToDb = (v) => (v <= 0 ? -80 : -34 + 0.3 * v); // 80 → −10 dB
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ------------------------------------------------------------------ graph

export async function buildGraph(settings, { lean = false } = {}) {
  const ctx = Tone.getContext();
  const g = { ctx };

  // Master chain
  g.limiter = new Tone.Limiter(-1.5).toDestination();
  g.volume = new Tone.Volume(volumeToDb(settings.volume)).connect(g.limiter);
  g.fader = new Tone.Gain(0).connect(g.volume);
  g.makeup = new Tone.Gain(Tone.dbToGain(7)).connect(g.fader); // brings the soft mix up before the −10 dB master
  g.comp = new Tone.Compressor({ threshold: -16, ratio: 2, attack: 0.08, release: 0.6, knee: 10 }).connect(g.makeup);
  g.tone = new Tone.Filter({ type: 'lowpass', frequency: 7200, rolloff: -12, Q: 0.4 }).connect(g.comp);
  g.bus = new Tone.Gain(1).connect(g.tone);

  // Reverb (send/return) — long, dark and soft
  g.reverb = new Tone.Convolver({ normalize: true });
  g.reverb.buffer = makeImpulse(ctx, 6.5, 0.05);
  g.revIn = new Tone.Gain(1);
  g.revHP = new Tone.Filter({ type: 'highpass', frequency: 160 });
  g.revLP = new Tone.Filter({ type: 'lowpass', frequency: 4200, rolloff: -12 });
  g.revOut = new Tone.Gain(0.85).connect(g.bus);
  g.revIn.chain(g.revHP, g.reverb, g.revLP, g.revOut);

  // Echo (send/return) — stereo ping-pong, filtered so repeats get darker
  g.delIn = new Tone.Gain(1);
  g.delay = new Tone.PingPongDelay({ delayTime: paceBase(settings.pace) * 0.75, feedback: feedbackFor(settings.echo), maxDelay: 3, wet: 1 });
  g.delLP = new Tone.Filter({ type: 'lowpass', frequency: 2400, rolloff: -12 });
  g.delOut = new Tone.Gain(0.6);
  g.delIn.chain(g.delay, g.delLP, g.delOut);
  g.delOut.connect(g.bus);
  g.delOut.connect(g.revIn);

  // Peg panners: A left, B centre, C right
  g.pegs = PEG_PAN.map((p) => new Tone.Panner(p).connect(g.bus));

  buildDrone(g, settings, lean);
  buildAmbience(g, settings);

  return g;
}

/**
 * Seeded, dark, exponentially decaying stereo impulse response.
 * Generated in JS (fast, no async render) and identical on every run, so the
 * offline export is bit-for-bit reproducible.
 */
function makeImpulse(ctx, decay, preDelay) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * (decay + preDelay));
  const buf = ctx.createBuffer(2, len, sr);
  for (let c = 0; c < 2; c++) {
    const r = mulberry32(hashSeed('hanoi-hymns-impulse', c));
    const d = buf.getChannelData(c);
    let y = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr - preDelay;
      if (t < 0) { d[i] = 0; continue; }
      const env = Math.exp((-6.9 * t) / decay) * Math.min(1, t / 0.015);
      const k = 0.55 - 0.45 * Math.min(1, t / decay); // tail gets darker over time
      y += k * (r() * 2 - 1 - y);
      d[i] = y * env;
    }
  }
  return buf;
}

const feedbackFor = (echo) => 0.16 + 0.42 * echo;
const DRONE_SCALE = 0.16;

// ------------------------------------------------------------------ drone

function droneFreqs(settings) {
  let root = settings.root;
  if (root > 6) root -= 12;
  const sa = midiToFreq(36 + root); // root two octaves down
  return { sa, pa: sa * 1.5, sa2: sa * 2 };
}

// Lightweight raw-node helpers (far cheaper than Tone.LFO / Tone.Noise when rendering offline)

function biquad(ctx, type, frequency, Q = 0.7) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = frequency;
  f.Q.value = Q;
  return f;
}

function rawGain(ctx, value) {
  const gn = ctx.createGain();
  gn.gain.value = value;
  return gn;
}

/** Slow sine LFO sweeping an AudioParam between min and max. */
function lfo(ctx, param, rate, min, max) {
  const o = ctx.createOscillator();
  o.frequency.value = rate;
  const depth = rawGain(ctx, (max - min) / 2);
  param.value = (min + max) / 2;
  o.connect(depth);
  depth.connect(param);
  o.start();
  return o;
}

/** Seeded looping noise buffer → identical ambience on every render. */
function noiseBuffer(ctx, type, seed, seconds = 9) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  const r = mulberry32(hashSeed('noise', type, seed));
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < len; i++) {
    const w = r() * 2 - 1;
    if (type === 'brown') {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    } else {
      // Paul Kellet's pink-noise filter
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  }
  // Crossfade the tail into the head so the loop point is seamless
  const fade = Math.floor(sr * 0.25);
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    d[len - fade + i] = d[len - fade + i] * (1 - t) + d[i] * t;
  }
  return buf;
}

function noise(ctx, type, seed, rate = 1) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, type, seed);
  src.loop = true;
  src.loopStart = 0.25;
  src.loopEnd = src.buffer.duration;
  src.playbackRate.value = rate;
  src.start();
  return src;
}

function osc(ctx, type, freq, gain, dest) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  const gn = rawGain(ctx, gain);
  o.connect(gn);
  gn.connect(dest);
  o.start();
  return o;
}

function buildDrone(g, settings, lean) {
  const ctx = g.ctx;
  const f = droneFreqs(settings);
  const type = SCALES[settings.scale].drone;
  g.droneLevel = new Tone.Gain(settings.drone * DRONE_SCALE);
  g.droneActive = new Tone.Gain(0);
  g.droneLevel.connect(g.droneActive);
  g.droneActive.connect(g.bus);
  g.droneActive.connect(g.revIn);
  g.dOsc = [];
  g.tOsc = [];

  // Soft drone: sines on root + fifth, slowly breathing
  g.droneSoft = new Tone.Gain(type === 'soft' ? 1 : 0).connect(g.droneLevel);
  if (!lean || type === 'soft') {
    const breath = rawGain(ctx, 0.14);
    Tone.connect(breath, g.droneSoft);
    lfo(ctx, breath.gain, 0.055, 0.09, 0.18);
    const softLP = biquad(ctx, 'lowpass', 420);
    softLP.connect(breath);
    g.dOsc = [
      { o: osc(ctx, 'sine', f.sa, 1, softLP), ratio: 1 },
      { o: osc(ctx, 'sine', f.pa, 0.35, softLP), ratio: 1.5 },
      { o: osc(ctx, 'triangle', f.sa2, 0.16, softLP), ratio: 2 },
    ];
  }

  // Tanpura-like drone (Raga mood): buzzy saws through slowly sweeping band-passes
  g.droneTan = new Tone.Gain(type === 'tanpura' ? 1 : 0).connect(g.droneLevel);
  if (!lean || type === 'tanpura') {
    const tanLP = biquad(ctx, 'lowpass', 1400);
    Tone.connect(tanLP, g.droneTan);
    const spec = [
      { r: 1.5, rate: 0.09, vol: -28 },
      { r: 2, rate: 0.13, vol: -27 },
      { r: 2.004, rate: 0.071, vol: -29 },
      { r: 1, rate: 0.05, vol: -24 },
    ];
    for (const sp of spec) {
      const fr = f.sa * sp.r;
      const bp = biquad(ctx, 'bandpass', fr * 4, 4);
      bp.connect(tanLP);
      lfo(ctx, bp.frequency, sp.rate, fr * 2.5, fr * 9);
      g.tOsc.push({ o: osc(ctx, 'sawtooth', fr, Tone.dbToGain(sp.vol), bp), ratio: sp.r });
      g.tOsc.push({ o: osc(ctx, 'sine', fr, Tone.dbToGain(sp.vol + 10), tanLP), ratio: sp.r }); // body under the buzz
    }
  }
}

// ------------------------------------------------------------------ ambience

function buildAmbience(g, settings) {
  const ctx = g.ctx;
  // Rain: two decorrelated pink noises spread across the stereo field
  g.rainGain = new Tone.Gain(ambGain('rain', settings.rain)).connect(g.bus);
  const rainHP = biquad(ctx, 'highpass', 420);
  const rainLP = biquad(ctx, 'lowpass', 3600, 0.5);
  const rainLP2 = biquad(ctx, 'lowpass', 4200, 0.5);
  rainHP.connect(rainLP);
  rainLP.connect(rainLP2);
  Tone.connect(rainLP2, g.rainGain);
  [-0.7, 0.7].forEach((p, i) => {
    const pan = ctx.createStereoPanner();
    pan.pan.value = p;
    pan.connect(rainHP);
    noise(ctx, 'pink', 'rain' + i, 1 - i * 0.03).connect(pan);
  });
  // Droplets bus (individual drops are triggered by the scheduler)
  g.dropBus = new Tone.Gain(1);
  g.dropBus.connect(g.bus);
  g.dropRev = new Tone.Gain(0.5).connect(g.revIn);
  g.dropBus.connect(g.dropRev);

  // River: low brown noise, slow filter + level modulation, gently wandering in stereo
  g.riverGain = new Tone.Gain(ambGain('river', settings.river)).connect(g.bus);
  const riverAmp = rawGain(ctx, 0.8);
  Tone.connect(riverAmp, g.riverGain);
  lfo(ctx, riverAmp.gain, 0.11, 0.6, 1);
  const riverLP = biquad(ctx, 'lowpass', 450, 0.8);
  riverLP.connect(riverAmp);
  lfo(ctx, riverLP.frequency, 0.06, 260, 780);
  const riverPan = ctx.createStereoPanner();
  riverPan.connect(riverLP);
  lfo(ctx, riverPan.pan, 0.03, -0.35, 0.35);
  noise(ctx, 'brown', 'river').connect(riverPan);

  // Wind: band-passed pink noise with a very slow sweep and gusts
  g.windGain = new Tone.Gain(ambGain('wind', settings.wind)).connect(g.bus);
  const windPan = ctx.createStereoPanner();
  Tone.connect(windPan, g.windGain);
  lfo(ctx, windPan.pan, 0.021, -0.6, 0.6);
  const gust = rawGain(ctx, 0.6);
  gust.connect(windPan);
  lfo(ctx, gust.gain, 0.047, 0.25, 1);
  const windBP = biquad(ctx, 'bandpass', 600, 1.6);
  windBP.connect(gust);
  lfo(ctx, windBP.frequency, 0.033, 280, 1150);
  noise(ctx, 'pink', 'wind').connect(windBP);
}

const AMB_SCALE = { rain: 0.15, river: 0.2, wind: 0.4 };
const ambGain = (k, v) => AMB_SCALE[k] * v ** 1.6; // curved → gentle, perceptual slider

// ------------------------------------------------------------------ live updates

export function applySettings(g, s, prev, time = g.ctx.currentTime) {
  const ramp = 1.2;
  g.volume.volume.rampTo(volumeToDb(s.volume), 0.25, time);
  g.rainGain.gain.rampTo(ambGain('rain', s.rain), ramp, time);
  g.riverGain.gain.rampTo(ambGain('river', s.river), ramp, time);
  g.windGain.gain.rampTo(ambGain('wind', s.wind), ramp, time);
  g.droneLevel.gain.rampTo(s.drone * DRONE_SCALE, ramp, time);
  g.delay.feedback.rampTo(feedbackFor(s.echo), 0.8, time);
  if (!prev || prev.pace !== s.pace) g.delay.delayTime.rampTo(paceBase(s.pace) * 0.75, 1.5, time);
  if (!prev || prev.root !== s.root || prev.scale !== s.scale) {
    const f = droneFreqs(s);
    const glide = 2.5;
    g.dOsc.concat(g.tOsc).forEach((d) => {
      d.o.frequency.cancelScheduledValues(time);
      d.o.frequency.setTargetAtTime(f.sa * d.ratio, time, glide / 3);
    });
    const tan = SCALES[s.scale].drone === 'tanpura';
    g.droneSoft.gain.rampTo(tan ? 0 : 1, 3, time);
    g.droneTan.gain.rampTo(tan ? 1 : 0, 3, time);
  }
}

export function setDroneActive(g, on, time = g.ctx.currentTime, secs = 3) {
  g.droneActive.gain.cancelScheduledValues(time);
  g.droneActive.gain.rampTo(on ? 1 : 0, secs, time);
}

export function fadeMaster(g, level, secs, time = g.ctx.currentTime) {
  g.fader.gain.cancelScheduledValues(time);
  g.fader.gain.rampTo(level, secs, time);
}

// ------------------------------------------------------------------ voices (raw Web Audio nodes for efficiency)

function partial(ctx, dest, { type = 'sine', freq, t, peak, attack, decay, detune = 0 }) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.detune.setValueAtTime(detune, t);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(peak, t + attack);
  env.gain.setTargetAtTime(0, t + attack, decay / 6.9); // ≈ −60 dB after `decay` seconds
  o.connect(env);
  env.connect(dest);
  const stop = t + attack + decay + 0.3;
  o.start(t);
  o.stop(stop);
  return { o, stop };
}

const BOWL_PARTIALS = [
  { r: 1, a: 1, d: 9, beat: 1.2 },
  { r: 2.76, a: 0.38, d: 6, beat: 1.9 },
  { r: 5.4, a: 0.13, d: 3.2, beat: 0 },
  { r: 8.93, a: 0.045, d: 1.6, beat: 0 },
];

function bowlVoice(ctx, dest, f, t, vel, detune, decayMul = 1) {
  const parts = [];
  const scale = clamp((262 / f) ** 0.35, 0.75, 1.35) * decayMul;
  const peak = 0.13 * vel;
  for (const p of BOWL_PARTIALS) {
    const freq = f * p.r;
    if (freq > 5500) continue;
    const spec = { freq, t, peak: peak * p.a, attack: 0.03 + 0.02 / p.r, decay: p.d * scale, detune };
    parts.push(partial(ctx, dest, spec));
    if (p.beat) parts.push(partial(ctx, dest, { ...spec, freq: freq + p.beat, peak: spec.peak * 0.55 }));
  }
  return parts;
}

function kalimbaVoice(ctx, dest, f, t, vel, detune) {
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(Math.min(4200, f * 7), t);
  lp.Q.value = 0.5;
  lp.connect(dest);
  const peak = 0.19 * vel;
  const scale = clamp((392 / f) ** 0.4, 0.7, 1.4);
  const parts = [
    partial(ctx, lp, { freq: f, t, peak, attack: 0.009, decay: 2.6 * scale, detune }),
    partial(ctx, lp, { freq: f * 2.0, t, peak: peak * 0.09, attack: 0.008, decay: 0.7, detune }),
  ];
  if (f * 5.95 < 5000) parts.push(partial(ctx, lp, { freq: f * 5.95, t, peak: peak * 0.07, attack: 0.004, decay: 0.16, detune }));
  return parts;
}

function padVoice(ctx, dest, f, t, vel, detune, hold) {
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 0.3;
  lp.frequency.setValueAtTime(f * 1.4, t);
  lp.frequency.linearRampToValueAtTime(Math.min(f * 3.2, 2400), t + 1.4);
  lp.frequency.setTargetAtTime(f * 1.6, t + 1.6, 2);
  lp.connect(dest);
  const peak = 0.05 * vel;
  const attack = 1.1;
  const parts = [];
  const mk = (type, freq, amp, cents) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.detune.setValueAtTime(detune + cents, t);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(peak * amp, t + attack);
    env.gain.setTargetAtTime(peak * amp * 0.7, t + attack, 0.8);
    env.gain.setTargetAtTime(0, t + attack + hold, 1.3);
    o.connect(env);
    env.connect(lp);
    const stop = t + attack + hold + 7;
    o.start(t);
    o.stop(stop);
    parts.push({ o, stop });
  };
  mk('triangle', f, 1, -7);
  mk('triangle', f, 1, 7);
  mk('sine', f / 2, 0.55, 0);
  mk('sine', f * 2, 0.12, 3);
  return parts;
}

/**
 * Trigger the sound of one Hanoi move at audio time `t`.
 * Returns a handle so not-yet-started voices can be cancelled on pause.
 */
export function triggerMove(g, ev, t, s) {
  const ctx = g.ctx;
  const instrument = VOICINGS[s.voicing].map[ev.to];
  const midi = stoneMidi(ev.stone, ev.n, s, instrument);
  const f = midiToFreq(midi);
  // Bigger (lower) stones get a little more weight
  const vel = ev.vel * (0.85 + 0.15 * (ev.stone / ev.n));
  // Recursion depth → space. Deeper calls (small stones) echo further away.
  const depthNorm = ev.n > 1 ? ev.depth / (ev.n - 1) : 0;
  const revAmt = 0.22 + 0.25 * s.echo + 0.45 * s.echo * depthNorm;
  const delAmt = s.echo * (0.08 + 0.5 * depthNorm);
  const dryAmt = 1 - 0.3 * s.echo * depthNorm;

  const out = ctx.createGain();
  out.gain.value = 1.8;
  const dry = ctx.createGain();
  dry.gain.value = dryAmt;
  const rev = ctx.createGain();
  rev.gain.value = revAmt;
  const del = ctx.createGain();
  del.gain.value = delAmt;
  out.connect(dry);
  out.connect(rev);
  out.connect(del);
  Tone.connect(dry, g.pegs[ev.to]);
  Tone.connect(rev, g.revIn);
  Tone.connect(del, g.delIn);

  let parts;
  if (instrument === 'bowl') parts = bowlVoice(ctx, out, f, t, vel, ev.detune);
  else if (instrument === 'kalimba') parts = kalimbaVoice(ctx, out, f, t, vel, ev.detune);
  else parts = padVoice(ctx, out, f, t, vel, ev.detune, 1.2 + paceBase(s.pace) * 0.8);

  // The largest stone moves only once per solve — the centre of the recursion.
  // Mark it with a deep, long gong-like bowl an octave below.
  if (ev.stone === ev.n && ev.n >= 4) {
    parts = parts.concat(bowlVoice(ctx, out, midiToFreq(stoneMidi(ev.stone, ev.n, s, 'pad')) / 2, t + 0.02, 0.7, 0, 1.6));
  }

  const stop = Math.max(...parts.map((p) => p.stop));
  return {
    start: t,
    stop,
    cancel() {
      parts.forEach((p) => {
        try { p.o.stop(); } catch (e) { /* already stopped */ }
      });
      try { out.disconnect(); } catch (e) { /* ignore */ }
    },
    dispose() {
      try { out.disconnect(); dry.disconnect(); rev.disconnect(); del.disconnect(); } catch (e) { /* ignore */ }
    },
  };
}

/** A single rain droplet: a tiny upward "plink", panned randomly. */
export function triggerDroplet(g, t, r, level) {
  const ctx = g.ctx;
  const f = 1100 + 1500 * r();
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(f, t);
  o.frequency.exponentialRampToValueAtTime(f * 1.45, t + 0.05);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime((0.012 + 0.03 * r()) * level, t + 0.004);
  env.gain.setTargetAtTime(0, t + 0.004, 0.022);
  const pan = ctx.createStereoPanner();
  pan.pan.value = r() * 1.6 - 0.8;
  o.connect(env);
  env.connect(pan);
  Tone.connect(pan, g.dropBus);
  o.start(t);
  o.stop(t + 0.3);
  return pan;
}
