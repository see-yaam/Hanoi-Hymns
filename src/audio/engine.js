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

export const PEG_PAN = [-0.55, 0, 0.55];

export const volumeToDb = (v) => (v <= 0 ? -80 : -34 + 0.3 * v); // 80 → −10 dB
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ------------------------------------------------------------------ graph

export async function buildGraph(settings) {
  const ctx = Tone.getContext();
  const g = { ctx };

  // Master chain
  g.limiter = new Tone.Limiter(-1.5).toDestination();
  g.volume = new Tone.Volume(volumeToDb(settings.volume)).connect(g.limiter);
  g.fader = new Tone.Gain(0).connect(g.volume);
  g.comp = new Tone.Compressor({ threshold: -20, ratio: 2.5, attack: 0.06, release: 0.5, knee: 12 }).connect(g.fader);
  g.tone = new Tone.Filter({ type: 'lowpass', frequency: 7200, rolloff: -12, Q: 0.4 }).connect(g.comp);
  g.bus = new Tone.Gain(1).connect(g.tone);

  // Reverb (send/return) — long, dark and soft
  g.reverb = new Tone.Reverb({ decay: 8.5, preDelay: 0.05, wet: 1 });
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

  buildDrone(g, settings);
  buildAmbience(g, settings);

  await g.reverb.ready;
  return g;
}

const feedbackFor = (echo) => 0.16 + 0.42 * echo;

// ------------------------------------------------------------------ drone

function droneFreqs(settings) {
  let root = settings.root;
  if (root > 6) root -= 12;
  const sa = midiToFreq(36 + root); // root two octaves down
  return { sa, pa: sa * 1.5, sa2: sa * 2 };
}

function buildDrone(g, settings) {
  const f = droneFreqs(settings);
  g.droneLevel = new Tone.Gain(settings.drone * 0.5);
  g.droneActive = new Tone.Gain(0);
  g.droneLevel.connect(g.droneActive);
  g.droneActive.connect(g.bus);
  g.droneActive.connect(g.revIn);

  // Soft drone: sines on root + fifth, slowly breathing
  g.droneSoft = new Tone.Gain(SCALES[settings.scale].drone === 'soft' ? 1 : 0).connect(g.droneLevel);
  const breath = new Tone.Gain(0.16).connect(g.droneSoft);
  g.droneLfo = new Tone.LFO({ frequency: 0.055, min: 0.09, max: 0.18 }).connect(breath.gain).start();
  const softLP = new Tone.Filter({ type: 'lowpass', frequency: 420 }).connect(breath);
  g.dOsc = [
    new Tone.Oscillator({ frequency: f.sa, type: 'sine', volume: 0 }),
    new Tone.Oscillator({ frequency: f.pa, type: 'sine', volume: -9 }),
    new Tone.Oscillator({ frequency: f.sa2, type: 'triangle', volume: -16 }),
  ];
  g.dOsc.forEach((o) => o.connect(softLP).start());

  // Tanpura-like drone (Raga mood): buzzy saws through slowly sweeping band-passes
  g.droneTan = new Tone.Gain(SCALES[settings.scale].drone === 'tanpura' ? 1 : 0).connect(g.droneLevel);
  const tanLP = new Tone.Filter({ type: 'lowpass', frequency: 1400 }).connect(g.droneTan);
  g.tOsc = [];
  const tanSpec = [
    { f: f.pa, rate: 0.09, vol: -28 },
    { f: f.sa2, rate: 0.13, vol: -27 },
    { f: f.sa2 * 1.002, rate: 0.071, vol: -29 },
    { f: f.sa, rate: 0.05, vol: -24 },
  ];
  tanSpec.forEach((s, i) => {
    const bp = new Tone.Filter({ type: 'bandpass', frequency: s.f * 4, Q: 4 }).connect(tanLP);
    new Tone.LFO({ frequency: s.rate, min: s.f * 2.5, max: s.f * 9, phase: i * 70 }).connect(bp.frequency).start();
    const o = new Tone.Oscillator({ frequency: s.f, type: 'sawtooth', volume: s.vol }).connect(bp).start();
    // Fundamental body under the buzz
    const body = new Tone.Oscillator({ frequency: s.f, type: 'sine', volume: s.vol + 10 }).connect(tanLP).start();
    g.tOsc.push({ o, body, ratio: s.f / f.sa });
  });
}

// ------------------------------------------------------------------ ambience

function buildAmbience(g, settings) {
  // Rain: two decorrelated pink noises spread across the stereo field
  g.rainGain = new Tone.Gain(ambGain('rain', settings.rain)).connect(g.bus);
  const rainLP = new Tone.Filter({ type: 'lowpass', frequency: 3600, rolloff: -24 }).connect(g.rainGain);
  const rainHP = new Tone.Filter({ type: 'highpass', frequency: 420 }).connect(rainLP);
  [-0.7, 0.7].forEach((p) => {
    const pan = new Tone.Panner(p).connect(rainHP);
    new Tone.Noise({ type: 'pink', playbackRate: p < 0 ? 1 : 0.97 }).connect(pan).start();
  });
  // Droplets bus (individual drops are triggered by the scheduler)
  g.dropBus = new Tone.Gain(1);
  g.dropBus.connect(g.bus);
  g.dropRev = new Tone.Gain(0.5).connect(g.revIn);
  g.dropBus.connect(g.dropRev);

  // River: low brown noise with slow filter + level modulation
  g.riverGain = new Tone.Gain(ambGain('river', settings.river)).connect(g.bus);
  const riverAmp = new Tone.Gain(0.8).connect(g.riverGain);
  new Tone.LFO({ frequency: 0.11, min: 0.6, max: 1 }).connect(riverAmp.gain).start();
  const riverLP = new Tone.Filter({ type: 'lowpass', frequency: 450, Q: 0.8 }).connect(riverAmp);
  new Tone.LFO({ frequency: 0.06, min: 260, max: 780 }).connect(riverLP.frequency).start();
  const riverWide = new Tone.AutoPanner({ frequency: 0.03, depth: 0.35 }).connect(riverLP).start();
  new Tone.Noise({ type: 'brown' }).connect(riverWide).start();

  // Wind: band-passed pink noise with a very slow sweep and gusts
  g.windGain = new Tone.Gain(ambGain('wind', settings.wind)).connect(g.bus);
  const windPan = new Tone.AutoPanner({ frequency: 0.021, depth: 0.6 }).connect(g.windGain).start();
  const gust = new Tone.Gain(0.6).connect(windPan);
  new Tone.LFO({ frequency: 0.047, min: 0.25, max: 1 }).connect(gust.gain).start();
  const windBP = new Tone.Filter({ type: 'bandpass', frequency: 600, Q: 1.6 }).connect(gust);
  new Tone.LFO({ frequency: 0.033, min: 280, max: 1150 }).connect(windBP.frequency).start();
  new Tone.Noise({ type: 'pink' }).connect(windBP).start();
}

const AMB_SCALE = { rain: 0.42, river: 0.55, wind: 1.1 };
const ambGain = (k, v) => AMB_SCALE[k] * v * v; // squared → gentle, perceptual slider

// ------------------------------------------------------------------ live updates

export function applySettings(g, s, prev, time = g.ctx.currentTime) {
  const ramp = 1.2;
  g.volume.volume.rampTo(volumeToDb(s.volume), 0.25, time);
  g.rainGain.gain.rampTo(ambGain('rain', s.rain), ramp, time);
  g.riverGain.gain.rampTo(ambGain('river', s.river), ramp, time);
  g.windGain.gain.rampTo(ambGain('wind', s.wind), ramp, time);
  g.droneLevel.gain.rampTo(s.drone * 0.5, ramp, time);
  g.delay.feedback.rampTo(feedbackFor(s.echo), 0.8, time);
  if (!prev || prev.pace !== s.pace) g.delay.delayTime.rampTo(paceBase(s.pace) * 0.75, 1.5, time);
  if (!prev || prev.root !== s.root || prev.scale !== s.scale) {
    const f = droneFreqs(s);
    const glide = 2.5;
    g.dOsc[0].frequency.rampTo(f.sa, glide, time);
    g.dOsc[1].frequency.rampTo(f.pa, glide, time);
    g.dOsc[2].frequency.rampTo(f.sa2, glide, time);
    g.tOsc.forEach((t) => {
      t.o.frequency.rampTo(f.sa * t.ratio, glide, time);
      t.body.frequency.rampTo(f.sa * t.ratio, glide, time);
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
  out.gain.value = 1;
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
