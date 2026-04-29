#!/usr/bin/env node
/*
 * Rewrites package.json for publishing the pathfinder-cli npm package.
 *
 * The repo's package.json is the Grafana plugin manifest (name:
 * grafana-pathfinder-app, version: <plugin-version>). The npm-published
 * artifact is a different beast: name pathfinder-cli, version pinned to
 * CURRENT_SCHEMA_VERSION so CLI and MCP cannot drift, and a narrow files
 * allowlist that ships only the CLI build output.
 *
 * Modes:
 *   --check   (default) Print the rewritten manifest to stdout. No I/O on disk.
 *   --write   Overwrite package.json in place. Intended for ephemeral CI
 *             checkouts during `npm publish`; do not run in a working tree
 *             you care about.
 *
 * See docs/design/phases/ai-authoring-2-distribution.md (decision log entry
 * "Single-package, rewrite manifest at publish time") for the rationale.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const PACKAGE_JSON_PATH = path.join(REPO_ROOT, 'package.json');
const SCHEMA_SOURCE_PATH = path.join(REPO_ROOT, 'src/types/json-guide.schema.ts');
const README_CLI_PATH = path.join(REPO_ROOT, 'README-cli.md');
const README_PATH = path.join(REPO_ROOT, 'README.md');

const PUBLISHED_NAME = 'pathfinder-cli';

// CLI runtime dependencies — anything imported transitively from
// dist/cli/cli/index.js or dist/cli/cli/mcp-placeholder.js. Keep this list
// minimal; the test below fails if a CLI source file imports an external
// module that is not in this allowlist.
const CLI_RUNTIME_DEPENDENCIES = ['commander', 'zod'];

// npm always includes README, LICENSE, and package.json from the package
// root regardless of the `files` field, so we don't list README.md here.
// Listing it explicitly would match recursively (e.g., a stray
// dist/README.md from a previous plugin build), pulling in unrelated
// files. The README itself is sourced from README-cli.md and copied to
// README.md by --write below.
const PUBLISHED_FILES = ['dist/cli/'];

// Keys to strip from the published manifest. devDependencies are never
// installed by consumers but bloat the manifest and leak internal tooling
// surface. lint-staged, husky's prepare, and webpack-related fields are
// repo-only.
const STRIPPED_TOP_LEVEL_KEYS = ['lint-staged', 'overrides', 'packageManager'];

// Scripts that have meaning inside the published artifact. Everything else
// (build, dev, test, etc.) is repo-only and gets dropped.
const PUBLISHED_SCRIPTS = [];

/**
 * Read CURRENT_SCHEMA_VERSION from src/types/json-guide.schema.ts.
 * Source-of-truth lives in TypeScript, so we parse the literal rather than
 * depending on a compiled artifact that may not exist at prepublish time.
 */
function readSchemaVersion(schemaSourcePath = SCHEMA_SOURCE_PATH) {
  const source = fs.readFileSync(schemaSourcePath, 'utf8');
  const match = source.match(/export\s+const\s+CURRENT_SCHEMA_VERSION\s*=\s*['"]([^'"]+)['"]/);
  if (!match) {
    throw new Error(`CURRENT_SCHEMA_VERSION not found in ${schemaSourcePath}`);
  }
  return match[1];
}

/**
 * Filter a dependencies map to the allowlist, preserving version specifiers.
 * Throws if an allowlisted dep is missing from the source manifest — that
 * means the source-of-truth has drifted and the published artifact would
 * fail to install.
 */
function filterDependencies(sourceDeps, allowlist) {
  const filtered = {};
  for (const name of allowlist) {
    if (!sourceDeps || !sourceDeps[name]) {
      throw new Error(
        `CLI runtime dependency "${name}" is not declared in package.json#dependencies. ` +
          `Either add it, or remove it from CLI_RUNTIME_DEPENDENCIES in scripts/prepublish-cli.js.`
      );
    }
    filtered[name] = sourceDeps[name];
  }
  return filtered;
}

/**
 * Build the publish-time manifest from the repo manifest plus the schema
 * version. Pure function — no I/O. Exported for unit testing.
 */
function buildPublishManifest(sourceManifest, schemaVersion) {
  const published = {
    name: PUBLISHED_NAME,
    version: schemaVersion,
    description: sourceManifest.description || 'Pathfinder CLI for authoring Grafana interactive guides.',
    bin: sourceManifest.bin,
    files: PUBLISHED_FILES,
    engines: sourceManifest.engines,
    license: sourceManifest.license,
    author: sourceManifest.author,
    repository: sourceManifest.repository,
    homepage: sourceManifest.homepage,
    bugs: sourceManifest.bugs,
    keywords: sourceManifest.keywords || ['grafana', 'pathfinder', 'cli', 'interactive-guides'],
    dependencies: filterDependencies(sourceManifest.dependencies, CLI_RUNTIME_DEPENDENCIES),
  };

  if (PUBLISHED_SCRIPTS.length > 0 && sourceManifest.scripts) {
    published.scripts = {};
    for (const name of PUBLISHED_SCRIPTS) {
      if (sourceManifest.scripts[name]) {
        published.scripts[name] = sourceManifest.scripts[name];
      }
    }
  }

  for (const key of STRIPPED_TOP_LEVEL_KEYS) {
    delete published[key];
  }

  // Drop any explicitly undefined keys so the output is clean.
  for (const key of Object.keys(published)) {
    if (published[key] === undefined) {
      delete published[key];
    }
  }

  return published;
}

function main(argv) {
  const args = new Set(argv.slice(2));
  const write = args.has('--write');
  const check = args.has('--check') || !write;

  const sourceManifest = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
  const schemaVersion = readSchemaVersion();
  const published = buildPublishManifest(sourceManifest, schemaVersion);
  const serialized = JSON.stringify(published, null, 2) + '\n';

  if (write) {
    fs.writeFileSync(PACKAGE_JSON_PATH, serialized);
    if (!fs.existsSync(README_CLI_PATH)) {
      throw new Error(`README-cli.md not found at ${README_CLI_PATH}. The published artifact requires it.`);
    }
    fs.copyFileSync(README_CLI_PATH, README_PATH);
    process.stderr.write(`prepublish-cli: rewrote ${PACKAGE_JSON_PATH} as ${PUBLISHED_NAME}@${schemaVersion}\n`);
    process.stderr.write(`prepublish-cli: copied README-cli.md -> README.md\n`);
  }
  if (check && !write) {
    process.stdout.write(serialized);
  }
}

module.exports = {
  buildPublishManifest,
  readSchemaVersion,
  filterDependencies,
  CLI_RUNTIME_DEPENDENCIES,
  PUBLISHED_NAME,
  PUBLISHED_FILES,
  PACKAGE_JSON_PATH,
  README_PATH,
  README_CLI_PATH,
};

if (require.main === module) {
  try {
    main(process.argv);
  } catch (err) {
    process.stderr.write(`prepublish-cli: ${err.message}\n`);
    process.exit(1);
  }
}
