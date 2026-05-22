#!/usr/bin/env node
/*
 * Download image/media assets from an analysis.json file.
 *
 * Usage:
 *   node scripts/download-assets.js ./clones/site/.capture/analysis.json ./clones/site/theme/assets
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const analysisPath = path.resolve(process.argv[2] || '');
const outDir = path.resolve(process.argv[3] || '');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function pickExt(url, contentType) {
  if (/avif/.test(contentType || '')) return 'avif';
  if (/webp/.test(contentType || '')) return 'webp';
  if (/png/.test(contentType || '')) return 'png';
  if (/gif/.test(contentType || '')) return 'gif';
  if (/jpeg/.test(contentType || '')) return 'jpg';
  const clean = url.split('?')[0].toLowerCase();
  if (clean.endsWith('.jpg') || clean.endsWith('.jpeg')) return 'jpg';
  if (clean.endsWith('.png')) return 'png';
  if (clean.endsWith('.webp')) return 'webp';
  if (clean.endsWith('.gif')) return 'gif';
  return 'jpg';
}

function fetchBuffer(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const request = client.get(
      url,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; liberate-it)',
          Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        },
      },
      (response) => {
        const location = response.headers.location;
        if (location && response.statusCode >= 300 && response.statusCode < 400) {
          if (redirects > 5) reject(new Error(`too many redirects for ${url}`));
          else resolve(fetchBuffer(new URL(location, url).href, redirects + 1));
          return;
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`HTTP ${response.statusCode} for ${url}`));
          response.resume();
          return;
        }
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          resolve({
            buffer: Buffer.concat(chunks),
            contentType: response.headers['content-type'] || '',
          });
        });
      }
    );
    request.on('error', reject);
    request.setTimeout(60000, () => {
      request.destroy(new Error(`timeout for ${url}`));
    });
  });
}

function collectAssets(analysis) {
  const items = [];
  for (const image of analysis.images || []) {
    if (!image.src) continue;
    items.push({
      url: image.src,
      alt: image.alt || '',
      w: image.w || null,
      h: image.h || null,
      kind: image.kind || 'img',
    });
  }
  for (const video of analysis.media?.videos || []) {
    if (!video.poster) continue;
    items.push({
      url: video.poster,
      alt: 'video poster',
      w: video.w || null,
      h: video.h || null,
      kind: 'video-poster',
    });
  }
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

async function main() {
  if (!analysisPath || !fs.existsSync(analysisPath)) {
    throw new Error('Provide an analysis.json path as the first argument.');
  }
  if (!outDir) throw new Error('Provide an output directory as the second argument.');

  ensureDir(outDir);
  const analysis = JSON.parse(fs.readFileSync(analysisPath, 'utf8'));
  const assets = collectAssets(analysis);
  const manifest = [];

  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i];
    const downloaded = await fetchBuffer(asset.url);
    const ext = pickExt(asset.url, downloaded.contentType);
    const local = `img-${String(i + 1).padStart(2, '0')}.${ext}`;
    fs.writeFileSync(path.join(outDir, local), downloaded.buffer);
    manifest.push({
      local,
      url: asset.url,
      alt: asset.alt,
      w: asset.w,
      h: asset.h,
      kind: asset.kind,
      bytes: downloaded.buffer.length,
      contentType: downloaded.contentType,
    });
    console.log(`downloaded ${local}`);
  }

  fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`wrote ${path.join(outDir, 'manifest.json')}`);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
