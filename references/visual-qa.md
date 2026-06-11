# Visual QA diff

Mandatory final step. Deploy the generated theme to a local WordPress site via WordPress Studio CLI, screenshot the rendered result, and iterate until the diff against the captured source is acceptable. Do not declare the clone complete without this step.

## Contents

1. Deploy with Studio CLI
2. Screenshot the Studio URL
3. Diff
4. Motion QA
5. Failure classes (A / B / C)
6. Iteration budget
7. Diff report output
8. When the `core/cover` white-text bug bites

## 1. Deploy with Studio CLI

Full procedure lives in `references/studio-cli.md`. The short version:

0. Run the artifact validator and fix any failures before launching WordPress:
   ```bash
   node <skill-path>/scripts/validate-artifacts.js ./clones/<slug>
   ```
1. Deploy or resync the clone into a nested Studio site:
   ```bash
   node scripts/studio-site.js deploy ./clones/<slug>
   ```
2. Read the local URL from Studio:
   ```bash
   studio site status --path ./clones/<slug>/studio-site
   ```

The generated theme remains at `./clones/<slug>/theme/`. The deploy helper copies it into `./clones/<slug>/studio-site/wp-content/themes/<slug>/`, activates it, and repeats the static front-page setup. After editing `theme/patterns/*.php` or `theme/style.css`, rerun the deploy helper and reload the Studio URL.

## 2. Screenshot the Studio URL

Use the local URL printed by `studio site status`; do not assume a fixed port. Because the site is a real HTTP URL, chrome-devtools can screenshot it directly.

When the theme carries reveal animations (the skeleton's `reveal.js` system, used whenever the capture found motion), the deployed clone has the same screenshot hazard the source did: `.reveal` elements sit at `opacity: 0` until scrolled into view. Run the stepped scroll first so every one-shot reveal has fired, then screenshot — otherwise the full-page PNG shows blank gaps that aren't real defects.

```
mcp__chrome-devtools__new_page { url: "<studio-local-url>" }
mcp__chrome-devtools__resize_page { width: 1280, height: 1400 }
# Hydrate fonts + images, then step-scroll to fire all reveals, then return to top:
mcp__chrome-devtools__evaluate_script { function: "async () => { await new Promise(r => setTimeout(r, 2000)); const step = Math.round(window.innerHeight * 0.85); for (let y = 0; y < document.body.scrollHeight; y += step) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 450)); } window.scrollTo(0, 0); await new Promise(r => setTimeout(r, 1400)); return document.title; }" }
mcp__chrome-devtools__take_screenshot { fullPage: true, filePath: "clones/<slug>/wp-result-desktop.png" }
```

For mobile (reveals are already fired for this tab; a short settle is enough):
```
mcp__chrome-devtools__resize_page { width: 390, height: 844 }
mcp__chrome-devtools__evaluate_script { function: "async () => { await new Promise(r => setTimeout(r, 1000)); return true; }" }
mcp__chrome-devtools__take_screenshot { fullPage: true, filePath: "clones/<slug>/wp-result-mobile.png" }
```

After capture, check the actual screenshot dimensions. Some Wix layouts keep a fixed wide canvas on a 390px viewport, so `mobile.png` may be wider than 390px (for example `980px`). In that case, reproduce the source `scrollWidth` with a theme-scoped `min-width` instead of forcing a narrow responsive stack; visual QA should compare against the captured mobile image dimensions, not the requested viewport alone.

If `take_screenshot` returns before the page is fully painted, increase the wait to 4-5 s or scroll to the bottom and back to trigger lazy hydration (same script used in capture).

## 3. Diff

Read the screenshots side-by-side in this order:

1. `clones/<slug>/.capture/desktop.png` — source of truth
2. `clones/<slug>/wp-result-desktop.png` — current clone

Walk the page section by section from top to bottom. For each section check:

| Check | Pass condition |
| --- | --- |
| Section order | Same sections appear in the same vertical order |
| Background colors | Each section's bg matches within a visible-difference threshold (don't obsess over 2-LAB-unit deltas; obvious wrong colors only) |
| Typography | Heading sizes and weights are in the same ballpark; serif vs sans-serif matches; caps/lowercase matches |
| Image placement | Every image in the source capture has a corresponding image in the WP result at the same grid position |
| Image content | Downloaded images are the same images as the source (not placeholder gray) |
| Button presence | CTAs appear where they did in the source, with matching labels |
| Footer | Same layout, same copyright line, same social links if present |

Repeat against the mobile pair.

## 4. Motion QA

For sites with `analysis.motion.totalElements > 0` or benchmark `motionFrameDelta > 0.02`, run a separate motion check:

| Check | Pass condition |
| --- | --- |
| Entry state | First viewport does not hide content or flash a blank state |
| Direction | Simple reveal/parallax/marquee direction matches the source |
| Timing | Duration feels close to captured `animationDurationMs` / `transitionDurationMs` |
| Final state | Settled WP frame matches the source settled screenshot |
| Mobile | Hover-only content is visible or tappable without hover |
| Reduced motion | `prefers-reduced-motion: reduce` disables non-essential animation and leaves content readable |

Use `references/animation-capture.md` for reproduction rules. A site targeting 90% UI match cannot pass with a motion `fail`; either preserve the simple motion or document a deliberate framework fallback in `notes.md`.

## 5. Failure classes

### Failure class A — spec file was wrong

The `specs/section-<n>-<type>.md` file has a value that doesn't match what the site actually shows. Re-run `scripts/extract-section.js` for that section's Y band, update the spec, regenerate the pattern (step 5 of `SKILL.md`), redeploy, screenshot again.

If the extractor and the screenshot disagree, the screenshot wins. Page builders can expose hidden or off-band DOM content that is technically extractable but not visually present in the capture. Mark those cases in the spec's "Notes for the pattern generator" and either omit the visible output or preserve only its vertical rhythm.

### Failure class B — pattern template dropped information

The spec was correct, but the block-markup template in `references/section-mapping.md` doesn't have a placeholder for the information that's missing (e.g. the spec listed a `{{SECONDARY_BUTTON}}` but the `cover-with-headline` template only has one button). Fix the template in `section-mapping.md`, regenerate the pattern, redeploy, screenshot again.

### Failure class C — WP rendering differs from expected

The spec and generation are both correct but WP produces a different visual than expected (e.g. `core/cover` is adding unwanted padding, `core/gallery` is applying unexpected gap). Document as a known gap in `clones/<slug>/notes.md` — do not hack the pattern around it. If the gap is important, file it as a follow-up for the skill itself.

## 6. Iteration budget

Budget **3 iterations** per site. If after 3 redeploys the diff still doesn't pass, stop and write a failure entry in `notes.md` with the list of outstanding discrepancies. Do not keep iterating indefinitely.

## 7. Diff report output

For each site, append to `clones/<slug>/notes.md`:

```markdown
## Visual QA pass

- Iteration 1: <what broke, what was fixed>
- Iteration 2: <...>
- Iteration 3: <...>
- Final score: <pass | partial | fail>
- Motion score: <pass | partial | fail | n/a>
- Remaining gaps:
  - <gap 1>
  - <gap 2>
```

Stop the Studio site once the loop ends if it is no longer needed:

```bash
studio site stop --path ./clones/<slug>/studio-site
```

## 8. When the `core/cover` white-text bug bites

Symptom: hero text is invisible in the deployed screenshot because the light base color + `core/cover` combination forces white text. This is a known bug documented in `references/section-mapping.md` under "The brightness rule".

**Fix in place** — update `patterns/section-<n>.php` to use the `core/group` variant of `cover-with-headline` from `section-mapping.md`. Redeploy with `node scripts/studio-site.js deploy ./clones/<slug>`. This should always be a class-B (template) fix, never a class-A (spec) fix.
