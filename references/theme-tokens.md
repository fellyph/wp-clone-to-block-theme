# Extracting theme.json tokens from captured styles

Translate the `tokens` and `palette` objects in `analysis.json` into a `theme.json` for the generated block theme. Aim for a clean, minimal token set — do not port every computed value verbatim.

## Colors

The extractor returns two color sources:

- **`tokens.button`** — a non-framework-default button color, when one was found. Null otherwise. The extractor blacklists known page-builder default button colors (currently `rgb(17, 109, 255)` / `#116DFF`, the Wix editor's default) because every page that hasn't been customized will return it, and it's almost never the user's actual brand color. If `tokens.defaultButtonSkipped: true` you can confirm the blacklist fired.
- **`palette[]`** — top colors sampled from the largest hero `<img>` via a 5-bit-per-channel histogram. May be empty if the image was CORS-tainted (many CDNs refuse cross-origin canvas reads).

Decide the palette in this order:

1. **`base`** — almost always white (`#ffffff`) or the captured `tokens.body.bg` if it's a near-white off-white.
2. **`contrast`** — `tokens.body.color` when it's a dark color; otherwise `#111111`.
3. **`primary`** — first try `tokens.button.bg`. If null, take `palette[0].hex` if it's not near-white and not near-black. If both fail, use a neutral charcoal `#1a1a1a`.
4. **`secondary`** — `palette[1]` if present, else a light tint of `primary`.
5. Optionally `tertiary` / `accent` from `palette[2..3]` if they are visually distinct.

Cap the palette at 6 named colors. Always include `base` and `contrast` so WP's duotone and style variations work.

```json
"color": {
  "palette": [
    { "slug": "base", "name": "Base", "color": "#ffffff" },
    { "slug": "contrast", "name": "Contrast", "color": "#111111" },
    { "slug": "primary", "name": "Primary", "color": "#2563eb" },
    { "slug": "secondary", "name": "Secondary", "color": "#f1f5f9" }
  ]
}
```

**Never use a page-builder default color as `primary` unless the original site is genuinely branded in that color.** The extractor already blacklists the known defaults; honor its signal. If you find yourself tempted to override `tokens.defaultButtonSkipped: true` and use the skipped color, first verify against the desktop screenshot that the color actually appears as a brand accent and not just as an unstyled button.

## Typography

`tokens.display.fontFamily` is the source of truth — it's the largest visible text on the page, not whatever `<h1>` happens to be in the DOM. `tokens.body.fontFamily` is sampled from a paragraph-sized text element, not from `getComputedStyle(body)` (which often returns a browser default like `Arial, Helvetica, sans-serif` and is useless).

Many builder sites use commercial fonts via their own CDNs. You cannot ship those. Match the captured family against this commercial-to-free substitution table:

| Captured family substring (case-insensitive) | Free replacement |
| --- | --- |
| `madefor-display`, `madefor-text`, `madefor` | Inter (Google Fonts) |
| `helvetica-w01`, `helveticaneuew01`, `helveticaneuew02`, `helveticaneuew10` | Inter or system Helvetica Neue |
| `helvetica neue`, `helvetica` | Inter or system stack |
| `avenir next`, `avenir` | Nunito Sans (Google Fonts) |
| `futura` | Jost (Google Fonts) |
| `proxima nova`, `proxima-nova` | Montserrat (Google Fonts) |
| `sofia pro`, `sofia-pro` | Manrope (Google Fonts) |
| `ideal sans` | Source Sans 3 (Google Fonts) |
| `brandon grotesque`, `brandon-grot` | Mulish (Google Fonts) |
| `adobe garamond pro`, `adobe-garamond` | EB Garamond (Google Fonts) |
| `gotham` | Inter or Montserrat |
| `freight sans`, `freight-sans` | Source Sans 3 (Google Fonts) |
| `freight display`, `freight-display` | Cormorant Garamond (Google Fonts) |
| `eb garamond` | EB Garamond (Google Fonts — already free, use as-is) |
| `playfair display`, `playfair` | Playfair Display (Google Fonts — use as-is) |
| `cormorant garamond`, `cormorant` | Cormorant Garamond (Google Fonts — use as-is) |
| `bodoni`, `libre bodoni` | Libre Bodoni (Google Fonts) |
| `libre baskerville`, `baskerville` | Libre Baskerville (Google Fonts — use as-is) |
| Webflow default UI sans | Inter (Google Fonts) |
| Squarespace default serif | Cormorant Garamond or Playfair Display |
| Typekit-served family with `typekit.net` or `use.typekit.com` URL | Look up the kit ID → match against this table; otherwise pick a visual lookalike (serif → EB Garamond, sans-serif → Inter) |
| `wfont_*` (hashed Wix font name) or any other hashed/obfuscated family | **Unrecoverable** — fall back to a visual lookalike based on the screenshot: serif → EB Garamond, sans-serif → Inter, display → Archivo Black |

Match by case-insensitive substring against `tokens.display.fontFamily`. Self-host via the theme's `assets/fonts/` directory or load via Google Fonts in a stylesheet enqueue. Never reference a commercial-font CDN (`parastorage.com`, `static.wixstatic.com`, `use.typekit.net`, `fonts.squarespace-cdn.com`, `uploads-ssl.webflow.com`).

If `tokens.h1Swapped: true`, the captured display element is the actual headline and `legacyH1Size` is a small kicker — use `tokens.display.fontSize` for the `xx-large` preset upper bound, not `legacyH1Size`.

## Font sizes

Build a fluid scale. Use `clamp()` for responsive sizes:

```json
"fontSizes": [
  { "slug": "small",  "name": "Small",  "size": "0.875rem" },
  { "slug": "medium", "name": "Medium", "size": "1rem" },
  { "slug": "large",  "name": "Large",  "size": "clamp(1.25rem, 1.1rem + 0.5vw, 1.5rem)" },
  { "slug": "x-large","name": "XL",     "size": "clamp(1.75rem, 1.4rem + 1.5vw, 2.5rem)" },
  { "slug": "xx-large","name": "XXL",   "size": "clamp(2.5rem, 1.8rem + 3vw, 4rem)", "fluid": false }
]
```

Pick the `xx-large` upper bound from `tokens.display.fontSize` (in `rem`, where 1rem = 16px). For example, captured `fontSize: 110` (px) → `xx-large` upper = `6.875rem`. Cap at `8rem` to avoid runaway display sizes.

## Spacing

Snap derived spacing to:

```
20: 0.25rem
30: 0.5rem
40: 1rem
50: 1.5rem
60: 2rem
70: 3rem
80: 4rem
```

Use these for block spacing presets and template spacing. Don't hardcode pixel values in templates.

## Layout widths

From the captured `tokens.contentWidth`:

```json
"layout": {
  "contentSize": "720px",
  "wideSize": "1200px"
}
```

Round `wideSize` to the nearest 20px below `contentWidth` (captured `1425px` → `1400px`). Set `contentSize` to ~720–820px for readable prose regardless of `wideSize`.

## The brightness rule (determines `core/cover` vs `core/group` hero)

After picking `base` and `contrast`, compute the brightness of `base`:

```
brightness = 0.299 * R + 0.587 * G + 0.114 * B
```

- **brightness ≥ 200** (near-white base) → pattern generation MUST use the `core/group` variant of the `cover-with-headline` template from `references/section-mapping.md`. `core/cover` forces its inner text color to white when an overlay is present, which produces invisible headings on light backgrounds. This is a hard rule, not a preference.
- **brightness < 200** (dark base) → `core/cover` is fine and its default white inner text reads correctly.

Record the computed brightness value in the spec file's "Captured palette" section so the pattern generator can pick the right template variant without recomputing.

## What NOT to copy

- Hashed class selectors from page builders (`.comp-xxxx`, `.txt-xxxx`, `.w-XXXX`, `.sqsrte-*`)
- Inline absolute `top/left` positioning
- Builder-specific CSS variables (`--wix-*`, `--sqs-*`, `--w-*`) — start fresh with `--wp--preset--*`
- Any font file hosted on a builder CDN (`parastorage.com`, `wixstatic.com`, `fonts.squarespace-cdn.com`, `uploads-ssl.webflow.com`)
- Framework-default button colors as brand colors — the extractor already blacklists these via `tokens.defaultButtonSkipped`
