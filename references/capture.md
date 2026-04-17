# Capture procedure (chrome-devtools MCP)

Capture a page into `./clones/<slug>/.capture/` so the rest of the workflow can work from stable local artifacts. The capture produces:

- `desktop.png`, `mobile.png` — full-page screenshots at 1440 and 390
- `analysis.json` — top-level tokens, sections, nav, image inventory (from `scripts/extract.js`)
- `sections/<n>.json` — one per section, full DOM tree + computed styles + text + images (from `scripts/extract-section.js`)
- `assets/img-NN.ext` — every image downloaded from its CDN while the URL is still valid
- `assets/manifest.json` — mapping from local filenames to original URLs and alt text

These artifacts are the complete input to the spec-writing step. Everything downstream reads from them and never re-scrapes the live page.

## 1. Open and stabilize the page

```
mcp__chrome-devtools__new_page { url: "<url>" }
mcp__chrome-devtools__resize_page { width: 1440, height: 900 }
```

Many modern sites are JS-rendered and lazy-load heavily. Stabilize with a single combined script that waits, scrolls to the bottom to hydrate lazy sections, then scrolls back to the top:

```
mcp__chrome-devtools__evaluate_script { function: "async () => { await new Promise(r => setTimeout(r, 2500)); window.scrollTo(0, document.body.scrollHeight); await new Promise(r => setTimeout(r, 1500)); window.scrollTo(0, 0); await new Promise(r => setTimeout(r, 500)); return { title: document.title, h: document.body.scrollHeight }; }" }
```

If a cookie banner blocks the hero, take a snapshot, locate its dismiss button by `uid`, and click it with `mcp__chrome-devtools__click` before continuing.

## 2. Screenshots

Full-page desktop:
```
mcp__chrome-devtools__take_screenshot { fullPage: true, filePath: ".capture/<slug>/desktop.png" }
```

Mobile:
```
mcp__chrome-devtools__resize_page { width: 390, height: 844 }
mcp__chrome-devtools__take_screenshot { fullPage: true, filePath: ".capture/<slug>/mobile.png" }
mcp__chrome-devtools__resize_page { width: 1440, height: 900 }
```

## 3. Extract tokens, sections, and palette

Read `scripts/extract.js` and pass its function body as the `function` argument to `mcp__chrome-devtools__evaluate_script`. Do NOT reimplement the extractor inline — it is non-trivial and the benchmark-hardened version lives in `scripts/extract.js` for a reason.

```
mcp__chrome-devtools__evaluate_script { function: "<contents of scripts/extract.js>" }
```

The returned JSON has this shape:

```jsonc
{
  "tokens": {
    "display": { "fontFamily": "...", "fontSize": 72, "fontWeight": "700", "color": "...", "text": "..." },
    "body":    { "fontFamily": "...", "fontSize": 16, "color": "..." },
    "button":  { "bg": "...", "fg": "..." } | null,   // null = no brand button found
    "contentWidth": 1200,
    "defaultButtonSkipped": true,   // true means a framework-default button color was ignored
    "h1Swapped": false,             // true means the visible headline is larger than <h1> — act accordingly
    "legacyH1Size": 17              // the size querySelector('h1') would have returned
  },
  "sections": [ { "index": 0, "top": 0, "height": 900, "heading": "...", "imgCount": 2, ... } ],
  "palette":  [ { "hex": "#rrggbb", "count": 123 } ],   // from hero-image histogram
  "nav":      [ "Home", "About", ... ],
  "images":   [ { "src": "...", "alt": "...", "w": 1600, "h": 900 } ],
  "diagnostics": {
    "textCandidates": 312,
    "sectionStrategy": "semantic",   // "semantic" if <section>/<header>/etc. were usable; "y-band" if it fell back to geometric clustering
    "afterDedupe": 7,
    "pageHeight": 5864
  }
}
```

Save the result as `.capture/<slug>/analysis.json`.

### Interpreting the extractor output

- **`tokens.display`** is the source of truth for the display font and size. It is the largest visible text element, not `document.querySelector('h1')`. If this is null, something is wrong with the capture — the page may still be loading. Re-run after a longer wait.
- **`tokens.button`** is null when no non-framework-default button color could be found. Fall back to `palette[0]` or `palette[1]` for the primary color.
- **`tokens.defaultButtonSkipped: true`** is a positive signal that the extractor correctly ignored a page-builder default (e.g. Wix's `#116DFF`). It does not mean the page is broken.
- **`tokens.h1Swapped: true`** means the site author used `<h1>` as a small eyebrow/kicker and put the real headline in a larger element. When true, use `tokens.display` for the `xx-large` preset and `legacyH1Size` for `large`.
- **`diagnostics.sectionStrategy`** tells you which detection path ran. `'semantic'` means `<section>/<header>/<footer>/...` were good enough; `'y-band'` means the page has no usable semantic landmarks and the geometric fallback was used. Both are fine; the field exists so you can record which strategy the site demanded.
- **`sections`** is already deduped (desktop+mobile DOM variants are collapsed by the ±40px Y-band rule). Expect 5–12 on a well-structured site.
- **`diagnostics.afterDedupe < 3`** is a failure signal — the page has no recoverable section structure. Fall back to the screenshot-only flow (see Known limitations).

## 4. Download every captured image (do NOT defer)

Many image CDNs sign their URLs, geoblock, or rate-limit. Download **immediately** after extraction, before moving to the per-section loop. Don't filter — download all of them so the per-section step has local paths available for every image it might reference.

Write a Bash loop that iterates `analysis.json.images[]`:

```bash
SLUG="<slug>"
DIR="./clones/$SLUG/.capture/assets"
mkdir -p "$DIR"

python3 -c "
import json, sys
imgs = json.load(open('./clones/$SLUG/.capture/analysis.json'))['images']
with open('$DIR/manifest.json', 'w') as f:
    json.dump([{'local': f'img-{i:02d}', 'url': img['src'], 'alt': img.get('alt',''), 'w': img.get('w'), 'h': img.get('h')} for i, img in enumerate(imgs, 1)], f, indent=2)
for i, img in enumerate(imgs, 1):
    url = img['src']
    ext = 'jpg' if '.jpg' in url.lower() or '.jpeg' in url.lower() else 'png' if '.png' in url.lower() else 'webp'
    print(f'img-{i:02d}.{ext}|{url}')
" | while IFS='|' read -r name url; do
    curl -sL -o "$DIR/$name" "$url" && echo "ok $name"
done
```

After the loop, `ls $DIR | wc -l` should match `analysis.json.images | length`. If a download failed (CDN 403, geoblock, cache-bust), mark the manifest entry `failed: true` — step 3 will substitute a placeholder during spec writing.

**Do not hotlink.** The generated theme must ship its own assets under `theme/assets/`. Never embed remote CDN URLs in the generated block markup — they expire, get cache-busted, or CORS-block cross-origin loads.

## 5. Per-section deep extraction (one call per section)

For each section in `analysis.json.sections[]`, run `scripts/extract-section.js` against its Y band. This returns the full DOM tree, computed styles, text content, and image inventory for **just that section**, which becomes the source of truth for the spec file in step 3 of `SKILL.md`.

```
mcp__chrome-devtools__evaluate_script {
  function: "<contents of scripts/extract-section.js>",
  args: ["<top>", "<height>"]
}
```

Where `<top>` and `<height>` come from the matching `analysis.json.sections[i]` entry. Save the result to `./clones/<slug>/.capture/sections/<i>.json`.

Run these **sequentially**, not in parallel — the extractor reads `window.scrollY` and bounding rects that can shift between calls. Give the browser a moment (~500ms) between calls.

### Reading the per-section output

Each `sections/<n>.json` has this shape:

```jsonc
{
  "band": { "top": 1187, "height": 628, "bottom": 1815 },
  "wrapper": {
    "tag": "section",
    "rect": { "top": 1187, "width": 1280, "height": 628 },
    "styles": { "backgroundColor": "rgb(255, 230, 0)", "padding": "60px 20px", ... }
  },
  "tree": {
    "tag": "section",
    "role": "container",
    "styles": { ... },
    "children": [ ... recursive DOM tree up to depth 5, with styles/text/images at every node ... ]
  },
  "flat": {
    "text": [ { "role": "heading", "text": "DESIGNER WHEEL COVERS", "size": "45px" }, ... ],
    "images": [ { "src": "https://...", "alt": "...", "w": 220, "h": 220, "rect": {...} }, ... ],
    "buttons": [ { "label": "Shop now", "href": "https://..." }, ... ]
  }
}
```

The `flat` array is a shortcut — it's pre-extracted from `tree` and holds the content you'll fill into spec files. `tree` is there for when `flat` isn't enough (e.g. deciding whether two adjacent children are a media-text pair or a column pair based on their parent's `flexDirection`).

## Known limitations

- **Absolute-positioned templates.** Some templates (heavy on photography portfolios, builder-generated pages) render the entire page as absolute-positioned divs with no semantic sections. The extractor's Y-band fallback handles most of these, but if `diagnostics.afterDedupe < 3` you should treat the capture as a *screenshot-only* clone: stop after step 2, skip section generation, and generate a single-pattern block theme where the front page is a `core/cover` with the hero image and a `core/gallery` of the detected images.
- **CORS-tainted palette.** Many image CDNs refuse cross-origin canvas reads, leaving `palette: []`. When this happens, fall back to `tokens.button.bg` or to a neutral default palette.
- **Framework-specific widgets.** Marquee scrollers, store/product blocks, booking widgets, chat popups, CMS collections, and parallax backgrounds are not captured as sections — the extractor only looks for static layout. Note these manually in the notes file and stub them in the generated pattern with an explicit HTML comment (see `references/section-mapping.md`).

## CDN caveats (signed URLs, cache-busting, CORS)

- Many CDNs serve images with signed query strings or short-TTL cache keys. Those URLs expire — download locally, don't hotlink.
- Some CDNs set `Access-Control-Allow-Origin: <specific origin>` which causes canvas reads to taint. Palette extraction falls back gracefully; no intervention needed.
- Squarespace, Webflow, and Shopify CDNs often 403 under cross-origin `curl` requests without a referer header. If a batch of downloads fails, retry with `curl -sL --referer '<source-url>'`.
- If `sections[].heading` is null for most entries, the site uses styled divs for visible headlines. The largest-visible-text pass inside each section usually still returns the right text — trust `heading` even when `sections[].tag !== 'h1'`.
