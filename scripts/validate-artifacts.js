#!/usr/bin/env node
/*
 * Validate a generated clone before visual QA.
 *
 * Usage:
 *   node scripts/validate-artifacts.js ./clones/<slug>
 *
 * The checks intentionally compare the generated WP artifact against the
 * per-section spec files. This catches the common failure where a pattern is
 * syntactically valid but no longer represents what the capture described.
 */

const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
// Motion checks are advisory by default so the first run on a clone captured
// before the motion pipeline existed does not hard-fail. Pass --strict-motion
// (or set LIBERATE_STRICT_MOTION=1) to promote them to errors once a clean run
// has passed — see references/pipeline-test.md.
const strictMotion = argv.includes('--strict-motion') || process.env.LIBERATE_STRICT_MOTION === '1';
const cloneRoot = path.resolve(argv.find((a) => !a.startsWith('--')) || process.cwd());
const skillRoot = path.resolve(__dirname, '..');
const errors = [];
const warnings = [];

// The canonical list lives in references/spec-files.md and is parsed at run
// time by loadInteractionModels(). This copy is the fallback for a detached
// checkout — a mismatch between the two is itself a validation error, so the
// list cannot silently drift across SKILL.md / spec-files.md / this file.
const FALLBACK_INTERACTION_MODELS = new Set([
  'static',
  'gallery',
  'media-text',
  'columns',
  'cover-with-headline',
  'animated-cover',
  'logo-strip',
  'testimonial',
  'cta',
  'blog-card-grid',
  'project-card-grid',
  'price-list',
  'color-block-grid',
  'marquee-strip',
  'horizontal-showcase',
  'footer',
  'nav',
]);

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function exists(filePath) {
  return fs.existsSync(filePath);
}

function rel(filePath) {
  return path.relative(process.cwd(), filePath) || '.';
}

function fail(filePath, message) {
  errors.push(`${rel(filePath)}: ${message}`);
}

function warn(filePath, message) {
  warnings.push(`${rel(filePath)}: ${message}`);
}

/** Every CSS class token appearing in a `className":"..."` or `class="..."`. */
function classTokens(content) {
  const out = new Set();
  const patterns = [/"className"\s*:\s*"([^"]*)"/g, /\bclass="([^"]*)"/g];
  for (const re of patterns) {
    for (const match of content.matchAll(re)) {
      for (const token of match[1].split(/\s+/)) if (token) out.add(token);
    }
  }
  return out;
}

function motionIssue(filePath, message) {
  (strictMotion ? fail : warn)(filePath, `${message}${strictMotion ? '' : ' [motion check — advisory, run with --strict-motion to enforce]'}`);
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function stripTags(value) {
  // Neutralise PHP delimiters BEFORE stripping HTML tags. `<?php … ?>` looks
  // like one enormous unclosed tag to /<[^>]+>/, so stripping tags first would
  // delete the entire PHP block — and with it any content the pattern holds in
  // a variable or array (a legitimate way to write a repeated card/row list).
  // The heading and CTA checks would then fail on markup that is perfectly
  // correct once rendered.
  return value
    .replace(/<\?php/g, ' ')
    .replace(/<\?=/g, ' ')
    .replace(/\?>/g, ' ')
    .replace(/<[^>]+>/g, ' ');
}

function decodeEntities(value) {
  return value
    .replace(/&#8217;|&#039;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ');
}

function normalize(value) {
  return decodeEntities(stripTags(value))
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function sectionBetween(markdown, heading) {
  const start = markdown.search(new RegExp(`^## ${heading}`, 'im'));
  if (start === -1) return '';
  const rest = markdown.slice(start);
  const next = rest.slice(1).search(/^## /m);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

function extractAssets(content) {
  return unique(
    [...content.matchAll(/assets\/(?:img-\d+\.(?:jpe?g|png|webp|gif|avif)|placeholder-[\w.-]+\.svg)/gi)]
      .map((match) => match[0])
  );
}

const MOTION_CLASSES = new Set([
  'none', 'css-transition', 'css-keyframes', 'entry-reveal', 'marquee',
  'carousel', 'parallax', 'video', 'lottie', 'scroll-triggered',
]);

// The skeleton's style.css defines exactly these three; anything else is a
// class the CSS never un-hides, i.e. content invisible forever.
const REVEAL_VARIANTS = new Set(['reveal-fade', 'reveal-slide-up', 'reveal-rise']);

function loadInteractionModels() {
  const specTemplate = path.join(skillRoot, 'references', 'spec-files.md');
  if (!exists(specTemplate)) return FALLBACK_INTERACTION_MODELS;
  const line = read(specTemplate)
    .split('\n')
    .find((l) => /\*\*Interaction model:\*\*/i.test(l));
  const inner = line && line.match(/<([^>]+)>/);
  if (!inner) return FALLBACK_INTERACTION_MODELS;

  const parsed = new Set(inner[1].split('|').map((v) => v.trim()).filter(Boolean));
  const onlyInDoc = [...parsed].filter((v) => !FALLBACK_INTERACTION_MODELS.has(v));
  const onlyInCode = [...FALLBACK_INTERACTION_MODELS].filter((v) => !parsed.has(v));
  if (onlyInDoc.length || onlyInCode.length) {
    fail(
      specTemplate,
      'interaction model list has drifted from scripts/validate-artifacts.js' +
      `${onlyInDoc.length ? ` — only in spec-files.md: ${onlyInDoc.join(', ')}` : ''}` +
      `${onlyInCode.length ? ` — only in validate-artifacts.js: ${onlyInCode.join(', ')}` : ''}` +
      ' (SKILL.md carries a third copy — update all three)'
    );
  }
  return parsed;
}

function loadTemplateNames() {
  const mappingPath = path.join(skillRoot, 'references', 'section-mapping.md');
  if (!exists(mappingPath)) return new Set();
  return new Set(
    [...read(mappingPath).matchAll(/^### `([^`]+)`/gm)].map((match) => match[1])
  );
}

function validateJson(filePath, predicate) {
  if (!exists(filePath)) {
    fail(filePath, 'missing JSON file');
    return null;
  }
  try {
    const parsed = JSON.parse(read(filePath));
    if (predicate) predicate(parsed);
    return parsed;
  } catch (error) {
    fail(filePath, `invalid JSON: ${error.message}`);
    return null;
  }
}

function validateNoDecorativeHtmlComments(filePath, content) {
  const comments = [...content.matchAll(/<!--([\s\S]*?)-->/g)];
  for (const comment of comments) {
    const body = comment[1].trim();
    if (body.startsWith('wp:') || body.startsWith('/wp:')) continue;
    fail(filePath, `non-WordPress HTML comment found: "${body.slice(0, 80)}"`);
  }
}

/**
 * Enforce the Motion profile block of references/spec-files.md. Pre-dispatch
 * checklist item 8 asks for these fields; nothing verified them until now, so
 * a spec could name a settled frame that was never produced and the builder
 * would silently fall back to cropping desktop.png.
 */
function validateMotionProfile(specPath, content) {
  const classMatch = content.match(/\*\*Motion class:\*\*\s*([^\n]+)/i);
  if (!classMatch) {
    motionIssue(specPath, 'missing **Motion class:** in the Motion profile');
    return { motionClass: null, revealClasses: [] };
  }
  const motionClass = classMatch[1].replace(/[`*]/g, '').split(/[<(]/)[0].trim();
  if (!MOTION_CLASSES.has(motionClass)) {
    motionIssue(specPath, `unknown motion class "${motionClass}" (expected one of ${[...MOTION_CLASSES].join(', ')})`);
  }

  const value = (label) => {
    const m = content.match(new RegExp(`\\*\\*${label}:\\*\\*\\s*([^\\n]+)`, 'i'));
    if (!m) return null;
    const v = m[1].replace(/[`*]/g, '').replace(/<[^>]*>/g, '').trim();
    return v || null;
  };

  const settledFrame = value('Settled frame');
  const revealRaw = value('Reveal classes');

  if (motionClass !== 'none') {
    if (!settledFrame) motionIssue(specPath, 'motion class is not "none" but **Settled frame:** is empty');
    if (!revealRaw) motionIssue(specPath, 'motion class is not "none" but **Reveal classes:** is empty');
  }

  // A named frame must actually be on disk, relative to the clone root.
  if (settledFrame && !/^n\/?a$/i.test(settledFrame)) {
    const framePath = settledFrame.match(/\.capture\/motion\/settled\/[\w.-]+\.png/);
    if (framePath && !exists(path.join(cloneRoot, framePath[0]))) {
      motionIssue(specPath, `**Settled frame:** points at ${framePath[0]}, which does not exist`);
    }
  }

  const revealClasses = revealRaw && !/^n\/?a$/i.test(revealRaw)
    ? unique([...revealRaw.matchAll(/\breveal(?:-[a-z-]+)?\b/g)].map((m) => m[0]))
    : [];
  for (const cls of revealClasses) {
    if (cls !== 'reveal' && !REVEAL_VARIANTS.has(cls)) {
      motionIssue(specPath, `unknown reveal variant "${cls}" — the skeleton CSS only defines ${[...REVEAL_VARIANTS].join(', ')}, so anything else stays hidden`);
    }
  }

  return { motionClass, revealClasses };
}

/**
 * If any pattern actually uses the reveal system, the theme must ship the whole
 * mechanism. A pattern with `class="reveal"` and no reveal.js is content that
 * never appears.
 */
function validateRevealWiring(patternPaths) {
  const users = [];
  const variantsUsed = new Set();
  for (const patternPath of patternPaths) {
    const tokens = classTokens(read(patternPath));
    // Exact token match only: a theme-local class like `fc-reveal` is its own
    // mechanism and must not be mistaken for the skeleton's reveal system.
    if (!tokens.has('reveal')) continue;
    users.push(patternPath);
    for (const t of tokens) if (/^reveal-/.test(t)) variantsUsed.add(t);
  }
  if (users.length === 0) return;

  const revealJs = path.join(themeDir, 'assets', 'js', 'reveal.js');
  const styleCss = path.join(themeDir, 'style.css');
  const functionsPhp = path.join(themeDir, 'functions.php');

  if (!exists(revealJs)) {
    motionIssue(revealJs, `${users.length} pattern(s) use the reveal system but theme/assets/js/reveal.js is missing — those blocks would stay hidden`);
  }
  if (exists(styleCss)) {
    const css = read(styleCss);
    if (!css.includes('.reveal') || !css.includes('is-revealed')) {
      motionIssue(styleCss, 'reveal CSS (.reveal / .is-revealed) missing from theme/style.css');
    }
  }
  if (exists(functionsPhp)) {
    const php = read(functionsPhp);
    if (!php.includes('reveal.js')) motionIssue(functionsPhp, 'functions.php does not enqueue assets/js/reveal.js');
    if (!/classList\.add\('js'\)/.test(php)) motionIssue(functionsPhp, "functions.php does not set the html.js class the reveal CSS is gated on");
    if (!/reveal-ready/.test(php)) motionIssue(functionsPhp, 'functions.php has no reveal-ready watchdog — a failed reveal.js would hide content permanently');
  }
  for (const variant of variantsUsed) {
    if (!REVEAL_VARIANTS.has(variant)) {
      motionIssue(patternsDir, `pattern uses undefined reveal variant "${variant}" — no CSS un-hides it`);
    }
  }
}

/** Sanity-check the scroll recording, when one exists. */
function validateMotionManifest() {
  const manifestPath = path.join(cloneRoot, '.capture', 'motion', 'manifest.json');
  if (!exists(manifestPath)) return;
  let manifest;
  try {
    manifest = JSON.parse(read(manifestPath));
  } catch (error) {
    fail(manifestPath, `invalid JSON: ${error.message}`);
    return;
  }
  if (manifest.hasMotion !== true) return;

  const steps = Array.isArray(manifest.steps) ? manifest.steps : [];
  if (steps.length === 0) {
    motionIssue(manifestPath, 'hasMotion is true but no scroll steps were recorded');
    return;
  }
  const onDisk = steps.filter(
    (s) => s.settledFrame && exists(path.join(cloneRoot, '.capture', 'motion', s.settledFrame))
  );
  if (onDisk.length === 0) {
    motionIssue(manifestPath, `hasMotion is true but none of the ${steps.length} settled frames exist on disk`);
  }
  const unsettled = steps.filter((s) => s.settled === false).length;
  if (unsettled / steps.length > 0.3) {
    warn(manifestPath, `${unsettled}/${steps.length} scroll steps never settled — captured styles may be mid-animation`);
  }
}

function parseSpec(specPath, content, templateNames, interactionModels) {
  const filename = path.basename(specPath);
  const sectionMatch = filename.match(/^section-(\d+)-/);
  const sectionNumber = sectionMatch ? Number(sectionMatch[1]) : null;

  const modelMatch = content.match(/\*\*Interaction model:\*\*\s*([^\n]+)/i);
  const interactionModel = modelMatch
    ? modelMatch[1].replace(/[`*]/g, '').split(/[<(]/)[0].trim()
    : '';

  const templateLine = content
    .split('\n')
    .find((line) => /Block template to use/i.test(line)) || '';
  const templateName = [...templateNames].find((name) => templateLine.includes(name)) || '';

  const copyrightMatch = content.match(/\*\*Copyright flag:\*\*\s*([^\n]+)/i);
  const brightnessMatch = content.match(/\*\*Background brightness:\*\*\s*([^\n]+)/i);
  const imageSection = sectionBetween(content, 'Images used in this section');
  const expectedAssets = extractAssets(imageSection || content);
  const expectsNoImages = /\bnone\b/i.test(imageSection) && expectedAssets.length === 0;
  const expectedHeadings = unique(
    [...content.matchAll(/-\s+\*\*h[1-6][^:]*:\*\*\s*"([^"]+)"/gi)].map((match) => match[1])
  );
  const expectedButtonLabels = unique([
    ...[...content.matchAll(/\bLabel:\s*"([^"]+)"/gi)].map((match) => match[1]),
    ...[...content.matchAll(/\bCTA:\s*"([^"]+)"/gi)].map((match) => match[1]),
  ]);

  if (sectionNumber === null) fail(specPath, 'filename does not start with section-<n>-');
  if (!interactionModels.has(interactionModel)) {
    fail(specPath, `invalid or missing interaction model "${interactionModel || '(empty)'}"`);
  }
  if (!templateName) {
    fail(specPath, 'generation instructions do not reference a known section-mapping template');
  }
  if (!copyrightMatch || !copyrightMatch[1].trim()) {
    fail(specPath, 'missing copyright flag');
  }
  if (!brightnessMatch || !/\d/.test(brightnessMatch[1])) {
    fail(specPath, 'missing numeric background brightness');
  }
  if (/https?:\/\//i.test(imageSection)) {
    fail(specPath, 'image section contains remote URL; use local assets/img-* paths');
  }
  if (content.split(/\r?\n/).length > 180) {
    warn(specPath, 'spec is longer than 180 lines; consider splitting complex sections');
  }

  const motion = validateMotionProfile(specPath, content);

  return {
    sectionNumber,
    interactionModel,
    templateName,
    motion,
    expectedAssets,
    expectsNoImages,
    expectedHeadings,
    expectedButtonLabels,
    skipSectionGradient:
      /do not repaint per-section|skip bg|skip per-section bg|inherits body gradient|body owns gradient/i.test(content),
  };
}

function validatePattern(spec, patternPath, content) {
  const normalizedPattern = normalize(content);
  const actualAssets = extractAssets(content);

  if (/\{\{[A-Z0-9_ -]+\}\}/.test(content)) {
    fail(patternPath, 'unresolved template placeholder remains in generated pattern');
  }
  if (/<img[^>]+https?:\/\//i.test(content) || /url\(\s*['"]?https?:\/\//i.test(content)) {
    fail(patternPath, 'remote image URL found; route assets through get_theme_file_uri()');
  }
  if (spec.skipSectionGradient && /linear-gradient\(/i.test(content)) {
    fail(patternPath, 'spec says the body owns the gradient, but the pattern repaints a gradient');
  }
  if (spec.expectsNoImages && actualAssets.length > 0) {
    fail(patternPath, `spec expects no images, but pattern references ${actualAssets.join(', ')}`);
  }
  for (const asset of spec.expectedAssets) {
    if (!actualAssets.includes(asset)) {
      fail(patternPath, `missing expected asset ${asset}`);
    }
  }
  for (const asset of actualAssets) {
    if (!spec.expectedAssets.includes(asset)) {
      fail(patternPath, `pattern references asset not listed in spec: ${asset}`);
    }
  }
  for (const heading of spec.expectedHeadings) {
    if (!normalizedPattern.includes(normalize(heading))) {
      fail(patternPath, `missing expected heading "${heading}"`);
    }
  }
  for (const label of spec.expectedButtonLabels) {
    if (!normalizedPattern.includes(normalize(label))) {
      fail(patternPath, `missing expected CTA label "${label}"`);
    }
  }

  validateNoDecorativeHtmlComments(patternPath, content);
}

function walkFiles(dirPath, predicate) {
  if (!exists(dirPath)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(fullPath, predicate));
    } else if (!predicate || predicate(fullPath)) {
      out.push(fullPath);
    }
  }
  return out;
}

const themeDir = path.join(cloneRoot, 'theme');
const specsDir = path.join(cloneRoot, 'specs');
const patternsDir = path.join(themeDir, 'patterns');
const templateNames = loadTemplateNames();
const interactionModels = loadInteractionModels();

validateJson(path.join(themeDir, 'theme.json'), (theme) => {
  if (theme.version !== 3) throw new Error('theme.json version must be 3');
  if (!theme.$schema) throw new Error('theme.json must include $schema');
});

const blueprintPath = path.join(cloneRoot, 'blueprint.json');
if (exists(blueprintPath)) validateJson(blueprintPath);

for (const filePath of walkFiles(path.join(themeDir, 'templates'), (file) => file.endsWith('.html'))) {
  validateNoDecorativeHtmlComments(filePath, read(filePath));
}
for (const filePath of walkFiles(path.join(themeDir, 'parts'), (file) => file.endsWith('.html'))) {
  validateNoDecorativeHtmlComments(filePath, read(filePath));
}

const specPaths = walkFiles(specsDir, (file) => /^section-\d+-.*\.md$/.test(path.basename(file)))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

if (specPaths.length === 0) {
  fail(specsDir, 'no section spec files found');
}

const patternPaths = [];
for (const specPath of specPaths) {
  const spec = parseSpec(specPath, read(specPath), templateNames, interactionModels);
  if (spec.sectionNumber === null) continue;
  const patternPath = path.join(patternsDir, `section-${spec.sectionNumber}.php`);
  if (!exists(patternPath)) {
    fail(patternPath, `missing pattern for ${path.basename(specPath)}`);
    continue;
  }
  const patternContent = read(patternPath);
  patternPaths.push(patternPath);
  validatePattern(spec, patternPath, patternContent);

  // The spec is the contract: reveal classes it declares must reach the markup.
  const patternClasses = classTokens(patternContent);
  for (const cls of spec.motion.revealClasses) {
    if (!patternClasses.has(cls)) {
      motionIssue(patternPath, `spec declares reveal class "${cls}" but the pattern does not use it`);
    }
  }
}

validateRevealWiring(patternPaths);
validateMotionManifest();

if (warnings.length > 0) {
  console.warn('Artifact validation warnings:');
  for (const message of warnings) console.warn(`- ${message}`);
}

if (errors.length > 0) {
  console.error('Artifact validation failed:');
  for (const message of errors) console.error(`- ${message}`);
  process.exit(1);
}

console.log(`Artifact validation passed for ${rel(cloneRoot)} (${specPaths.length} sections).`);
