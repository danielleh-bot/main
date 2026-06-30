#!/usr/bin/env node
/**
 * record-mp4.mjs — Record a smooth, seamlessly-looping MP4 of a web page or HTML creative.
 *
 * Same capture engine as record.mjs (auto-detects an inner scroll container + phone-device
 * frame, serves react/react-dom/babel locally when the CDN is blocked, eased ping-pong
 * scroll for a seamless loop), but instead of quantizing each frame into a 256-colour GIF
 * it pipes the raw PNG frames straight into ffmpeg and encodes true-colour H.264. Result:
 * full colour, sharper text, smaller files — a real video rather than a slide image.
 *
 * Use this when you want an actual .mp4 (Insert -> Video in Slides/Keynote, web <video>,
 * etc.). Use record.mjs when you want a GIF that auto-loops as an inserted image.
 *
 * Usage:
 *   node record-mp4.mjs <url-or-file> [options]
 *
 * Options:
 *   --out <path>        Output MP4 (default: ./recording.mp4)
 *   --duration <sec>    Clip length (default: 5)
 *   --fps <n>           Frames per second (default: 30 — MP4 affords smooth motion)
 *   --width <px>        Viewport width  (default: 1200)
 *   --height <px>       Viewport height (default: 1000)
 *   --ss <n>            Supersample factor for crisp text (default: 2). Captured at ss x
 *                       then downscaled by ffmpeg (lanczos).
 *   --crf <n>           x264 quality, lower = better/larger, 0..51 (default: 18)
 *   --preset <name>     x264 preset (default: slow)
 *   --scroll <mode>     pingpong | down | none (default: pingpong — seamless loop)
 *   --hold <sec>        Pause at each end of a pingpong (default: 0.5)
 *   --scroll-px <px>    Override scroll distance (default: full content)
 *   --selector <css>    Clip to this element (overrides device auto-detect)
 *   --frame <mode>      device | viewport (default: device — auto-detect phone frame;
 *                       forced to viewport in --mobile mode)
 *   --pad <px>          Padding around the device frame clip (default: 18)
 *   --wait <ms>         Settle time after load before recording (default: 6000)
 *   --mobile            Emulate a mobile phone browser (mobile viewport, touch, mobile UA).
 *                       Defaults to a 390x844 viewport and --frame viewport.
 *   --dismiss <spec>    Close overlays (cookie / subscribe / paywall popups) after load.
 *                       "auto" uses built-in heuristics; or a comma-separated selector list.
 *
 * Note: MP4 has no intrinsic loop-count metadata (unlike GIF) — looping is up to the
 * player. The recorded motion is itself a seamless loop, so it joins cleanly when repeated.
 *
 * Outbound requests honour HTTPS_PROXY / https_proxy; localhost is always bypassed.
 */
import { chromium, devices } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, isAbsolute, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import http from 'node:http';

// Value-less boolean flags: they never consume the following token.
const BOOL_FLAGS = new Set(['mobile']);
function parseArgs(argv) { const a = { _: [] }; for (let i = 0; i < argv.length; i++) { const t = argv[i]; if (t.startsWith('--')) { const k = t.slice(2); if (BOOL_FLAGS.has(k)) { a[k] = true; } else { a[k] = argv[i + 1]; i++; } } else a._.push(t); } return a; }
const args = parseArgs(process.argv.slice(2));
const target = args._[0];
if (!target) { console.error('Usage: node record-mp4.mjs <url-or-file> [options]'); process.exit(1); }
const mobile = !!args.mobile;
const dismiss = 'dismiss' in args
  ? (args.dismiss === undefined || String(args.dismiss).startsWith('--') ? 'auto' : args.dismiss)
  : null;
const O = {
  out: args.out || 'recording.mp4',
  duration: parseFloat(args.duration || '5'),
  fps: parseInt(args.fps || '30', 10),
  width: parseInt(args.width || (mobile ? '390' : '1200'), 10),
  height: parseInt(args.height || (mobile ? '844' : '1000'), 10),
  ss: parseFloat(args.ss || '2'),
  crf: Math.max(0, Math.min(51, parseInt(args.crf || '18', 10))),
  preset: args.preset || 'slow',
  scroll: args.scroll || 'pingpong',
  hold: parseFloat(args.hold || '0.5'),
  scrollPx: args['scroll-px'] != null ? parseInt(args['scroll-px'], 10) : null,
  selector: args.selector || null,
  frame: args.frame || (mobile ? 'viewport' : 'device'),
  pad: parseInt(args.pad || '18', 10),
  wait: parseInt(args.wait || '6000', 10),
  mobile,
  dismiss,
};

const here = dirname(fileURLToPath(import.meta.url));
// Optional offline copies of the libraries bundled creatives fetch from unpkg.
function tryRead(p) { try { return readFileSync(p); } catch { return null; } }
const vendor = {
  react: tryRead(resolve(here, 'node_modules/react/umd/react.production.min.js')),
  reactDom: tryRead(resolve(here, 'node_modules/react-dom/umd/react-dom.production.min.js')),
  babel: tryRead(resolve(here, 'node_modules/@babel/standalone/babel.min.js')),
};

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const evenDown = (n) => Math.max(2, Math.floor(n / 2) * 2);
// Backpressure-aware write: resolves once ffmpeg has drained enough to accept more.
function writeFrame(stream, buf) { return new Promise((res, rej) => { stream.write(buf, (err) => err ? rej(err) : null); if (!stream.writableNeedDrain) res(); else stream.once('drain', res); }); }

async function main() {
  // Decide how to load the target. Local files are served over HTTP so that creatives
  // whose internal module loader uses fetch() get a real origin (file:// breaks them).
  let navUrl, server = null;
  if (/^https?:\/\//i.test(target)) {
    navUrl = target;
  } else {
    const filePath = isAbsolute(target) ? target : resolve(process.cwd(), target);
    if (!existsSync(filePath)) { console.error(`File not found: ${filePath}`); process.exit(1); }
    const html = readFileSync(filePath);
    const name = basename(filePath);
    server = http.createServer((req, res) => {
      const u = decodeURIComponent(req.url.split('?')[0]);
      if (u === '/' || u === '/' + name) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); return; }
      const sib = resolve(dirname(filePath), '.' + u);
      if (sib.startsWith(dirname(filePath)) && existsSync(sib)) { res.writeHead(200); res.end(readFileSync(sib)); return; }
      res.writeHead(404); res.end('not found');
    });
    await new Promise(r => server.listen(0, r));
    navUrl = `http://127.0.0.1:${server.address().port}/`;
  }

  const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || null;
  const isRemote = /^https?:\/\//i.test(target);
  const launchOpts = { args: ['--no-sandbox', '--disable-dev-shm-usage'] };
  if (proxyUrl && isRemote) { launchOpts.proxy = { server: proxyUrl, bypass: 'localhost,127.0.0.1,::1' }; }
  const browser = await chromium.launch(launchOpts);

  const ctxOpts = { viewport: { width: O.width, height: O.height }, deviceScaleFactor: O.ss, ignoreHTTPSErrors: true };
  if (O.mobile) {
    const dev = devices['iPhone 13'] || {};
    ctxOpts.userAgent = dev.userAgent;
    ctxOpts.isMobile = dev.isMobile ?? true;
    ctxOpts.hasTouch = dev.hasTouch ?? true;
  }
  const ctx = await browser.newContext(ctxOpts);

  // Serve React/ReactDOM/Babel from local copies *only if present* (offline fallback).
  await ctx.route('**/*', async (route) => {
    const u = route.request().url(); const hdr = { 'access-control-allow-origin': '*' };
    const js = (b) => route.fulfill({ status: 200, contentType: 'application/javascript', headers: hdr, body: b });
    if (/(unpkg\.com|cdn\.jsdelivr\.net|esm\.sh).*@babel\/standalone/.test(u) && vendor.babel) return js(vendor.babel);
    if (/(unpkg\.com|cdn\.jsdelivr\.net|esm\.sh).*react-dom.*\.js/.test(u) && vendor.reactDom) return js(vendor.reactDom);
    if (/(unpkg\.com|cdn\.jsdelivr\.net|esm\.sh).*react.*\.js/.test(u) && vendor.react) return js(vendor.react);
    return route.continue();
  });

  const page = await ctx.newPage();
  await page.goto(navUrl, { waitUntil: 'load' }).catch(() => {});
  await page.waitForTimeout(O.wait);

  if (O.dismiss) await dismissOverlays(page, O.dismiss);

  // Detect inner scroll container + device frame.
  const geo = await page.evaluate((PAD) => {
    let sc = null, scMax = 0, dev = null, devArea = 0;
    const walk = (node) => {
      for (const el of node.querySelectorAll('*')) {
        const cs = getComputedStyle(el); const b = el.getBoundingClientRect();
        const m = el.scrollHeight - el.clientHeight;
        if (m > scMax && /(auto|scroll)/.test(cs.overflowY) && b.height > 200) { scMax = m; sc = el; }
        if (b.width > 200 && b.width < 700 && b.height > 500 && parseFloat(cs.borderRadius) > 15) { const a = b.width * b.height; if (a > devArea) { devArea = a; dev = el; } }
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    };
    walk(document.body);
    if (sc) sc.setAttribute('data-rec-scroll', '1');
    let frameBox = null;
    if (dev) { let p = dev; while (p && p.parentElement) { const pcs = getComputedStyle(p.parentElement); if (parseFloat(pcs.borderRadius) > 15) p = p.parentElement; else break; } const fb = p.getBoundingClientRect(); frameBox = { x: fb.x, y: fb.y, w: fb.width, h: fb.height }; }
    const winMax = Math.max(0, document.documentElement.scrollHeight - document.documentElement.clientHeight);
    return { innerScroll: !!sc, innerMax: scMax, winMax, frameBox };
  }, O.pad);

  const usesInner = geo.innerScroll && geo.innerMax > 10;
  let maxScroll = usesInner ? geo.innerMax : geo.winMax;
  if (O.scrollPx != null) maxScroll = Math.min(O.scrollPx, maxScroll);
  if (O.scroll === 'none') maxScroll = 0;

  // Clip region (in CSS px). The PNG comes back at O.ss x these dimensions.
  const vp = page.viewportSize();
  let clip = null;
  if (O.selector) {
    const el = await page.$(O.selector);
    if (!el) { console.error(`Selector not found: ${O.selector}`); await browser.close(); process.exit(1); }
    const bb = await el.boundingBox();
    clip = { x: Math.max(0, Math.floor(bb.x - O.pad)), y: Math.max(0, Math.floor(bb.y - O.pad)), width: Math.ceil(bb.width + O.pad * 2), height: Math.ceil(bb.height + O.pad * 2) };
  } else if (O.frame === 'device' && geo.frameBox) {
    const f = geo.frameBox;
    clip = { x: Math.max(0, Math.floor(f.x - O.pad)), y: Math.max(0, Math.floor(f.y - O.pad)) };
    clip.width = Math.min(vp.width - clip.x, Math.ceil(f.w + O.pad * 2));
    clip.height = Math.min(vp.height - clip.y, Math.ceil(f.h + O.pad * 2));
  } // else: full viewport (clip stays null)

  // Output dimensions = clip (or viewport) size in CSS px, forced even for yuv420p.
  const outW = evenDown(clip ? clip.width : vp.width);
  const outH = evenDown(clip ? clip.height : vp.height);

  const totalFrames = Math.max(4, Math.round(O.duration * O.fps));
  const holdFrac = Math.min(0.4, (O.hold * O.fps) / totalFrames);

  console.log(`Scroll: ${usesInner ? 'inner' : 'window'} range ${maxScroll}px | out ${outW}x${outH} (captured @${O.ss}x) | ${totalFrames} frames @${O.fps}fps ${O.scroll} -> H.264 crf${O.crf}`);

  // Per-frame scroll positions.
  const positions = [];
  for (let i = 0; i < totalFrames; i++) {
    const p = i / (totalFrames - 1);
    let v;
    if (O.scroll === 'pingpong') {
      const tri = p < 0.5 ? p * 2 : (1 - p) * 2;
      const lo = holdFrac, hi = 1 - holdFrac;
      const m = tri <= lo ? 0 : tri >= hi ? 1 : (tri - lo) / (hi - lo);
      v = ease(m) * maxScroll;
    } else if (O.scroll === 'down') {
      v = ease(p) * maxScroll;
    } else v = 0;
    positions.push(Math.round(v));
  }

  // Spawn ffmpeg: read a stream of PNGs on stdin, downscale to even output dims, encode H.264.
  const outPath = isAbsolute(O.out) ? O.out : resolve(process.cwd(), O.out);
  const ff = spawn('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(O.fps), '-i', '-',
    '-vf', `scale=${outW}:${outH}:flags=lanczos`,
    '-c:v', 'libx264', '-preset', O.preset, '-crf', String(O.crf),
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-r', String(O.fps),
    outPath,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  const ffDone = new Promise((res, rej) => { ff.on('error', rej); ff.on('close', (code) => code === 0 ? res() : rej(new Error(`ffmpeg exited ${code}`))); });

  const setScroll = usesInner
    ? (y) => page.evaluate((yy) => { const el = document.querySelector('[data-rec-scroll]'); if (el) el.scrollTop = yy; }, y)
    : (y) => page.evaluate((yy) => window.scrollTo(0, yy), y);

  for (let i = 0; i < totalFrames; i++) {
    await setScroll(positions[i]);
    await page.waitForTimeout(10);
    const buf = await page.screenshot({ type: 'png', clip: clip || undefined });
    await writeFrame(ff.stdin, buf);
    process.stdout.write(`\r  frame ${i + 1}/${totalFrames}`);
  }
  process.stdout.write('\n');
  ff.stdin.end();
  await ffDone;
  await browser.close();
  if (server) await new Promise(r => server.close(r));
  const kb = existsSync(outPath) ? (readFileSync(outPath).length / 1024).toFixed(0) : '?';
  console.log(`Done: ${outPath} (${kb} KB, ${outW}x${outH}, ${O.fps}fps)`);
}

// Dismiss cookie / subscribe / newsletter / paywall overlays before recording.
async function dismissOverlays(page, spec) {
  const explicit = spec && spec !== 'auto' ? spec.split(',').map(s => s.trim()).filter(Boolean) : [];
  let totalClosed = 0;
  for (let round = 0; round < 3; round++) {
    await page.keyboard.press('Escape').catch(() => {});
    let closedThisRound = 0;
    for (const frame of page.frames()) {
      const n = await frame.evaluate(({ explicit }) => {
        const isVisible = (el) => { const b = el.getBoundingClientRect(); const cs = getComputedStyle(el); return b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0'; };
        let closed = 0;
        for (const sel of explicit) {
          for (const el of document.querySelectorAll(sel)) { if (isVisible(el)) { el.click(); closed++; } }
        }
        const closeRe = /^(close|close dialog|close modal|dismiss|no thanks|no, ?thanks|not now|maybe later|skip|continue without|×|✕|✖|x)$/i;
        const labelRe = /close|dismiss|no thanks|not now|maybe later/i;
        const controls = document.querySelectorAll('button,a,[role="button"],[aria-label],[class*="close" i],[class*="dismiss" i],[id*="close" i]');
        for (const el of controls) {
          if (!isVisible(el)) continue;
          const al = (el.getAttribute('aria-label') || '').trim();
          const tl = (el.getAttribute('title') || '').trim();
          const txt = (el.textContent || '').trim();
          if ((al && labelRe.test(al)) || (tl && labelRe.test(tl)) || (txt.length <= 24 && closeRe.test(txt))) {
            el.click(); closed++;
            if (closed > 6) break;
          }
        }
        {
          const vw = innerWidth, vh = innerHeight;
          for (const el of document.querySelectorAll('div,section,aside')) {
            const cs = getComputedStyle(el); if (!/fixed|sticky/.test(cs.position)) continue;
            const b = el.getBoundingClientRect();
            const coversMost = b.width >= vw * 0.9 && b.height >= vh * 0.6 && b.top <= 5;
            const looksModal = /modal|overlay|popup|paywall|subscri|newsletter|gateway|backdrop|interstitial/i.test((el.className || '') + ' ' + (el.id || ''));
            if (coversMost && looksModal && +cs.zIndex >= 100) { el.remove(); closed++; }
          }
        }
        for (const el of [document.documentElement, document.body]) { el.style.overflow = ''; el.style.position = ''; }
        return closed;
      }, { explicit }).catch(() => 0);
      closedThisRound += n;
    }
    totalClosed += closedThisRound;
    if (closedThisRound === 0 && round > 0) break;
    await page.waitForTimeout(500);
  }
  console.log(`Dismiss: closed ${totalClosed} overlay element(s)`);
}

main().catch(e => { console.error(e); process.exit(1); });
