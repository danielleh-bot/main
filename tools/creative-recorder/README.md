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
| `--scroll-from`| 0          | Start the scroll at this depth (px) instead of the top — useful for long feeds where the interesting part is further down |
| `--scroll-to`  | end        | End the scroll at this depth (px); pair with `--scroll-from` to scroll a specific band (e.g. a feed → an immersive section) |
| `--selector`   | —          | Clip to a specific element (CSS selector) |
| `--frame`      | device     | `device` auto-detects a phone/device frame to clip to; `viewport` captures the whole viewport |
| `--pad`        | 18         | Padding around the device-frame clip |
| `--wait`       | 6000       | Settle time (ms) after load before recording |
| `--loop`       | 0          | GIF loop count, 0 = infinite |
| `--colors`     | 256        | Max palette colors per frame (2–256); lower shrinks the file (GIF only) |
| `--vbitrate`   | 3M         | WebM target bitrate (only when `--out` ends in `.webm`) |
| `--clean`      | on         | Auto-dismiss cookie/consent/subscribe/paywall overlays; `--clean off` to disable |
| `--keep-snap`  | false      | Keep CSS scroll-snap (by default it's disabled for smooth scrolling) |
| `--settle`     | 40         | ms waited per frame for paint / lazy-loaded content |
| `--format`     | rgb565     | Palette precision: `rgb565` (best for photos), `rgb444`, `rgba4444` |
| `--out-scale`  | 1          | Output pixel density vs CSS px; `>1` renders larger/crisper (pair with a higher `--ss`) |
| `--dither`     | on         | Ordered dithering to reduce banding; pass `--dither off` for full-screen photo scrolls (avoids shimmer + smaller file) |
| `--dither-strength` | 16    | Dither intensity when enabled |

## What it handles automatically

- **Plain pages / HTML files** — scrolls the window.
- **Smooth scrolling by default** — disables CSS `scroll-snap` during capture so feeds
  *glide* instead of jumping card-to-card, and captures one forward pass then mirrors the
  frames for a perfectly seamless loop (never re-scrolls dynamic content).
- **Virtualized / lazy-loaded "continuous" feeds** — verifies each scroll position actually
  landed and waits for more content to render, so the scroll doesn't cap or snap.
- **Live pages** — auto-dismisses common cookie/consent/subscribe/paywall overlays
  (OneTrust, Osano, TrustArc, GDPR/consent banners, full-screen modals). Disable with
  `--clean off`; keep snapping with `--keep-snap true`.
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

A 5s phone-frame clip with a mostly-static UI lands around 3–6 MB. **Full-screen
photo/video feeds are the hard case**: every frame is a different image so GIF compression
can't help, and a crisp 6s clip can run ~9 MB. To shrink: lower `--fps` (e.g. 10–12),
shorten `--duration`, reduce `--out-scale`/`--colors`, and keep `--dither off`. For
maximum crispness on photographic content, raise `--ss` and `--out-scale` together (e.g.
`--ss 3 --out-scale 1.3`) and accept a larger file.

## GIF vs WebM video

Set the output extension to choose the format:

```bash
node record.mjs creative.html --out clip.gif    # animated GIF (loops as a slide image)
node record.mjs creative.html --out clip.webm    # smooth 30fps WebM video (tiny file)
```

- **GIF** pastes straight into a slide (`Insert → Image`) and loops forever on its own.
  Great for UI-heavy creatives. But it's limited to ~256 colors per frame and gets large
  and choppy on **full-screen photographic/video content**.
- **WebM** (encoded via Playwright's bundled ffmpeg → VP8) is **far smoother (30fps) and
  much smaller** for photo/video-heavy creatives. Use it when a GIF looks choppy or
  bloated. Insert it via `Insert → Video → Google Drive` (upload the file to Drive first);
  enable *Autoplay* in the video's format options. Note: Slides plays videos once per
  presentation rather than looping continuously like a GIF.

Rule of thumb: **mostly-static UI → GIF; full-screen photos/video → WebM.** MP4 isn't
supported (the bundled encoder only does VP8/WebM).
