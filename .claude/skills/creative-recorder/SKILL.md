---
name: creative-recorder
description: >-
  Record a smooth, seamlessly-looping animated GIF of a web page, landing page, or HTML
  creative (including Taboola TrueNative "bundled" standalone ad units) for pasting into
  Google Slides or any deck. Use this skill whenever the user wants a recording, clip,
  GIF, screen capture, animated preview, or scrolling demo of a URL or .html file — even
  if they say "video", "mp4", "screen recording", "screenshot of it scrolling", or just
  "put this creative in a slide" rather than asking for a GIF by name. Also use it when
  they want to show an ad unit, mock, or prototype animating in a presentation.
---

# Creative Recorder

Produce a seamlessly-looping **animated GIF** of a URL or HTML file that the user can drop
into a slide with `Insert → Image`. In Google Slides a GIF loops forever on its own as an
image, with no Drive upload and no video embed — which is why GIF is the target format even
when the user asks for a "video" or "clip". Say so briefly rather than silently substituting
formats, and only reach for real video if they insist (see Notes).

The loop is seamless because the page scrolls down and back up with eased motion
("ping-pong"), so the last frame equals the first and there's no visible jump on repeat.

The tool lives in `tools/creative-recorder/`.

## Steps

1. **Set up once** — only if `tools/creative-recorder/node_modules` is missing:
   ```bash
   cd tools/creative-recorder && npm install && npm run setup
   ```
   `npm run setup` downloads the Chromium build Playwright drives. If a Chromium is already
   present in the environment (e.g. a preinstalled Playwright cache), setup is a no-op and
   can be skipped.

2. **Record** (paths are resolved from your current directory, so this works from the repo
   root):
   ```bash
   node tools/creative-recorder/record.mjs <url-or-file> --out <name>.gif
   ```
   The defaults — 5s, 14fps, ping-pong scroll, device-frame auto-detect, 2x supersampling —
   are tuned for a phone-shaped creative on a slide, so start there and only tune if the
   result disagrees with what the user wanted.

3. **Read the tool's own report before trusting the output.** Every run prints a line like:
   ```
   Scroll: inner range 820px | clip 426x816 @2x | 70 frames @14fps pingpong
   Done: /path/out.gif (142 KB, 426x816)
   ```
   This is your cheapest signal that the recording is actually of the thing the user meant.
   `inner` means it scrolled a container inside the page (typical for a bundled creative in
   a phone frame), `window` means it scrolled the page itself. A `range` of `0px` means
   nothing moved, and a `clip` size that doesn't resemble the creative means it framed the
   wrong element — see Troubleshooting.

4. **Look at the GIF** before handing it over. Viewing the file shows its first frame, which
   catches the most common silent failure: a creative that hadn't finished booting when
   recording started, so the GIF is a blank, white, or skeleton screen. The tool exits 0 in
   that case, so nothing else will warn you.

5. **Deliver the `.gif`** with whatever file-sending tool is available (e.g. `SendUserFile`),
   or tell the user the exact path if there is none, and mention that it goes into the slide
   via `Insert → Image` and will loop by itself.

## Tuning

- Smoother motion: `--fps 15 --duration 6`.
- Smaller file: `--fps 12`, shorter `--duration`, or `--colors 128`. A 5s phone-frame clip is
  typically 3–6 MB; that's fine for a deck, but keep it lean if several will share a slide.
- Whole viewport instead of a phone frame: `--frame viewport`.
- Clip to one element: `--selector ".my-card"`.
- One-way scroll instead of ping-pong: `--scroll down` (drop the seamless loop only if the
  user explicitly wants a one-directional pan).
- Longer pause at the top and bottom of the ping-pong: `--hold 1`.

## Troubleshooting

Match the symptom to the fix rather than re-running with random flags:

- **`range 0px`, or the GIF is a still image** — the page has nothing to scroll, or the inner
  scroll container wasn't found. Try `--frame viewport` to see the whole page, `--selector`
  to target the scrolling element directly, or accept a static capture if the creative
  genuinely doesn't scroll.
- **Blank / half-rendered frames** — the creative needed longer to boot. Raise the settle
  time: `--wait 12000`. Bundled ad units that compile JSX in the browser are the usual
  culprits.
- **Clipped to the wrong thing** — device auto-detection looks for a tall, rounded, phone-ish
  element, so a large rounded card can win by mistake. Use `--frame viewport` for the full
  viewport or `--selector` to name the element you want.
- **Creative is cut off at the edges** — the viewport is 1200x1000 by default; enlarge it with
  `--width` / `--height` so the whole unit fits before it gets clipped.
- **Chromium won't launch** — run `npm run setup` in `tools/creative-recorder`, or point
  Playwright at an existing browser cache with `PLAYWRIGHT_BROWSERS_PATH`.
- **`Selector not found` / `File not found`** — the run exits 1 without writing a GIF; fix the
  path or selector rather than reading a stale output file from an earlier attempt.

## Notes

- Local files and bundled creatives are served over a temporary local HTTP server, because
  these creatives use a `fetch()`-based module loader that breaks on a `file://` origin.
  React, ReactDOM, and Babel are served from local `node_modules` when the page requests them
  from a CDN, so recording still works when `unpkg.com` is blocked.
- Output is GIF only. The bundled encoder can't produce MP4. If the user truly needs video,
  a WebM via `ffmpeg` is the escape hatch — but it has to be inserted into Slides as a video
  object, which is why the GIF path is the default recommendation.

See `tools/creative-recorder/README.md` for the full flag list and defaults.
