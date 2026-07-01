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
 *   --scroll-from <px>  Start scrolling from this y-offset instead of the top (useful for
 *                       content far down a long page, e.g. a feed below an article).
 *   --focus <css>       Auto-scroll to this element and scroll through it (computes the
 *                       start offset + distance from the element's position/height). Best
 *                       way to capture a Taboola feed or widget low on a long page.
 *   --selector <css>    Clip to this element (overrides device auto-detect)
 *   --frame <mode>      device | viewport (default: device — auto-detect phone frame;
 *                       forced to viewport in --mobile mode)
 *   --pad <px>          Padding around the device frame clip (default: 18)
 *   --wait <ms>         Settle time after load before recording (default: 6000)
 *   --no-warmup         Skip the pre-scroll that triggers lazy-loaded content (Taboola
 *                       feeds, lazy images). Warm-up is on by default; disable for static
 *                       pages where it just adds time.
 *   --loop <n>          GIF loop count, 0 = infinite (default: 0)
 *   --colors <n>        Max palette colors per frame, 2..256 (default: 256)
 *   --mobile            Emulate a mobile phone browser (mobile viewport, touch, mobile
 *                       user-agent — sites render their responsive/mobile layout).
 *                       Defaults to a 390x844 viewport and --frame viewport.
 *   --dismiss <spec>    Close overlays (cookie / subscribe / newsletter / paywall popups)
 *                       after load, before recording. "auto" uses built-in heuristics;
 *                       or pass a comma-separated CSS selector list to click. Heuristics
 *                       run in both modes. Default: off.
 *
 * Outbound requests honour HTTPS_PROXY / https_proxy from the environment (so it works
 * behind an egress proxy); localhost is always bypassed for the local file server.
 */
import { chromium, devices } from 'playwright';
import gifenc from 'gifenc';
const { GIFEncoder, quantize, applyPalette } = gifenc;
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, isAbsolute, dirname, basename } from 'node:path';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

// Value-less boolean flags: they never consume the following token.
const BOOL_FLAGS = new Set(['mobile', 'no-warmup']);
function parseArgs(argv) { const a = { _: [] }; for (let i = 0; i < argv.length; i++) { const t = argv[i]; if (t.startsWith('--')) { const k = t.slice(2); if (BOOL_FLAGS.has(k)) { a[k] = true; } else { a[k] = argv[i + 1]; i++; } } else a._.push(t); } return a; }
const args = parseArgs(process.argv.slice(2));
const target = args._[0];
if (!target) { console.error('Usage: node record.mjs <url-or-file> [options]'); process.exit(1); }
const mobile = !!args.mobile;
// --dismiss with no value (or a bare flag) means "auto"; otherwise it's a selector list.
const dismiss = 'dismiss' in args
  ? (args.dismiss === undefined || String(args.dismiss).startsWith('--') ? 'auto' : args.dismiss)
  : null;
const O = {
  out: args.out || 'recording.gif',
  duration: parseFloat(args.duration || '5'),
  fps: parseInt(args.fps || '14', 10),
  width: parseInt(args.width || (mobile ? '390' : '1200'), 10),
  height: parseInt(args.height || (mobile ? '844' : '1000'), 10),
  ss: parseFloat(args.ss || '2'),
  scroll: args.scroll || 'pingpong',
  hold: parseFloat(args.hold || '0.5'),
  scrollPx: args['scroll-px'] != null ? parseInt(args['scroll-px'], 10) : null,
  scrollFrom: args['scroll-from'] != null ? parseInt(args['scroll-from'], 10) : null,
  focus: args.focus || null,
  selector: args.selector || null,
  frame: args.frame || (mobile ? 'viewport' : 'device'),
  pad: parseInt(args.pad || '18', 10),
  wait: parseInt(args.wait || '6000', 10),
  loop: parseInt(args.loop ?? '0', 10),
  colors: Math.max(2, Math.min(256, parseInt(args.colors || '256', 10))),
  mobile,
  dismiss,
  warmup: !args['no-warmup'],
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

  // Route outbound traffic through an egress proxy if one is configured (HTTPS_PROXY) —
  // but only for remote URL targets. Local-file mode serves the page (and its react/babel
  // fallbacks) from 127.0.0.1, which must never go through the proxy.
  const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || null;
  const isRemote = /^https?:\/\//i.test(target);
  const launchOpts = { args: ['--no-sandbox', '--disable-dev-shm-usage'] };
  if (proxyUrl && isRemote) { launchOpts.proxy = { server: proxyUrl, bypass: 'localhost,127.0.0.1,::1' }; }
  const browser = await chromium.launch(launchOpts);

  // In --mobile mode, adopt a phone device profile (mobile UA + touch + isMobile) so the
  // site serves its responsive layout. deviceScaleFactor stays at O.ss to keep the
  // supersample/downscale math consistent.
  const ctxOpts = { viewport: { width: O.width, height: O.height }, deviceScaleFactor: O.ss, ignoreHTTPSErrors: true };
  if (O.mobile) {
    const dev = devices['iPhone 13'] || {};
    ctxOpts.userAgent = dev.userAgent;
    ctxOpts.isMobile = dev.isMobile ?? true;
    ctxOpts.hasTouch = dev.hasTouch ?? true;
  }
  const ctx = await browser.newContext(ctxOpts);

  // Serve React/ReactDOM/Babel from local copies *only if present* (offline fallback for
  // local bundled creatives). Scope this to LOCAL-file targets only: a catch-all route
  // handler intercepts every request, and on heavy live sites (hundreds of third-party
  // requests) that stalls/breaks the page load — remote URLs must load unintercepted.
  if (!isRemote && (vendor.react || vendor.reactDom || vendor.babel)) {
    await ctx.route(/(unpkg\.com|cdn\.jsdelivr\.net|esm\.sh)/, async (route) => {
      const u = route.request().url(); const hdr = { 'access-control-allow-origin': '*' };
      const js = (b) => route.fulfill({ status: 200, contentType: 'application/javascript', headers: hdr, body: b });
      if (/@babel\/standalone/.test(u) && vendor.babel) return js(vendor.babel);
      if (/react-dom.*\.js/.test(u) && vendor.reactDom) return js(vendor.reactDom);
      if (/react.*\.js/.test(u) && vendor.react) return js(vendor.react);
      return route.continue();
    });
  }

  const page = await ctx.newPage();
  await page.goto(navUrl, { waitUntil: 'load' }).catch(() => {});
  await page.waitForTimeout(O.wait);

  if (O.dismiss) await dismissOverlays(page, O.dismiss);

  // Warm up lazy-loaded content (Taboola feeds, infinite-scroll widgets, lazy images) by
  // scrolling the whole page through once before measuring — otherwise the scroll range is
  // capped at the page's initial height and the feed (which only mounts on scroll) is never
  // reached. Disable with --no-warmup.
  if (O.warmup) await warmup(page);

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

  // Prefer an inner scroll container only when it actually scrolls more than the window
  // (true for bundled creatives whose window barely moves; false for normal pages where a
  // small incidental overflow div would otherwise hijack the scroll from the real content).
  const usesInner = geo.innerScroll && geo.innerMax > 10 && geo.innerMax > geo.winMax;
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

  // Scroll window: base (start offset) + span (distance travelled). By default the whole
  // page (0..maxScroll). --focus <selector> starts at an element and scrolls through it;
  // --scroll-from <px> starts at a fixed offset. Both are handy for content that lives far
  // down a long page (e.g. a Taboola feed below a long article) — otherwise the recording
  // spends its whole duration on the article and never reaches it.
  let base = 0, span = maxScroll;
  if (O.focus && maxScroll > 0) {
    const info = await page.evaluate(({ sel, inner }) => {
      const e = document.querySelector(sel); if (!e) return null;
      const r = e.getBoundingClientRect();
      if (inner) { const sc = document.querySelector('[data-rec-scroll]'); const sr = sc.getBoundingClientRect(); return { top: (r.top - sr.top) + sc.scrollTop, height: e.offsetHeight, vp: sc.clientHeight }; }
      return { top: r.top + window.scrollY, height: e.offsetHeight, vp: window.innerHeight };
    }, { sel: O.focus, inner: usesInner });
    if (!info) { console.error(`--focus selector not found: ${O.focus}`); await browser.close(); if (server) await new Promise(r => server.close(r)); process.exit(1); }
    // Start just above the element and scroll to the end of the page — captures the element
    // and everything after it (e.g. a whole Taboola feed that runs to the page bottom).
    base = Math.max(0, Math.min(info.top - O.pad, maxScroll));
    span = maxScroll - base;
  } else if (O.scrollFrom != null && maxScroll > 0) {
    base = Math.max(0, Math.min(O.scrollFrom, maxScroll));
    span = maxScroll - base;
  }

  console.log(`Scroll: ${usesInner ? 'inner' : 'window'} base ${base}px + span ${span}px (max ${maxScroll}px) | clip ${clip ? clip.width + 'x' + clip.height : 'full ' + vp.width + 'x' + vp.height} @${O.ss}x | ${totalFrames} frames @${O.fps}fps ${O.scroll}`);

  // Per-frame scroll positions.
  const positions = [];
  for (let i = 0; i < totalFrames; i++) {
    const p = i / (totalFrames - 1);
    let v;
    if (O.scroll === 'pingpong') {
      const tri = p < 0.5 ? p * 2 : (1 - p) * 2;
      const lo = holdFrac, hi = 1 - holdFrac;
      const m = tri <= lo ? 0 : tri >= hi ? 1 : (tri - lo) / (hi - lo);
      v = base + ease(m) * span;
    } else if (O.scroll === 'down') {
      v = base + ease(p) * span;
    } else v = base;
    positions.push(Math.round(v));
  }

  const gif = GIFEncoder();
  const setScroll = usesInner
    ? (y) => page.evaluate((yy) => { const el = document.querySelector('[data-rec-scroll]'); if (el) el.scrollTop = yy; }, y)
    : (y) => page.evaluate((yy) => window.scrollTo(0, yy), y);

  let outW = 0, outH = 0;
  for (let i = 0; i < totalFrames; i++) {
    await setScroll(positions[i]);
    await page.waitForTimeout(10);
    const buf = await page.screenshot({ type: 'png', clip: clip || undefined });
    const { data, width, height } = decodePNG(buf);
    const ds = downscale(data, width, height, O.ss);
    outW = ds.width; outH = ds.height;
    const palette = quantize(ds.data, O.colors, { format: 'rgb444' });
    const index = applyPalette(ds.data, palette, 'rgb444');
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

// Scroll the page (and the largest inner scroll container, if any) all the way through
// once to trigger lazy-loaded content — Taboola feeds, infinite-scroll widgets, and
// IntersectionObserver-driven images only mount/load when scrolled into view. Steps in
// viewport-sized increments, re-reading the (growing) scroll height as content appears,
// then returns to the top so recording starts from a fully-loaded page.
async function warmup(page) {
  await page.evaluate(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    // Scroll the window in viewport-sized steps. Viewport scrolling is what drives the
    // IntersectionObserver-based lazy loading that feeds/images/embeds use; also scroll any
    // large inner overflow container at each step so bundled creatives warm up too.
    const maxOf = () => document.documentElement.scrollHeight - innerHeight;
    let y = 0;
    for (let i = 0; i < 120; i++) {
      const max = maxOf();
      y = Math.min(y + innerHeight * 0.85, max);
      window.scrollTo(0, y);
      // nudge inner scrollers (e.g. a phone-frame feed) proportionally
      for (const el of document.querySelectorAll('*')) {
        const m = el.scrollHeight - el.clientHeight;
        if (m > 200 && /(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.clientHeight > 200) el.scrollTop = m * (max ? y / max : 0);
      }
      await sleep(200);
      if (y >= max) { await sleep(400); if (y >= maxOf()) break; } // settle, confirm no further growth
    }
    window.scrollTo(0, 0);
    document.querySelectorAll('*').forEach(el => { if (el.scrollHeight - el.clientHeight > 200) el.scrollTop = 0; });
    await sleep(500);
  }).catch(() => {});
}

// Dismiss cookie / subscribe / newsletter / paywall overlays before recording.
// Strategy per round: press Escape, click explicit selectors, click heuristic close
// controls (by aria-label / text / common class names), and as a last resort strip
// full-viewport fixed backdrops and restore scrolling. Runs across the main frame and
// any same-origin iframes (subscribe popups are often iframed), repeated a few times
// because some overlays mount in stages.
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
        // 1. Explicit, caller-supplied selectors.
        for (const sel of explicit) {
          for (const el of document.querySelectorAll(sel)) { if (isVisible(el)) { el.click(); closed++; } }
        }
        // 2. Heuristic close controls.
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
            if (closed > 6) break; // safety: don't go on a clicking spree
          }
        }
        // 3. Remove lingering full-viewport fixed/sticky backdrops and restore scroll.
        // Runs even after a close click, because some close buttons don't actually tear
        // the overlay down. Strict heuristics (covers most of the viewport, high z-index,
        // modal-ish class/id) keep this from touching real article content.
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
        // Always restore scrolling that overlays tend to lock.
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
