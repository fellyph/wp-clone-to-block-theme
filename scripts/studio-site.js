#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const defaultWpVersion = '6.7';
const defaultPhpVersion = '8.2';
const studioBin = process.env.STUDIO_BIN || 'studio';

function usage(exitCode = 0) {
  const output = exitCode === 0 ? console.log : console.error;
  output(`Usage:
  node scripts/studio-site.js deploy <clone-root> [options]

Options:
  --dry-run              Print planned filesystem and Studio actions.
  --wp <version>         WordPress version for new Studio sites. Default: ${defaultWpVersion}
  --php <version>        PHP version for new Studio sites. Default: ${defaultPhpVersion}
  --name <site-name>     Studio site name and WordPress blog name.
  --site-path <path>     WordPress site root. Default: <clone-root>/studio-site
  --help                 Show this help.
`);
  process.exit(exitCode);
}

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const [command, cloneRootArg, ...rest] = argv;
  if (!command || command === '--help' || command === '-h') usage(0);
  if (command !== 'deploy') fail(`unknown command "${command}"`);
  if (!cloneRootArg) usage(1);

  const options = {
    cloneRoot: path.resolve(cloneRootArg),
    dryRun: false,
    wp: defaultWpVersion,
    php: defaultPhpVersion,
    name: null,
    sitePath: null,
  };

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const [name, inlineValue] = arg.split('=', 2);
    const needsValue = () => {
      if (inlineValue !== undefined) return inlineValue;
      index += 1;
      if (index >= rest.length || rest[index].startsWith('--')) {
        fail(`${arg} requires a value`);
      }
      return rest[index];
    };

    switch (name) {
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--wp':
        options.wp = needsValue();
        break;
      case '--php':
        options.php = needsValue();
        break;
      case '--name':
        options.name = needsValue();
        break;
      case '--site-path':
        options.sitePath = path.resolve(needsValue());
        break;
      case '--help':
      case '-h':
        usage(0);
        break;
      default:
        fail(`unknown option "${arg}"`);
    }
  }

  return options;
}

function titleFromSlug(slug) {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function escapePhpSingleQuoted(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function formatCommand(args) {
  return [studioBin, ...args].map((part) => shellQuote(String(part))).join(' ');
}

function runStudio(args, dryRun) {
  if (dryRun) {
    console.log(`[dry-run] ${formatCommand(args)}`);
    return;
  }

  const result = spawnSync(studioBin, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env,
  });

  if (result.error) fail(`${studioBin} failed to start: ${result.error.message}`);
  if (result.status !== 0) fail(`${formatCommand(args)} exited with code ${result.status}`);
}

function isWordPressRoot(sitePath) {
  return (
    fs.existsSync(path.join(sitePath, 'wp-includes', 'version.php')) &&
    fs.existsSync(path.join(sitePath, 'wp-content'))
  );
}

function isEmptyDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) return true;
  return fs.statSync(dirPath).isDirectory() && fs.readdirSync(dirPath).length === 0;
}

function replaceTokens(value, replacements) {
  if (Array.isArray(value)) return value.map((item) => replaceTokens(item, replacements));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replaceTokens(item, replacements)])
    );
  }
  if (typeof value !== 'string') return value;

  return Object.entries(replacements).reduce(
    (next, [token, replacement]) => next.replaceAll(token, replacement),
    value
  );
}

function buildBlueprint({ blueprintTemplatePath, siteName, themeSlug, wp, php }) {
  const raw = fs.readFileSync(blueprintTemplatePath, 'utf8');
  const blueprint = replaceTokens(JSON.parse(raw), {
    THEME_SITE_TITLE: escapePhpSingleQuoted(siteName),
    THEME_SLUG: themeSlug,
  });

  blueprint.preferredVersions = { php, wp };
  return `${JSON.stringify(blueprint, null, 2)}\n`;
}

function writeBlueprint(blueprintPath, contents, dryRun) {
  if (dryRun) {
    console.log(`[dry-run] write ${blueprintPath}`);
    return;
  }

  fs.writeFileSync(blueprintPath, contents);
  console.log(`Wrote ${blueprintPath}`);
}

function syncTheme(themeSource, themeTarget, dryRun) {
  if (dryRun) {
    console.log(`[dry-run] remove ${themeTarget}`);
    console.log(`[dry-run] copy ${themeSource} -> ${themeTarget}`);
    return;
  }

  fs.mkdirSync(path.dirname(themeTarget), { recursive: true });
  fs.rmSync(themeTarget, { recursive: true, force: true });
  fs.cpSync(themeSource, themeTarget, { recursive: true, verbatimSymlinks: true });
  console.log(`Synced theme to ${themeTarget}`);
}

function deploy(options) {
  const cloneRoot = options.cloneRoot;
  const themeSlug = path.basename(cloneRoot);
  const siteName = options.name || `${titleFromSlug(themeSlug)} Clone`;
  const sitePath = options.sitePath || path.join(cloneRoot, 'studio-site');
  const themeSource = path.join(cloneRoot, 'theme');
  const themeTarget = path.join(sitePath, 'wp-content', 'themes', themeSlug);
  const blueprintTemplatePath = path.join(repoRoot, 'assets', 'blueprint-template.json');
  const blueprintPath = path.join(cloneRoot, 'blueprint.json');

  if (!fs.existsSync(cloneRoot)) fail(`clone root does not exist: ${cloneRoot}`);
  if (!fs.existsSync(themeSource)) fail(`theme directory does not exist: ${themeSource}`);
  if (!fs.existsSync(path.join(themeSource, 'theme.json'))) fail(`missing theme.json in ${themeSource}`);
  if (!fs.existsSync(path.join(themeSource, 'style.css'))) fail(`missing style.css in ${themeSource}`);

  if (fs.existsSync(sitePath) && !isWordPressRoot(sitePath) && !isEmptyDirectory(sitePath)) {
    fail(`site path exists but is not an empty directory or WordPress root: ${sitePath}`);
  }

  const needsCreate = !isWordPressRoot(sitePath);
  const blueprint = buildBlueprint({
    blueprintTemplatePath,
    siteName,
    themeSlug,
    wp: options.wp,
    php: options.php,
  });

  writeBlueprint(blueprintPath, blueprint, options.dryRun);

  if (needsCreate) {
    if (!options.dryRun) fs.mkdirSync(sitePath, { recursive: true });
    runStudio(
      [
        'site',
        'create',
        '--path',
        sitePath,
        '--name',
        siteName,
        '--wp',
        options.wp,
        '--php',
        options.php,
        '--blueprint',
        blueprintPath,
        '--start',
        '--skip-browser',
      ],
      options.dryRun
    );
  } else {
    runStudio(['site', 'start', '--path', sitePath, '--skip-browser', '--skip-log-details'], options.dryRun);
  }

  syncTheme(themeSource, themeTarget, options.dryRun);

  runStudio(['--path', sitePath, 'wp', 'theme', 'activate', themeSlug], options.dryRun);
  runStudio(
    [
      '--path',
      sitePath,
      'wp',
      'eval',
      [
        "$front = get_page_by_path('front');",
        "if (! $front) { $front_id = wp_insert_post(['post_title' => 'Front', 'post_name' => 'front', 'post_status' => 'publish', 'post_type' => 'page']); } else { $front_id = $front->ID; }",
        "update_option('show_on_front', 'page');",
        'update_option(\'page_on_front\', (int) $front_id);',
        `update_option('blogname', '${escapePhpSingleQuoted(siteName)}');`,
      ].join(' '),
    ],
    options.dryRun
  );
  runStudio(['site', 'status', '--path', sitePath], options.dryRun);
}

deploy(parseArgs(process.argv.slice(2)));
