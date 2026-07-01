# prototype-recorder — record any prototype, get a GIF for slides

A Claude Code skill that records a UI prototype on a mobile viewport and produces a polished GIF (and MP4 archive) ready to drop into Google Slides.

Designed for designers, PMs, and engineers who used to record with Loom + a third-party converter. This is faster, deterministic, and looks better.

---

## What you get

Per recording, you get:

```
~/Desktop/prototype-recordings/
└── <trigger-name>/
    ├── gifs/<name>-<preset>-<timestamp>.gif      ← share with your PM
    └── recordings/<name>-<timestamp>.mp4          ← also embeddable in Slides
```

Tip: Google Slides lets you insert MP4 directly. The MP4 is usually 2-3 MB and looks better than the GIF — try it first.

---

## How to use it (3 ways)

### Way 1 — "record the X trigger"

If the prototype is in a code project Claude can read, just say:

> Record the `tab-switch` trigger.

Claude will:
1. Find the trigger code in the project.
2. Read it, infer the flow, write a recipe.
3. Show you the recipe — you confirm or redirect ("slow down the middle", "also scroll inside the overlay").
4. Record, convert, save, open the result.

### Way 2 — Walk Claude through it

If the flow isn't fully captured in code (or the project isn't local), describe it:

> Record the prototype at `https://my-prototype.vercel.app/checkout-flow`. Scroll down slowly, then click "Continue", wait 2 seconds, then click "Pay now". Make it about 8 seconds total at iPhone 14 size.

Claude will turn that into a recipe and run it.

### Way 3 — Re-run an existing recording

After a UI tweak you want to re-shoot:

> Re-record `tab-switch` against the latest dev build.

Claude reuses the saved recipe; you get a fresh gif against the current code.

### Way 4 — Figma prototype

Paste a Figma prototype URL (the share/Present link, not the editor URL):

> Record this Figma prototype: https://www.figma.com/proto/abc123/Checkout?node-id=1-2&starting-point-node-id=1:2

Claude will:
1. Detect it's Figma, transform the URL to fullscreen + hidden-UI mode for a clean recording.
2. Ask how the prototype is driven — auto-advance with arrow keys, coordinate clicks at specific hotspots, or "just record what auto-plays".
3. Confirm whether the prototype is set to "Anyone with the link can view" (private prototypes won't load — Playwright runs without your Figma session).
4. Record it.

Two limitations vs. real prototypes: (a) Figma renders to a single canvas, so Claude can't auto-find buttons by text — you may need to give coordinates or just press arrow keys to advance frames. (b) Private files need their share setting flipped to "Anyone with the link" first.

---

## Mobile or desktop?

You'll be asked at the start of every recording. Default is **Mobile (iPhone 14 Pro)**. Pick **Desktop (1280×720)** if your prototype is desktop-only or you're showing a desktop layout.

The viewport changes both what the page sees (so responsive code renders the right layout) and the recording dimensions. You can also ask for a specific device by name if you want — any device name from Playwright's [device list](https://playwright.dev/docs/emulation#devices) works (e.g. "iPad Pro", "Pixel 5", "iPhone SE").

---

## Quality presets

| Preset | Width (portrait / landscape) | FPS | Typical size for ~12s | Use when |
|--------|---|-----|----------------------|----------|
| `tiny` | 480 / 720 px | 10 | 3-5 MB | **Default for slides.** Fits in a deck without lag. |
| `smooth-small` | 720 / 1080 px | 15 | 6-15 MB | Micro-interactions where smoothness matters |
| `high-quality` | 1080 / 1440 px | 30 | 15-30 MB | Reference / archival / zooming-in demos |
| `ultra` | up to 1920 px | 60 | 50-150 MB | Engineering reviews, design crits, "very sharp" requests |

You'll be asked to pick when you start; default is `tiny`. Landscape (desktop) recordings auto-bump one tier so text stays legible.

**Note:** the MP4 saved alongside every gif is **sharper than any gif preset** (h.264 encodes detail far more efficiently than gif's 256-color palette). For design reviews or anywhere you want maximum clarity, try the MP4 first — Google Slides supports inserting it as a video.

---

## Quick install (for new users)

If a teammate is sharing this skill with you, run:

```bash
git clone <repo-url> ~/.claude/skills/prototype-recorder && \
  ~/.claude/skills/prototype-recorder/setup.sh --install
```

That clones the skill into the right place and installs the deps (ffmpeg, gifski, Playwright, Chromium). Then in any Claude Code session, type `/prototype-recorder` and you're set.

To update later: `cd ~/.claude/skills/prototype-recorder && git pull`.

---

## First-time setup (one time, ~3 min)

You need: macOS with [Homebrew](https://brew.sh), Node.js, and Claude Code.

The skill auto-detects what's missing and offers to install:
- `ffmpeg` and `gifski` (via brew) — video/gif tools
- `playwright` (via npm) + Chromium browser — recording engine

When you first run the skill, Claude will say "missing X, install? (y/n)" — say yes once and you're set.

To check status manually:
```bash
~/.claude/skills/prototype-recorder/setup.sh
# or to install:
~/.claude/skills/prototype-recorder/setup.sh --install
```

---

## How recipes work (for the curious)

A "recipe" is a small JavaScript file at `~/.claude/skills/prototype-recorder/recipes/<name>.mjs` that scripts the recording flow: when to scroll, what to click, when to wait. Designers and PMs don't write these — Claude generates them by reading the project source and confirming with you.

If you want to peek at a real one, see `recipes/_examples/`.

You can also edit a recipe by hand (or ask Claude to) — useful if a recording came out a beat too fast or you want to add a new step.

---

## Tips for slide-friendly gifs

- **Keep total duration under 15s** when possible. Longer flows = bigger gifs.
- **Pick `tiny` first** unless your PM specifically asks for higher quality.
- **The MP4 is a great alternative.** Insert it as a video in Slides — better quality, smaller file, plays inline.
- **Hold the final frame for ~1 second** in the recipe. Gif viewers can't pause; if a moment isn't held, it's missed.
- **Speed up app-side delays** (e.g. "wait 4s for toast", "8s of video") rather than recording them at real speed. Time-acceleration is built into the recipe patterns and doesn't distort the rest of the flow.

---

## When to ask for help

- The skill installed but recordings come out blank or don't capture the right thing → ask Claude to read the recipe and trace through phase-by-phase.
- The gif is huge (>15 MB) and `tiny` doesn't help → the flow is probably too long; consider splitting into two short demos.
- A trigger fires in the real prototype but never in the recording → likely a `target=_blank` or `visibilitychange` thing; mention this and Claude will apply the right pattern from `PATTERNS.md`.
