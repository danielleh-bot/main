# Recipe authoring cookbook

Reference patterns for writing `recipes/<name>.mjs` files. Each pattern is a tested snippet from real recipes. Compose, don't reinvent.

A recipe is an ES module exporting `default async (page, { duration }) => {...}` where `page` is a Playwright Page. The recipe owns the timeline of the recording — when to scroll, click, navigate, dispatch events.

Always start with `console.log("  · Phase N: ...")` calls to localize failures.

---

## Pattern 1 — Wait for a selector then act

```js
await page.waitForSelector('button:has-text("Continue")', { timeout: 5000 });
await page.click('button:has-text("Continue")');
```

Use Playwright's `:has-text("...")` for human-readable selectors. Falls back to `[aria-label="..."]` or CSS class as needed.

---

## Pattern 2 — Gentle smooth scroll

```js
async function smoothScroll(page, steps, perStepPx, stepMs = 220) {
  for (let i = 0; i < steps; i++) {
    await page.evaluate(px => window.scrollBy({ top: px, behavior: "smooth" }), perStepPx);
    await page.waitForTimeout(stepMs);
  }
}
```

Use small step sizes (60-110px) for slow reading-style scroll; larger (250+) for quick traversal.

---

## Pattern 3 — Scroll inside a modal/dialog

`window.scrollBy` won't move dialog content. Find the dialog's scroll container:

```js
await page.evaluate(() => {
  const dialog = document.querySelector('[role="dialog"]');
  const card = dialog && dialog.firstElementChild;
  if (card) card.scrollBy({ top: 220, behavior: "smooth" });
});
```

Adjust selector if the project uses a different dialog convention.

---

## Pattern 4 — Force same-tab navigation on `target=_blank` links

When a link opens in a new tab and you need to record both screens in one recording:

```js
await page.evaluate(() => {
  document.querySelectorAll('a[href="/messenger"]').forEach(a => { a.target = "_self"; });
});
await page.click('a[href="/messenger"]');
```

---

## Pattern 5 — Time-acceleration on a specific page

For app-side animations with hardcoded delays (chat bubbles, timed videos, multi-step intros), inject before navigation. The `addInitScript` runs on every page document creation; gate by pathname:

```js
await page.addInitScript((speed) => {
  if (!location.pathname.startsWith("/messenger")) return;
  const realSetTimeout = window.setTimeout;
  const realSetInterval = window.setInterval;
  window.setTimeout  = (fn, ms = 0, ...rest) => realSetTimeout(fn,  Math.max(1, Math.floor(ms / speed)), ...rest);
  window.setInterval = (fn, ms = 0, ...rest) => realSetInterval(fn, Math.max(1, Math.floor(ms / speed)), ...rest);
  const realNow = Date.now.bind(Date);
  const start = realNow();
  Date.now = () => start + (realNow() - start) * speed;
}, 2);  // 2× speed
```

Speed range: 1.5× = barely faster, 4× = blur. 2-3× is the sweet spot for chat-style animations.

`Date.now` override is required for code that uses `(Date.now() - start) / DURATION` for progress (e.g. video timers).

---

## Pattern 6 — Simulate visibilitychange (tab focus)

For triggers that respond to tab switching:

```js
await page.evaluate(() => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
  document.dispatchEvent(new Event("visibilitychange"));
});
await page.waitForTimeout(120);
await page.evaluate(() => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  document.dispatchEvent(new Event("visibilitychange"));
});
```

---

## Pattern 7 — Wait for a specific URL after navigation

```js
await page.waitForURL(`${origin}${TARGET_PATH}`, { timeout: 5000 });
await page.waitForLoadState("domcontentloaded");
await page.waitForTimeout(400); // settle
```

---

## Pattern 8 — Detect the dev server origin from the loaded page

```js
const origin = new URL(page.url()).origin;
```

Avoid hardcoding `http://localhost:3030` — recipes should work against Vercel URLs too.

---

## Pattern 9 — Targeted scroll until a condition is met

For scroll-driven triggers that need to pass a percentage threshold:

```js
const docH = await page.evaluate(
  () => document.documentElement.scrollHeight - window.innerHeight,
);
const targetY = Math.floor(docH * 0.5);
while (true) {
  await page.evaluate(() => window.scrollBy({ top: 110, behavior: "smooth" }));
  await page.waitForTimeout(180);
  const y = await page.evaluate(() => window.scrollY);
  if (y >= targetY + 80) break;
  if (y > docH - 50) break; // safety: hit the bottom
}
```

---

## Pattern 10 — Visible pause for the viewer

After significant state changes, leave the new state on screen long enough to read:
- Toast or notification appears: 1.4-2s
- New page or major view change: 0.7-1s
- Modal opens: 0.9-1.2s (after the slide-up animation completes)
- End-of-recording final state: 0.9-1.5s

Don't be stingy — gif viewers can't pause/scrub; if a moment isn't held, it's missed.

---

## Pattern 11 — Figma prototypes (canvas-based, no DOM selectors)

Figma renders the prototype into a single `<canvas>` element. DOM selectors like `button:has-text("Continue")` cannot find anything inside the design. Three working approaches:

**A. Keyboard navigation (simplest, when the flow is linear).** In Present mode, arrow keys / spacebar advance through frames:

```js
await page.waitForSelector('canvas', { timeout: 10000 });
await page.waitForTimeout(800); // mount + first paint settle

for (let i = 0; i < 5; i++) {
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(1500); // hold each frame
}
```

**B. Coordinate clicks (when you need to hit a specific hotspot).** Read coordinates off the design in Figma DevTools (right panel → position) — they're relative to the prototype's frame, not the page. Multiply by device pixel ratio if needed.

```js
// Click "Continue" hotspot at frame coords (172, 540) in a 393-wide design
await page.mouse.click(172, 540);
await page.waitForTimeout(1200);
```

If the prototype is centered/zoomed, compute the offset from the canvas bounds:

```js
const box = await page.locator('canvas').boundingBox();
await page.mouse.click(box.x + frameX, box.y + frameY);
```

**C. URL transform — always do this first.** Strip Figma's UI and lock to fullscreen so the recording shows the design only. Easiest path: pass the cleaned URL to `run.sh --url ...`, no recipe code needed.

```js
// In a recipe, before/instead of navigation:
const cleanFigmaUrl = (url) => {
  const u = new URL(url);
  u.searchParams.set("fullscreen", "1");
  u.searchParams.set("hide-ui", "1");
  u.searchParams.set("scaling", "scale-down");
  return u.toString();
};
```

**Auth gotcha:** Playwright runs in a clean Chromium with no Figma session. Public ("Anyone with the link can view") prototypes work; private ones show a login wall. Either flip the share setting, or set up a `storageState.json` from a logged-in session (helper not yet built).

**Mobile preview note:** Figma's mobile preview frame is a fixed-size design (e.g. 393×852) regardless of what device the page loads on. So `--device "iPhone 14 Pro"` is mostly cosmetic for Figma — the recorded content is the design at its authored frame width. Pick the device that matches the design's frame width to avoid double letterboxing.

---

## Anti-patterns

- **Don't use `setTimeout` instead of `page.waitForTimeout`.** The former runs in Node; the latter in the browser context. They're both fine for waiting, but `page.waitForTimeout` is the convention and integrates better with Playwright's tracing.
- **Don't hardcode pixel scroll amounts that depend on viewport.** Use viewport-relative or percentage-based math.
- **Don't skip `console.log` phase boundaries.** They're the only debugging signal when a recipe fails.
- **Don't chain too many phases without pauses.** A 30-second-of-action recipe makes a heavy gif. If the flow is genuinely long, use Pattern 5 (time-acceleration) on the slowest parts.
