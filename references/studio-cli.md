# WordPress Studio CLI

Run each generated clone in a persistent local WordPress site managed by WordPress Studio CLI. The clone artifacts remain in `clones/<slug>/`; the full Studio WordPress install lives in `clones/<slug>/studio-site/` and is ignored by git.

Upstream docs:
- https://developer.wordpress.com/docs/developer-tools/studio/cli/
- https://developer.wordpress.com/docs/developer-tools/studio/sites/
- https://developer.wordpress.com/docs/guides/how-to-create-custom-blueprints/

## Contents

1. Requirements
2. Deploy command
3. Blueprint JSON template
4. Site lifecycle
5. WP-CLI
6. Visual QA URL
7. Optional preview sites
8. Troubleshooting

## 1. Requirements

- WordPress Studio CLI available as `studio`.
  - If using the Studio desktop app, enable the CLI from Studio Settings.
  - If using the standalone package, install the `wp-studio` CLI so the `studio` command is on `PATH`.
- Node.js 18 or later for this skill's helper scripts.
- A local theme directory at `./clones/<slug>/theme/` with `theme.json`, `style.css`, `templates/`, `parts/`, `patterns/`, and `assets/`.

Confirm CLI availability:

```bash
studio --help
studio site create --help
```

## 2. Deploy command

From the repo root, run:

```bash
node scripts/studio-site.js deploy ./clones/<slug>
```

The helper:

1. Validates `./clones/<slug>/theme/`.
2. Writes `./clones/<slug>/blueprint.json` from `assets/blueprint-template.json`.
3. Creates `./clones/<slug>/studio-site/` if it is not already a Studio WordPress root.
4. Copies the generated theme to `./clones/<slug>/studio-site/wp-content/themes/<slug>/`.
5. Starts the Studio site, activates the theme, sets the static `front` page, and prints `studio site status`.

Useful options:

```bash
node scripts/studio-site.js deploy ./clones/<slug> --dry-run
node scripts/studio-site.js deploy ./clones/<slug> --wp 6.7 --php 8.2
node scripts/studio-site.js deploy ./clones/<slug> --name "Example Clone"
node scripts/studio-site.js deploy ./clones/<slug> --site-path ./clones/<slug>/studio-site
```

## 3. Blueprint JSON template

Studio uses the shared Blueprint JSON format. This skill keeps the schema URL in `assets/blueprint-template.json`, but does not rely on a theme activation step during site creation because the generated theme is copied into the Studio site after WordPress exists.

The template creates a static `front` page and sets the blog name. The deploy helper repeats the same setup with `studio wp eval` after theme sync so repeated deploys are idempotent.

## 4. Site lifecycle

Use `--path` to target the nested Studio site root:

```bash
studio site status --path ./clones/<slug>/studio-site
studio site start --path ./clones/<slug>/studio-site --skip-browser
studio site stop --path ./clones/<slug>/studio-site
```

Do not commit `clones/<slug>/studio-site/`; it contains a full WordPress install and local runtime state.

## 5. WP-CLI

Run WP-CLI through Studio:

```bash
studio --path ./clones/<slug>/studio-site wp theme status <slug>
studio --path ./clones/<slug>/studio-site wp theme activate <slug>
studio --path ./clones/<slug>/studio-site wp option get siteurl
```

The deploy helper uses this path-aware form to avoid accidentally running against the repo root.

## 6. Visual QA URL

After deploy, use the local URL reported by:

```bash
studio site status --path ./clones/<slug>/studio-site
```

Open that URL in chrome-devtools, then capture desktop and mobile screenshots for the visual diff. Do not assume a fixed port; Studio owns port assignment.

## 7. Optional preview sites

Preview sites are for sharing, not for the required local QA loop. They require WordPress.com authentication:

```bash
studio auth status
studio auth login
studio preview create --path ./clones/<slug>/studio-site --name "<slug>"
studio preview update <host> --path ./clones/<slug>/studio-site
```

Use `studio preview list` to find existing preview hosts before updating.

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `studio: command not found` | Studio CLI is not installed or not on `PATH` | Enable the CLI in Studio Settings or install the standalone CLI. |
| `The specified directory is not added to Studio` | The command points at the clone root instead of the Studio site root | Use `--path ./clones/<slug>/studio-site`. |
| Theme shows a default bundled theme | Theme sync or activation did not run | Re-run `node scripts/studio-site.js deploy ./clones/<slug>` and check `studio --path ... wp theme status <slug>`. |
| Edits do not appear in the browser | Source theme changed after the last sync | Re-run the deploy helper, then reload the Studio site URL. |
| Assets 404 in the rendered page | Theme asset paths are wrong or sync is stale | Run the artifact validator, redeploy, and verify files under `studio-site/wp-content/themes/<slug>/assets/`. |
| Preview create/update fails | Not authenticated or preview host mismatch | Run `studio auth status`; use `studio preview list`; pass `--overwrite` only when intentionally updating from another directory. |
