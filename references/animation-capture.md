# Animation capture and reproduction

Complex portfolio and agency sites often look close in a still screenshot but fail the UI match because motion, hover states, and scroll effects are missing. Treat animation as captured design data, not an optional flourish.

## Source data

Use these artifacts:

- `analysis.json.motion` — page-wide motion inventory from `scripts/extract.js`.
- `analysis.json.sections[*].motion` — per-section motion signals and samples.
- `analysis.json.media.videos` — visible video sources/posters for static `core/cover` fallbacks.
- `.capture/sections/<n>.json.tree[*].motion` — node-level animation/transition details from `scripts/extract-section.js`.
- `.capture/motion/manifest.json` — animation census + scroll-step↔frame map from `scripts/record-scroll.js` (or the MCP screenshot-burst fallback in `references/capture.md` §2).
- `.capture/motion/settled/step-NN.png` — per-step settled frames from the scroll recording. These are the per-section visual reference and supersede the `motion-start`/`motion-end` estimates when present.
- `motion-start.png` and `motion-end.png` from the benchmark runner — initial viewport frames used to estimate visible animation delta.
- `desktop.png` and `mobile.png` — final settled state.

## Motion classes

Classify every moving section as one of these:

| Class | Preserve in WP? | Implementation |
| --- | --- | --- |
| `none` | n/a | Static blocks only. |
| `css-transition` | yes | Emit hover/focus transition classes in `style.css`. |
| `css-keyframes` | yes, when simple | Copy timing/direction/easing into theme-scoped keyframes; use captured duration. |
| `entry-reveal` | yes | Use opacity + translate transforms with staggered delays. Keep final state visible if JS is absent. |
| `marquee` | yes | CSS-only horizontal keyframes; pause on hover; honor reduced motion. |
| `carousel` | partial | Render all images as a responsive grid unless the source carousel state is essential; add an explicit comment if autoplay is dropped. |
| `parallax` | partial | Retain static background/image placement; use `background-attachment: fixed` only if the source effect is simple and not mobile-critical. |
| `video` | partial | Use `core/cover` with poster image and comment that live video was reduced. |
| `lottie` | no by default | Stub with a static poster/placeholder and explicit comment. |
| `scroll-triggered` | partial | Preserve the final visible state and simple reveal transitions; do not recreate complex pinned timelines in block markup. |

## Pattern requirements

- Add a **Motion profile** section to every spec, even when it says `none`.
- Generated animation CSS must be theme-scoped, for example `.wp-block-group.clone-section-3 .clone-reveal`.
- Always add a `@media (prefers-reduced-motion: reduce)` rule that disables non-essential animation and leaves content visible.
- Do not hide content behind an animation-only initial state. If JavaScript or CSS fails, the final content must still be readable.
- For hover-only portfolio cards, preserve the default card title/image and make hover overlays additive. Mobile must expose the same labels without requiring hover.
- For cookie banners, chat widgets, and platform badges detected in screenshots, do not recreate them as site content. Record them in `notes.md` as source chrome.
- For Wix video-text masks or videos with an empty `poster`, do not leave the area blank. Use the nearest captured still/texture/GIF asset as a visual fallback, reference that fallback in the section spec, and record the missing poster in `notes.md`.
- For animated hero videos, canvas, or Three.js scenes whose downloaded poster/background URL does not match the captured screenshot frame, crop the visible hero/section still from `desktop.png` and `mobile.png` into local `assets/img-NN.png` files. Use those as the visual fallback. If the crop already contains heading/nav/button text, keep the semantic DOM text in the pattern for validation/accessibility but visually hide the duplicate overlay with section-scoped CSS.

## Visual QA

During visual QA, compare both:

1. Settled stills: source `desktop.png` / `mobile.png` vs WP screenshots.
2. Motion frames: source `motion-start.png` / `motion-end.png` vs WP entry state when the first viewport visibly animates.

Score motion separately:

- `pass` — simple transitions/keyframes match the direction, duration, and visible final state.
- `partial` — static state matches, but complex framework motion is intentionally reduced.
- `fail` — animation removal changes layout meaning, hides content, or removes a core brand effect.

If a site needs a 90% visual match, a `fail` motion score blocks completion even when the still screenshot looks acceptable.
