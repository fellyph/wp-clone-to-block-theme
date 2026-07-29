#!/usr/bin/env node
/**
 * check-motion-manifest.js — assert the invariants of a scroll recording.
 *
 * This is the Tier-1 gate of references/pipeline-test.md: it is the one command
 * that says whether `scripts/record-scroll.js` produced a usable capture, so the
 * expensive downstream steps are not run on a broken recording.
 *
 * Usage:
 *   node scripts/check-motion-manifest.js ./clones/<slug>/.capture/motion
 *
 * Exit codes: 0 all invariants hold | 1 one or more failed | 2 bad usage
 */
'use strict';

const fs = require('fs');
const path = require('path');

const motionDir = path.resolve(process.argv[2] || '');
if (!process.argv[2] || !fs.existsSync(motionDir)) {
  process.stderr.write('Usage: node scripts/check-motion-manifest.js <motion-dir>\n');
  process.exit(2);
}

const errors = [];
const warnings = [];
const fail = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

const manifestPath = path.join(motionDir, 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  process.stderr.write(`FAIL: no manifest.json in ${motionDir}\n`);
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
} catch (e) {
  process.stderr.write(`FAIL: manifest.json is not valid JSON: ${e.message}\n`);
  process.exit(1);
}

const steps = Array.isArray(manifest.steps) ? manifest.steps : [];
const vw = manifest.viewport && manifest.viewport.width;
const vh = manifest.viewport && manifest.viewport.height;

// --- step count -------------------------------------------------------------
if (steps.length === 0) fail('no steps recorded');
if (steps.length > 0 && steps.length < 3) {
  warn(`only ${steps.length} steps — expected more unless the page is a single screen`);
}

// --- scroll monotonicity ----------------------------------------------------
for (let i = 1; i < steps.length; i++) {
  if (steps[i].scrollY < steps[i - 1].scrollY) {
    fail(`scrollY went backwards at step ${i}: ${steps[i - 1].scrollY} → ${steps[i].scrollY}`);
  }
}

// --- page height growth is monotonic, and the pass reached the bottom --------
for (let i = 1; i < steps.length; i++) {
  if (typeof steps[i].pageHeightAtStep === 'number' && steps[i].pageHeightAtStep < steps[i - 1].pageHeightAtStep) {
    fail(`pageHeightAtStep shrank at step ${i}: ${steps[i - 1].pageHeightAtStep} → ${steps[i].pageHeightAtStep}`);
  }
}
const last = steps[steps.length - 1];
if (last && typeof last.pageHeightAtStep === 'number' && vh) {
  const reached = last.scrollY + vh;
  if (reached < last.pageHeightAtStep - 2) {
    fail(`scroll pass stopped ${Math.round(last.pageHeightAtStep - reached)}px short of the bottom (scrollY ${last.scrollY} + ${vh} < pageHeight ${last.pageHeightAtStep}) — raise --max-steps/--budget-ms`);
  }
}

// --- settled frames exist, one per step, at the right size ------------------
const settledDir = path.join(motionDir, 'settled');
const onDisk = fs.existsSync(settledDir)
  ? fs.readdirSync(settledDir).filter((f) => f.endsWith('.png'))
  : [];
if (onDisk.length !== steps.length) {
  fail(`settled/ has ${onDisk.length} PNGs but the manifest records ${steps.length} steps`);
}
for (const step of steps) {
  if (!step.settledFrame) {
    fail(`step ${step.stepIndex} has no settledFrame`);
    continue;
  }
  const p = path.join(motionDir, step.settledFrame);
  if (!fs.existsSync(p)) {
    fail(`step ${step.stepIndex} points at a missing frame: ${step.settledFrame}`);
    continue;
  }
  const dim = pngSize(p);
  if (!dim) {
    fail(`step ${step.stepIndex}: ${step.settledFrame} is not a readable PNG`);
  } else if (vw && vh && (dim.width !== vw || dim.height !== vh)) {
    // A frame that is not exactly the viewport means it came from a re-encoded
    // or letterboxed source rather than a direct page.screenshot().
    fail(`step ${step.stepIndex}: ${step.settledFrame} is ${dim.width}x${dim.height}, expected ${vw}x${vh}`);
  }
}

// --- settle quality ---------------------------------------------------------
const unsettled = steps.filter((s) => s.settled === false).length;
if (steps.length && unsettled / steps.length > 0.3) {
  warn(`${unsettled}/${steps.length} steps never settled — captured styles may be mid-animation`);
}

// --- motion detection -------------------------------------------------------
if (manifest.hasMotion === false) {
  warn('hasMotion is false — if the source visibly animates, widen the reveal-marker list in record-scroll.js censusInPage()');
}

// --- banner -----------------------------------------------------------------
if (manifest.bannerDismissal && !manifest.bannerDismissal.clicked) {
  warn(`no banner dismissed (${manifest.bannerDismissal.reason}) — confirm settled frames match desktop.png chrome`);
}

/** Read width/height from a PNG IHDR without pulling in a decoder. */
function pngSize(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(24);
    if (fs.readSync(fd, buf, 0, 24, 0) < 24) return null;
    if (buf.toString('ascii', 1, 4) !== 'PNG') return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  } catch (e) {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

for (const w of warnings) console.warn(`WARN  ${w}`);
for (const e of errors) console.error(`FAIL  ${e}`);

if (errors.length) {
  console.error(`\nMotion manifest check failed: ${errors.length} error(s), ${warnings.length} warning(s).`);
  process.exit(1);
}
console.log(
  `Motion manifest OK: ${steps.length} steps, ${onDisk.length} settled frames at ${vw}x${vh}, ` +
  `hasMotion=${manifest.hasMotion}, ${warnings.length} warning(s).`
);
