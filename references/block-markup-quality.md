# Block markup quality — the builder's contract

Every builder subagent emits one `theme/patterns/section-<n>.php`. This file is the quality contract for that markup. Apply it after filling a template from `references/section-mapping.md` and before committing.

- [Why validity matters](#why-validity-matters)
- [Comment delimiter rules](#comment-delimiter-rules)
- [Class naming order](#class-naming-order)
- [Preset slugs and CSS vars](#preset-slugs-and-css-vars)
- [Attribute types](#attribute-types)
- [Structure constraints](#structure-constraints)
- [Theme conventions](#theme-conventions)
- [Validation gate (wp-blockmarkup-mcp)](#validation-gate-wp-blockmarkup-mcp)
- [Pre-commit checklist](#pre-commit-checklist)

## Why validity matters

WordPress re-parses block markup every time the editor opens. If the serialized HTML doesn't match what the block's save function would produce for the given attributes, the editor shows the "Attempt block recovery" dialog; recovery rewrites the block from attributes alone, silently discarding any HTML the attributes didn't describe. Worse failure mode: markup that parses but has wrong class names or slug casing renders *unstyled* with no error at all. Both are invisible at generation time and expensive to find during visual QA — get the markup right the first time.

## Comment delimiter rules

**Static blocks** (group, heading, paragraph, image, cover, columns, buttons…) are paired comments wrapping their saved HTML:

```html
<!-- wp:heading {"level":2,"fontSize":"x-large"} -->
<h2 class="wp-block-heading has-x-large-font-size">Pricing</h2>
<!-- /wp:heading -->
```

**Dynamic blocks** render server-side and must be self-closing with **no inner HTML**: `core/query`, `core/latest-posts`, `core/navigation`, `core/site-title`, `core/site-logo`, and all `core/post-*` blocks.

```html
<!-- wp:site-title {"level":0} /-->
```

Emitting inner HTML for a dynamic block, or omitting the closer on a static block, triggers recovery.

Attribute JSON must be strictly valid: double quotes only, no trailing commas, no comments, booleans/numbers unquoted. The `wp:` prefix omits `core/` for core blocks — `wp:group`, never `wp:core/group`. Third-party blocks keep their namespace (`wp:woocommerce/...`), but clones should not emit any.

## Class naming order

WP generates preset classes as `has-{slug}-{feature}` — slug **first**, feature **last**:

| Attribute | Generated class | Companion class |
| --- | --- | --- |
| `"backgroundColor":"primary"` | `has-primary-background-color` | `has-background` |
| `"textColor":"contrast"` | `has-contrast-color` | `has-text-color` |
| `"borderColor":"primary"` | `has-primary-border-color` | — |
| `"fontSize":"large"` | `has-large-font-size` | — |
| `"fontFamily":"body"` | `has-body-font-family` | — |

The bare companion classes (`has-background`, `has-text-color`) must accompany the slugged class — block-library CSS keys real rules off them. Reversed order parses fine but matches no stylesheet, so the styling drops silently:

```html
<!-- CORRECT -->
<div class="wp-block-group has-primary-background-color has-background">

<!-- WRONG — parses, renders unstyled -->
<div class="wp-block-group has-background-color-primary">
```

## Preset slugs and CSS vars

Slugs are kebab-case and must exist in the theme's `theme.json` (see `references/theme-tokens.md`: `base`, `contrast`, `primary`, `secondary`; sizes `small`…`xx-large`; spacing `20`–`80`). A slug that isn't registered produces no CSS variable and the value vanishes.

Two syntaxes, one per context — casing must match the slug exactly:

- **In HTML `style=""`**: `var(--wp--preset--color--primary)` (double dashes between every segment).
- **In attribute JSON**: `var:preset|color|primary` (pipes, no parens).

```html
<!-- CORRECT — attr uses var:preset, HTML uses var(--wp--preset--…) -->
<!-- wp:group {"style":{"spacing":{"padding":{"top":"var:preset|spacing|80"}}},"layout":{"type":"constrained"}} -->
<div class="wp-block-group" style="padding-top:var(--wp--preset--spacing--80)">

<!-- WRONG — CSS-var syntax inside the JSON attr; parser keeps it but CSS never resolves -->
<!-- wp:group {"style":{"spacing":{"padding":{"top":"var(--wp--preset--spacing--80)"}}}} -->
```

## Attribute types

- `fontSize`, `backgroundColor`, `textColor`, `fontFamily`, `borderColor` take **string slugs** referencing presets — never hex (`"backgroundColor":"#2563eb"` is wrong) and never numbers.
- Raw values go in the `"style":{...}` object instead: `"style":{"color":{"background":"#2563eb"}}`, `"style":{"typography":{"fontSize":"1.125rem"}}`. Then the HTML carries the value inline (`style="background-color:#2563eb"`) plus the bare `has-background` class — no slugged class.
- Spacing: `var:preset|spacing|{slug}` to stay on the theme scale, or explicit units (`"1.5rem"`, `"24px"`) when the design demands an off-scale value. Per `section-mapping.md`, prefer the preset scale.
- Extra classes go in `"className":"insight-card"` — and must also appear in the HTML `class=""` list, or recovery strips them.

## Structure constraints

Parent blocks accept only their registered children; anything else fails validation.

- `core/buttons` → only `core/button` children. A bare `core/button` outside `core/buttons` also validates poorly — always wrap.
- `core/columns` → only `core/column` children (each emitting `<div class="wp-block-column">`).
- `core/list` → only `core/list-item` children (`<li>`), not raw `<li>` without delimiters.
- `core/cover` → inner blocks must sit inside `<div class="wp-block-cover__inner-container">`, after the overlay `<span>`/`<img>`.
- `core/group` → the JSON `layout` attr and the saved classes must agree. WP injects layout classes at render time, so the safest static form is: emit the `layout` attr in JSON and do **not** hand-write `is-layout-flow` / `is-layout-constrained` / `is-layout-flex` / `is-content-justification-*` classes unless copying a template from `section-mapping.md` verbatim. Never emit a justification class that contradicts the attr (`"justifyContent":"space-between"` + `is-content-justification-center` = silent layout break).

## Theme conventions

- Patterns auto-register from `patterns/*.php` file headers. `Title:` and `Slug:` are required; the slug prefix is the theme slug (`Slug: <theme-slug>/section-3`). No PHP registration call needed.
- Template parts live **flat** in `parts/` — `parts/header.html`, never `parts/site/header.html`. Subdirectories are not scanned.
- Image URLs in patterns always go through PHP so the theme ships its own assets:

```php
<img src="<?php echo esc_url( get_theme_file_uri('assets/img-03.webp') ); ?>" alt="..." />
```

Never inline CDN URLs (see `section-mapping.md`, "What NOT to do").

## Validation gate (wp-blockmarkup-mcp)

If MCP tools named `mcp__wp-blockmarkup__*` are available in the session, validation is **mandatory** before committing the pattern:

1. Extract the block markup portion of the file — everything after the closing `?>` of the PHP header.
2. Replace each `<?php echo esc_url( get_theme_file_uri('...') ); ?>` with a placeholder path (e.g. `https://example.com/img.webp`) so the validator sees parseable HTML.
3. Call `validate_markup` with the result.
4. Fix **every** reported error — recovery dialogs are all-or-nothing per block — then re-validate until clean.

Also useful while writing:

- `get_block_markup` with `block_name` and `validated_only: true` — returns verified real-world markup for a block when unsure of the saved-HTML shape.
- `get_block_schema` — confirms attribute names and types before inventing one.

If the MCP tools are **not** available in the session, the same validator runs as a CLI through Bash — use it before falling back to manual checking:

```bash
npx -y -p wp-blockmarkup-mcp wp-blocks validate '<markup here>'
```

Structural validation always works; attribute-level verification additionally needs the core blocks indexed once per machine (`npx -y -p wp-blockmarkup-mcp wp-blocks source:add --name gutenberg --type github-public --repo https://github.com/WordPress/gutenberg --branch trunk` — slow, but persists in `~/.wp-blockmarkup-mcp/`). A "block not found in any indexed source" warning means only the structural tier ran.

If neither the MCP server nor the CLI is available, apply sections 2–7 of this file as a manual checklist, line by line, against the finished pattern. Do not skip — these are exactly the errors hand-authored markup gets wrong.

> Setup note for users: `claude mcp add wp-blockmarkup -- npx wp-blockmarkup-mcp` (requires Node 20+).

## Pre-commit checklist

1. PHP header has `Title:` and `Slug: <theme-slug>/section-<n>`; file is in `patterns/`, parts are flat in `parts/`.
2. Every static block has a matching closer; every dynamic block (`query`, `navigation`, `site-title`, `post-*`…) is self-closing with no inner HTML.
3. All attribute JSON is valid: double quotes, no trailing commas; block names omit `core/`.
4. Preset classes read `has-{slug}-{feature}` and carry their companions (`has-background`, `has-text-color`).
5. Every color/font/spacing slug exists in `theme.json`; casing matches exactly.
6. `var:preset|…` in JSON attrs, `var(--wp--preset--…)` in `style=""` — never swapped.
7. `fontSize`/`backgroundColor`/`textColor` hold slugs; raw values live in `style:{...}`; `className` values also appear in the HTML `class` list.
8. Parent/child structure is legal: buttons in `buttons`, columns in `columns`, list-items in `list`, cover content inside `wp-block-cover__inner-container`.
9. `layout` attrs and any layout/justification classes agree; no contradicting hand-written `is-layout-*` classes.
10. Images go through `get_theme_file_uri()`; markup passed `validate_markup` (or the manual section 2–7 sweep) with zero errors.
