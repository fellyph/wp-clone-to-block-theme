#!/usr/bin/env node
/*
 * Run a lightweight site benchmark sweep.
 *
 * Usage:
 *   node scripts/benchmark-wix-sites.js sites.json ./benchmarks/site-sweep
 *
 * sites.json:
 * [
 *   { "slug": "example", "url": "https://example.wixsite.com/site" }
 * ]
 *
 * Outputs per site:
 * - desktop.png
 * - mobile.png
 * - analysis.json
 * - summary.json
 *
 * Aggregate outputs:
 * - summary.json
 * - report.md
 */

const fs = require('fs');
const path = require('path');
// playwright and pngjs are optional dependencies — resolved lazily so that
// merely loading this file (e.g. `node --check`, or another script requiring
// it) never throws on a machine that has not installed them.
let chromium = null;
let PNG = null;

function loadDeps() {
  const missing = [];
  for (const [name, assign] of [
    ['playwright', (m) => { chromium = m.chromium; }],
    ['pngjs', (m) => { PNG = m.PNG; }],
  ]) {
    try {
      assign(require(require.resolve(name, { paths: [__dirname, process.cwd()] })));
    } catch (e) {
      missing.push(name);
    }
  }
  if (missing.length) {
    process.stderr.write(
      `Missing optional dependencies: ${missing.join(', ')}\n` +
      `Run: npm i ${missing.join(' ')}${missing.includes('playwright') ? ' && npx playwright install chromium' : ''}\n`
    );
    process.exit(2);
  }
}

const sitesPath = path.resolve(process.argv[2] || '');
const outRoot = path.resolve(process.argv[3] || './benchmarks/wix-5');
const skillRoot = path.resolve(__dirname, '..');
const extractorSource = fs
  .readFileSync(path.join(skillRoot, 'scripts', 'extract.js'), 'utf8')
  .trim()
  .replace(/;$/, '');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(file, data) {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function mdEscape(value) {
  return String(value || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function diffPngRatio(aBuffer, bBuffer) {
  try {
    const a = PNG.sync.read(aBuffer);
    const b = PNG.sync.read(bBuffer);
    if (a.width !== b.width || a.height !== b.height) return null;
    let changed = 0;
    const pixels = a.width * a.height;
    for (let i = 0; i < a.data.length; i += 4) {
      const dr = Math.abs(a.data[i] - b.data[i]);
      const dg = Math.abs(a.data[i + 1] - b.data[i + 1]);
      const db = Math.abs(a.data[i + 2] - b.data[i + 2]);
      const da = Math.abs(a.data[i + 3] - b.data[i + 3]);
      if (dr + dg + db + da > 55) changed++;
    }
    return Number((changed / pixels).toFixed(4));
  } catch (error) {
    return null;
  }
}

function riskNotes(summary) {
  const risks = [];
  const complexSignals = complexMotionSignals(summary);
  if (summary.sections < 3) risks.push('low section count');
  if (summary.diagnostics?.sectionStrategy === 'y-band') {
    risks.push(compactPortfolioLike(summary) ? 'compact portfolio Y-band' : 'Y-band fallback');
  }
  if (summary.images === 0 && summary.pageHeight > 1600) risks.push('no image inventory');
  if (summary.cookieOverlay) risks.push('cookie/privacy overlay visible');
  if (summary.pageHeight && summary.pageHeight > 8000) risks.push('very tall page');
  if (summary.videos > 0) risks.push(`video poster fallback(${summary.videos})`);
  if (summary.motionSignals?.['carousel-like'] > 0) risks.push(`carousel reduction(${summary.motionSignals['carousel-like']})`);
  if (complexSignals.length > 0) risks.push(`complex motion: ${complexSignals.join(', ')}`);
  else if (summary.motionElements > 20) risks.push('CSS motion captured');
  if (summary.motionFrameDelta && summary.motionFrameDelta > 0.1) risks.push('large animated initial viewport');
  else if (summary.motionFrameDelta && summary.motionFrameDelta > 0.02) risks.push('animated initial viewport');
  if (summary.motionLibraries && summary.motionLibraries.length > 0) risks.push(`motion libraries: ${summary.motionLibraries.join(', ')}`);
  return risks;
}

function complexMotionSignals(summary) {
  const signals = summary.motionSignals || {};
  return ['canvas', 'lottie-like', 'scroll-effect']
    .filter((signal) => signals[signal] > 0)
    .map((signal) => `${signal}(${signals[signal]})`);
}

function compactPortfolioLike(summary) {
  return summary.diagnostics?.sectionStrategy === 'y-band'
    && summary.sections >= 3
    && summary.images >= 8
    && summary.pageHeight > 0
    && summary.pageHeight < 3200;
}

function cloneInputScore(summary) {
  let score = 100;
  const complexSignals = complexMotionSignals(summary);
  if (summary.status && (summary.status < 200 || summary.status >= 400)) score -= 40;
  if (summary.sections < 3) score -= 35;
  if (summary.diagnostics?.sectionStrategy === 'y-band' && !compactPortfolioLike(summary)) score -= 10;
  if (summary.images === 0 && summary.pageHeight > 1600) score -= 20;
  if (summary.motionElements > 300) score -= 3;
  if (summary.videos > 0) score -= Math.min(2, summary.videos);
  if (summary.motionSignals?.['carousel-like'] > 0) score -= 2;
  if (complexSignals.length > 0) score -= Math.min(14, complexSignals.length * 4);
  if (summary.motionFrameDelta && summary.motionFrameDelta > 0.1) score -= 3;
  else if (summary.motionFrameDelta && summary.motionFrameDelta > 0.02) score -= 3;
  if (summary.motionLibraries && summary.motionLibraries.length > 0) score -= Math.min(8, summary.motionLibraries.length * 4);
  if (summary.pageHeight && summary.pageHeight > 8000) score -= 5;
  return Math.max(0, Math.min(100, score));
}

async function stabilize(page) {
  await page.waitForTimeout(2500);
  await page.evaluate(async () => {
    let previousHeight = 0;
    let currentHeight = Math.max(
      document.body ? document.body.scrollHeight : 0,
      document.documentElement ? document.documentElement.scrollHeight : 0
    );
    const step = Math.max(420, Math.floor(window.innerHeight * 0.72));

    for (let pass = 0; pass < 2; pass += 1) {
      for (let y = 0; y <= currentHeight + window.innerHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((resolve) => setTimeout(resolve, 220));
        currentHeight = Math.max(
          document.body ? document.body.scrollHeight : 0,
          document.documentElement ? document.documentElement.scrollHeight : 0
        );
      }

      if (currentHeight === previousHeight) break;
      previousHeight = currentHeight;
    }

    window.scrollTo(0, 0);
    await new Promise((resolve) => setTimeout(resolve, 700));
  });
}

async function runSite(browser, site) {
  const startedAt = Date.now();
  const siteDir = path.join(outRoot, site.slug);
  ensureDir(siteDir);

  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });

  const summary = {
    slug: site.slug,
    url: site.url,
    ok: false,
    status: null,
    title: null,
    error: null,
    durationMs: null,
    diagnostics: null,
    sections: 0,
    images: 0,
    videos: 0,
    inlineSvgs: 0,
    navItems: 0,
    pageHeight: null,
    hasWixMarker: false,
    cookieOverlay: false,
    motionElements: 0,
    motionSignals: {},
    motionLibraries: [],
    motionFrameDelta: null,
    cloneInputScore: 0,
    risks: [],
  };

  try {
    const response = await page.goto(site.url, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    summary.status = response ? response.status() : null;

    await page.waitForTimeout(500);
    const motionStart = await page.screenshot({
      path: path.join(siteDir, 'motion-start.png'),
      fullPage: false,
    });
    await page.waitForTimeout(1500);
    const motionEnd = await page.screenshot({
      path: path.join(siteDir, 'motion-end.png'),
      fullPage: false,
    });
    summary.motionFrameDelta = diffPngRatio(motionStart, motionEnd);

    await stabilize(page);

    summary.title = await page.title();
    summary.hasWixMarker = await page.evaluate(() => {
      const text = document.body ? document.body.innerText : '';
      const html = document.documentElement ? document.documentElement.outerHTML : '';
      return /wix/i.test(text) || /wixstatic|wixsite|wix\.com/i.test(html);
    });
    summary.cookieOverlay = await page.evaluate(() => {
      const text = document.body ? document.body.innerText : '';
      return /we use cookies|accept cookies|cookie settings|decline all|privacy policy/i.test(text);
    });

    await page.screenshot({
      path: path.join(siteDir, 'desktop.png'),
      fullPage: true,
    });

    const extractor = new Function(`return (${extractorSource});`)();
    const analysis = await page.evaluate(extractor);
    writeJson(path.join(siteDir, 'analysis.json'), analysis);

    summary.diagnostics = analysis.diagnostics || null;
    summary.sections = analysis.sections ? analysis.sections.length : 0;
    summary.images = analysis.images ? analysis.images.length : 0;
    summary.videos = analysis.media && analysis.media.videos ? analysis.media.videos.length : 0;
    summary.inlineSvgs = analysis.media && analysis.media.inlineSvgs ? analysis.media.inlineSvgs.length : 0;
    summary.navItems = analysis.nav ? analysis.nav.length : 0;
    summary.pageHeight = analysis.diagnostics ? analysis.diagnostics.pageHeight : null;
    summary.motionElements = analysis.motion ? analysis.motion.totalElements : 0;
    summary.motionSignals = analysis.motion ? analysis.motion.signalCounts : {};
    summary.motionLibraries = analysis.motion ? analysis.motion.libraries : [];
    summary.ok = summary.status >= 200 && summary.status < 400 && summary.sections >= 3;
    summary.risks = riskNotes(summary);
    summary.cloneInputScore = cloneInputScore(summary);

    await page.setViewportSize({ width: 390, height: 844 });
    await stabilize(page);
    await page.screenshot({
      path: path.join(siteDir, 'mobile.png'),
      fullPage: true,
    });
  } catch (error) {
    summary.error = error && error.stack ? error.stack : String(error);
  } finally {
    summary.durationMs = Date.now() - startedAt;
    writeJson(path.join(siteDir, 'summary.json'), summary);
    await page.close().catch(() => {});
  }

  return summary;
}

function writeReport(results) {
  const passed = results.filter((result) => result.ok).length;
  const lines = [
    '# Site benchmark sweep',
    '',
    `Sites tested: ${results.length}`,
    `Capture-ready: ${passed}/${results.length}`,
    '',
    '| Site | Status | Strategy | Sections | Images | SVGs | Videos | Nav | Motion | Score | Page height | Notes |',
    '| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
  ];

  for (const result of results) {
    const strategy = result.diagnostics ? result.diagnostics.sectionStrategy : '';
    const notes = result.error
      ? `error: ${result.error.split('\n')[0]}`
      : result.ok
        ? (result.risks.length > 0 ? result.risks.join('; ') : 'ready for clone workflow')
        : 'needs manual review';
    lines.push(
      `| [${mdEscape(result.slug)}](${mdEscape(result.url)}) | ${result.status || ''} | ${mdEscape(strategy)} | ${result.sections} | ${result.images} | ${result.inlineSvgs || 0} | ${result.videos} | ${result.navItems} | ${result.motionElements} | ${result.cloneInputScore} | ${result.pageHeight || ''} | ${mdEscape(notes)} |`
    );
  }

  fs.writeFileSync(path.join(outRoot, 'report.md'), `${lines.join('\n')}\n`);
  writeJson(path.join(outRoot, 'summary.json'), results);
}

async function main() {
  if (!sitesPath || !fs.existsSync(sitesPath)) {
    throw new Error('Provide a sites.json file as the first argument.');
  }
  loadDeps();
  const sites = JSON.parse(fs.readFileSync(sitesPath, 'utf8'));
  ensureDir(outRoot);

  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const site of sites) {
      console.log(`benchmark ${site.slug}: ${site.url}`);
      results.push(await runSite(browser, site));
    }
  } finally {
    await browser.close().catch(() => {});
  }

  writeReport(results);
  console.log(`wrote ${path.join(outRoot, 'report.md')}`);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
