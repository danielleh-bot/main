---
name: creative-recorder
description: >-
  Record a smooth, seamlessly-looping GIF of a web page or HTML creative (including
  Taboola "bundled" standalone ad units) for pasting into Google Slides. Use when the
  user gives a URL or .html file and wants a short looping GIF/clip of it scrolling.
---

# Creative Recorder

Produce a smooth, seamlessly-looping **animated GIF** of a URL or HTML file that the user
can paste into a Google Slides slide (`Insert → Image` — a GIF auto-loops as an image).

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

2. **Record:**
   ```bash
   node tools/creative-recorder/record.mjs <url-or-file> --out <name>.gif
   ```
   Sensible defaults: 5s, 14fps, ping-pong scroll, device-frame auto-detect, 2x
   supersampling for crisp text.

3. **Deliver** the resulting `.gif` to the user (e.g. with SendUserFile) and tell them to
   insert it into the slide via `Insert → Image`.

## Tuning

- Smoother motion: `--fps 15 --duration 6`.
- Smaller file: `--fps 12`, shorter `--duration`, or `--colors 128`.
- Whole viewport instead of a phone frame: `--frame viewport`.
- Clip to one element: `--selector ".my-card"`.
- One-way scroll instead of ping-pong: `--scroll down`.

## Notes

- For local files and bundled creatives the tool serves the page over a local HTTP server
  and serves React / ReactDOM / Babel from local `node_modules` when the page fetches them
  from a CDN — so it works even when `unpkg.com` is blocked.
- Output is GIF (loops as a slide image). MP4 isn't supported by the bundled encoder; use
  WebM via `ffmpeg` only if true video is required.

See `tools/creative-recorder/README.md` for the full option list.
