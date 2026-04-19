---
name: wp-clone-to-block-theme
description: Clone a public website into a WordPress block theme that reproduces layout, imagery, palette, typography, and real section content. Captures the live page via chrome-devtools MCP, downloads all referenced images, writes per-section spec files from computed styles, and dispatches parallel builder agents in git worktrees to emit one WP block pattern per section. Handles Wix / Webflow / Squarespace / Shopify builders too — the extractor falls back to Y-band clustering when the source page has no semantic section markup. Use when the user asks to "clone this site to WordPress", "convert to block theme", "rebuild this page as a block theme", "pixel-perfect block theme clone", or provides any public URL.
---

# Clone a website into a WordPress block theme

## Overview

This skill turns any public URL into a WordPress block theme that reproduces the source page's layout, imagery, palette, typography, and real content — not a structural scaffold. Every generated pattern is backed by a per-section spec file extracted from computed styles with local asset paths. No placeholder text. No generic 3-column filler. If the captured section is a 10-image gallery, the generated pattern is a 10-image gallery.

The workflow builds on two proven patterns: a block-theme skeleton + section-mapping templates + brightness-based `core/cover` rule + CORS-tainted palette fallback (all bundled in this skill), and the Next.js `ai-website-cloner-template-master/.claude/skills/clone-website` conventions for exhaustive `getComputedStyle()` extraction, interaction-model gating, spec-file contracts, **parallel dispatch in git worktrees**, **foundation-first sequencing**, **build gate at every step**, and **pre-dispatch checklist**.

## Prerequisites

Stop and tell the user if any of these are missing.

- **chrome-devtools MCP** (tools `mcp__chrome-devtools__*`) — required for source-page capture and for screenshotting the deployed clone.
- **Node.js 18+ and `npx`** — required to run `@wp-playground/cli@latest`, which spins up a persistent local WordPress at `http://127.0.0.1:9400` to host the generated theme. Details in `references/playground-cli.md`. This replaces the previous wp-playground MCP path (which required a live browser tab + WebSocket bridge).
- **`curl`, `bash`, `python3`, `node`, `git`** on the host — for asset download, JSON validation, JS syntax checks, and worktree orchestration.
- A working directory for the clone output (default: `./clones/<slug>/`).

## Workflow

Eight steps in fixed order: **capture → design brief → foundation → specs → pre-dispatch check → parallel dispatch → assemble → deploy & visual QA**. Step 4 is a hard gate before step 5. Step 1b (design brief) is written once, immediately after capture, and is consulted by every subsequent step.

### 1. Capture

Read `references/capture.md`. Produce under `./clones/<slug>/.capture/`:

- `desktop.png` — full-page 1440×900 screenshot
- `mobile.png` — full-page 390×844 screenshot
- `analysis.json` — from `scripts/extract.js` via `evaluate_script`. Contains tokens, deduped sections, nav, image inventory, and a `diagnostics.sectionStrategy` field (`'semantic' | 'y-band'`) that records which detection path ran.
- `assets/` — every image from `analysis.json.images` downloaded via `curl -L` immediately. CDN-signed URLs expire; download before the loop moves on. Named `img-01.<ext>`, `img-02.<ext>`, ... with mapping in `assets/manifest.json`.
- `sections/<n>.json` — one deep extract per section from `scripts/extract-section.js`. Full computed-style tree for every element, plus text and image URLs. This is the source of truth for step 3.
- `fonts/<family>-<weight>-<style>-NN.woff2` — one WOFF2 per subset downloaded from Google Fonts for the display + body families. See `references/capture.md` step 4a.

**Capture health check:** if `analysis.diagnostics.afterDedupe < 3`, the page has no recoverable section structure. Fall back to a single-pattern theme (hero cover + gallery of all downloaded images). Skip steps 3–5 and jump to step 6 with the single pattern. Step 1b still runs — the design brief is site-wide and not per-section.

### 1b. Design brief

Read `references/design-brief.md`. Produce **`./clones/<slug>/design.md`** from the captured tokens, palette, per-section JSONs, and desktop screenshot. The brief is a 9-section design system contract:

1. Visual Theme & Atmosphere
2. Color Palette & Roles
3. Typography Rules
4. Component Stylings
5. Layout Principles
6. Depth & Elevation
7. Do's and Don'ts
8. Responsive Behavior
9. Agent Prompt Guide

Every subsequent step (foundation, spec writing, dispatched builders, visual QA) reads `design.md` and keeps styling decisions consistent with it. The file is written once here and frozen during pattern work — only visual-QA iteration 3 is allowed to correct it, and when it does, all downstream artifacts must be regenerated to match.

`design.md` is the skill's design contract, equivalent to how `analysis.json` is the capture contract and `specs/section-<n>.md` is the per-section contract.

### 2. Foundation (build-gated)

Foundation reads `design.md` first. Sections 2, 3, 5, and 6 of the brief are the authoritative source for palette slugs, font stack, spacing scale, and shadow stack — `references/theme-tokens.md` only describes the *format* these values take in `theme.json`.

**Foundation artifacts must exist before any spec is dispatched to a builder.** This guarantees every worktree can rely on `theme.json`, palette slugs, font presets, and image paths being stable.

Emit into `./clones/<slug>/theme/`:

- `theme.json` — from `references/theme-tokens.md`, including the brightness-based `core/cover` vs `core/group` rule.
- `style.css` — minimal theme header; description ends with "Benchmark reference only — not for publication." when the source site is third-party.
- `assets/fonts/` — self-hosted fonts **copied from `.capture/fonts/`** (downloaded in step 1/4a). Emit one `@font-face` block per `fonts/manifest.json` entry into `style.css`. Do **not** use `@import url('https://fonts.googleapis.com/...')` — `references/capture.md` step 4a replaces that path with local WOFF2 files.
- `assets/` — **copy** every file from `./clones/<slug>/.capture/assets/` so the theme ships its own media.
- `templates/index.html`, `templates/front-page.html`, `parts/header.html`, `parts/footer.html` — initialized from `assets/block-theme-skeleton/`. Pattern slugs inside `front-page.html` are left as comment placeholders; step 6 wires them up.

**Build gate (run now and after every subsequent mutation):**

```bash
python3 -c "import json; j = json.load(open('theme/theme.json')); assert j['version'] == 3; assert '$schema' in j"
node --check scripts/extract.js
node --check scripts/extract-section.js
```

If the build gate fails here, do not proceed. Fix `theme.json` or the extractor and rerun.

### 3. Write per-section spec files

Read `references/spec-files.md`. For each section in `analysis.json.sections`, write a spec file to `./clones/<slug>/specs/section-<n>-<type>.md`.

The spec file is a contract between extraction and generation. Fill every field. If a field truly does not apply, write `n/a` — but most fields apply to most sections.

**Interaction model** goes in every spec: `static`, `gallery`, `media-text`, `columns`, `cover-with-headline`, `logo-strip`, `testimonial`, `cta`, `blog-card-grid`, `price-list`, `color-block-grid`, `footer`, `nav`. This string drives template selection in step 5. Prefer `blog-card-grid` over `columns` for post/insight listings, and `price-list` over `columns` for services/packages — the generic `columns` template produces the wrong visual for both.

**Content and assets** — spec files hold verbatim captured text and **local** asset paths (`assets/img-07.jpg`, not the CDN URL). Button labels, heading text, paragraph copy — all from the real site, not paraphrased.

**Design brief references** — every spec file's **Generation instructions** section ends with a "Design brief citations" bullet list: which `design.md` subsections this section depends on. Example: "Component > Cards & Containers for shadow and radius; Typography > Card Heading for title size and weight; Color Palette > Surface & Shadows for card bg." Builders read both files in step 5.

### 4. Pre-dispatch checklist (hard gate)

Every spec file must pass this checklist before step 5 dispatches a builder for it. Skipping a gate means the builder will need re-work; enforce it.

1. **Spec exists** at `specs/section-<n>-<type>.md`; filename matches the captured interaction model.
2. **Computed styles captured** — the spec's "Captured palette" and "Layout" sections contain actual `rgb()`/`px` values from `.capture/sections/<n>.json`, not guesses.
3. **Interaction model set** — one of the allowed values listed in step 3. Never empty.
4. **Copyright flag set** — `none` or a specific reason. Never blank.
5. **Images local-pathed** — every image in the spec references `assets/img-NN.<ext>`, never a remote URL.
6. **Brightness recorded** — the per-section background brightness is computed and in the spec, so the builder picks the right cover-vs-group variant.
7. **Template name valid** — "Block template to use" names an existing entry in `references/section-mapping.md`.
8. **Spec under ~150 lines** — if the spec is longer, the section is probably too complex for one builder; split it into sub-sections.

If any gate fails, fix the spec before dispatching. Do not send a partial spec to a builder and hope they figure it out.

### 5. Parallel dispatch (worktrees)

Read `references/parallel-dispatch.md`. One builder subagent per spec file, each working in its own `git worktree` branch to eliminate merge conflicts.

- Main branch owns `theme/theme.json`, `theme/style.css`, `theme/assets/`, `theme/parts/*`, `theme/templates/*`.
- Each worktree owns **only** `theme/patterns/section-<n>.php`.
- Builders read **both** `design.md` and `references/section-mapping.md` to pick the block template matching their interaction model, fill placeholders from their spec + the design brief's Component Stylings section, and emit the pattern file. Every builder agent prompt must include: "Your pattern must follow `design.md`. When choosing backgrounds, radii, button colors, shadows, or typography, cite the specific subsection of `design.md` driving the choice. Do not introduce values that aren't documented there."
- Orchestrator merges worktrees sequentially onto main, running the build gate (see step 2) after each merge.

If fewer than 3 sections exist, or the user explicitly asks, run builders sequentially without worktrees. The checklist, template selection, and build gate still apply.

### 6. Assemble

Wire patterns into `templates/front-page.html`:

```
<!-- wp:pattern {"slug":"<theme-slug>/section-1"} /-->
<!-- wp:pattern {"slug":"<theme-slug>/section-2"} /-->
...
```

Emit `parts/header.html` from `analysis.nav` if present; otherwise fall back to `core/site-title` only. Emit `parts/footer.html` from the captured footer section's spec (if a section tagged `footer` exists), else keep the skeleton default.

Run the build gate once more. Everything must pass before deploy.

### 7. Deploy and visual QA diff

Read `references/playground-cli.md` to launch the local WordPress and `references/visual-qa.md` for the screenshot + diff procedure. In short: write `clones/<slug>/blueprint.json`, run `npx @wp-playground/cli@latest server --port=9400 --mount=./clones/<slug>/theme:/wordpress/wp-content/themes/<slug> --blueprint=./clones/<slug>/blueprint.json` in the background, wait for `http://127.0.0.1:9400/` to respond, then chrome-devtools navigate + full-page screenshot at 1280×1400 and 390×844. Compare side-by-side with `.capture/desktop.png` and `.capture/mobile.png`.

For each visible discrepancy, classify as **A** (spec was wrong → re-extract that section), **B** (template dropped information → fix `section-mapping.md` and regenerate), or **C** (WP renders differently than expected → record in `notes.md` as a known gap).

Iterate to match section order, image placement, palette, and typography. **Budget 3 iterations per site.** If the diff still fails after 3 redeploys, stop and write a failure entry in `notes.md`.

## Copyright and licensing

Third-party websites are copyrighted. This skill is only appropriate for:

- Sites the user owns, or
- Third-party website templates the user is entitled to reuse, or
- Benchmark / educational evaluation where the output stays local and is never published

For third-party sites: the generated theme's `style.css` header must say "Benchmark reference only — not for publication." Do not reproduce trademarked logos, celebrity photography, or copyrighted editorial imagery verbatim — substitute a same-dimensions placeholder SVG in `theme/assets/` and flag it in `theme/notes.md` with the exact file name and a one-line reason. The pattern still renders, the layout still reads, and nothing protected is redistributed.

## Resources

- `scripts/extract.js` — full-page capture extractor. Semantic-landmark preflight (`<section>`, `<header>`, `<footer>`, `<nav>`, `<main>`, `<article>`, `[role="region"]` filtered to visible + height ≥ 200 px); falls through to Y-band clustering only when fewer than 3 semantic landmarks are found. Largest-visible-text display sampler, framework-default button blacklist, CORS-tainted palette fallback. Pass the body as the `function` argument to `evaluate_script`.
- `scripts/extract-section.js` — per-section deep extractor. Walks a 40-property `getComputedStyle()` tree rooted at the section wrapper.
- `references/capture.md` — capture procedure, asset download loop, per-section extraction loop, font self-host download.
- `references/design-brief.md` — the `design.md` template and filling rules for step 1b (9-section design system contract).
- `references/spec-files.md` — spec file template and how to fill it.
- `references/section-mapping.md` — block-markup templates per interaction model, with placeholder variables.
- `references/theme-tokens.md` — `analysis.tokens` → `theme.json`, brightness-based `core/cover` vs `core/group` rule, commercial-to-free font substitution table.
- `references/parallel-dispatch.md` — worktree setup, builder agent prompt template, merge procedure, build-gate commands.
- `references/playground-cli.md` — launch a persistent local WordPress via `@wp-playground/cli` (blueprint, mount, persistence, teardown).
- `references/visual-qa.md` — deploy via the CLI playground, screenshot at 1280×1400 + 390×844, side-by-side diff, 3-iteration budget.
- `assets/block-theme-skeleton/` — minimal block theme to copy before filling in.
- `assets/blueprint-template.json` — starting blueprint for `@wp-playground/cli --blueprint=` (activates the theme, wires front-page).

## What NOT to do

Lessons from previous benchmark failures — each cost hours of rework.

- **Do not skip image download.** A theme without real images looks like an empty scaffold regardless of layout accuracy. Run the asset download in step 1, immediately after capture, before CDN-signed URLs expire.
- **Do not use the skeleton's hardcoded hero/features patterns as-is for every site.** The skeleton is a starting point — step 5 must replace or delete its patterns with real ones from the spec files.
- **Do not reproduce every section type as a generic 3-column layout.** A logo strip is not a feature grid. A media-text is not a columns block. A testimonial is not a cover. Use the right template per interaction model from `references/section-mapping.md`.
- **Do not use `core/cover` when the base brightness ≥ 200.** The cover block forces white inner text on an overlay and produces invisible content on light backgrounds. Use `core/group` with explicit contrast text color. Rule lives in `references/theme-tokens.md` and `references/section-mapping.md`.
- **Do not dispatch a builder without the 8-item pre-dispatch checklist passing.** Partial specs produce patterns that need a second pass and waste the worktree.
- **Do not skip the build gate.** It is three commands and catches JSON typos, JS syntax errors, and invalid `theme.json` schema versions before they reach wp-playground.
- **Do not skip the visual QA diff.** A theme that activates cleanly can still look nothing like its source. The diff catches this on site #1.
- **Do not inline CDN URLs in the generated theme.** Signed query strings and geoblocked hosts break the theme in deploys. Always `get_theme_file_uri('assets/...')`.
