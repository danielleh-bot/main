// Recipe for the Explore-More tab-switch trigger flow.
//
// Full journey (one tab, simulated, ~12s):
//   1. Article + nudge (real speed so the reading is legible)
//   2. Tap nudge → /messenger (4× time-accelerated for chat + reel)
//   3. Watch chat bubbles + reel + chat-2 + tap "back to USA Today"
//   4. goBack to article + simulate hidden→visible visibilitychange
//   5. Scroll → trigger fires → vignette overlay slides up
//   6. Scroll INSIDE the overlay (showing more EM items)
//   7. Tap close → return to article
//
// The default export is invoked by record.mjs as `await fn(page, { duration })`.

const ARTICLE_PATH = "/explore-more/tab-switch";
const MESSENGER_PATH = "/messenger";
const MESSENGER_SPEEDUP = 2;

async function gentleScroll(page, totalMs, stepPx = 60) {
	const stepMs = 250;
	const steps = Math.floor(totalMs / stepMs);
	for (let i = 0; i < steps; i++) {
		await page.evaluate(
			(px) => window.scrollBy({ top: px, behavior: "smooth" }),
			stepPx,
		);
		await page.waitForTimeout(stepMs);
	}
}

export default async function tabSwitchRecipe(page) {
	const origin = new URL(page.url()).origin;

	// Install init script that fast-forwards time ONLY on the messenger page.
	// Applies to all subsequent navigations on this page; checks pathname so it
	// no-ops on article and overlay phases.
	await page.addInitScript((speed) => {
		if (!location.pathname.startsWith("/messenger")) return;
		const realSetTimeout = window.setTimeout;
		const realSetInterval = window.setInterval;
		window.setTimeout = (fn, ms = 0, ...rest) =>
			realSetTimeout(fn, Math.max(1, Math.floor(ms / speed)), ...rest);
		window.setInterval = (fn, ms = 0, ...rest) =>
			realSetInterval(fn, Math.max(1, Math.floor(ms / speed)), ...rest);
		const realNow = Date.now.bind(Date);
		const startReal = realNow();
		Date.now = () => startReal + (realNow() - startReal) * speed;
	}, MESSENGER_SPEEDUP);

	// --- Phase 1: Article + nudge (real speed) ---
	console.log("  · Phase 1: article + nudge");
	await page.waitForTimeout(600); // first paint
	await gentleScroll(page, 2400, 70); // ~2.4s of reading
	// Nudge appears at 4s after mount; we've spent ~3s. Wait to see it.
	await page.waitForTimeout(1400);

	// --- Phase 2: Tap nudge → messenger (speedup kicks in via init script) ---
	console.log("  · Phase 2: tap nudge → messenger");
	await page.evaluate(() => {
		document.querySelectorAll('a[href="/messenger"]').forEach((a) => {
			a.target = "_self";
		});
	});
	const nudgeLink = await page.$('a[href="/messenger"]');
	if (!nudgeLink) throw new Error("Messenger nudge link not found");
	await nudgeLink.click();
	await page.waitForURL(`${origin}${MESSENGER_PATH}`, { timeout: 5000 });

	// --- Phase 3: Chat bubbles (4× speed) ---
	console.log("  · Phase 3: chat bubbles (sped up)");
	await page.waitForSelector('button:has-text("Click here to watch my story")', { timeout: 8000 });
	await page.waitForTimeout(400);

	// --- Phase 4: Reel (4× speed → ~2s) ---
	console.log("  · Phase 4: reel (sped up)");
	await page.click('button:has-text("Click here to watch my story")');
	await page.waitForSelector('button:has-text("back to USA Today")', { timeout: 15000 });
	await page.waitForTimeout(400);

	// --- Phase 5: Tap back, return to article ---
	console.log("  · Phase 5: back to article");
	await (await page.$('button:has-text("back to USA Today")')).click();
	await page.waitForURL(`${origin}${ARTICLE_PATH}`, { timeout: 5000 });
	await page.waitForLoadState("domcontentloaded");
	await page.waitForTimeout(400);

	// --- Phase 6: Simulate visibility return → engagement → trigger fires ---
	console.log("  · Phase 6: visibility events → trigger fires");
	await page.evaluate(() => {
		Object.defineProperty(document, "visibilityState", {
			configurable: true,
			get: () => "hidden",
		});
		document.dispatchEvent(new Event("visibilitychange"));
	});
	await page.waitForTimeout(120);
	await page.evaluate(() => {
		Object.defineProperty(document, "visibilityState", {
			configurable: true,
			get: () => "visible",
		});
		document.dispatchEvent(new Event("visibilitychange"));
	});
	await page.waitForTimeout(700); // past 600ms grace
	await page.evaluate(() => window.scrollBy({ top: 30, behavior: "smooth" }));

	// Wait for slide-up animation (380ms) + viewer-readable pause
	await page.waitForSelector('[role="dialog"]', { timeout: 3000 });
	await page.waitForTimeout(900);

	// --- Phase 7: Scroll inside the EM overlay ---
	console.log("  · Phase 7: scroll inside EM");
	for (let i = 0; i < 4; i++) {
		await page.evaluate(() => {
			const dialog = document.querySelector('[role="dialog"]');
			const card = dialog && dialog.firstElementChild;
			if (card) card.scrollBy({ top: 220, behavior: "smooth" });
		});
		await page.waitForTimeout(450);
	}
	await page.waitForTimeout(500);

	// --- Phase 8: Close EM ---
	console.log("  · Phase 8: close EM");
	await page.click('[role="dialog"] button[aria-label="Close"]');
	await page.waitForTimeout(900); // article re-revealed

	console.log("  · Done");
}
