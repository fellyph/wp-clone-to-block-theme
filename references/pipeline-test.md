# Pipeline test

How to prove the skill still works end to end after changing any of its scripts, the skeleton, or the capture contract. Five tiers, each gating the next — a failure at tier N means the tiers after it would be testing on a broken foundation, so stop and fix rather than pressing on.

There is no test framework here: the pipeline's inputs are live third-party websites and its outputs are judged visually. What follows is the substitute — a fixed order, exact commands, and machine-checkable assertions wherever one is possible.

Pick a target that actually exercises the thing you changed. A builder-made animated site (Wix, Framer, Webflow) stresses motion capture, wrapper selection, and lazy growth; a static semantic site stresses almost none of it.

## Tier 0 — static checks

No network, seconds.

```bash
npm run check                                          # node --check every script
node scripts/validate-artifacts.js ./clones/<known-good-clone>
```

The second command is the regression gate. Keep at least one previously-passing clone on disk and require it to keep passing. New validation must be *conditional* on the artifacts it validates existing — if a check you added fires on an older clone that predates the feature, the check is wrong, not the clone.

## Tier 1 — recorder in isolation

No MCP, no WordPress. Install Playwright in the clone workspace, never in the skill directory:

```bash
mkdir -p clones/<slug> && cd clones/<slug>
npm i playwright && npx playwright install chromium
cd -
node scripts/record-scroll.js "<url>" "./clones/<slug>/.capture/motion" --width 1440 --height 900
node scripts/check-motion-manifest.js "./clones/<slug>/.capture/motion"
```

`check-motion-manifest.js` asserts the invariants: exit 0, monotonic `scrollY`, non-shrinking `pageHeightAtStep`, the pass reached the bottom, one settled frame per step at exactly the viewport size, and it warns when more than 30% of steps never settled or when no banner was dismissed.

Two things it cannot assert, which you must check by hand:

- **Reproducibility.** Run the recorder three times and diff the manifests. `steps.length` and the `scrollY` sequence must be stable. Instability means the settle logic is timing-dependent and every artifact downstream is non-deterministic.
- **ffmpeg independence.** Re-run once with ffmpeg removed from `PATH` (`env PATH=/usr/bin:/bin node scripts/record-scroll.js ...`). It must still exit 0 with every settled frame present — the frames come from `page.screenshot()`, and any dependence on ffmpeg is a regression.

Also open `settled/step-00.png` next to the top of `desktop.png`: same chrome, same banner state. A banner in one and not the other means builders and QA are working from different pictures.

## Tier 2 — extractor in isolation

In the chrome-devtools MCP tab: run the §1 stabilize script from `references/capture.md`, then `extract-section.js` against two or three band coordinates from `analysis.json`.

Then repeat with the DevTools tab explicitly backgrounded (switch to another tab). It must **return within a few seconds, not hang** — this is the regression test for the settle poll, which must never wait on `requestAnimationFrame` because Chrome freezes rAF outright in a hidden tab.

When a previous capture of the same URL exists, diff the trees against it. Expect a shallower tree (passthrough wrappers collapsed) and the same or wider `wrapper.rect.width` (the ≥60%-viewport preference). A *narrower* wrapper than before is a regression: the extractor picked a builder's inner column and silently dropped the section's other content.

## Tier 3 — full pipeline

Run all nine steps of `SKILL.md` into `./clones/<slug>/`. Checkpoints, in order:

1. after step 1 — `manifest.hasMotion` is set and `settled/` is populated;
2. after step 3 — every spec's `**Settled frame:**` path exists on disk;
3. at step 4 — checklist item 8 is machine-checked by the validator, not eyeballed;
4. at step 7b — `node scripts/validate-artifacts.js ./clones/<slug> --strict-motion` passes.

## Tier 4 — deploy and failsafe QA

```bash
node scripts/studio-site.js deploy ./clones/<slug>
```

Then the stepped-scroll-then-screenshot procedure in `references/visual-qa.md` §2 — never screenshot before the scroll pass, or `reveal.js` will not have fired and the PNG shows blank gaps that are not real defects. Follow with the three reveal failsafe probes in §4a.

## Comparing two runs of the same URL

A prior clone of the same site is the most informative artifact you can have: same skill, same target, different code. Compare on these axes and write the numbers into `clones/<slug>/notes.md`.

| Axis | Compare | Reading |
| --- | --- | --- |
| Section detection | `analysis.json` `diagnostics.afterDedupe` and `sectionStrategy` | Should be unchanged unless you deliberately touched detection. A silent change here invalidates every per-section comparison below. |
| Styles at rest | `sections/<n>.json` `styles.opacity` / `styles.transform` | The settle poll's whole purpose. Mid-tween values in the old run and clean values in the new one is the proof it works — and if both are clean, the settle work bought nothing *on this site*. Say so; do not claim a win the data does not show. |
| Wrapper selection | `sections/<n>.json` `wrapper.rect.width` | Quantify how many sections got a wider wrapper. Narrower is a regression. |
| Visual fidelity | each run's `wp-result-desktop.png` against **its own** `.capture/desktop.png` | The one end-to-end number. `diffPngRatio()` in `scripts/benchmark-wix-sites.js` already does this (needs `pngjs`). |
| Motion fidelity | patterns against `settled/step-NN.png` | Standalone, not comparable, if the older theme had no reveal system. |

**Before drawing any cross-run conclusion, diff the two `.capture/desktop.png` files.** Live sites change. If the source itself moved between the runs, only the within-run comparisons (each clone against its own capture) are valid, and the fidelity row must be reported as inconclusive rather than as an improvement or a regression.
