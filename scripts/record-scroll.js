#!/usr/bin/env node
/**
 * record-scroll.js — walk a page top to bottom with Playwright, screenshot each
 * settled scroll step, and write a manifest of steps + an animation census so a
 * cloning skill can reason about motion.
 *
 * The `settled/step-NN.png` frames are the primary artifact and come straight
 * from `page.screenshot()` at the moment the settle poll returned — pixel-exact,
 * no video involved. `scroll.webm` is recorded alongside as a human-reviewable
 * artifact, and ffmpeg is entirely optional (only `--keyframes` uses it).
 *
 * Usage:
 *   node record-scroll.js <url> <outDir> [options]
 *
 * Options:
 *   --width <px>            viewport width (default 1440)
 *   --height <px>           viewport height (default 900)
 *   --fps <n>               keyframe sweep rate, with --keyframes (default 2)
 *   --keyframes             also dump frames/frame_NNNN.png from the video (needs ffmpeg)
 *   --max-steps <n>         hard cap on scroll steps (default 40)
 *   --budget-ms <ms>        wall-clock cap on the scroll pass (default 180000)
 *   --dismiss-selector <css>  click this instead of auto-detecting a cookie banner
 *   --keep-banner           do not dismiss cookie/consent banners
 *
 * Exit codes: 0 ok | 1 fatal | 2 playwright missing | 4 no steps recorded
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

function parseArgs(argv) {
  const args = {
    width: 1440,
    height: 900,
    fps: 2,
    keyframes: false,
    maxSteps: 40,
    budgetMs: 180000,
    dismissSelector: null,
    keepBanner: false,
  };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--width') args.width = parseInt(argv[++i], 10);
    else if (a === '--height') args.height = parseInt(argv[++i], 10);
    else if (a === '--fps') args.fps = parseFloat(argv[++i]);
    else if (a === '--keyframes') args.keyframes = true;
    else if (a === '--max-steps') args.maxSteps = parseInt(argv[++i], 10);
    else if (a === '--budget-ms') args.budgetMs = parseInt(argv[++i], 10);
    else if (a === '--dismiss-selector') args.dismissSelector = argv[++i];
    else if (a === '--keep-banner') args.keepBanner = true;
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
  const markers = [
    '[data-aos]', '.wow', '[data-scroll]', '[data-sr-id]', '[data-motion-enter]',
    '[data-anim]', '[data-animation]', '[data-motion-part]', '[data-framer-appear-id]',
    '.reveal', '.animate-on-scroll', '[data-w-id]',
  ];
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
  // Polls with setTimeout, never requestAnimationFrame — rAF is frozen outright
  // in a backgrounded/occluded page, which would make the deadline unreachable.
  // Keep identical to the settle snippets in scripts/extract-section.js and
  // references/capture.md.
  return new Promise((resolve) => {
    const start = Date.now();
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
      } else if (Date.now() - start > timeoutMs) {
        resolve({ settled: false, activeInfiniteAnimations: infiniteRunning() });
      } else {
        setTimeout(tick, 100);
      }
    };
    tick();
  });
}

function pageHeightInPage() {
  return Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
}

function dismissInPage(explicitSelector) {
  // Runs in a *separate* headless browser from the chrome-devtools MCP tab, so
  // the banner the operator dismissed there is still present here. Left alone,
  // it would appear in every settled frame while desktop.png shows none —
  // and the settled frame is the builder's authoritative visual reference.
  const clickIt = (el, why) => {
    el.click();
    return { clicked: why, text: (el.textContent || '').trim().slice(0, 60) };
  };
  if (explicitSelector) {
    const el = document.querySelector(explicitSelector);
    return el ? clickIt(el, explicitSelector) : { clicked: null, reason: 'selector matched nothing' };
  }
  const containerSel = '[id*=cookie i],[class*=cookie i],[class*=consent i],[id*=consent i],[class*=banner i],[role=dialog],[aria-label*=cookie i]';
  const accept = /^(accept|accept all|i agree|agree|got it|ok|okay|dismiss|close|decline|decline all|reject|reject all|allow)\b/i;
  const containers = Array.from(document.querySelectorAll(containerSel));
  for (const container of containers) {
    const r = container.getBoundingClientRect();
    if (r.width < 40 || r.height < 20) continue;
    const buttons = Array.from(container.querySelectorAll('button,a,[role=button],[data-hook*=close i]'));
    for (const b of buttons) {
      const label = (b.textContent || b.getAttribute('aria-label') || '').trim();
      if (accept.test(label)) return clickIt(b, `${containerSel.split(',')[0]} → "${label}"`);
    }
    // Wix promo/consent strips often expose only an unlabelled close control.
    const closer = container.querySelector('[aria-label*=close i],[data-hook*=close i],button[class*=close i]');
    if (closer) return clickIt(closer, 'close control in consent/banner container');
  }
  return { clicked: null, reason: 'no cookie/consent banner found' };
}

// --------------------------------------------------------------------- ffmpeg

function extractKeyframes(videoPath, outDir, fps, notes) {
  const framesDir = path.join(outDir, 'frames');
  fs.mkdirSync(framesDir, { recursive: true });
  log(`extracting keyframes at ${fps} fps ...`);
  try {
    execFileSync('ffmpeg', ['-y', '-i', videoPath, '-vf', `fps=${fps}`, path.join(framesDir, 'frame_%04d.png')], { stdio: 'ignore' });
    return fs.readdirSync(framesDir).filter((f) => f.endsWith('.png')).length;
  } catch (e) {
    notes.push(`keyframe extraction failed: ${e.message}`);
    return 0;
  }
}

// ----------------------------------------------------------------------- main

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.url || !args.outDir) {
    process.stderr.write('Usage: node record-scroll.js <url> <outDir> [--width 1440] [--height 900] [--fps 2] [--keyframes] [--max-steps 40] [--budget-ms 180000] [--dismiss-selector <css>] [--keep-banner]\n');
    process.exit(1);
  }
  const playwright = loadPlaywright();
  const outDir = path.resolve(args.outDir);
  const videoTmp = path.join(outDir, 'video-tmp');
  const settledDir = path.join(outDir, 'settled');
  fs.mkdirSync(videoTmp, { recursive: true });
  fs.mkdirSync(settledDir, { recursive: true });

  const notes = [];
  const steps = [];
  let census = null;
  let videoFile = null;
  let dismissal = null;

  log(`launching chromium (${args.width}x${args.height}) ...`);
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: args.width, height: args.height },
    recordVideo: { dir: videoTmp, size: { width: args.width, height: args.height } },
  });
  const page = await context.newPage();
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

    if (args.keepBanner) {
      notes.push('banner dismissal skipped (--keep-banner)');
    } else {
      dismissal = await page.evaluate(dismissInPage, args.dismissSelector).catch((e) => ({ clicked: null, reason: e.message }));
      if (dismissal && dismissal.clicked) {
        notes.push(`dismissed banner: ${dismissal.clicked}${dismissal.text ? ` ("${dismissal.text}")` : ''}`);
        log(`dismissed banner: ${dismissal.clicked}`);
        await sleep(700);
      } else {
        notes.push(`no banner dismissed: ${(dismissal && dismissal.reason) || 'unknown'}`);
      }
    }

    log('running animation census ...');
    census = await page.evaluate(censusInPage);
    log(`census: ${census.animations.length} animations, reveal markers: ${JSON.stringify(census.revealMarkers)}`);

    const stepSize = Math.max(1, Math.round(args.height * 0.85));
    const deadline = Date.now() + args.budgetMs;
    // pageHeight is re-read every step: lazy-loading builder pages grow as you
    // scroll, so the census value alone would stop the pass short of the bottom.
    let pageHeight = census.pageHeight;
    let stableBottomHits = 0;
    let stepIndex = 0;
    let y = 0;

    log(`scroll pass: pageHeight=${pageHeight}, step=${stepSize}, maxSteps=${args.maxSteps}`);

    for (;;) {
      await page.evaluate((top) => window.scrollTo({ top, behavior: 'smooth' }), y);
      await sleep(600);
      const settle = await page.evaluate(settleInPage, 3000);
      await sleep(300);
      const scrollY = await page.evaluate(() => window.scrollY);

      const file = `step-${String(stepIndex).padStart(2, '0')}.png`;
      let settledFrame = null;
      try {
        await page.screenshot({ path: path.join(settledDir, file) });
        settledFrame = `settled/${file}`;
      } catch (e) {
        notes.push(`screenshot for step ${stepIndex} failed: ${e.message.split('\n')[0]}`);
      }

      const heightNow = await page.evaluate(pageHeightInPage);
      const grew = heightNow > pageHeight;
      pageHeight = Math.max(pageHeight, heightNow);
      const maxScroll = Math.max(0, pageHeight - census.viewportHeight);

      steps.push({
        stepIndex,
        scrollY,
        pageHeightAtStep: pageHeight,
        viewportBand: [scrollY, scrollY + args.height],
        settled: settle.settled,
        activeInfiniteAnimations: settle.activeInfiniteAnimations,
        settledFrame,
      });
      log(`step ${stepIndex}: scrollY=${scrollY} pageHeight=${pageHeight}${grew ? ' (grew)' : ''} settled=${settle.settled} infinite=${settle.activeInfiniteAnimations}`);
      stepIndex++;

      // Terminate only when the bottom is reached twice with a stable height —
      // one hit can be a lazy loader that is about to extend the page.
      if (y >= maxScroll) {
        stableBottomHits = grew ? 0 : stableBottomHits + 1;
        if (stableBottomHits >= 2) {
          notes.push('scroll pass reached a stable bottom');
          break;
        }
      } else {
        stableBottomHits = 0;
      }
      if (stepIndex >= args.maxSteps) {
        notes.push(`scroll pass stopped at --max-steps ${args.maxSteps} (page may be taller than captured)`);
        break;
      }
      if (Date.now() > deadline) {
        notes.push(`scroll pass stopped at --budget-ms ${args.budgetMs} (page may be taller than captured)`);
        break;
      }
      y = Math.min(y + stepSize, maxScroll);
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

  let framesExtracted = 0;
  if (args.keyframes) {
    if (videoFile && hasCommand('ffmpeg', ['-version'])) {
      framesExtracted = extractKeyframes(videoFile, outDir, args.fps, notes);
    } else {
      notes.push('--keyframes requested but ffmpeg or the video is unavailable; settled frames are unaffected');
    }
  }

  const finiteAnimations = census ? census.animations.filter((a) => a.iterations !== 'infinite').length : 0;
  const hasMotion = !!census && (finiteAnimations > 0 || Object.keys(census.revealMarkers).length > 0);

  const manifest = {
    url: args.url,
    capturedAt: new Date().toISOString(),
    viewport: { width: args.width, height: args.height },
    video: videoFile ? 'scroll.webm' : null,
    fps: args.keyframes ? args.fps : null,
    bannerDismissal: dismissal,
    steps,
    census,
    hasMotion,
    notes,
  };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  log(`manifest written: ${path.join(outDir, 'manifest.json')}`);

  console.log(`RESULT ${JSON.stringify({ video: manifest.video, steps: steps.length, hasMotion, framesExtracted })}`);

  if (steps.length === 0) {
    process.stderr.write('ERROR: no scroll steps were recorded — the capture produced nothing usable.\n');
    process.exit(4);
  }
  process.exit(0);
}

main().catch((e) => {
  process.stderr.write(`Fatal: ${e.stack || e.message}\n`);
  process.exit(1);
});
