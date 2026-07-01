#!/usr/bin/env node
/**
 * rec.mjs — one entry point for the creative recorder. Dispatches to record.mjs (GIF) or
 * record-mp4.mjs (MP4) based on --format, or inferred from the --out file extension.
 *
 * Usage:
 *   node rec.mjs <url-or-file> [--format gif|mp4] [--out name.ext] [...recorder flags]
 *
 * Format resolution (first match wins):
 *   1. --format gif|mp4
 *   2. extension of --out (.gif / .mp4)
 *   3. default: gif
 *
 * Everything except --format is passed straight through to the underlying recorder, so all
 * flags (--duration, --fps, --frame, --mobile, --selector, --crf, --colors, ...) work as
 * documented in record.mjs / record-mp4.mjs.
 *
 * Examples:
 *   node rec.mjs page.html                      -> page.gif (default)
 *   node rec.mjs page.html --format mp4         -> recording.mp4
 *   node rec.mjs page.html --out clip.mp4       -> clip.mp4 (format inferred)
 *   node rec.mjs https://site.com --out a.gif --duration 6 --mobile
 */
import { spawn } from 'node:child_process';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);

// Pull --format out of the args; leave everything else untouched for the recorder.
let format = null;
const passthrough = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--format') { format = (argv[i + 1] || '').toLowerCase(); i++; continue; }
  passthrough.push(argv[i]);
}

// Infer from --out extension when --format wasn't given.
if (!format) {
  const oi = passthrough.indexOf('--out');
  const out = oi >= 0 ? passthrough[oi + 1] : null;
  const ext = out ? extname(out).slice(1).toLowerCase() : '';
  if (ext === 'gif' || ext === 'mp4') format = ext;
}
format = format || 'gif';

if (format !== 'gif' && format !== 'mp4') {
  console.error(`Unknown --format "${format}". Use gif or mp4.`);
  process.exit(1);
}

const script = format === 'mp4' ? 'record-mp4.mjs' : 'record.mjs';
const child = spawn('node', [resolve(here, script), ...passthrough], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (e) => { console.error(e); process.exit(1); });
