# Per-section spec files

A spec file is a contract between extraction and pattern generation. One spec file per section. It contains every value needed to write the WP block pattern without re-running capture.

**Path:** `./clones/<slug>/specs/section-<n>-<type>.md`
**Source:** `./clones/<slug>/.capture/sections/<n>.json` (from `scripts/extract-section.js`)
**Consumed by:** Step 5 of `SKILL.md` — the pattern generator reads this file and picks the matching block template from `references/section-mapping.md`.

## Template

Copy this template verbatim for every section. Fill every field. If a field truly doesn't apply, write `n/a` — but most fields apply to most sections.

```markdown
# Section <n> — <Interaction Model>

## Identity

- **Index in page:** <n from analysis.json.sections>
- **Interaction model:** <static | cover-with-headline | media-text | columns | gallery | logo-strip | testimonial | cta | blog-card-grid | price-list | color-block-grid | footer | nav>
- **Y band:** top=<px>, height=<px>
- **Framework-specific widget:** <none | marquee | store | booking | form | chat | members | cms-collection | shopify-embed>
- **Copyright flag:** <none | contains trademarked logos | contains celebrity photography | contains copyrighted editorial imagery>

## Captured palette

- **Background color:** <hex from wrapper.styles.backgroundColor, e.g. #FFE600>
- **Background brightness:** <0-255 computed via 0.299R + 0.587G + 0.114B — drives cover-vs-group choice>
- **Text color:** <hex, e.g. #111111>
- **Accent color used inside section:** <hex or n/a>
- **Does the section overlay a background image?** <yes | no>
  - If yes: `assets/<local-filename>` — size <w×h> — alt text: "<alt>"

## Real content (verbatim from the site)

### Headings
- **h1:** "<exact text>" — captured font-size <Npx>, weight <N>, family "<family>"
- **h2:** "<exact text>" — captured size <Npx>
- **h3 etc.:** "<exact text>" — ...

### Body text / paragraphs
- "<exact paragraph text, up to 300 chars>"
- "<next paragraph>"

### Buttons
- Label: "<exact text>"; href: "<url>"; bg color: <hex>; text color: <hex>

### Lists / bullet items
- "<item 1>"
- "<item 2>"

## Images used in this section

For each image in `sections/<n>.json.flat.images`, list:

- `assets/img-<nn>.<ext>` — original alt "<alt>" — captured rect <w×h> — position in section <top-left | center | right-column | grid-item-N>

If this section has **layered images** (background + foreground stacked), list them in back-to-front order and mark which are positioned as `absolute`.

## Layout

- **Container width:** <px from wrapper.rect.width>
- **Padding:** <Npx top / right / bottom / left>
- **Child layout:** <grid | flex-row | flex-column | stack>
- **Column count (if grid/flex-row):** <N>
- **Gap between children:** <Npx>
- **Divider above:** <color + thickness (e.g. "rgba(255,255,255,0.15) 1px"), or n/a>
- **Divider below:** <color + thickness, or n/a>
- **Responsive notes:** <how does this change at 390px from the mobile screenshot?>

## Generation instructions

- **Block template to use (from `section-mapping.md`):** `<template-name>`
- **Placeholders to fill:**
  - `{{BG_COLOR}}` → <hex>
  - `{{BG_GRADIENT}}` → <linear-gradient(...) string, or n/a — wins over BG_COLOR when present>
  - `{{TEXT_COLOR}}` → <hex>
  - `{{HEADING}}` → "<text from above>"
  - `{{SUBHEADING}}` → "<text>"
  - `{{BUTTON_LABEL}}` → "<text>"
  - `{{BUTTON_HREF}}` → "<url>"
  - `{{ASSETS}}` → [`assets/img-<nn>.<ext>`, ...] (as a Bash array for the generator loop)
  - `{{COLUMN_COUNT}}` → <N>
  - `{{DIVIDER_ABOVE}}` → <color hex, or n/a>
  - `{{DIVIDER_BELOW}}` → <color hex, or n/a>
- **Substitutions made for copyright:** <none | img-04.jpg replaced with assets/placeholder-600x400.svg because it's a celebrity photo>
- **Design brief citations:** <list the `design.md` subsections this pattern depends on, e.g. "Component > Cards & Containers for shadow and radius; Typography > Card Heading for title size/weight; Color Palette > Surface & Shadows for card bg"> — the builder in step 5 reads both files and expects these citations.

## Notes for the pattern generator

Free-form notes that don't fit the template. Anything the pattern author needs to know — "this is a press-logo strip so use `core/columns` with uniform widths", "the background has a subtle gradient from #FFE600 to #FFEE66", "the heading is broken across three lines using explicit `<br>` so preserve them".
```

## How to fill a spec file

Read the matching `.capture/sections/<n>.json`. That file has three top-level keys:

- `wrapper` — the section container's tag, rect, and computed styles. Use this for **Captured palette** (background color, text color, overlay detection via `backgroundImage`).
- `tree` — the full DOM tree. Walk it to find per-element styles if you need more than the flat summary.
- `flat` — shortcut arrays: `text[]`, `images[]`, `buttons[]`. This is where most of the **Real content** and **Images** data comes from.

Example — given this `flat` payload from a captured section:

```json
{
  "text": [
    { "role": "heading", "text": "DESIGNER WHEEL COVERS", "size": "45px" },
    { "role": "subheading", "text": "5 collaborations", "size": "23px" }
  ],
  "images": [
    { "src": "https://cdn.example.com/abc.png", "alt": "Jason Naylor collab", "w": 220, "h": 220, "rect": { "top": 850, "left": 200 } },
    { "src": "https://cdn.example.com/def.jpg", "alt": "Tropical Flowers", "w": 221, "h": 220, "rect": { "top": 850, "left": 460 } }
  ],
  "buttons": []
}
```

The spec file for this section fills like:

```markdown
## Real content
### Headings
- **h2:** "DESIGNER WHEEL COVERS" — captured size 45px
- **h3:** "5 collaborations" — captured size 23px

## Images used in this section
- `assets/img-03.png` — alt "Jason Naylor collab" — 220×220 — grid-item-1
- `assets/img-04.jpg` — alt "Tropical Flowers" — 221×220 — grid-item-2

## Layout
- Child layout: flex-row (grid)
- Column count: 5
- Gap between children: ~20px

## Generation instructions
- **Block template to use:** `columns-of-images-with-label`
- **Placeholders to fill:**
  - `{{HEADING}}` → "DESIGNER WHEEL COVERS"
  - `{{ASSETS}}` → [assets/img-03.png, assets/img-04.jpg, ...]
  - `{{COLUMN_COUNT}}` → 5
```

## What makes a spec file "complete"

A spec file is complete when a human who has never seen the source page can read only this file and write the matching WP block pattern without guessing. If your generator has to make assumptions, go back to `.capture/sections/<n>.json` and re-read until you can fill the gap.

If you write `n/a` for more than 3 fields, the section probably needs re-extraction — either the section index was wrong, or the wrapper detection picked an empty outer container instead of the real section. Re-run `scripts/extract-section.js` with a different Y-band and try again.

The spec must also pass the 8-item pre-dispatch checklist in `SKILL.md` step 4 before the section goes out to a builder. If any gate fails, fix the spec first.
