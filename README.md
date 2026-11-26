# 🪨 Hanoi Hymns — Recursive Soundscapes

> *Every call asks a musical question. Every return answers it.*

A calm riverside at dusk. River stones rest on three flat rocks in the water. A **truly recursive
Tower of Hanoi** carries them across, one by one — and every move rings a singing bowl, a kalimba
or a warm pad. The recursion doesn't just *drive* the music: it **is** the music.

**Live demo:** _coming soon — `https://<your-user>.github.io/<repo>/`_

![Hanoi Hymns — Morning Mist, a stone mid-flight while the call stack shows depth 3](docs/screenshot-main.png)

| Temple Night (3 stones, finished solve) | Mobile |
|---|---|
| ![Temple Night](docs/screenshot-night.png) | <img src="docs/screenshot-mobile.png" alt="Mobile layout" width="260" /> |

<!-- Placeholder: add a short demo GIF / video link here -->
**Demo video:** _coming soon_

---

## The key insight: recursion composes a fractal rhythm

Write down which stone moves at each step of the Hanoi solution:

```
1 2 1 3 1 2 1 4 1 2 1 3 1 2 1 5 …
```

This is the **ruler sequence** — it looks like the tick marks on a ruler. Every block is two copies
of the previous block joined by a new, larger number: a **fractal**, self-similar at every scale.

In Hanoi Hymns that sequence becomes the melody (each stone has its own pitch) *and* the rhythm
(after a bigger stone moves, the river takes a longer breath). Small, high stones chime often;
big, low stones speak rarely and deeply — and the very largest stone, which moves only once,
in the exact middle of the piece, is marked by a deep gong. You can watch the ruler sequence build up
live as a bar chart in the recursion panel.

## How the recursion maps to music

| Recursion property | Musical / visual result |
|---|---|
| **Stone size** (1 … n) | Pitch on the chosen scale — largest stone = lowest note, smallest = highest |
| **Destination peg** A / B / C | Instrument (e.g. A = singing bowl, B = kalimba, C = warm pad) **and** stereo position (left / centre / right) |
| **Recursion depth** of the call that moves the stone | Reverb send + delay send — deeper calls echo further away, so you can *hear* the recursion |
| **Ruler sequence** of moved stones | Melody contour and rhythm — gap after a move grows with the stone's size (fractal breathing) |
| **Largest stone's single move** | Deep gong-like bowl one octave lower — the centre of the recursion |
| **Total moves 2ⁿ − 1** | Length of the piece (7 moves for 3 stones … 255 for 8) |
| **Seed** | Tiny humanization (velocity, micro-timing, detune). Same seed + settings ⇒ same composition |

Underneath everything: a quiet drone on the root (a tanpura-like shimmer for the raga mood) and a
synthesized ambience of rain, river and wind.

## Features

- **Configurable recursive algorithm** — a real recursive generator (`src/recursion/hanoi.js`),
  3–8 stones, any start and target rock. Each move carries its depth and a snapshot of the call stack.
- **2.5D riverside scene** — dusk sky with slowly appearing stars, moon glow, drifting clouds, three
  parallax hill ranges, mist, a flowing river with reflections, fireflies and swaying grass.
  Stones are soft-shaded river-stone shapes in earthy tones that travel in slow eased arcs;
  landings send out water ripples and a glow pulse in sync with the sound.
- **Live recursion panel** — the call stack (`hanoi(4, A→C)` …) with the active depth highlighted,
  the current move, the ruler sequence as a growing bar chart, and progress *move X / 2ⁿ − 1*.
- **Procedural music (Tone.js, 100 % synthesized)** — singing bowl (inharmonic partials with gentle
  beating), kalimba (soft pluck with tine overtone), warm pad (detuned triangles, slow filter swell);
  4 moods: *Pentatonic Major (Calm)*, *Hirajoshi (Zen)*, *Raga Bhupali (Bangla Dusk)*, *Dorian (Dreamy)*,
  any root note; drone; rain (filtered noise + random droplets), river, wind.
- **Mixing rules** — soft attacks, long dark reverb, ping-pong echo, master low-pass, gentle
  compressor, limiter, master level ≈ −10 dB, smooth fades. Audio starts only after *Begin*.
- **Controls** — collapsible glass panel: stones, mood, root, breath pace (slow / medium / flow),
  instrument presets per rock, echo depth, seed with 🎲, endless journey, ambience mixer, sky
  (dusk ↔ night), master volume. Play / pause / restart / step back / step forward.
  Changing sound settings applies instantly; changing pace or seed keeps your place in the piece.
- **Presets** — 🌫️ Morning Mist · 🌧️ Monsoon Evening · 🏮 Temple Night · 🌙 Deep Sleep.
- **Share link** — all settings + seed live in the URL hash; anyone opening it hears the same piece.
- **Download my soundscape** — renders one full solve offline with the *same* audio graph and
  saves a 16-bit stereo 44.1 kHz WAV, with a calm progress card. Filename includes preset, stones,
  scale and seed.
- **Calm tools** — breathing guide (inhale 4 · hold 4 · exhale 6, following the pace), sleep timer
  (10 / 20 / 30 min with a one-minute fade-out), focus mode (hide all UI), *About the math* modal.
- **Accessible** — full keyboard control, visible focus rings, ARIA labels, good contrast,
  `prefers-reduced-motion` support (no parallax / sway / rain streaks, lower arcs), responsive
  layout for laptop and mobile.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `Space` | Play / pause |
| `→` / `←` | Step forward / step back one move |
| `R` | Restart |
| `F` | Focus mode (hide UI) · `Esc` to leave |
| `B` | Breathing guide |
| `S` | Settings panel |
| `?` | About the math |

## Run it

```bash
npm install
npm run dev      # → http://localhost:5173
npm run build    # production build in dist/
npm run preview  # serve the build locally
```

Deploying to GitHub Pages: `vite.config.js` uses `base: './'`, so the contents of `dist/` work from
any sub-path. Push `dist/` to a `gh-pages` branch (or use a Pages workflow).

## Tech stack

- **Vite 6** + **vanilla JavaScript** (ES modules) — no framework
- **Tone.js 15** — audio context, filters, compressor, limiter, ping-pong delay, convolver, offline rendering
- **Web Audio** raw nodes for per-note voices, LFOs and seeded noise (cheap enough for long offline renders)
- **Canvas 2D** — the whole scene, with pre-rendered stone and rock sprites for smooth 60 fps

```
src/
  recursion/hanoi.js     recursive generator of moves {stone, from, to, depth, index, stack}
  recursion/composer.js  moves → timed, seeded, humanized score (fractal rhythm)
  audio/engine.js        graph, instruments, drone, ambience, depth→space mapping
  audio/export.js        offline render + 16-bit WAV encoder
  conductor.js           one clock for sound & sight; look-ahead scheduler; pause/step/endless
  visual/scene.js        riverside canvas scene, stones, ripples, glows
  visual/stack.js        live call stack + ruler sequence + progress
  ui/controls.js         settings panel, presets
  settings.js            scales, presets, share-link encoding, pitch mapping
  main.js                wiring, landing, calm tools, keyboard
```

## How AI was used

This project was built with **Claude Code** (Anthropic's agentic coding CLI) during the hackathon.
The complete prompt chain — every prompt and every full AI response — is in [`ai-logs/`](ai-logs/):

- [`ai-logs/session-01.md`](ai-logs/session-01.md) — full export of the first build session
- [`ai-logs/claude-code-log.md`](ai-logs/claude-code-log.md) — automatic hook-based log of all later sessions
- [`ai-logs/README.md`](ai-logs/README.md) — how the logging works

The human author directed the concept, requirements and judging priorities; Claude Code wrote the
code, tuned the sound design (measured levels with offline renders) and the visuals, and documented
its decisions.

## License

MIT — all sounds are synthesized in the browser; no third-party audio assets.
