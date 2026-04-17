# WordPress Playground via `@wp-playground/cli`

Run a persistent local WordPress at `http://127.0.0.1:9400` that mounts the generated theme directly from disk. This replaces the old wp-playground MCP path (which required a live browser tab + WebSocket bridge + base64 binary upload).

Upstream docs: https://wordpress.github.io/wordpress-playground/developers/local-development/wp-playground-cli/

## Contents

1. Requirements
2. Launch command (background)
3. Blueprint JSON template
4. Persistence and `--reset`
5. Verifying the server is up
6. Stopping the server
7. Troubleshooting

## 1. Requirements

- Node.js 18 or later
- Network access for the first `npx` run (pulls `@wp-playground/cli` into the npx cache; subsequent runs are offline)
- A local theme directory at `./clones/<slug>/theme/` with `theme.json`, `style.css`, `templates/`, `parts/`, `patterns/`, `assets/`
- A `./clones/<slug>/blueprint.json` (see template below)

## 2. Launch command (background)

Always launch in the background so the main workflow stays responsive. From the repo root:

```bash
npx @wp-playground/cli@latest server \
  --port=9400 \
  --mount=./clones/<slug>/theme:/wordpress/wp-content/themes/<slug> \
  --blueprint=./clones/<slug>/blueprint.json
```

With Claude Code's Bash tool, pass `run_in_background: true`. The server prints startup logs and then blocks; the process must stay alive for the duration of the screenshot + diff loop.

Notes:
- `server` mode accepts explicit `--mount` and `--blueprint` flags. `start` mode auto-detects and is convenient when you're already inside the theme directory, but it offers less control — prefer `server` for this skill's flow.
- The `--mount` syntax is `<local-path>:<wordpress-path>`. Mount the theme directly under `/wordpress/wp-content/themes/<slug>/`.
- Use `--port=9401` (or any free port) if 9400 is occupied.
- `--php=8.2` / `--wp=6.7` let you pin versions if default choices drift.

## 3. Blueprint JSON template

See `assets/blueprint-template.json` for a canonical version. Copy it to `./clones/<slug>/blueprint.json` and replace `<slug>` with the theme folder name.

```json
{
  "$schema": "https://playground.wordpress.net/blueprint-schema.json",
  "preferredVersions": { "php": "8.2", "wp": "6.7" },
  "login": true,
  "steps": [
    { "step": "activateTheme", "themeFolderName": "<slug>" },
    {
      "step": "runPHP",
      "code": "<?php require('/wordpress/wp-load.php'); if (!get_page_by_path('front')) { wp_insert_post(['post_title'=>'Front','post_name'=>'front','post_status'=>'publish','post_type'=>'page']); } update_option('show_on_front','page'); update_option('page_on_front', get_page_by_path('front')->ID); update_option('blogname', 'Supermembros Clone');"
    }
  ]
}
```

The `runPHP` step creates a blank `front` page and sets it as the static front page. Block themes render `templates/front-page.html` when the front page is a static page of any kind; without this step, the home URL would fall back to `index.html` (posts listing) and never load the patterns wired into `front-page.html`.

## 4. Persistence and `--reset`

`start` and `server` both persist WordPress state across runs in `~/.wordpress-playground/sites/<path-hash>/`. The hash is derived from the mount path, so the same `clones/<slug>/theme` always reuses the same database.

- **Wipe state** (e.g. after pattern changes that the blueprint won't catch): `npx @wp-playground/cli@latest server --reset --port=9400 --mount=… --blueprint=…`.
- **Inspect state on disk**: `ls ~/.wordpress-playground/sites/`. One subdirectory per mount path.
- **Temporary mode**: add `--no-persistence` (or omit `--mount`) if the caller wants a fresh sandbox on each launch. Not recommended for this skill.

## 5. Verifying the server is up

After the background launch, poll with `curl` until the server responds:

```bash
until curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:9400/ | grep -q '^200$'; do
  sleep 1
done
echo "playground up"
```

First launch can take 20–40 seconds (downloading WP core). Subsequent launches against the same mount are 2–5 seconds.

If the server returns HTTP 200 but the front page is blank, the blueprint's `runPHP` step may have failed. Re-run with `--reset` and check the stdout logs of the launch command.

## 6. Stopping the server

If launched via Claude Code's `run_in_background`:

```bash
# Find the background job ID from the earlier Bash call.
# Use the KillShell tool or `kill <pid>` in a new Bash call.
```

If launched from a regular terminal: Ctrl+C. If launched detached: `pkill -f '@wp-playground/cli'`. Always stop the server at the end of the visual-QA loop — it holds port 9400 and can conflict with later runs.

## 7. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `EADDRINUSE: address already in use :::9400` | Previous playground still running | `pkill -f '@wp-playground/cli'` then relaunch |
| Front page is blank / shows default WP hello | Blueprint `runPHP` failed silently | Re-launch with `--reset`; check the launch logs for PHP errors |
| Theme shows "Twenty Twenty-Four" instead of the clone | `activateTheme` step failed — wrong `themeFolderName` or missing mount | Confirm `--mount` path contains `theme.json` at its root; ensure `themeFolderName` in the blueprint matches the last segment of the mount destination |
| Fonts (Sora, etc.) don't load | Browser is offline or Google Fonts CDN is blocked | `@import` in `style.css` requires network access; switch to `assets/fonts/` self-hosted with `@font-face` if offline |
| Assets 404 in the rendered page | Mount path mismatch or `get_theme_file_uri()` returns a wrong URL | Visit `http://127.0.0.1:9400/wp-json/wp/v2/themes` and verify the active theme's `stylesheet_uri` resolves to a real `style.css` |
| Takes 60+ seconds on first launch | `npx` is fetching the CLI tarball | Normal once per host; subsequent launches are fast |
| Node version complaints | Node < 18 | Install a current LTS via `nvm install --lts` |
