# wp-clone-to-block-theme

A [Claude Code](https://claude.com/claude-code) skill that clones a public website into a WordPress block theme.

Given a URL, the skill extracts design tokens and real content via chrome-devtools MCP, emits per-section spec files from `getComputedStyle()`, generates a full block theme (`theme.json` + templates + parts + one pattern per section), and deploys it to a local WordPress via [`@wp-playground/cli`](https://wordpress.github.io/wordpress-playground/developers/local-development/wp-playground-cli/) for side-by-side visual QA.

Output is a **structural** clone with real assets and verbatim copy — not a pixel-perfect scrape. Designed for benchmark / reference work where WordPress core blocks can represent the source page's layout.

## What you get

- A runnable WordPress block theme per source URL under `./clones/<slug>/theme/`
- Captured source screenshots, per-section JSON, and downloaded assets under `./clones/<slug>/.capture/`
- A deployed local preview at `http://127.0.0.1:9400/` with the clone activated
- Side-by-side desktop + mobile screenshots for visual diff

## Requirements

- [Claude Code](https://claude.com/claude-code) with the `chrome-devtools` MCP
- Node.js 18+ (`npx @wp-playground/cli@latest`)
- `curl`, `bash`, `python3`, `node`, `git`

## Install

Drop the skill into your `~/.claude/skills/` directory:

```bash
git clone https://github.com/fellyph/wp-clone-to-block-theme.git \
  ~/.claude/skills/wp-clone-to-block-theme
```

Project-scoped install (only available in one repo):

```bash
git clone https://github.com/fellyph/wp-clone-to-block-theme.git \
  .claude/skills/wp-clone-to-block-theme
```

Confirm with `python3 ~/.claude/skills/skill-creator/scripts/quick_validate.py ~/.claude/skills/wp-clone-to-block-theme` — expect `Skill is valid!`.

## Usage

From Claude Code:

```
/wp-clone-to-block-theme https://example.com/
```

Or describe the task: "clone https://example.com/ to a WordPress block theme".

The skill runs 7 ordered steps:

1. **Capture** — chrome-devtools navigates to the URL, takes desktop + mobile screenshots, runs the canonical extractor (`scripts/extract.js`), downloads every image via `curl`, and extracts per-section DOM trees.
2. **Foundation** — emits `theme.json` (palette + fonts + spacing from captured tokens), `style.css`, templates and parts skeleton, and copies assets. Build gate: JSON schema + `node --check`.
3. **Spec files** — one per section, real content + `getComputedStyle()` values + interaction model.
4. **Pre-dispatch checklist** — 8-item hard gate per spec before it goes to a builder.
5. **Parallel dispatch** — one builder subagent per spec, each in its own `git worktree`, writing exactly one `patterns/section-<n>.php`.
6. **Assemble** — wires patterns into `front-page.html`, emits header + footer parts.
7. **Deploy + visual QA** — launches `npx @wp-playground/cli@latest server ...`, screenshots `http://127.0.0.1:9400/`, diffs against the source capture. 3-iteration budget.

See [`SKILL.md`](SKILL.md) for the full workflow and [`references/`](references/) for per-step procedures.

## Layout

```
.
├── SKILL.md                          # entry point (workflow + prerequisites)
├── scripts/
│   ├── extract.js                    # full-page extractor (semantic + Y-band fallback)
│   └── extract-section.js            # per-section computed-style walker
├── references/
│   ├── capture.md                    # chrome-devtools capture procedure
│   ├── spec-files.md                 # per-section spec template
│   ├── section-mapping.md            # 9 interaction-model → WP block templates
│   ├── theme-tokens.md               # theme.json rules + commercial-to-free fonts
│   ├── parallel-dispatch.md          # worktree setup, builder prompt, merge
│   ├── playground-cli.md             # @wp-playground/cli launch + blueprint
│   └── visual-qa.md                  # deploy + screenshot + diff
└── assets/
    ├── block-theme-skeleton/         # starter theme.json + templates + parts
    └── blueprint-template.json       # @wp-playground/cli blueprint
```

## Design notes

- **Semantic-landmark preflight** with Y-band fallback — `scripts/extract.js` prefers real `<section>/<header>/<footer>/<nav>/<main>/<article>/[role="region"]` elements; falls back to geometric Y-band clustering only when fewer than 3 usable semantic landmarks are found. Records the path in `diagnostics.sectionStrategy`.
- **Framework-default button blacklist** — skips known page-builder default colors (currently `#116DFF` / Wix) so the "primary" color pick reflects the actual brand, not an unstyled button.
- **Foundation-first sequencing** — `theme.json`, fonts, and `assets/` land on the main branch before any spec is dispatched, so worktrees never race on shared state.
- **Brightness-based cover rule** — `core/cover` forces inner text white on overlay; on light backgrounds (brightness ≥ 200) the templates emit `core/group` with explicit contrast text instead.
- **8-item pre-dispatch checklist** — every spec must pass before a builder sees it (spec exists, computed styles captured, interaction model set, copyright flagged, images local-pathed, brightness recorded, template name valid, spec ≤ 150 lines).
- **CLI playground for deploy** — no MCP WebSocket bridge, no base64 binary upload, no iframe screenshot surgery. The theme is mounted from disk; edits to `theme/patterns/*.php` take effect on page reload.

## Acknowledgments

The interaction-model templates, brightness rule, and per-section spec contract started life in the sibling [`wp-clone-wix-to-block-theme`](https://github.com/fellyph?tab=repositories) skill (not yet published). The worktree-dispatch and pre-dispatch-checklist patterns were ported from the `clone-website` skill inside the Next.js-output workspace `ai-website-cloner-template-master`.

## License

[GPL-2.0-or-later](LICENSE). Same license as the WordPress themes this skill produces — keeps the generated output and this tooling under a consistent license.
