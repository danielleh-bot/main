#!/usr/bin/env node
// Record a webpage at a mobile viewport and write recording.webm + load.json.
//
// Usage:
//   node record.mjs --url <url> --out <dir> [--device "iPhone 14 Pro"]
//                   [--duration 5000] [--interaction scroll | --click <sel> | --js-file <path>]

import { chromium, devices } from "playwright";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

function parseArgs(argv) {
	const out = {};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (!a.startsWith("--")) continue;
		const key = a.slice(2);
		const next = argv[i + 1];
		if (!next || next.startsWith("--")) {
			out[key] = true;
		} else {
			out[key] = next;
			i++;
		}
	}
	return out;
}

const args = parseArgs(process.argv.slice(2));
const targetUrl = args.url;
const outDir = args.out;
const deviceName = args.device || "iPhone 14 Pro";
const durationMs = parseInt(args.duration || "5000", 10);

if (!targetUrl || !outDir) {
	console.error(
		"Usage: node record.mjs --url <url> --out <dir> [--device <name>] [--viewport WxH] [--duration <ms>] [--interaction scroll | --click <sel> | --js-file <path>]",
	);
	process.exit(1);
}

const deviceConfig = devices[deviceName];
if (!deviceConfig) {
	console.error(`Unknown device: "${deviceName}".`);
	console.error(
		`Examples: ${Object.keys(devices).filter((d) => d.includes("iPhone") || d.includes("Pixel")).slice(0, 8).join(", ")}`,
	);
	process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

// Playwright's recordVideo.size does NOT super-sample — if it's larger than
// the viewport, Playwright pads with black instead of upscaling. So we record
// at viewport size 1:1 and rely on a sufficiently large viewport for sharpness.
//
// For desktop UIs, the Playwright "Desktop Chrome" default of 1280×720 is
// cramped for modern dashboards. Pass --viewport 1440x900 (or any WxH) to
// override the device viewport.
let viewport = deviceConfig.viewport;
if (args.viewport) {
	const m = String(args.viewport).match(/^(\d+)\s*[xX×]\s*(\d+)$/);
	if (!m) {
		console.error(`Invalid --viewport "${args.viewport}". Use format: 1440x900`);
		process.exit(1);
	}
	viewport = { width: parseInt(m[1], 10), height: parseInt(m[2], 10) };
}

const browser = await chromium.launch();
const context = await browser.newContext({
	...deviceConfig,
	viewport,
	recordVideo: {
		dir: outDir,
		size: { width: viewport.width, height: viewport.height },
	},
});
const page = await context.newPage();

const startTs = Date.now();
console.log(`→ Loading ${targetUrl} on ${deviceName}...`);
await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
const loadedAtMs = Date.now() - startTs;
console.log(`→ DOM loaded after ${loadedAtMs}ms`);

// Brief settle for fonts / first paint
await page.waitForTimeout(500);

// Optional interaction
if (args.interaction === "scroll") {
	console.log("→ Interaction: scroll");
	const total = durationMs;
	const steps = 20;
	const stepMs = Math.floor(total / steps);
	for (let i = 0; i < steps; i++) {
		await page.evaluate(
			(stepPx) => window.scrollBy({ top: stepPx, behavior: "smooth" }),
			Math.floor(deviceConfig.viewport.height / 4),
		);
		await page.waitForTimeout(stepMs);
	}
} else if (args.click) {
	console.log(`→ Interaction: click "${args.click}"`);
	await page.waitForSelector(args.click, { timeout: 5000 });
	await page.click(args.click);
	await page.waitForTimeout(durationMs);
} else if (args["js-file"]) {
	const abs = path.resolve(args["js-file"]);
	console.log(`→ Interaction: custom JS from ${abs}`);
	const mod = await import(url.pathToFileURL(abs).href);
	if (typeof mod.default !== "function") {
		console.error("Custom JS file must export a default async function (page) => {...}");
		process.exit(1);
	}
	await mod.default(page, { duration: durationMs });
} else {
	console.log(`→ Recording for ${durationMs}ms (no interaction)...`);
	await page.waitForTimeout(durationMs);
}

await context.close();
await browser.close();

// Find produced video and rename
const produced = fs.readdirSync(outDir).filter((f) => f.endsWith(".webm"));
if (produced.length === 0) {
	console.error("No .webm produced — Playwright may have failed silently.");
	process.exit(1);
}
const finalPath = path.join(outDir, "recording.webm");
fs.renameSync(path.join(outDir, produced[0]), finalPath);

// Write load metadata for the converter
fs.writeFileSync(
	path.join(outDir, "load.json"),
	JSON.stringify({ loadedAtMs, durationMs, device: deviceName, url: targetUrl }, null, 2),
);

const stats = fs.statSync(finalPath);
console.log(`✓ Recording → ${finalPath} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
