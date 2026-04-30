#!/usr/bin/env node
/*
 * Shared helpers for the Pathfinder CLI Docker build pipeline.
 *
 * Two responsibilities:
 *
 *   1. Read CURRENT_SCHEMA_VERSION from src/types/json-guide.schema.ts.
 *      The CI workflow uses this to verify that the built CLI's
 *      `--version` matches the source-of-truth schema version.
 *
 *   2. Generate a minimal runtime package.json containing only the
 *      runtime dependencies the CLI actually imports. The Dockerfile
 *      uses this to keep the runtime image small — installing the
 *      plugin's full dependency tree (React, @grafana/ui, etc.) would
 *      bloat the image with code the CLI never executes.
 *
 * Versions in the generated runtime package.json are copied verbatim
 * from the main package.json so they cannot drift. If a runtime dep
 * is missing from package.json#dependencies, this script throws —
 * loud failure beats silent install of a typo'd version.
 *
 * CLI usage:
 *   node scripts/cli-build-utils.js schema-version
 *   node scripts/cli-build-utils.js runtime-package <output-path>
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');

// CLI runtime imports — anything reachable at runtime from
// dist/cli/cli/index.js or dist/cli/cli/mcp/index.js.
// Keep this list minimal. If the Docker build fails with
// "Cannot find module 'X'", either add X here or remove the
// import from the CLI codepath.
const RUNTIME_DEPS = ['commander', 'zod', '@modelcontextprotocol/sdk'];

function readSchemaVersion() {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'src/types/json-guide.schema.ts'), 'utf8');
  const m = src.match(/CURRENT_SCHEMA_VERSION\s*=\s*['"]([^'"]+)['"]/);
  if (!m) {
    throw new Error('CURRENT_SCHEMA_VERSION not found in src/types/json-guide.schema.ts');
  }
  return m[1];
}

function buildRuntimePackageJson() {
  const src = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const dependencies = {};
  for (const name of RUNTIME_DEPS) {
    const version = src.dependencies && src.dependencies[name];
    if (!version) {
      throw new Error(
        `runtime dep "${name}" listed in RUNTIME_DEPS is not in package.json#dependencies. ` +
          `Either add it to dependencies, or remove it from RUNTIME_DEPS.`
      );
    }
    dependencies[name] = version;
  }
  return {
    name: 'pathfinder-cli-runtime',
    version: '0.0.0',
    private: true,
    dependencies,
  };
}

if (require.main === module) {
  const cmd = process.argv[2];
  try {
    if (cmd === 'schema-version') {
      process.stdout.write(readSchemaVersion());
    } else if (cmd === 'runtime-package') {
      const dest = process.argv[3];
      if (!dest) {
        throw new Error('usage: cli-build-utils.js runtime-package <output-path>');
      }
      const manifest = buildRuntimePackageJson();
      fs.writeFileSync(dest, JSON.stringify(manifest, null, 2) + '\n');
      process.stderr.write(`wrote runtime package.json (${RUNTIME_DEPS.join(', ')}) to ${dest}\n`);
    } else {
      throw new Error('usage: cli-build-utils.js {schema-version | runtime-package <output-path>}');
    }
  } catch (err) {
    process.stderr.write(`cli-build-utils: ${err.message}\n`);
    process.exit(1);
  }
}

module.exports = { RUNTIME_DEPS, REPO_ROOT, readSchemaVersion, buildRuntimePackageJson };
