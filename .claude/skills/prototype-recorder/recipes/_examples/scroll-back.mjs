// Recipe for the Explore-More scroll-back trigger flow.
//
// Flow (single-page, ~12s):
//   1. Article loads, gradual downward scroll
//   2. Pass 50% of doc height → UserTestingTaskPanel slides in (fixed bottom)
//   3. Pause so the task message is readable
//   4. Scroll back up — past the 40px threshold → trigger fires (200ms delay)
//   5. EM overlay slides up
//   6. Scroll inside the overlay
//   7. Tap close → return to article briefly

const ARTICLE_PATH = "/explore-more/scroll-back";

async function smoothScroll(page, totalSteps, perStepPx, stepMs = 220) {
	for (let i = 0; i < totalSteps; i++) {
		await page.evaluate(
			(px) => window.scrollBy({ top: px, behavior: "smooth" }),
			perStepPx,
		);
		await page.waitForTimeout(stepMs);
	}
}

export default async function scrollBackRecipe(page) {
	// --- Phase 1: Article + read scroll ---
	console.log("  · Phase 1: read scroll (down)");
	await page.waitForTimeout(700); // first paint settle

	// Scroll down gradually until we pass 50% of the doc, then a bit more.
	// The article is long; use 100px steps until passedHalf, then continue
	// briefly so the task panel definitely shows.
	const docH = await page.evaluate(
		() => document.documentElement.scrollHeight - window.innerHeight,
	);
	const halfwayY = Math.floor(docH * 0.5);

	// Phase A: get into the article (~3s)
	while (true) {
		await page.evaluate(() =>
			window.scrollBy({ top: 110, behavior: "smooth" }),
		);
		await page.waitForTimeout(180);
		const y = await page.evaluate(() => window.scrollY);
		if (y >= halfwayY + 80) break; // a little past 50% so the panel locks in
		if (y > docH - 50) break; // safety
	}

	// --- Phase 2: Task panel visible, pause to read ---
	console.log("  · Phase 2: task panel visible");
	await page.waitForSelector('aside[aria-label="Task instructions"]', { timeout: 3000 });
	await page.waitForTimeout(2000); // long enough to read the message

	// --- Phase 3: Scroll back up → trigger fires ---
	console.log("  · Phase 3: scroll back up → trigger fires");
	// Threshold is 40px from peak; we scroll up well past it for visual clarity.
	for (let i = 0; i < 4; i++) {
		await page.evaluate(() =>
			window.scrollBy({ top: -90, behavior: "smooth" }),
		);
		await page.waitForTimeout(220);
	}

	// --- Phase 4: EM overlay appears ---
	console.log("  · Phase 4: EM overlay slides up");
	await page.waitForSelector('[role="dialog"]', { timeout: 3000 });
	await page.waitForTimeout(900); // viewer-readable pause

	// --- Phase 5: Scroll inside the overlay ---
	console.log("  · Phase 5: scroll inside EM");
	for (let i = 0; i < 4; i++) {
		await page.evaluate(() => {
			const dialog = document.querySelector('[role="dialog"]');
			const card = dialog && dialog.firstElementChild;
			if (card) card.scrollBy({ top: 220, behavior: "smooth" });
		});
		await page.waitForTimeout(450);
	}
	await page.waitForTimeout(500);

	// --- Phase 6: Close EM ---
	console.log("  · Phase 6: close EM");
	await page.click('[role="dialog"] button[aria-label="Close"]');
	await page.waitForTimeout(900);

	console.log("  · Done");
}
