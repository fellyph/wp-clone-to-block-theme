---
name: liberate-it
description: Liberate It clones a public website into a WordPress block theme that reproduces layout, imagery, palette, typography, motion cues, and real section content. It captures the live page via chrome-devtools MCP, records a top-to-bottom scroll video so animated sites (fade-in heroes, scroll-triggered reveals, parallax, carousels) are captured in their settled state instead of mid-animation, downloads referenced assets, writes per-section spec files from computed styles, and dispatches parallel builder agents in git worktrees to emit one validated WP block pattern per section — with entrance animations reproduced in the generated theme via a bundled reveal system. Handles Wix, Webflow, Squarespace, Shopify, and other builder sites too; the extractor falls back to Y-band clustering when the source page has no semantic section markup. Use when the user asks to "clone this site to WordPress", "convert to block theme", "rebuild this page as a block theme", "pixel-perfect block theme clone", "liberate this site", or provides any public URL that should become a WordPress site — especially for animated or builder-made sites.
---

# Liberate It: Clone a Website into a WordPress Block Theme

## Overview

Liberate It turns any public URL into a WordPress block theme that reproduces the source page's layout, imagery, palette, typography, motion cues, and real content — not a structural scaffold. Every generated pattern is backed by a per-section spec file extracted from computed styles with local asset paths. No placeholder text. No generic 3-column filler. If the captured section is a 10-image gallery, the generated pattern is a 10-image gallery.

The workflow builds on two proven patterns: a block-theme skeleton + section-mapping templates + brightness-based `core/cover` rule + CORS-tainted palette fallback (all bundled in this skill), and the Next.js `ai-website-cloner-template-master/.claude/skills/clone-website` conventions for exhaustive `getComputedStyle()` extraction, interaction-model gating, spec-file contracts, **parallel dispatch in git worktrees**, **foundation-first sequencing**, **build gate at every step**, and **pre-dispatch checklist**.

## Prerequisites

Stop and tell the user if any of these are missing.

- **chrome-devtools MCP** (tools `mcp__chrome-devtools__*`) — required for source-page capture and for screenshotting the deployed clone.
- **WordPress Studio CLI (`studio`) and Node.js 18+** — required to create a persistent local WordPress site at `./clones/<slug>/studio-site/`, sync the generated theme, and report the local preview URL. Details in `references/studio-cli.md`.
- **`curl`, `bash`, `python3`, `node`, `git`** on the host — for asset download, JSON validation, JS syntax checks, and worktree orchestration.
- A working directory for the clone output (default: `./clones/<slug>/`).

Recommended but optional — the workflow degrades gracefully without them:

- **Playwright + ffmpeg** — `npm i playwright && npx playwright install chromium` (in the clone workspace) and `brew install ffmpeg`. Powers `scripts/record-scroll.js`, the scroll-video recorder that captures animated sites in their settled state. Without them, the capture step falls back to an MCP screenshot burst (same artifacts, no video). See `references/capture.md` §2.
- **wp-blockmarkup-mcp** (`claude mcp add wp-blockmarkup -- npx wp-blockmarkup-mcp`, Node 20+) — gives builders a `validate_markup` tool that catches block-recovery bugs (malformed delimiters, wrong class-name order, preset-slug casing) before they reach WordPress. Without it, builders run the `npx -y -p wp-blockmarkup-mcp wp-blocks validate` CLI or follow the manual checklist in `references/block-markup-quality.md`.

## Workflow

Nine steps in fixed order: **capture → design brief → foundation → specs → pre-dispatch check → parallel dispatch → assemble → artifact validation → deploy & visual QA**. Step 4 is a hard gate before step 5, and step 7b is a hard gate before deploy. Step 1b (design brief) is written once, immediately after capture, and is consulted by every subsequent step.

### 1. Capture

Read `references/capture.md`. Produce under `./clones/<slug>/.capture/`:

- `motion/` — top-to-bottom scroll recording: `scroll.webm` + per-step `settled/step-NN.png` frames + `manifest.json` (scroll positions, animation census, `hasMotion` flag). From `scripts/record-scroll.js` (Playwright) or the MCP screenshot-burst fallback. On animated sites the settled frames — not crops of the full-page screenshot — are the builders' visual reference, because the full-page shot can only show one moment while reveals fire per-section.
- `desktop.png` — full-page 1440×900 screenshot, taken **after** the stepped scroll pass so every scroll-triggered reveal has fired
- `mobile.png` — full-page 390×844 screenshot
- `analysis.json` — from `scripts/extract.js` via `evaluate_script`. Contains tokens, deduped sections, nav, image inventory, inline SVG/icon inventory, motion/animation inventory, and a `diagnostics.sectionStrategy` field (`'semantic' | 'y-band'`) that records which detection path ran.
- `assets/` — every image from `analysis.json.images` downloaded via `curl -L` immediately. CDN-signed URLs expire; download before the loop moves on. Named `img-01.<ext>`, `img-02.<ext>`, ... with mapping in `assets/manifest.json`.
- `sections/<n>.json` — one deep extract per section from `scripts/extract-section.js`. Full computed-style tree for every element, plus text and image URLs. This is the source of truth for step 3.
- `fonts/<family>-<weight>-<style>-NN.woff2` — one WOFF2 per subset downloaded from Google Fonts for the display + body families. See `references/capture.md` step 4a.

**Capture health check:** if `analysis.diagnostics.afterDedupe < 3`, the page has no recoverable section structure. Fall back to a single-pattern theme (hero cover + gallery of all downloaded images). Skip steps 3–5 and jump to step 6 with the single pattern. Step 1b still runs — the design brief is site-wide and not per-section.

### 1b. Design brief

Read `references/design-brief.md`. Produce **`./clones/<slug>/design.md`** from the captured tokens, palette, per-section JSONs, motion inventory, and desktop/mobile screenshots. The brief is a 10-section design system contract:

1. Visual Theme & Atmosphere
2. Color Palette & Roles
3. Typography Rules
4. Component Stylings
5. Layout Principles
6. Depth & Elevation
7. Do's and Don'ts
8. Responsive Behavior
9. Motion & Interaction System
10. Agent Prompt Guide

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
- `functions.php`, `templates/index.html`, `templates/front-page.html`, `parts/header.html`, `parts/footer.html` — initialized from `assets/block-theme-skeleton/`. `functions.php` enqueues `style.css` (Studio/Core may otherwise apply only `theme.json` global styles for block themes) and `assets/js/reveal.js`, and bootstraps the `html.js` class in `wp_head`. Pattern slugs inside `front-page.html` are left as placeholders; step 6 wires them up.
- `assets/js/reveal.js` + the reveal CSS block in `style.css` — from the skeleton: the one-shot scroll-reveal system. When the capture found motion, builders tag animated blocks with `reveal` + variant classes (`reveal-fade` / `reveal-slide-up` / `reveal-rise`) and the theme replays the source's entrance animations (IntersectionObserver, gated on `html.js` and `prefers-reduced-motion`). Tune the CSS transition duration to the captured timing from `motion/manifest.json`. See the `entry-reveal` row in `references/animation-capture.md`.

**Build gate (run now and after every subsequent mutation):**

```bash
python3 -c "import json; j = json.load(open('theme/theme.json')); assert j['version'] == 3; assert '$schema' in j"
node --check scripts/extract.js
node --check scripts/extract-section.js
node <skill-path>/scripts/validate-artifacts.js ./clones/<slug>
```

Run `validate-artifacts.js` only after specs and patterns exist; during the foundation-only pass, run the first three commands. If the build gate fails, do not proceed. Fix the failing source (`theme.json`, extractor scripts, specs, or generated patterns) and rerun.

### 3. Write per-section spec files

Read `references/spec-files.md`. For each section in `analysis.json.sections`, write a spec file to `./clones/<slug>/specs/section-<n>-<type>.md`.

The spec file is a contract between extraction and generation. Fill every field. If a field truly does not apply, write `n/a` — but most fields apply to most sections.

**Interaction model** goes in every spec: `static`, `gallery`, `media-text`, `columns`, `cover-with-headline`, `animated-cover`, `logo-strip`, `testimonial`, `cta`, `blog-card-grid`, `project-card-grid`, `price-list`, `color-block-grid`, `marquee-strip`, `horizontal-showcase`, `footer`, `nav`. This string drives template selection in step 5. Prefer `project-card-grid` for portfolio/case-study grids, `blog-card-grid` for post/insight listings, and `price-list` for services/packages — the generic `columns` template produces the wrong visual for all three.

**Content and assets** — spec files hold verbatim captured text and **local** asset paths (`assets/img-07.jpg`, not the CDN URL). Button labels, heading text, paragraph copy — all from the real site, not paraphrased.

**Design brief references** — every spec file's **Generation instructions** section ends with a "Design brief citations" bullet list: which `design.md` subsections this section depends on. Example: "Component > Cards & Containers for shadow and radius; Typography > Card Heading for title size and weight; Color Palette > Surface & Shadows for card bg." Builders read both files in step 5.

### 4. Pre-dispatch checklist (hard gate)

Every spec file must pass this checklist before step 5 dispatches a builder for it. Skipping a gate means the builder will need re-work; enforce it.

1. **Spec exists** at `specs/section-<n>-<type>.md`; filename matches the captured interaction model.
2. **Computed styles captured** — the spec's "Captured palette" and "Layout" sections contain actual `rgb()`/`px` values from `.capture/sections/<n>.json`, not guesses.
3. **Interaction model set** — one of the allowed values listed in step 3. Never empty.
4. **Copyright flag set** — `none` or a specific reason. Never blank.
5. **Images local-pathed** — every image in the spec references `assets/img-NN.<ext>`, never a remote URL.
6. **Inline SVGs/icons recorded** — visible non-downloadable SVGs from `.capture/sections/<n>.json.flat.svgs` are listed with a reproduction plan, or marked decorative.
7. **Brightness recorded** — the per-section background brightness is computed and in the spec, so the builder picks the right cover-vs-group variant.
8. **Motion profile recorded** — every section has `none`, `css-transition`, `css-keyframes`, `entry-reveal`, `marquee`, `carousel`, `parallax`, `video`, `lottie`, or `scroll-triggered` from `analysis.motion` / `.capture/sections/<n>.json`, plus the settled-frame pointer and reveal classes when the section animates.
9. **Template name valid** — "Block template to use" names an existing entry in `references/section-mapping.md`.
10. **Spec under ~170 lines** — if the spec is longer, the section is probably too complex for one builder; split it into sub-sections.

If any gate fails, fix the spec before dispatching. Do not send a partial spec to a builder and hope they figure it out.

### 5. Parallel dispatch (worktrees)

Read `references/parallel-dispatch.md`. One builder subagent per spec file, each working in its own `git worktree` branch to eliminate merge conflicts.

- Main branch owns `theme/theme.json`, `theme/style.css`, `theme/assets/`, `theme/parts/*`, `theme/templates/*`.
- Each worktree owns **only** `theme/patterns/section-<n>.php`.
- Builders read **both** `design.md` and `references/section-mapping.md` to pick the block template matching their interaction model, fill placeholders from their spec + the design brief's Component Stylings section, and emit the pattern file. Every builder agent prompt must include: "Your pattern must follow `design.md`. When choosing backgrounds, radii, button colors, shadows, or typography, cite the specific subsection of `design.md` driving the choice. Do not introduce values that aren't documented there."
- Builders' visual reference is the **settled frame** named in their spec's Motion profile, and every pattern's markup must pass the validation gate in `references/block-markup-quality.md` (the `mcp__wp-blockmarkup__validate_markup` tool when available, the CLI or manual checklist otherwise) before commit. Invalid markup triggers WordPress's block-recovery dialog and silently strips styling — catching it pre-commit is far cheaper than diagnosing it in visual QA.
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

### 7b. Artifact validation gate

Run:

```bash
node <skill-path>/scripts/validate-artifacts.js ./clones/<slug>
```

This validator compares `specs/section-*.md` to `theme/patterns/section-*.php` and catches drift that PHP/JSON syntax checks cannot see:

- expected images in the spec are exactly the local `assets/img-*` references in the pattern
- sections that say "no images" do not accidentally inherit skeleton images
- captured headings and CTA labels are present in the generated pattern
- no remote image URLs are present in block markup
- no unresolved `{{placeholder}}` strings remain
- no section pattern repaints a body-owned gradient
- templates, parts, and patterns contain only WordPress block HTML comments (`<!-- wp:* -->`)

If this gate fails, treat it as a class-B generation/template failure unless the spec itself is demonstrably wrong. Fix the spec or pattern and rerun the gate before launching Studio.

### 8. Deploy and visual QA diff

Read `references/studio-cli.md` to deploy the generated theme into a nested Studio site and `references/visual-qa.md` for the screenshot + diff procedure. In short: run `node scripts/studio-site.js deploy ./clones/<slug>`, read the local URL from `studio site status --path ./clones/<slug>/studio-site`, then chrome-devtools navigate + full-page screenshot at 1280×1400 and 390×844. Compare side-by-side with `.capture/desktop.png` and `.capture/mobile.png`.

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
- `scripts/extract-section.js` — per-section deep extractor. Walks a 40-property `getComputedStyle()` tree rooted at the section wrapper, after waiting for finite animations to settle.
- `scripts/record-scroll.js` — Playwright scroll recorder. Records `scroll.webm` while stepping top→bottom with animation settlement, runs an animation census, extracts settled frames + keyframes via ffmpeg, writes `motion/manifest.json`. Exit 2 = Playwright missing (use MCP fallback), exit 3 = ffmpeg missing (video saved, no frames).
- `scripts/validate-artifacts.js` — clone artifact validator. Runs before Studio deploy to compare specs against generated patterns and catch skeleton drift, remote assets, decorative comments, unresolved placeholders, and body-gradient repainting.
- `scripts/studio-site.js` — deploy helper that creates or starts `clones/<slug>/studio-site/`, syncs the generated theme, activates it, sets the static front page, and prints Studio site status.
- `scripts/download-assets.js` — downloads `analysis.json.images[]` and `analysis.json.media.videos[].poster` into deterministic `assets/img-NN.ext` files with a manifest.
- `scripts/benchmark-wix-sites.js` — batch capture/extraction sweep for public site targets. Given a `sites.json` list, writes desktop/mobile screenshots, top-viewport motion frames, `analysis.json`, per-site summaries, and an aggregate readiness/risk report.
- `references/animation-capture.md` — motion capture and reproduction rules for CSS transitions/keyframes, entry reveals, marquees, parallax, carousels, Lottie/video fallbacks, and reduced-motion behavior.
- `references/block-markup-quality.md` — block markup validity rules (delimiters, class order, preset slugs, nesting) and the three-tier validation gate (wp-blockmarkup MCP, `wp-blocks validate` CLI, manual checklist) builders run before committing.
- `references/capture.md` — capture procedure, asset download loop, per-section extraction loop, font self-host download.
- `references/design-brief.md` — the `design.md` template and filling rules for step 1b (10-section design system contract).
- `references/spec-files.md` — spec file template and how to fill it.
- `references/section-mapping.md` — block-markup templates per interaction model, with placeholder variables.
- `references/theme-tokens.md` — `analysis.tokens` → `theme.json`, brightness-based `core/cover` vs `core/group` rule, commercial-to-free font substitution table.
- `references/parallel-dispatch.md` — worktree setup, builder agent prompt template, merge procedure, build-gate commands.
- `references/studio-cli.md` — create or reuse a persistent local WordPress site via Studio CLI, run WP-CLI, and optionally publish a preview site.
- `references/visual-qa.md` — deploy via Studio CLI, screenshot at 1280×1400 + 390×844, side-by-side diff, 3-iteration budget.
- `assets/block-theme-skeleton/` — minimal block theme to copy before filling in.
- `assets/block-theme-skeleton/functions.php` — enqueues the generated `style.css` fallback stylesheet and `assets/js/reveal.js`, and bootstraps the `html.js` class for the reveal CSS.
- `assets/block-theme-skeleton/assets/js/reveal.js` — one-shot scroll-reveal replayer (IntersectionObserver adds `is-revealed` once per element; everything stays visible without JS or under reduced motion). Pairs with the reveal CSS block in the skeleton `style.css`.
- `assets/blueprint-template.json` — Studio-compatible Blueprint setup for the static front page and site title.

## What NOT to do

Lessons from previous benchmark failures — each cost hours of rework.

- **Do not skip image download.** A theme without real images looks like an empty scaffold regardless of layout accuracy. Run the asset download in step 1, immediately after capture, before CDN-signed URLs expire.
- **Do not use the skeleton's hardcoded hero/features patterns as-is for every site.** The skeleton is a starting point — step 5 must replace or delete its patterns with real ones from the spec files.
- **Do not reproduce every section type as a generic 3-column layout.** A logo strip is not a feature grid. A media-text is not a columns block. A testimonial is not a cover. Use the right template per interaction model from `references/section-mapping.md`.
- **Do not use `core/cover` when the base brightness ≥ 200.** The cover block forces white inner text on an overlay and produces invisible content on light backgrounds. Use `core/group` with explicit contrast text color. Rule lives in `references/theme-tokens.md` and `references/section-mapping.md`.
- **Do not dispatch a builder without the 10-item pre-dispatch checklist passing.** Partial specs produce patterns that need a second pass and waste the worktree.
- **Do not skip the build gate.** It is three commands and catches JSON typos, JS syntax errors, and invalid `theme.json` schema versions before they reach Studio.
- **Do not screenshot an animated site before the scroll pass.** Scroll-triggered reveals leave pre-animation elements at `opacity: 0` — a too-early full-page screenshot captures blank gaps and ghosted heroes, and every downstream artifact (design brief, specs, QA diff) inherits the corruption. Run the stepped scroll (and the recording) first; on animated sites the settled frames in `.capture/motion/settled/` are the per-section truth. The same rule applies to the deployed clone when the theme carries reveals — see `references/visual-qa.md`.
- **Do not skip the visual QA diff.** A theme that activates cleanly can still look nothing like its source. The diff catches this on site #1.
- **Do not inline CDN URLs in the generated theme.** Signed query strings and geoblocked hosts break the theme in deploys. Always `get_theme_file_uri('assets/...')`.
