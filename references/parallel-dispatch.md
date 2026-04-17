# Parallel dispatch in git worktrees

Step 5 of `SKILL.md` turns per-section spec files into WP block patterns. Each section is an independent unit — so we dispatch one builder subagent per spec file, each working in its own git worktree. This compresses wall-clock time and lets each builder focus on a single spec rather than the whole site.

The pattern is borrowed from the Next.js cloner `ai-website-cloner-template-master/.claude/skills/clone-website/`, adapted for WP block-theme output: each worktree owns **exactly one file** (`theme/patterns/section-<n>.php`). Foundation artifacts (`theme.json`, `style.css`, `assets/`, `parts/*`, `templates/*`) live on `main` and do not move. No merge conflicts by construction.

## Prerequisites

- The clone output directory `./clones/<slug>/` must be a git repo with a `main` branch and a clean working tree. If it isn't yet, initialize:
  ```bash
  cd ./clones/<slug>
  git init
  git add theme/theme.json theme/style.css theme/templates/ theme/parts/ theme/assets/ specs/ .capture/
  git commit -m "foundation: theme.json, tokens, assets, specs"
  ```
- The 8-item pre-dispatch checklist from `SKILL.md` step 4 must pass for every spec being dispatched. Do not dispatch a builder with a partial spec — the builder will produce a partial pattern and you'll pay the wall-clock cost of re-dispatch.
- The build gate must have passed on `main` right before dispatch:
  ```bash
  python3 -c "import json; j = json.load(open('theme/theme.json')); assert j['version'] == 3; assert '$schema' in j"
  node --check <skill-path>/scripts/extract.js
  node --check <skill-path>/scripts/extract-section.js
  ```

## Dispatch rules

- **Threshold.** If fewer than 3 sections, run sequentially without worktrees — the setup overhead isn't worth it. Otherwise, dispatch all sections in parallel.
- **Worktree per section.** One `git worktree add` per spec, branched from `main`.
- **File ownership.** Each builder writes **only** `theme/patterns/section-<n>.php` in its own worktree. Builders must not touch `theme.json`, `style.css`, `assets/`, `parts/*`, `templates/*`, or any other pattern's file.
- **Spec is read-only.** Builders read `specs/section-<n>-<type>.md` and `.capture/sections/<n>.json` but do not modify them. If a builder believes the spec is wrong, it returns an error — the orchestrator re-extracts and fixes the spec on `main`, then redispatches.
- **Reference selection.** Builders read `references/section-mapping.md` to find the template matching their spec's `Interaction model` field. They use the brightness value recorded in the spec to choose between cover-variant and light-variant where applicable.
- **No network.** Builders work entirely from local files — `.capture/`, `specs/`, `references/`, and the foundation artifacts. No live scraping, no CDN fetches. Assets are already on disk under `theme/assets/`.

## Worktree setup (orchestrator)

For each spec file in `specs/`:

```bash
SLUG="<slug>"
N=<section number>
cd ./clones/$SLUG
git worktree add ../$SLUG-section-$N -b section-$N
```

Each worktree is a full copy of the `main` tree (via git), so the builder can run the build gate locally without cross-worktree contamination.

## Builder subagent prompt (template)

Each builder is an independent Agent with access to file tools. Use a prompt along these lines:

```
You are generating one WP block pattern from a pre-extracted spec.

Working directory: {{ABSOLUTE_WORKTREE_PATH}}
Spec file:         specs/section-{{N}}-{{TYPE}}.md
Per-section JSON:  .capture/sections/{{N}}.json
References:        {{SKILL_PATH}}/references/section-mapping.md, theme-tokens.md
Foundation:        theme/theme.json, theme/style.css, theme/assets/  (read-only for this task)

Your task:
1. Read the spec. Confirm its `Interaction model` field names a template that exists in `section-mapping.md`.
2. Pick the cover-variant vs light-variant where applicable, using the brightness value the spec recorded.
3. Fill every `{{placeholder}}` from the spec's `Generation instructions` section. Use verbatim captured text and local `assets/img-NN.<ext>` paths — never a remote URL.
4. Wrap the result in the standard pattern-file header:
   <?php
   /**
    * Title: {{HUMAN_READABLE_TITLE}}
    * Slug: {{THEME_SLUG}}/section-{{N}}
    * Categories: featured
    */
   ?>
5. Write the output to `theme/patterns/section-{{N}}.php`. Do not touch any other file.
6. Run the build gate from the worktree root:
   php -l theme/patterns/section-{{N}}.php
   python3 -c "import json; j = json.load(open('theme/theme.json')); assert j['version'] == 3"
7. Commit with `git add theme/patterns/section-{{N}}.php && git commit -m "section-{{N}}: {{TYPE}}"`.

Output constraints:
- No placeholder text. If a `{{placeholder}}` can't be filled from the spec, stop and report the missing field — do not invent content.
- No remote URLs in block markup. Every image path must route through `<?php echo esc_url( get_theme_file_uri('assets/img-NN.<ext>') ); ?>`.
- No modifications outside `theme/patterns/section-{{N}}.php`.

Report back: absolute path of the file you created, the template you used, and the commit hash.
```

## Merge procedure (orchestrator)

Once all builders report completion, merge them sequentially onto `main`:

```bash
cd ./clones/<slug>
for N in $(ls specs/ | sed -E 's/section-([0-9]+)-.*/\1/' | sort -n); do
  git merge section-$N --no-ff -m "merge section-$N"
  # Build gate after each merge
  php -l theme/patterns/section-$N.php
  python3 -c "import json; j = json.load(open('theme/theme.json')); assert j['version'] == 3"
done
```

Because each worktree only touches `theme/patterns/section-<n>.php`, merges are conflict-free by construction. If a merge does report a conflict, it means a builder violated the file-ownership rule — reject the merge, inspect the diff, and redispatch that section with a stricter prompt.

## Worktree cleanup

After merging, remove the worktrees:

```bash
for N in $(ls specs/ | sed -E 's/section-([0-9]+)-.*/\1/' | sort -n); do
  git worktree remove ../<slug>-section-$N
  git branch -d section-$N
done
```

## When to run sequentially instead

Parallel dispatch is the default. Run sequentially only in these cases:

- **Fewer than 3 sections.** Setup overhead dwarfs the parallel gain.
- **User explicitly asked for sequential.** Respect the request.
- **Single-machine resource pressure.** If the orchestrator is running on constrained hardware and each builder is heavyweight, serialize to avoid swapping.

Even sequentially, all the other rules still apply: pre-dispatch checklist, file-ownership restriction, build gate after every pattern, same builder prompt template.

## Failure modes

| Failure | Cause | Fix |
| --- | --- | --- |
| Builder writes outside its file | Prompt violation | Reject the merge, redispatch with a stricter prompt; consider adding a worktree-level `.gitignore` that blocks writes outside `theme/patterns/` |
| Builder reports missing placeholder | Spec was incomplete | Orchestrator re-extracts the section on `main`, updates the spec, redispatches |
| Build gate fails after merge | Invalid JSON or PHP syntax in the new pattern | Revert the merge (`git reset --hard HEAD^`), fix the spec or template in `section-mapping.md`, redispatch |
| Two builders race on `theme.json` | Prompt violation — builders should not touch foundation | Enforce via prompt + reject merge; foundation is read-only for builders |
| Merge conflict | File-ownership rule was violated | Builder touched more than one file; redispatch with corrected prompt |
