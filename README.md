# Liberate It

Liberate It is a skill for converting a public website into a WordPress block theme.

Given a URL, it captures the live page, extracts design tokens and real content, downloads local assets, writes per-section build specs, generates a full block theme, deploys it to a local WordPress Studio site, and runs visual QA against the source screenshots.

The output is a benchmark/reference clone: a runnable WordPress block theme with real structure, real copy, local media, theme tokens, templates, parts, and one pattern per captured section. It is not intended for publishing third-party copyrighted designs without permission.

## What You Get

- A WordPress block theme for each source URL under `./clones/<slug>/theme/`
- Captured desktop and mobile screenshots under `./clones/<slug>/.capture/`
- `analysis.json` with extracted tokens, sections, nav, image inventory, motion signals, and diagnostics
- Per-section JSON captures with computed styles and real DOM content
- Downloaded assets with a manifest mapping remote URLs to local `assets/img-NN.*` files
- Per-section spec files under `./clones/<slug>/specs/`
- A local WordPress Studio preview with the generated theme activated
- Desktop and mobile result screenshots for visual comparison

## Requirements

- Codex or Claude Code with skill support
- `chrome-devtools` MCP tools for page capture, DOM evaluation, and screenshots
- Node.js 18+ for helper scripts
- WordPress Studio CLI (`studio`) for local WordPress preview and theme deployment
- `curl`, `bash`, `python3`, `node`, and `git`
- Network access to the target site and its assets during capture

The skill stops early if a required capture or deploy dependency is missing. Asset download happens immediately after extraction because builder/CDN image URLs can expire.

## Install

Install the skill into your global Codex skills directory:

```bash
git clone https://github.com/fellyph/wp-clone-to-block-theme.git \
  ~/.codex/skills/liberate-it
```

Project-scoped install:

```bash
mkdir -p .codex/skills
git clone https://github.com/fellyph/wp-clone-to-block-theme.git \
  .codex/skills/liberate-it
```

Claude Code users can use the same destination name under `.claude/skills/`:

```bash
git clone https://github.com/fellyph/wp-clone-to-block-theme.git \
  ~/.claude/skills/liberate-it
```

After installing, restart the agent session so the skill metadata is loaded. The skill identifier is `liberate-it`; the display name is "Liberate It".

The commands above keep the current GitHub repository URL and install it into a `liberate-it` skill directory. If the repository is renamed later, replace the source URL and keep the destination directory as `liberate-it`.

## How To Use

Invoke the skill directly:

```text
/liberate-it https://example.com/
```

Or describe the goal in natural language:

```text
Convert https://example.com/ into a WordPress block theme.
```

```text
Liberate this site into WordPress and match the design closely: https://example.com/
```

Output is written to `./clones/<slug>/`. The generated theme lives at `./clones/<slug>/theme/`, and the local WordPress Studio site lives at `./clones/<slug>/studio-site/`.

To get the local preview URL after deployment:

```bash
studio site status --path ./clones/<slug>/studio-site
```

## How Liberate It Works

Liberate It runs a fixed, build-gated workflow.

1. **Capture** - Opens the source URL with chrome-devtools, stabilizes lazy-loaded content, takes desktop and mobile screenshots, runs `scripts/extract.js`, downloads images and video posters, and extracts each section with `scripts/extract-section.js`.
2. **Design brief** - Writes `design.md`, a site-wide design contract covering visual theme, palette, typography, components, layout rules, responsive behavior, and motion.
3. **Foundation** - Creates the block theme foundation: `theme.json`, `style.css`, templates, parts, copied media, and self-hosted fonts when available.
4. **Spec files** - Writes one markdown spec per captured section with verbatim text, local asset paths, computed styles, layout, brightness, motion, and the selected interaction model.
5. **Pre-dispatch checklist** - Verifies each spec has computed values, local images, copyright flags, inline SVG handling, motion notes, brightness, and a valid block template.
6. **Pattern generation** - Builds one WordPress block pattern per section. Larger pages can dispatch builders in separate git worktrees so each builder owns only `theme/patterns/section-<n>.php`.
7. **Assemble** - Wires all generated patterns into `templates/front-page.html` and emits header/footer parts from captured navigation and footer content.
8. **Artifact validation** - Runs `scripts/validate-artifacts.js` to catch missing images, unresolved placeholders, remote URLs, skeleton drift, and invalid block markup before WordPress deploy.
9. **Deploy and visual QA** - Deploys the theme with `node scripts/studio-site.js deploy ./clones/<slug>`, screenshots the Studio URL, compares desktop and mobile output against the source, then iterates up to three times.

## Important Design Rules

- Real content wins: headings, paragraphs, CTA labels, nav labels, and visible section text come from the captured site.
- Assets are local: generated block markup must use theme assets, not remote CDN URLs.
- Specs drive generation: every pattern is backed by a completed section spec.
- Light backgrounds avoid `core/cover`: when brightness is 200 or higher, templates use `core/group` with explicit contrast text.
- Motion is documented: entry reveals, carousels, marquees, parallax, video, and hover states are preserved where practical or reduced to a documented static fallback.
- Third-party output is local reference material unless the user owns or has rights to the source design and assets.

## Repository Layout

```text
.
├── SKILL.md                          # Liberate It workflow and prerequisites
├── scripts/
│   ├── extract.js                    # Full-page extractor with semantic + Y-band fallback
│   ├── extract-section.js            # Per-section computed-style walker
│   ├── download-assets.js            # Deterministic local asset downloader
│   ├── studio-site.js                # WordPress Studio deployment helper
│   └── validate-artifacts.js         # Specs-to-patterns validation gate
├── references/
│   ├── capture.md                    # Capture procedure
│   ├── design-brief.md               # Site-wide design contract template
│   ├── spec-files.md                 # Per-section spec template
│   ├── section-mapping.md            # Interaction models to WP block templates
│   ├── theme-tokens.md               # theme.json rules and font substitutions
│   ├── parallel-dispatch.md          # Git worktree builder workflow
│   ├── studio-cli.md                 # Studio CLI deploy and preview flow
│   └── visual-qa.md                  # Screenshot comparison and iteration rules
└── assets/
    ├── block-theme-skeleton/         # Starter block theme files
    └── blueprint-template.json       # Studio-compatible setup blueprint
```

## Validation

Useful checks while editing the skill:

```bash
node --check scripts/extract.js
node --check scripts/extract-section.js
node --check scripts/download-assets.js
node --check scripts/studio-site.js
node --check scripts/validate-artifacts.js
```

When a clone exists, run:

```bash
node scripts/validate-artifacts.js ./clones/<slug>
```

## License

[GPL-2.0-or-later](LICENSE). Same license as the WordPress themes this skill produces.
