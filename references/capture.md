# Capture procedure (chrome-devtools MCP)

Capture a page into `./clones/<slug>/.capture/` so the rest of the workflow can work from stable local artifacts. The capture produces:

- `motion/` — scroll recording of the page (video + per-step settled frames + `manifest.json`), from `scripts/record-scroll.js` or the MCP fallback in §2. This is the visual source of truth for animated sites.
- `desktop.png`, `mobile.png` — full-page settled screenshots at 1440 and 390, taken **after** the stepped-scroll pass so scroll-triggered animations have fired
- `motion-start.png`, `motion-end.png` — initial desktop viewport frames for visible entry/motion comparison (superseded by `motion/settled/step-NN.png` when the scroll recording ran)
- `analysis.json` — top-level tokens, sections, nav, image inventory, and motion inventory (from `scripts/extract.js`)
- `sections/<n>.json` — one per section, full DOM tree + computed styles + text + images (from `scripts/extract-section.js`)
- `assets/img-NN.ext` — every image downloaded from its CDN while the URL is still valid
- `assets/manifest.json` — mapping from local filenames to original URLs and alt text

These artifacts are the complete input to the spec-writing step. Everything downstream reads from them and never re-scrapes the live page.

## 1. Open and stabilize the page

```
mcp__chrome-devtools__new_page { url: "<url>" }
mcp__chrome-devtools__resize_page { width: 1440, height: 900 }
```

Many modern sites are JS-rendered, lazy-load heavily, and gate animations behind IntersectionObserver — a section's fade-in only fires when it scrolls into view. Stabilize with a combined script that waits, walks the page in viewport-sized steps to hydrate lazy sections **and let each step's animations settle**, then scrolls back to the top. A single jump to the bottom is not enough for Wix portfolio pages that reveal each project only when its band enters the viewport:

```
mcp__chrome-devtools__evaluate_script { function: "async () => { const settle = async () => { const t0 = Date.now(); while (Date.now() - t0 < 3000) { const running = document.getAnimations().filter(a => a.playState === 'running' && a.effect && a.effect.getTiming().iterations !== Infinity); if (running.length === 0) break; await new Promise(r => requestAnimationFrame(r)); } await new Promise(r => setTimeout(r, 300)); }; await new Promise(r => setTimeout(r, 2500)); let previousHeight = 0; let h = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight); const step = Math.max(420, Math.floor(window.innerHeight * 0.72)); for (let pass = 0; pass < 2; pass++) { for (let y = 0; y <= h + window.innerHeight; y += step) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 220)); await settle(); h = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight); } if (h === previousHeight) break; previousHeight = h; } window.scrollTo(0, 0); await settle(); return { title: document.title, h, images: Array.from(document.images).filter(img => img.complete && img.naturalWidth > 0).length }; }" }
```

The `iterations !== Infinity` filter matters: marquees and looping spinners never finish, and without it the settle loop would always hit the timeout.

If the settled screenshot shows content that `analysis.json.images[]` missed, or if mid-page crops are blank where section headings/assets are known to exist, rerun extraction after this stepped-scroll pass and replace `analysis.json` before downloading assets. Treat the screenshot as the authority: missing lazy image inventory is a capture failure, not a sparse design.

If a cookie/privacy banner is visible, take a snapshot, locate its dismiss/accept/decline button by `uid`, and click it with `mcp__chrome-devtools__click` before continuing. Do this even when the banner sits between sections rather than directly blocking the hero — otherwise visual QA will force the clone to reproduce transient consent UI instead of the actual site. If a benchmark intentionally keeps the banner, record it in `notes.md` and in the section spec as `Framework-specific widget: cookie-banner`.

Cookie/banner text to look for before screenshots: `we use cookies`, `accept cookies`, `cookie settings`, `decline all`, `privacy policy`.

## 2. Motion capture (scroll recording)

Animated sites — fade-in heroes, scroll-triggered reveals, parallax, carousels (see the motion classes in `references/animation-capture.md`) — cannot be trusted to a single screenshot: the snapshot lands mid-tween and the design brief inherits ghosted text and half-faded images. Record a top-to-bottom scroll instead and use the **settled frames** as the per-section visual reference.

**Primary path — `scripts/record-scroll.js` (Playwright, separate headless browser):**

```bash
node <skill-path>/scripts/record-scroll.js "<url>" "./clones/<slug>/.capture/motion" --width 1440 --height 900
```

One-time dependencies (install in the clone workspace, not the skill directory): `npm i playwright && npx playwright install chromium`, plus `ffmpeg` on the PATH (`brew install ffmpeg`). The script:

- records the viewport to `motion/scroll.webm` while smooth-scrolling top→bottom in steps, waiting at each step for finite animations to settle;
- takes an **animation census** before scrolling — `document.getAnimations()` plus reveal-library markers (`[data-aos]`, `.wow`, `[data-scroll]`, Wix motion attributes) — saved into the manifest;
- extracts `motion/frames/` (~2 fps keyframes, useful for understanding how the page animates) and `motion/settled/step-NN.png` (one frame per scroll step at its settled timestamp — the per-section visual references);
- writes `motion/manifest.json` mapping scroll positions → frames, with the census and a `hasMotion` flag.

Exit codes: `0` = full success; `3` = video + manifest saved but ffmpeg missing, frames not extracted (treat as partial success and either install ffmpeg and re-extract, or fall back to the burst below for stills); `2` = Playwright missing → use the fallback.

**Fallback path — screenshot burst via chrome-devtools MCP (no extra dependencies):**

In the already-open MCP tab, repeat for each scroll step (~85% of viewport height): `evaluate_script` to `window.scrollTo(0, y)` + run the same settle poll from §1, then `take_screenshot` (viewport, NOT fullPage) to `.capture/motion/settled/step-NN.png`. Afterward write `.capture/motion/manifest.json` by hand with the same shape the script produces (`video: null`, `steps[]` with `scrollY` + `settledFrame`, `census` from a one-off `evaluate_script` that returns `document.getAnimations()` info, `hasMotion`). Downstream steps read only the manifest and the settled frames, so they never need to know which path produced them.

**Static fast path:** if the census reports no finite animations and no reveal markers (`hasMotion: false`), skip frame study entirely — the full-page screenshots in §2b are sufficient and the workflow proceeds exactly as it did for static sites.

## 2b. Screenshots

Initial motion frames, before the final stabilization pass:
```
mcp__chrome-devtools__evaluate_script { function: "async () => { await new Promise(r => setTimeout(r, 500)); return document.title; }" }
mcp__chrome-devtools__take_screenshot { fullPage: false, filePath: ".capture/<slug>/motion-start.png" }
mcp__chrome-devtools__evaluate_script { function: "async () => { await new Promise(r => setTimeout(r, 1500)); return document.title; }" }
mcp__chrome-devtools__take_screenshot { fullPage: false, filePath: ".capture/<slug>/motion-end.png" }
```

Take the full-page screenshots **after** the stepped scroll in §1 (and after §2's recording if you used the MCP fallback in the same tab) — by then every scroll-triggered reveal has fired and the page is in its final, fully-revealed state. A screenshot taken before the scroll pass captures pre-animation opacity-0 elements as blank gaps.

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
  "sections": [ {
    "index": 0, "top": 0, "height": 900,
    "bg": "rgba(0, 0, 0, 0)",             // computed backgroundColor of the tightest wrapper
    "bgImage": null,                       // computed backgroundImage of the tightest wrapper
    "effectiveBg": {                       // actual bg a user sees — may come from ancestor or sibling bg layer
      "color": "rgba(0, 0, 0, 0)",
      "image": "linear-gradient(180deg, #1a1f4c 0%, #0038ff 100%)",
      "source": "ancestor"                // "wrapper" | "ancestor" | "sibling"
    },
    "dividerAbove": null,                  // { top, width, height, color } if a thin horizontal rule sits within 40px of the section top
    "dividerBelow": { "top": 943, "width": 1185, "height": 1, "color": "rgba(255,255,255,0.15)" },
    "heading": "...", "imgCount": 2
  } ],
  "dividers": [ { "top": 943, "width": 1185, "height": 1, "color": "rgba(255,255,255,0.15)" } ],
  "palette":  [ { "hex": "#rrggbb", "count": 123 } ],   // from hero-image histogram
  "nav":      [ "Home", "About", ... ],
  "images":   [ { "src": "...", "alt": "...", "w": 1600, "h": 900 } ],
  "media":    { "videos": [ { "src": "...", "poster": "...", "w": 1920, "h": 1080 } ] },
  "motion": {
    "totalElements": 12,
    "signalCounts": { "transition": 8, "css-animation": 2, "carousel-like": 1 },
    "cssKeyframes": 4,
    "libraries": [ "gsap" ],
    "samples": [ { "selector": "div.hero", "signals": [ "transition", "transform" ] } ]
  },
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
- **`tokens.pageBackground`** is set when a single gradient element covers ≥80% of `pageHeight` and ≥60% of viewport width — this is the "one long gradient behind the whole page" pattern that builder templates paint as a body background. When this field is non-null, write the gradient into `theme.json` `styles.background.gradient` so `<body>` inherits it, and **do not** re-emit it on any section pattern. Any section whose `effectiveBg.image` matched this gradient will already have `effectiveBg = { image: null, source: 'pageBackground' }` so the pattern generator can cleanly skip background emission.
- **`sections[i].effectiveBg`** is the bg a user actually sees, recovered by walking up to 4 ancestors and scanning absolutely-positioned siblings whose Y band overlaps the section by ≥80%. Page builders (Wix, Webflow, Squarespace) routinely layer gradients and images on a separate background div while the semantic section wrapper stays transparent, so `bg` / `bgImage` alone will miss them. Prefer `effectiveBg.image` when emitting a pattern; fall back to `effectiveBg.color`, then `bg` / `bgImage`. Respect the `source` field: `'pageBackground'` and `'inherited'` both mean "the body or a preceding section owns this bg — do not emit".
- **`sections[i].dividerAbove` / `dividerBelow`** are thin (1–4 px) horizontal rules that span ≥60% of the viewport and sit within 40 px of the section's top or bottom edge. Emit a `core/separator` block when they're present; don't invent one when absent.
- **`dividers[]`** lists every candidate divider on the page. Useful for cross-referencing when a divider sits between two sections and you want to confirm attribution.
- **`motion`** lists CSS transitions/keyframes, transform states, sticky/fixed elements, carousel/marquee/parallax/Lottie-like markers, and known animation libraries. Use `references/animation-capture.md` to decide whether to preserve, reduce, or stub each motion class.
- **`sections[i].motion`** is the section-scoped subset of the motion inventory. It must be copied into the spec's Motion profile.
- **`images[]`** includes both visible `<img>` elements and CSS `background-image` URLs. The `kind` field is `img` or `background`; background entries include a `rect` so project-card and hero media can be placed correctly.
- **`media.videos[]`** lists visible video elements with poster/source URLs and rects. Use the poster as the default WordPress fallback. If no poster exists, document the missing frame in the section spec and prefer a nearby captured still, texture, or GIF with the same visual role before falling back to a same-size placeholder.
- **Video/canvas frame instability:** when the downloaded poster/background URL renders a different frame than `desktop.png` or `mobile.png`, create a local captured-still asset from the screenshot crop for that section (for example `assets/img-37.png`) and list it in the spec. This is the correct fallback for Wix video or Three.js heroes whose visible frame is not represented by a stable poster URL.
- **`diagnostics.afterDedupe < 3`** is a failure signal — the page has no recoverable section structure. Fall back to the screenshot-only flow (see Known limitations).

## 4. Download every captured image (do NOT defer)

Many image CDNs sign their URLs, geoblock, or rate-limit. Download **immediately** after extraction, before moving to the per-section loop. Don't filter — download all of them so the per-section step has local paths available for every image it might reference.

Prefer the bundled downloader, which handles `<img>`, CSS background images, and visible video posters:

```bash
node <skill-path>/scripts/download-assets.js ./clones/$SLUG/.capture/analysis.json ./clones/$SLUG/.capture/assets
```

If that is unavailable, write a Bash loop that iterates `analysis.json.images[]`:

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

## 4a. Download the display + body fonts (self-host instead of `@import`)

The extractor returns `tokens.display.fontFamily` / `tokens.body.fontFamily`. Match those against the substitution table in `references/theme-tokens.md` to pick a Google Fonts target, then download the WOFF2 files during capture — *not* at `@import` time in the generated theme. Self-hosting means the theme renders identically offline and without a flash of unstyled text while Google Fonts loads.

Save to `./clones/<slug>/.capture/fonts/<family>-<weight>.woff2` and write a `fonts/manifest.json` mapping each local file to its `{ family, weight, style, unicodeRange }`. Step 2 (foundation) copies this directory into `theme/assets/fonts/` and emits `@font-face` rules in `theme/style.css`.

```bash
SLUG="<slug>"
FDIR="./clones/$SLUG/.capture/fonts"
mkdir -p "$FDIR"

# Build the Google Fonts CSS URL from the substitution targets chosen in theme-tokens.md.
# Example: display=Syne (weights 600,700,800), body=Inter (weights 400,500,600,700)
GF_URL="https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap"

# Google Fonts serves different CSS based on User-Agent. The `Mozilla/5.0` UA below
# returns WOFF2, which is what modern WP supports. Omit the UA and you'll get TTF.
curl -sL -A 'Mozilla/5.0' "$GF_URL" -o "$FDIR/fonts.css"

# Parse the @font-face rules: extract the src URL, family, weight, style, and the
# `unicode-range` per subset. Download each WOFF2 under a deterministic filename.
python3 - <<'PY'
import re, json, os, subprocess
css = open('$FDIR/fonts.css').read()
blocks = re.findall(r'@font-face\s*\{[^}]+\}', css)
manifest = []
for i, b in enumerate(blocks, 1):
    family = re.search(r"font-family:\s*'([^']+)'", b).group(1)
    weight = re.search(r'font-weight:\s*(\d+)', b).group(1)
    style  = re.search(r'font-style:\s*(\w+)', b).group(1)
    url    = re.search(r'url\((https:[^)]+\.woff2)\)', b).group(1)
    urange = re.search(r'unicode-range:\s*([^;]+);', b)
    name = f'{family.lower().replace(" ", "-")}-{weight}-{style}-{i:02d}.woff2'
    out  = os.path.join('$FDIR', name)
    subprocess.run(['curl', '-sL', '-A', 'Mozilla/5.0', '-o', out, url], check=True)
    manifest.append({'local': name, 'family': family, 'weight': int(weight), 'style': style, 'unicodeRange': urange.group(1).strip() if urange else None})
json.dump(manifest, open('$FDIR/manifest.json', 'w'), indent=2)
print(f'downloaded {len(manifest)} font files')
PY
```

Step 2's foundation step then:

1. Copies `.capture/fonts/*.woff2` → `theme/assets/fonts/*.woff2`.
2. Writes one `@font-face` block per manifest entry into `theme/style.css`, pointing `src` at `url('./assets/fonts/<local>') format('woff2')`.
3. Omits any `@import` from `fonts.googleapis.com` in the generated `style.css`.

`theme.json`'s `settings.typography.fontFamilies` should reference the family name (e.g. `"Syne"`), letting WP wire the preset to the `@font-face`-loaded face.

**When to skip the download:** if the Google Fonts CSS URL 429s (rate limit) or the network is offline, emit the existing `@import` fallback in `theme/style.css` and flag it in `theme/notes.md`. Next iteration can retry.

## 5. Per-section deep extraction (one call per section)

For each section in `analysis.json.sections[]`, run `scripts/extract-section.js` against its Y band. This returns the full DOM tree, computed styles, text content, and image inventory for **just that section**, which becomes the source of truth for the spec file in step 3 of `SKILL.md`.

**Settle before extracting.** The extractor reads computed styles — if a reveal animation is mid-tween, you capture `opacity: 0.4` and a half-translated `transform` instead of the design's final values. Before each call, scroll the band into view and wait for animations to finish (the extractor itself also re-runs this settle internally, but pre-scrolling fires the section's IntersectionObserver so there is something to settle):

```
mcp__chrome-devtools__evaluate_script { function: "async () => { window.scrollTo(0, <top> - 100); await new Promise(r => setTimeout(r, 400)); const t0 = Date.now(); while (Date.now() - t0 < 3000) { const running = document.getAnimations().filter(a => a.playState === 'running' && a.effect && a.effect.getTiming().iterations !== Infinity); if (running.length === 0) break; await new Promise(r => requestAnimationFrame(r)); } await new Promise(r => setTimeout(r, 300)); return window.scrollY; }" }
```

Then run the extractor:

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

The node-level `motion` fields inside `tree` feed the spec's Motion profile (see `references/animation-capture.md` and `references/spec-files.md`). Cross-check them against `.capture/motion/manifest.json`'s census — the manifest sees load-time animations the per-section pass may have missed (they finished before extraction), while the tree sees scroll-triggered ones precisely per band.

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
