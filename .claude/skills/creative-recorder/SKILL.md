---
name: creative-recorder
description: >-
  Record a smooth, seamlessly-looping GIF or MP4 of a web page or HTML creative (including
  Taboola "bundled" standalone ad units) for pasting into Google Slides. Use when the
  user gives a URL or .html file and wants a short looping GIF/MP4/clip of it scrolling.
---

# Creative Recorder

Produce a smooth, seamlessly-looping **GIF or MP4** of a URL or HTML file. A GIF pastes
straight into a Google Slides slide (`Insert → Image` — auto-loops as an image); an MP4 is
a true-colour video (`Insert → Video`, web `<video>`, etc.). Both share the same capture
engine; pick the format the user asks for (default to GIF for slides).

The tool lives in `tools/creative-recorder/`. The loop is seamless because it scrolls
down and back up with eased motion ("ping-pong"), so the last frame equals the first.

## Steps

1. **Set up once** (if `tools/creative-recorder/node_modules` is missing):
   ```bash
   cd tools/creative-recorder && npm install && npm run setup
   ```
   `npm run setup` installs the Chromium browser. If Chromium is already present in the
   environment (e.g. Playwright pre-installed under `/opt/pw-browsers`), `setup` is a
   no-op and can be skipped.

2. **Record** — one entry point, `rec.mjs`, picks the encoder by `--format` (or the `--out`
   extension):
   ```bash
   # GIF (slide image, auto-loops via Insert → Image) — the default
   node tools/creative-recorder/rec.mjs <url-or-file> --out <name>.gif

   # MP4 (true-colour H.264 video, via Insert → Video) — frames piped straight to ffmpeg,
   # no GIF intermediate, no 256-colour quantization. Requires ffmpeg on PATH.
   node tools/creative-recorder/rec.mjs <url-or-file> --format mp4 --out <name>.mp4
   ```
   `rec.mjs` just dispatches to `record.mjs` (GIF) or `record-mp4.mjs` (MP4) — call those
   directly if you prefer. Format resolves as: `--format` → `--out` extension → GIF default.
   Shared defaults: ping-pong scroll, device-frame auto-detect, 2x supersampling for crisp
   text. GIF defaults to 5s/14fps; MP4 defaults to 5s/30fps (video affords smoother motion).

3. **Deliver** the resulting file to the user (e.g. with SendUserFile). For a GIF, tell them
   to insert it via `Insert → Image`; for an MP4, via `Insert → Video` (set it to loop).

## Tuning

Flags below work on **both** recorders unless noted.

- Smoother motion: `--fps 15 --duration 6` (GIF); MP4 is already 30fps.
- Smaller file: GIF → `--fps 12`, shorter `--duration`, or `--colors 128`; MP4 → raise
  `--crf` (e.g. `--crf 24`, default 18; higher = smaller/lower quality).
- Whole viewport instead of a phone frame: `--frame viewport`.
- Clip to one element: `--selector ".my-card"`.
- One-way scroll instead of ping-pong: `--scroll down`.
- Emulate a phone (responsive/mobile layout): `--mobile`.

## Notes

- For local files and bundled creatives the tool serves the page over a local HTTP server
  and serves React / ReactDOM / Babel from local `node_modules` when the page fetches them
  from a CDN — so it works even when `unpkg.com` is blocked.
- **GIF** (`record.mjs`) loops automatically as a slide image. **MP4** (`record-mp4.mjs`)
  is true-colour H.264 — sharper and usually smaller, but MP4 has no intrinsic loop-count
  metadata, so looping depends on the player (the recorded motion itself loops seamlessly).
  `record-mp4.mjs` requires `ffmpeg` on PATH.

See `tools/creative-recorder/README.md` for the full option list.
