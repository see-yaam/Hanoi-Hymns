# CLAUDE.md — Zen Stones

Project context for future Claude Code sessions. Keep this file concise.

## Concept
A calm riverside at dusk. River stones on 3 flat rocks are moved by a **real recursive Tower of Hanoi**;
every move rings a synthesized tone. The moved-stone sequence 1,2,1,3,1,2,1,4… is the fractal
**ruler sequence**, so the recursion literally composes a self-similar melody and rhythm.
Built for Hub's Quest Epoch 1 (24 h solo hackathon).

## Judging weights (prioritize in this order)
Relaxation/UX 35% › Musical quality 25% › Creative recursion 15% › Visual design 10% ›
Interaction/usability 10% › Technical execution 5%. **Calm and sound quality beat complexity.**

## Stack
Vite 6 + vanilla JS (ES modules) · Tone.js 15 · Canvas 2D. No frameworks, no 3D, no audio files.
`vite.config.js` uses `base: './'` (GitHub Pages ready). `npm run dev` / `npm run build`.

## Map
- `src/recursion/hanoi.js` — recursive generator `{stone, from, to, depth, index, stack}`
- `src/recursion/composer.js` — moves → timed, seeded, humanized events (fractal breath rhythm)
- `src/audio/engine.js` — graph (bus → lowpass → comp → makeup → fader → −10 dB volume → limiter), voices, drone, ambience
- `src/audio/export.js` — offline render (same graph) → 16-bit WAV
- `src/conductor.js` — single clock: playhead from AudioContext time, look-ahead scheduler, step/pause/endless
- `src/visual/scene.js` — canvas scene derived from the playhead every frame; `stack.js` — call stack + ruler panel
- `src/ui/controls.js`, `src/settings.js` (scales, presets, URL-hash share), `src/main.js` (wiring, calm tools, keys)

## Audio rules (do not break)
Soft attacks, generous reverb, master limiter, master volume ≈ −10 dB, low-pass on the master
(no harsh highs), smooth fades, audio only after a user gesture. Deterministic: same settings + seed ⇒
same composition (seeded PRNG for humanization, droplets, noise buffers and reverb impulse).
Mapping: stone size → pitch (largest = lowest), destination peg → instrument + pan,
recursion depth → reverb/delay send.

## Rules for every session
1. **Never edit or delete `ai-logs/` or `.claude/hooks/`** — they hold the hackathon prompt-chain logs.
2. Never write secrets, tokens or passwords anywhere (the repo is public).
3. Summarize what changed at the end of every response.
4. Commit after each completed fix, with a clear message.
5. Run `npm run build` before declaring work done.
