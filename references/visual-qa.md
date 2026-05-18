# Visual QA diff

Mandatory final step. Deploy the generated theme to a local WordPress via `@wp-playground/cli`, screenshot the rendered result, and iterate until the diff against the captured source is acceptable. Do not declare the clone complete without this step.

## Contents

1. Deploy (local playground)
2. Screenshot (chrome-devtools against `http://localhost:9400`)
3. Diff
4. Motion QA
5. Failure classes (A / B / C)
6. Iteration budget
7. Diff report output
8. When the `core/cover` white-text bug bites

## 1. Deploy (local playground)

Full procedure lives in `references/playground-cli.md`. The short version:

0. Run the artifact validator and fix any failures before launching WordPress:
   ```bash
   node <skill-path>/scripts/validate-artifacts.js ./clones/<slug>
   ```
1. Copy `assets/blueprint-template.json` to `./clones/<slug>/blueprint.json` and replace `THEME_SLUG` with the theme folder name (`supermembros`, `roeeby`, etc.).
2. Launch the CLI playground in the background (Claude Code: `Bash` tool with `run_in_background: true`):
   ```bash
   npx @wp-playground/cli@latest server \
     --port=9400 \
     --mount=./clones/<slug>/theme:/wordpress/wp-content/themes/<slug> \
     --blueprint=./clones/<slug>/blueprint.json
   ```
3. Poll until the server responds:
   ```bash
   until curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:9400/ | grep -q '^200$'; do sleep 1; done
   ```

No file upload. No base64 binaries. The theme is mounted directly from disk — changes to `theme/patterns/*.php` or `theme/style.css` only need a page reload to take effect (unless WP caches templates; `?nocache=1` forces a rebuild).

## 2. Screenshot (chrome-devtools against `http://localhost:9400`)

Because the site is a real HTTP URL — not an iframe inside `playground.wordpress.net` — chrome-devtools can screenshot it directly. Skip the iframe-resizing workaround from the previous workflow; it is no longer needed.

```
mcp__chrome-devtools__new_page { url: "http://127.0.0.1:9400/" }
mcp__chrome-devtools__resize_page { width: 1280, height: 1400 }
# Wait ~2s for WP to hydrate fonts + images:
mcp__chrome-devtools__evaluate_script { function: "async () => { await new Promise(r => setTimeout(r, 2000)); return document.title; }" }
mcp__chrome-devtools__take_screenshot { fullPage: true, filePath: "clones/<slug>/wp-result-desktop.png" }
```

For mobile:
```
mcp__chrome-devtools__resize_page { width: 390, height: 844 }
mcp__chrome-devtools__take_screenshot { fullPage: true, filePath: "clones/<slug>/wp-result-mobile.png" }
```

After capture, check the actual screenshot dimensions. Some Wix layouts keep a fixed wide canvas on a 390px viewport, so `mobile.png` may be wider than 390px (for example `980px`). In that case, reproduce the source `scrollWidth` with a theme-scoped `min-width` instead of forcing a narrow responsive stack; visual QA should compare against the captured mobile image dimensions, not the requested viewport alone.

If `take_screenshot` returns before the page is fully painted, increase the wait to 4–5 s or scroll to the bottom and back to trigger lazy hydration (same script used in capture).

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

Stop the playground server once the loop ends (see `references/playground-cli.md` §6).

## 8. When the `core/cover` white-text bug bites

Symptom: hero text is invisible in the deployed screenshot because the light base color + `core/cover` combination forces white text. This is a known bug documented in `references/section-mapping.md` under "The brightness rule".

**Fix in place** — update `patterns/section-<n>.php` to use the `core/group` variant of `cover-with-headline` from `section-mapping.md`. Redeploy (no restart needed — the mount is live). This should always be a class-B (template) fix, never a class-A (spec) fix.
