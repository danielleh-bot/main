#!/usr/bin/env node
/**
 * record.mjs — Record a smooth, seamlessly-looping GIF of a web page or HTML creative,
 * sized for pasting straight into Google Slides (an animated GIF loops automatically as
 * an image — no Drive upload / video embed needed).
 *
 * Handles two cases automatically:
 *   1. Plain pages / HTML files  -> scrolls the window.
 *   2. Self-contained creatives (e.g. Taboola "bundled" standalone ad units that boot
 *      React/JSX and scroll inside a phone frame) -> serves react/react-dom/babel from
 *      local node_modules when the CDN is unreachable, auto-detects the inner scroll
 *      container + device frame, and clips to it.
 *
 * Usage:
 *   node record.mjs <url-or-file> [options]
 *
 * Options:
 *   --out <path>        Output GIF (default: ./recording.gif)
 *   --duration <sec>    Clip length (default: 5)
 *   --fps <n>           Frames per second (default: 14)
 *   --width <px>        Viewport width  (default: 1200)
 *   --height <px>       Viewport height (default: 1000)
 *   --ss <n>            Supersample factor for crisp text (default: 2)
 *   --scroll <mode>     pingpong | down | none (default: pingpong — seamless loop)
 *   --hold <sec>        Pause at each end of a pingpong (default: 0.5)
 *   --scroll-px <px>    Override scroll distance (default: full content)
 *   --selector <css>    Clip to this element (overrides device auto-detect)
 *   --frame <mode>      device | viewport (default: device — auto-detect phone frame)
 *   --pad <px>          Padding around the device frame clip (default: 18)
 *   --wait <ms>         Settle time after load before recording (default: 6000)
 *   --loop <n>          GIF loop count, 0 = infinite (default: 0)
 *   --colors <n>        Max palette colors per frame, 2..256 (default: 256)
 */
import { chromium } from 'playwright';
import gifenc from 'gifenc';
const { GIFEncoder, quantize, applyPalette } = gifenc;
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, isAbsolute, dirname, basename } from 'node:path';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

function parseArgs(argv) { const a = { _: [] }; for (let i = 0; i < argv.length; i++) { const t = argv[i]; if (t.startsWith('--')) { a[t.slice(2)] = argv[i + 1]; i++; } else a._.push(t); } return a; }
const args = parseArgs(process.argv.slice(2));
const target = args._[0];
if (!target) { console.error('Usage: node record.mjs <url-or-file> [options]'); process.exit(1); }
const O = {
  out: args.out || 'recording.gif',
  duration: parseFloat(args.duration || '5'),
  fps: parseInt(args.fps || '14', 10),
  width: parseInt(args.width || '1200', 10),
  height: parseInt(args.height || '1000', 10),
  ss: parseFloat(args.ss || '2'),
  scroll: args.scroll || 'pingpong',
  hold: parseFloat(args.hold || '0.5'),
  scrollPx: args['scroll-px'] != null ? parseInt(args['scroll-px'], 10) : null,
  scrollFrom: args['scroll-from'] != null ? parseInt(args['scroll-from'], 10) : null,
  scrollTo: args['scroll-to'] != null ? parseInt(args['scroll-to'], 10) : null,
  selector: args.selector || null,
  frame: args.frame || 'device',
  pad: parseInt(args.pad || '18', 10),
  wait: parseInt(args.wait || '6000', 10),
  loop: parseInt(args.loop ?? '0', 10),
  colors: Math.max(2, Math.min(256, parseInt(args.colors || '256', 10))),
  format: args.format || 'rgb565',           // palette precision: rgb565 (best) | rgb444 | rgba4444
  dither: args.dither !== 'off',             // ordered dithering to kill photo banding (on by default)
  ditherStrength: parseFloat(args['dither-strength'] || '16'),
  outScale: parseFloat(args['out-scale'] || '1'), // output pixel density vs CSS px (>1 = larger/crisper)
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
      // serve sibling assets if any
      const sib = resolve(dirname(filePath), '.' + u);
      if (sib.startsWith(dirname(filePath)) && existsSync(sib)) { res.writeHead(200); res.end(readFileSync(sib)); return; }
      res.writeHead(404); res.end('not found');
    });
    await new Promise(r => server.listen(0, r));
    navUrl = `http://127.0.0.1:${server.address().port}/`;
  }

  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: O.width, height: O.height }, deviceScaleFactor: O.ss, ignoreHTTPSErrors: true });

  // Serve React/ReactDOM/Babel from local copies *only if present* (offline fallback);
  // otherwise let the request hit the network normally.
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

  // Clip region.
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

  const totalFrames = Math.max(4, Math.round(O.duration * O.fps));
  const frameDelayMs = Math.round(1000 / O.fps);
  const holdFrac = Math.min(0.4, (O.hold * O.fps) / totalFrames);

  console.log(`Scroll: ${usesInner ? 'inner' : 'window'} range ${maxScroll}px | clip ${clip ? clip.width + 'x' + clip.height : 'full ' + vp.width + 'x' + vp.height} @${O.ss}x | ${totalFrames} frames @${O.fps}fps ${O.scroll}`);

  // Scroll band: optionally scroll between two depths instead of from the very top.
  const absMax = usesInner ? geo.innerMax : geo.winMax;
  const start = O.scrollFrom != null ? Math.max(0, Math.min(O.scrollFrom, absMax)) : 0;
  const end = O.scrollTo != null ? Math.max(0, Math.min(O.scrollTo, absMax)) : maxScroll;
  const span = end - start;
  if (start || O.scrollTo != null) console.log(`Scroll band: ${start} -> ${end}px`);

  // Per-frame scroll positions.
  const positions = [];
  for (let i = 0; i < totalFrames; i++) {
    const p = i / (totalFrames - 1);
    let v;
    if (O.scroll === 'pingpong') {
      const tri = p < 0.5 ? p * 2 : (1 - p) * 2;
      const lo = holdFrac, hi = 1 - holdFrac;
      const m = tri <= lo ? 0 : tri >= hi ? 1 : (tri - lo) / (hi - lo);
      v = start + ease(m) * span;
    } else if (O.scroll === 'down') {
      v = start + ease(p) * span;
    } else v = start;
    positions.push(Math.round(v));
  }

  const gif = GIFEncoder();
  const setScroll = usesInner
    ? (y) => page.evaluate((yy) => { const el = document.querySelector('[data-rec-scroll]'); if (el) el.scrollTop = yy; }, y)
    : (y) => page.evaluate((yy) => window.scrollTo(0, yy), y);

  const dsFactor = Math.max(1, O.ss / O.outScale); // render at O.ss, output at O.outScale px density
  let outW = 0, outH = 0;
  for (let i = 0; i < totalFrames; i++) {
    await setScroll(positions[i]);
    await page.waitForTimeout(10);
    const buf = await page.screenshot({ type: 'png', clip: clip || undefined });
    const { data, width, height } = decodePNG(buf);
    const ds = downscale(data, width, height, dsFactor);
    outW = ds.width; outH = ds.height;
    if (O.dither) orderedDither(ds.data, ds.width, ds.height, O.ditherStrength);
    const palette = quantize(ds.data, O.colors, { format: O.format });
    const index = applyPalette(ds.data, palette, O.format);
    gif.writeFrame(index, ds.width, ds.height, { palette, delay: frameDelayMs, repeat: O.loop });
    process.stdout.write(`\r  frame ${i + 1}/${totalFrames}`);
  }
  process.stdout.write('\n');
  gif.finish();
  const outPath = isAbsolute(O.out) ? O.out : resolve(process.cwd(), O.out);
  writeFileSync(outPath, gif.bytes());
  await browser.close();
  if (server) await new Promise(r => server.close(r));
  console.log(`Done: ${outPath} (${(gif.bytes().length / 1024).toFixed(0)} KB, ${outW}x${outH})`);
}

// Ordered (Bayer 8x8) dithering: jitter each channel by a sub-step amount before
// palette quantization so nearest-color mapping alternates between neighbouring palette
// entries, breaking up the banding/posterization GIFs show on photographic gradients.
const BAYER8 = (() => {
  const m = [[0, 32, 8, 40, 2, 34, 10, 42], [48, 16, 56, 24, 50, 18, 58, 26], [12, 44, 4, 36, 14, 46, 6, 38], [60, 28, 52, 20, 62, 30, 54, 22], [3, 35, 11, 43, 1, 33, 9, 41], [51, 19, 59, 27, 49, 17, 57, 25], [15, 47, 7, 39, 13, 45, 5, 37], [63, 31, 55, 23, 61, 29, 53, 21]];
  const out = new Float32Array(64);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) out[y * 8 + x] = m[y][x] / 64 - 0.5; // -0.5..0.5
  return out;
})();
function orderedDither(data, w, h, strength) {
  if (!strength) return;
  for (let y = 0; y < h; y++) {
    const brow = (y & 7) * 8;
    for (let x = 0; x < w; x++) {
      const t = BAYER8[brow + (x & 7)] * strength;
      const i = (y * w + x) * 4;
      data[i] += t; data[i + 1] += t; data[i + 2] += t; // Uint8ClampedArray clamps for us
    }
  }
}

// Box-average downscale of an RGBA buffer by factor f.
function downscale(src, w, h, f) {
  if (f === 1) return { data: src, width: w, height: h };
  const ow = Math.round(w / f), oh = Math.round(h / f);
  const out = new Uint8ClampedArray(ow * oh * 4);
  for (let oy = 0; oy < oh; oy++) {
    const sy0 = Math.floor(oy * f), sy1 = Math.min(h, Math.floor((oy + 1) * f));
    for (let ox = 0; ox < ow; ox++) {
      const sx0 = Math.floor(ox * f), sx1 = Math.min(w, Math.floor((ox + 1) * f));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = sy0; sy < sy1; sy++) { let row = (sy * w + sx0) * 4; for (let sx = sx0; sx < sx1; sx++) { r += src[row]; g += src[row + 1]; b += src[row + 2]; a += src[row + 3]; row += 4; n++; } }
      const di = (oy * ow + ox) * 4;
      out[di] = r / n; out[di + 1] = g / n; out[di + 2] = b / n; out[di + 3] = a / n;
    }
  }
  return { data: out, width: ow, height: oh };
}

// Minimal PNG decoder for the 8-bit RGB/RGBA images Chromium emits.
function decodePNG(buf) {
  let p = 8, width = 0, height = 0, bitDepth = 0, colorType = 0; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p); p += 4; const type = buf.toString('ascii', p, p + 4); p += 4;
    const data = buf.subarray(p, p + len); p += len; p += 4;
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data); else if (type === 'IEND') break;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!channels || bitDepth !== 8) throw new Error(`Unsupported PNG colorType=${colorType} bitDepth=${bitDepth}`);
  const stride = width * channels;
  const out = new Uint8ClampedArray(width * height * 4);
  const prev = new Uint8Array(stride), cur = new Uint8Array(stride);
  const paeth = (a, b, c) => { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    for (let x = 0; x < stride; x++) {
      const rb = raw[pos++]; const a = x >= channels ? cur[x - channels] : 0; const b = prev[x]; const c = x >= channels ? prev[x - channels] : 0; let v;
      switch (filter) { case 0: v = rb; break; case 1: v = rb + a; break; case 2: v = rb + b; break; case 3: v = rb + ((a + b) >> 1); break; case 4: v = rb + paeth(a, b, c); break; default: throw new Error('filter ' + filter); }
      cur[x] = v & 0xff;
    }
    for (let x = 0; x < width; x++) { const si = x * channels, di = (y * width + x) * 4; out[di] = cur[si]; out[di + 1] = cur[si + 1]; out[di + 2] = cur[si + 2]; out[di + 3] = channels === 4 ? cur[si + 3] : 255; }
    prev.set(cur);
  }
  return { data: out, width, height };
}

main().catch(e => { console.error(e); process.exit(1); });
