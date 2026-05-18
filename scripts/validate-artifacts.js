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

const cloneRoot = path.resolve(process.argv[2] || process.cwd());
const skillRoot = path.resolve(__dirname, '..');
const errors = [];
const warnings = [];

const allowedInteractionModels = new Set([
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

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function stripTags(value) {
  return value.replace(/<[^>]+>/g, ' ');
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

function parseSpec(specPath, content, templateNames) {
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
  if (!allowedInteractionModels.has(interactionModel)) {
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

  return {
    sectionNumber,
    interactionModel,
    templateName,
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

for (const specPath of specPaths) {
  const spec = parseSpec(specPath, read(specPath), templateNames);
  if (spec.sectionNumber === null) continue;
  const patternPath = path.join(patternsDir, `section-${spec.sectionNumber}.php`);
  if (!exists(patternPath)) {
    fail(patternPath, `missing pattern for ${path.basename(specPath)}`);
    continue;
  }
  validatePattern(spec, patternPath, read(patternPath));
}

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
