# Creative Recorder

Record a **smooth, seamlessly-looping GIF** of a web page or HTML creative — sized to
drop straight into a Google Slides slide.

In Google Slides an animated GIF is inserted as an **image** (`Insert → Image`) and loops
forever on its own. No Drive upload, no video embed, no playback controls. That makes a
GIF the right format for "paste a short looping clip into a slide."

The loop is made seamless by scrolling **down and back up** with eased motion (a
"ping-pong"), so the last frame equals the first — no visible jump when it repeats.

## Setup

```bash
cd tools/creative-recorder
npm install
npm run setup        # downloads the Chromium browser Playwright drives
```

## Usage

```bash
# A live URL
node record.mjs https://example.com --out example.gif

# A local HTML file (relative or absolute path)
node record.mjs ./my-creative.html --out creative.gif

# Common knobs
node record.mjs ./creative.html \
  --duration 5 \      # seconds (default 5)
  --fps 14 \          # frames/sec (default 14)
  --scroll pingpong \ # pingpong (seamless) | down | none
  --colors 256        # lower = smaller file, e.g. 128
```

### Options

| Flag           | Default    | Description |
|----------------|------------|-------------|
| `--out`        | recording.gif | Output path |
| `--duration`   | 5          | Clip length in seconds |
| `--fps`        | 14         | Frames per second |
| `--width`/`--height` | 1200/1000 | Viewport size |
| `--ss`         | 2          | Supersample factor (renders at Nx, downscales for crisp text) |
| `--scroll`     | pingpong   | `pingpong` (seamless loop), `down` (one-way), or `none` |
| `--hold`       | 0.5        | Pause in seconds at each end of a ping-pong |
| `--scroll-px`  | full       | Override how far it scrolls |
| `--selector`   | —          | Clip to a specific element (CSS selector) |
| `--frame`      | device     | `device` auto-detects a phone/device frame to clip to; `viewport` captures the whole viewport |
| `--pad`        | 18         | Padding around the device-frame clip |
| `--wait`       | 6000       | Settle time (ms) after load before recording |
| `--loop`       | 0          | GIF loop count, 0 = infinite |
| `--colors`     | 256        | Max palette colors per frame (2–256); lower shrinks the file |
| `--mobile`     | off        | Emulate a mobile phone browser (mobile viewport, touch, mobile UA). Defaults to a 390×844 viewport and `--frame viewport` so you capture the site's responsive layout. |
| `--dismiss`    | off        | Close cookie / subscribe / newsletter / paywall overlays after load, before recording. `--dismiss auto` uses built-in heuristics; or pass a comma-separated CSS selector list (e.g. `--dismiss ".close-btn,#newsletter-close"`) to click specific controls. Heuristics always run too. |

### Recording a live mobile page with a popup

```bash
# Phone-sized capture of a news article, closing the subscribe popup first
node record.mjs "https://example.com/some-article" --mobile --dismiss auto --out article.gif
```

`--dismiss auto` presses Escape, clicks close controls (matched by `aria-label`,
`title`, button text like "Close" / "No thanks", and `close`/`dismiss` class names) across
the main frame and same-origin iframes, and as a last resort removes full-viewport modal
backdrops and restores page scrolling — repeated over a few rounds since some overlays
mount in stages.

> **Network:** recording a live URL needs outbound web access. Requests honour
> `HTTPS_PROXY` automatically. In a locked-down environment whose egress policy blocks the
> target host, the page can't load — open web access in the environment's network policy
> first. (Local HTML files always work; they need no network.)

## What it handles automatically

- **Plain pages / HTML files** — scrolls the window.
- **Self-contained "bundled" creatives** (e.g. Taboola TrueNative standalone ad units that
  boot a React/JSX app and scroll inside a phone frame):
  - The file is served over a local HTTP server, because these creatives use a `fetch()`
    based module loader that does not work from a `file://` origin.
  - `react`, `react-dom`, and `@babel/standalone` are served from local `node_modules`
    when the page tries to load them from a CDN — so it works even in locked-down
    networks where `unpkg.com` is blocked. (With normal internet access, the CDN is used
    as-is and these copies are simply ignored.)
  - The inner scroll container and the device frame are auto-detected; the GIF is clipped
    to the phone with a little background padding for a clean device-mockup look.

## Notes on file size

A 5s phone-frame clip lands around 3–6 MB depending on fps and content. To shrink it:
lower `--fps` (e.g. 12), shorten `--duration`, or reduce `--colors` (e.g. 128). One GIF of
a few MB is fine in a deck; just avoid putting many very large GIFs on one slide.

## Why GIF and not MP4?

GIF pastes into a slide as a self-looping image — the simplest workflow. MP4/WebM would
need to be uploaded to Drive and inserted as a video object. (The encoder bundled with
Playwright can only produce WebM/GIF, not MP4, anyway.) If you specifically need video,
record frames the same way and encode a WebM with `ffmpeg`.
