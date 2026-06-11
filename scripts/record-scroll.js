#!/usr/bin/env node
/**
 * record-scroll.js — record a smooth scroll pass of a page with Playwright,
 * extract frames with ffmpeg, and write a manifest of scroll steps + an
 * animation census so a cloning skill can reason about motion.
 *
 * Usage:
 *   node record-scroll.js <url> <outDir> [--width 1440] [--height 900] [--fps 2]
 *
 * Exit codes: 0 ok | 1 fatal | 2 playwright missing | 3 partial (no ffmpeg)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

function parseArgs(argv) {
  const args = { width: 1440, height: 900, fps: 2 };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--width') args.width = parseInt(argv[++i], 10);
    else if (a === '--height') args.height = parseInt(argv[++i], 10);
    else if (a === '--fps') args.fps = parseFloat(argv[++i]);
    else positional.push(a);
  }
  args.url = positional[0];
  args.outDir = positional[1];
  return args;
}

function loadPlaywright() {
  // Resolve relative to this script first, then the caller's cwd (so the
  // skill can install playwright in the project being worked on).
  const attempts = [
    () => require('playwright'),
    () => require(require.resolve('playwright', { paths: [process.cwd()] })),
  ];
  for (const attempt of attempts) {
    try {
      return attempt();
    } catch (e) { /* try next */ }
  }
  process.stderr.write('Playwright not installed. Run: npm i playwright && npx playwright install chromium\n');
  process.exit(2);
}

function hasCommand(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'ignore' });
  return !r.error && r.status === 0;
}

function log(msg) {
  console.log(`[record-scroll] ${msg}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- in-page fns

function censusInPage() {
  const shortSelector = (el) => {
    if (!el || !el.tagName) return null;
    const tag = el.tagName.toLowerCase();
    const cls = el.classList && el.classList[0] ? `.${el.classList[0]}` : '';
    return tag + cls;
  };
  const animations = document.getAnimations().map((a) => {
    const timing = a.effect ? a.effect.getTiming() : {};
    return {
      name: a.animationName || a.transitionProperty || a.id || null,
      duration: timing.duration || 0,
      iterations: timing.iterations === Infinity ? 'infinite' : timing.iterations,
      playState: a.playState,
      target: shortSelector(a.effect && a.effect.target),
    };
  });
  const markers = ['[data-aos]', '.wow', '[data-scroll]', '[data-sr-id]', '[data-motion-enter]', '[data-anim]'];
  const revealMarkers = {};
  for (const sel of markers) {
    const n = document.querySelectorAll(sel).length;
    if (n > 0) revealMarkers[sel] = n;
  }
  return {
    animations,
    revealMarkers,
    pageHeight: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
    viewportHeight: window.innerHeight,
  };
}

function settleInPage(timeoutMs) {
  return new Promise((resolve) => {
    const start = performance.now();
    const finiteRunning = () =>
      document.getAnimations().filter(
        (a) => a.playState === 'running' && a.effect && a.effect.getTiming().iterations !== Infinity
      ).length;
    const infiniteRunning = () =>
      document.getAnimations().filter(
        (a) => a.playState === 'running' && a.effect && a.effect.getTiming().iterations === Infinity
      ).length;
    const tick = () => {
      if (finiteRunning() === 0) {
        resolve({ settled: true, activeInfiniteAnimations: infiniteRunning() });
      } else if (performance.now() - start > timeoutMs) {
        resolve({ settled: false, activeInfiniteAnimations: infiniteRunning() });
      } else {
        requestAnimationFrame(tick);
      }
    };
    tick();
  });
}

// --------------------------------------------------------------------- ffmpeg

function probeDuration(videoPath) {
  if (!hasCommand('ffprobe', ['-version'])) return null;
  try {
    const out = execFileSync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', videoPath,
    ]).toString().trim();
    const d = parseFloat(out);
    return Number.isFinite(d) ? d : null;
  } catch (e) {
    return null;
  }
}

function extractFrames(videoPath, outDir, fps, steps, notes, wallClockMs) {
  const framesDir = path.join(outDir, 'frames');
  const settledDir = path.join(outDir, 'settled');
  fs.mkdirSync(framesDir, { recursive: true });
  fs.mkdirSync(settledDir, { recursive: true });

  log(`extracting frames at ${fps} fps ...`);
  let frameCount = 0;
  try {
    execFileSync('ffmpeg', ['-y', '-i', videoPath, '-vf', `fps=${fps}`, path.join(framesDir, 'frame_%04d.png')], { stdio: 'ignore' });
    frameCount = fs.readdirSync(framesDir).filter((f) => f.endsWith('.png')).length;
  } catch (e) {
    notes.push(`fps frame extraction failed: ${e.message}`);
  }

  const duration = probeDuration(videoPath);
  // Step timestamps are wall-clock offsets from page creation, but the video
  // only starts at first paint — it's shorter than the wall-clock span, so raw
  // offsets land one step late. Subtract the lead gap (assumed at the start).
  let leadGapS = 0;
  if (duration !== null && wallClockMs) {
    leadGapS = Math.max(0, wallClockMs / 1000 - duration);
    if (leadGapS > 0.2) notes.push(`timestamp correction: video starts ${leadGapS.toFixed(2)}s after page creation; settled-frame seeks shifted accordingly`);
  }
  for (const step of steps) {
    let t = Math.max(0, step.videoTimestampMs / 1000 - leadGapS);
    if (duration !== null) t = Math.min(t, Math.max(0, duration - 0.1));
    const file = `step-${String(step.stepIndex).padStart(2, '0')}.png`;
    try {
      execFileSync('ffmpeg', ['-y', '-ss', t.toFixed(3), '-i', videoPath, '-frames:v', '1', path.join(settledDir, file)], { stdio: 'ignore' });
      if (fs.existsSync(path.join(settledDir, file))) step.settledFrame = `settled/${file}`;
    } catch (e) {
      notes.push(`settled frame for step ${step.stepIndex} failed: ${e.message}`);
    }
  }
  return frameCount;
}

// ----------------------------------------------------------------------- main

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.url || !args.outDir) {
    process.stderr.write('Usage: node record-scroll.js <url> <outDir> [--width 1440] [--height 900] [--fps 2]\n');
    process.exit(1);
  }
  const playwright = loadPlaywright();
  const outDir = path.resolve(args.outDir);
  const videoTmp = path.join(outDir, 'video-tmp');
  fs.mkdirSync(videoTmp, { recursive: true });

  const notes = [];
  const steps = [];
  let census = null;
  let videoFile = null;

  log(`launching chromium (${args.width}x${args.height}) ...`);
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: args.width, height: args.height },
    recordVideo: { dir: videoTmp, size: { width: args.width, height: args.height } },
  });
  const page = await context.newPage();
  const recordingStart = Date.now();
  const video = page.video();

  try {
    log(`navigating to ${args.url} ...`);
    // 'load' + a bounded networkidle attempt instead of waitUntil:'networkidle' —
    // builder sites (Wix etc.) poll analytics forever and never go idle, which
    // would burn the full timeout and pad the video with a minute of dead air.
    try {
      await page.goto(args.url, { waitUntil: 'load', timeout: 60000 });
    } catch (e) {
      notes.push(`goto did not reach load: ${e.message.split('\n')[0]}`);
      log('navigation timeout/error, continuing anyway');
    }
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {
      notes.push('network never went idle within 8s (typical for builder sites), continuing');
    });
    await sleep(2500);

    log('running animation census ...');
    census = await page.evaluate(censusInPage);
    log(`census: ${census.animations.length} animations, reveal markers: ${JSON.stringify(census.revealMarkers)}`);

    const stepSize = Math.max(1, Math.round(args.height * 0.85));
    const pageHeight = census.pageHeight;
    const maxScroll = Math.max(0, pageHeight - census.viewportHeight);
    log(`scroll pass: pageHeight=${pageHeight}, step=${stepSize}, maxScroll=${maxScroll}`);

    let stepIndex = 0;
    for (let y = 0; ; y = Math.min(y + stepSize, maxScroll)) {
      await page.evaluate((top) => window.scrollTo({ top, behavior: 'smooth' }), y);
      await sleep(600);
      const settle = await page.evaluate(settleInPage, 3000);
      await sleep(300);
      const scrollY = await page.evaluate(() => window.scrollY);
      steps.push({
        stepIndex,
        scrollY,
        videoTimestampMs: Date.now() - recordingStart,
        settled: settle.settled,
        activeInfiniteAnimations: settle.activeInfiniteAnimations,
        settledFrame: null,
      });
      log(`step ${stepIndex}: scrollY=${scrollY} settled=${settle.settled} infinite=${settle.activeInfiniteAnimations}`);
      stepIndex++;
      if (y >= maxScroll) break;
    }

    log('scrolling back to top ...');
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    await sleep(600);
    await page.evaluate(settleInPage, 3000);
    await sleep(1000);
  } catch (e) {
    notes.push(`scroll pass error: ${e.message.split('\n')[0]}`);
    log(`error during capture: ${e.message}`);
  }

  const wallClockMs = Date.now() - recordingStart;
  await context.close();
  await browser.close();

  try {
    const tmpPath = video ? await video.path() : null;
    if (tmpPath && fs.existsSync(tmpPath)) {
      videoFile = path.join(outDir, 'scroll.webm');
      fs.renameSync(tmpPath, videoFile);
      fs.rmSync(videoTmp, { recursive: true, force: true });
      log(`video saved: ${videoFile} (${fs.statSync(videoFile).size} bytes)`);
    } else {
      notes.push('no video file produced');
    }
  } catch (e) {
    notes.push(`video move failed: ${e.message}`);
  }

  const ffmpegAvailable = hasCommand('ffmpeg', ['-version']);
  let framesExtracted = 0;
  if (videoFile && ffmpegAvailable) {
    framesExtracted = extractFrames(videoFile, outDir, args.fps, steps, notes, wallClockMs);
  } else if (!ffmpegAvailable) {
    notes.push('ffmpeg not available: frames were not extracted');
    process.stderr.write('WARNING: ffmpeg not found; video and manifest saved but frames were not extracted.\n');
  }

  const finiteAnimations = census ? census.animations.filter((a) => a.iterations !== 'infinite').length : 0;
  const hasMotion = !!census && (finiteAnimations > 0 || Object.keys(census.revealMarkers).length > 0);

  const manifest = {
    url: args.url,
    capturedAt: new Date().toISOString(),
    viewport: { width: args.width, height: args.height },
    video: videoFile ? 'scroll.webm' : null,
    fps: args.fps,
    steps,
    census,
    hasMotion,
    notes,
  };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  log(`manifest written: ${path.join(outDir, 'manifest.json')}`);

  console.log(`RESULT ${JSON.stringify({ video: manifest.video, steps: steps.length, hasMotion, framesExtracted })}`);
  process.exit(!ffmpegAvailable && videoFile ? 3 : 0);
}

main().catch((e) => {
  process.stderr.write(`Fatal: ${e.stack || e.message}\n`);
  process.exit(1);
});
