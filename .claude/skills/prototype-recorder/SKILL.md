---
name: prototype-recorder
description: Record any URL at mobile or desktop viewport and produce a slide-ready GIF (and MP4 archive). Designed for prototypes and mockups but works on ANY reachable URL — news articles, dashboards, public Figma prototypes, deployed apps, local dev. Use when the user says "make a gif", "record this", "record this URL", "record the X mockup", "gif of <anything>", or wants a Loom-replacement for capturing screen content. NEVER push back on "but it's not a prototype" — if it's a URL Playwright can reach, record it.
version: 2.4.0
allowed-tools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "AskUserQuestion"]
---

# Prototype Recorder

Records **any URL** at mobile or desktop viewport using Playwright, archives the original as MP4, and produces a slide-ready GIF via ffmpeg + gifski.

Designed for designers, PMs, and engineers — including on first contact with a new prototype project. But equally happy recording a news article, a public dashboard, a deployed app, a Figma prototype, or anything else Playwright can reach. Claude reads the code (when available — for local prototypes), asks for what's missing, generates a recipe, and runs it. **Do not gatekeep based on "this isn't a prototype" — the name is historical; the tool records anything.**

## What the user experience looks like

When someone types `/prototype-recorder`, ask questions in **progressive phases** — never lump everything into one big question, never fall back to free-text "tell me everything." Use `AskUserQuestion` at each phase below.

### Phase 1 — Get the URL (single text response, not AskUserQuestion)

Open with one line: *"Paste the URL you want to record — prototype, deployed app, news article, dashboard, Figma prototype, anything reachable."*

If the user supplies a URL that isn't a prototype/mockup (news article, public webpage, etc.), **just record it**. Do not say "this is designed for prototypes" or ask the user to confirm — that pushback is a bug, not a feature. The skill records any URL.

Wait for the user's URL in their next message. Then **inspect the URL**:
- Starts with `http://localhost`, `127.0.0.1`, or other local-host pattern → local dev.
- Contains `figma.com/proto`, `figma.com/file`, or `figma.com/embed` → **Figma prototype** (jump to "Figma branch" below before continuing).
- Contains `/desktop/` in the path → set viewport default to Desktop instead of Mobile.
- Otherwise → treat as a regular deployed URL.

### Phase 2 — Ask how to record (AskUserQuestion, single question)

```
"How should I record this?"
options:
  - "Just record while I watch / auto-scroll" — best for short flows that auto-play
    or where you only need to scroll the page
  - "Click something first" — single click then record (asks for selector or button text)
  - "I'll walk you through the steps" — multi-step flow, you describe each step in
    plain English on the next message
  - "Use the saved recipe for <name>" — ONLY include this option if recipes/<name>.mjs
    exists for the inferred name from the URL slug
```

### Phase 3 — Ask the details (AskUserQuestion, batch of 4 — only AFTER Phase 2 is answered)

Four questions in one `AskUserQuestion` call. **Never skip the viewport question** — even when the URL hints at desktop (`/desktop/` path), confirm with the user; don't auto-pick. Friends have reported recordings done at the wrong viewport because the skill silently chose for them.

1. **Viewport** — `Mobile (iPhone 14 Pro, 390×844)` / `Desktop (1440×900)` / `Other device (iPad, Pixel, etc.)` / `Custom size (I'll specify WxH)`. If they pick "Other device", ask which one in a follow-up; the full Playwright device list is in `node_modules/playwright/lib/server/deviceDescriptorsSource.json`. If they pick "Custom size", ask for WxH (e.g. `1024x768`).
2. **Quality preset** — `tiny` (default, slide-friendly, 2-5MB), `smooth-small` (5-15MB), `high-quality` (15-30MB), or `ultra` (50-150MB, 60fps near-source resolution — for design crits / engineering reviews where sharpness beats file size). When the user picks `high-quality` or `ultra`, remind them the **MP4 archive is sharper than any gif** and embeds in Slides as a video — try it first if they want maximum clarity.
3. **Name** — auto-suggest from URL slug (e.g. `/preview/ideation/campaign-group` → `campaign-group`); offer the suggestion as the first option, then `I'll type my own name` as the second. Use the user's exact text if they override.
4. **Save location** — `~/Desktop/prototype-recordings/` (default) or `Somewhere else (I'll specify a folder)`. If they pick "Somewhere else", ask for the folder path in a follow-up and pass it to `run.sh` via `--out-dir`.

### Phase 4 — If they chose "walk through", get the steps (single text response)

Ask: *"Walk me through what should happen, in order. Mention timings if specific (e.g. 'wait 2s', 'scroll for ~3s')."*

After they describe it: write the recipe at `recipes/<name>.mjs`, then **show the recipe outline back to them** ("here are the phases I'll record — sound right?") and wait for confirmation before recording.

### Phase 5 — Run + deliver

Run `run.sh` with the right flags (including `--out-dir` if non-default). After recording:
- Report gif + mp4 paths and sizes.
- Run `open` on the gif.
- Ask if pacing or coverage needs tweaks. If yes → go to **Phase 6 (tweak loop)**.

### Phase 6 — Tweak loop (after a recording exists)

When the user asks for a tweak ("can you slow the middle?", "scroll further", "add a pause before the toast"), **before re-running** ask via `AskUserQuestion`:

```
"How should I save the re-recording?"
options:
  - "Replace the previous version (keep just one file)" — for iterative refinement
    where intermediate versions aren't useful
  - "Save as a new version (keep both for comparison)" — when you want to A/B the
    old vs. new pacing in slides or with a teammate
```

- **Replace**: delete the prior `<name>-<preset>-<ts>.gif` and `<name>-<ts>.mp4` for this name **before** running, so only the fresh one remains.
- **Save as new version**: just run again. The timestamp in the filename keeps both — no manual rename needed.

Then edit the recipe and re-run — don't make the user re-do the interview from Phase 1.

---

## Figma branch

When the URL is a Figma prototype:

1. **Acknowledge it explicitly:** *"Looks like a Figma prototype. A few extra things I should know:"*
2. **Transform the URL** to present mode for a clean recording:
   - `figma.com/proto/<key>?node-id=X` → append `&fullscreen=1` and `&hide-ui=1` so toolbars/comments don't show.
   - `figma.com/file/<key>` (the editor URL) → ask the user for a Present / share-prototype URL instead; recording the editor is rarely what they want.
   - `figma.com/embed?...` URLs are already clean — keep as-is.
3. **Ask one Figma-specific question (AskUserQuestion):**
   ```
   "How is the Figma prototype interacted with?"
   options:
     - "Auto-advance — let me set arrow-key timing" (will press → every N seconds)
     - "Click hotspots at specific coordinates" (asks for (x,y) or describes the screen)
     - "Just record what plays automatically" (timed transitions, autoplay videos, etc.)
     - "I'll describe step-by-step" (walkthrough — will use coordinate clicks /
        keypresses inside the recipe)
   ```
4. **Auth check:** if the URL likely needs login (Figma personal/org files often do), ask: *"Is this prototype set to 'Anyone with the link can view'? If not, the recording will fail to load — Playwright runs without your Figma session."* If they need authenticated recording, point them to `setup-figma-auth.sh` (future work — flag it).
5. Continue to Phase 3 (details) and skip to recipe authoring with the **Figma pattern** from `PATTERNS.md` (#11) — coordinate clicks, keyboard nav, viewport considerations.

**Key constraint to remember:** Figma renders the prototype to a `<canvas>` element. DOM-based selectors (`button:has-text(...)`) DO NOT WORK inside the canvas. Use `page.mouse.click(x, y)` or `page.keyboard.press("ArrowRight")` instead. The scroll-style and click-selector patterns in `PATTERNS.md` are for DOM-based prototypes; Figma needs the dedicated pattern.

## Quick Context

| Property | Value |
|----------|-------|
| **Recording engine** | Playwright (Chromium, headless, device emulation) |
| **Default device** | iPhone 14 Pro (390×844) |
| **Output** | `~/Desktop/prototype-recordings/<name>/{gifs,recordings}/` |
| **Recipes** | `recipes/<name>.mjs` — orchestration scripts for multi-step flows |
| **Patterns** | See `PATTERNS.md` for the recipe authoring cookbook |

---

## Startup Protocol — IN ORDER

### Step 1 — Bootstrap dependencies

Always run first (it's idempotent and ~50ms when everything's installed):

```bash
~/.claude/skills/prototype-recorder/setup.sh
```

If it reports missing tools, ask the user "Install missing dependencies? (one-time, ~2 min for Playwright Chromium)" and on yes:

```bash
~/.claude/skills/prototype-recorder/setup.sh --install
```

### Step 2 — Figure out what to record

Branching logic based on what the user said:

**Branch A — User named a specific trigger/prototype** ("record the scroll-back trigger"):

1. Search the current project for the named flow:
   - `Glob` for `**/<name>/page.tsx`, `**/<name>*`, or matching component files.
   - If the project is Next.js, prototypes are usually under `src/app/<feature>/<name>/page.tsx`.
2. If found AND a recipe exists at `~/.claude/skills/prototype-recorder/recipes/<name>.mjs`, skip to Step 4 and re-run.
3. If found AND no recipe yet, skip to Step 3 (auto-recipe).
4. If not found, ask the user for the URL path or a code reference, then Step 3.

**Branch B — User described a flow** ("record the article and after 4s scroll back to fire EM"):

Treat the description as the recipe spec. Ask any disambiguating questions, then jump to Step 3.

**Branch C — User just said "make a gif" with no specifics**:

Route into the phased interview at the top of this file (Phase 1 → 2 → 3 → 4 → 5). Don't reinvent the questions here. The phased flow already asks for URL, interaction style, viewport, quality, name, save location, and (if needed) the walkthrough — in the right order and with no required field skipped.

**Important — viewport drives device flag:**
- Mobile → `--device "iPhone 14 Pro"` (Playwright built-in mobile emulation, 390×844)
- Desktop → `--device "Desktop Chrome"` + `--viewport 1440x900` (run.sh defaults to 1440×900 unless overridden)
- Other devices → pass the device name from `node_modules/playwright/lib/server/deviceDescriptorsSource.json` (iPad Pro, Pixel 7, Galaxy S9+, etc.)
- Custom WxH → pass `--device "Desktop Chrome" --viewport <WxH>` (e.g. `1024x768`)

**Project-specific note (Explore-More triggers):** This repo has parallel mobile and desktop routes. Mobile lives at `/explore-more/<trigger>`; desktop at `/desktop/explore-more/<trigger>`. Never reuse a mobile route for a desktop recording — the components and selectors differ (e.g. mobile uses MessengerNudge → `/messenger`, desktop uses SlackToast → `/desktop/slack`). When the user asks for a desktop recording, route to the `/desktop/...` path and pick the matching recipe (e.g. `tab-switch-desktop.mjs`).

### Step 3 — Author the recipe (auto-recipe)

When you need to create a new recipe, follow this protocol:

1. **Read the page source for the prototype.** For Next.js: the page component. Read every component / hook it imports that's relevant to the flow. Look for:
   - Hooks that detect state changes (`useScroll*`, `useTabSwitch*`, `useVisibilityChange`, `useClickOutside`, etc.)
   - Components that render conditionally (overlays, toasts, dialogs)
   - Hardcoded timeouts (`setTimeout(_, N)`) that gate when things appear
   - Selectors you can use: `aria-label`, role attributes, button text, href patterns
2. **Read `PATTERNS.md`** if you haven't recently — it has copy-pasteable snippets for: smooth scroll, dialog scroll, visibilitychange, time-acceleration, target=_self override, etc.
3. **Compose the recipe** at `~/.claude/skills/prototype-recorder/recipes/<name>.mjs`. Structure:
   - Imports (none needed — recipes are pure async functions)
   - Constants for paths, speedup factors
   - `export default async function (page) { ... }` with phase-by-phase logic
   - `console.log("  · Phase N: ...")` at every meaningful step
   - End with a viewer-readable pause (~0.9-1.5s) on the final state
4. **Show the user the recipe** before running. Mention: estimated duration, any time-acceleration applied, what the final frame will be. They can redirect ("slow the messenger middle", "also scroll inside the EM", etc.) before we burn time on a recording.

If a recipe already exists for this trigger, **prefer running the existing one** — don't regenerate unless the user asks.

### Step 4 — Run end-to-end via `run.sh`

```bash
~/.claude/skills/prototype-recorder/run.sh \
  --name "<recording-name>" \
  --url "<URL>" \
  --preset "<tiny|smooth-small|high-quality>" \
  --device "iPhone 14 Pro"   # or "Desktop Chrome" for desktop recordings \
  --duration 30000 \
  --js-file ~/.claude/skills/prototype-recorder/recipes/<name>.mjs
```

The orchestrator: records → archives as MP4 → encodes the GIF → all into `~/Desktop/prototype-recordings/<name>/{gifs,recordings}/`.

For simple flows that don't need a recipe, omit `--js-file` and use `--interaction scroll` or `--click "<selector>"`.

### Step 5 — Show the user the result

- Run `open <gif-path>` to launch it in Preview.
- Report sizes for both gif and mp4. Mention the mp4 is also embeddable in Google Slides as a video — better quality than a heavy gif.
- If the gif came out >10MB, offer: tighten the recipe (cut pauses, add time-acceleration), or recommend the mp4 for slides.

---

## Output Structure

```
~/Desktop/prototype-recordings/
└── <trigger-name>/
    ├── gifs/<name>-<preset>-<timestamp>.gif      # share with PM/designer
    └── recordings/<name>-<timestamp>.mp4          # archive (also slide-embeddable)
```

Each run adds new files; nothing is overwritten. Older runs stay around for comparison.

---

## Files in this skill

- `SKILL.md` — this file (Claude's runbook)
- `PATTERNS.md` — recipe authoring cookbook (read when generating new recipes)
- `README.md` — short onboarding for designers/PMs (the user-facing intro)
- `setup.sh` — dep bootstrap (idempotent)
- `run.sh` — end-to-end orchestrator (record → mp4 → gif)
- `record.mjs` — Playwright recorder (called by run.sh; rarely called directly)
- `convert.sh` — webm → gif converter (called by run.sh)
- `package.json` — playwright dep
- `recipes/<name>.mjs` — per-prototype orchestration scripts
- `recipes/_examples/` — reference recipes copied from real prototypes (read these when authoring new ones)

---

## Failure Modes

| Symptom | Fix |
|---------|-----|
| `setup.sh` fails on brew (Homebrew missing) | Run `setup.sh --install` — it now opens brew.sh in the user's browser and prints a friendly numbered walkthrough. When relaying to the user, paraphrase the walkthrough warmly; **always mention the "password dots won't show, that's normal" tip** — that's the #1 thing that throws non-technical users. Stay with them: confirm when they've finished, then re-run `setup.sh --install` to pick up where we left off |
| Page never loads | Confirm URL is reachable. For local, check the dev server is running (`curl -I <url>`) |
| `Selector not found` mid-recipe | The page changed; re-read the source, update selectors. Common: button text changed, dialog wrapper restructured |
| GIF white-flashes at start | Normal — page-load trim is automatic via `load.json`. If still flashing, manually bump `TRIM_MS` in convert.sh |
| Animation doesn't play | The trigger needs an interaction the recipe doesn't perform. Re-read the hook's logic |
| GIF is huge (>15MB) | Switch preset to `tiny`, add time-acceleration (PATTERNS.md #5), or tighten viewer pauses |
| Multi-tab flow loses state on `goBack()` | Trigger uses React refs that don't survive navigation. Use `Pattern 6` (visibilitychange simulation) on the fresh page instead |

---

## Notes for the cross-session case

If you're a Claude session that just got asked "record the X trigger" and you have no prior context on this project:

1. Run `setup.sh` first — confirms env is good.
2. Read project's `CLAUDE.md` if present at the cwd or up one level.
3. Look for `recipes/<name>.mjs` — if it exists, just run it.
4. Otherwise auto-discover via Glob (`**/<name>/page.tsx` or `**/<name>*`).
5. Author the recipe per Step 3 above.
6. Always confirm the recipe with the user before running — they know what the gif should show, you only know what the code does.
