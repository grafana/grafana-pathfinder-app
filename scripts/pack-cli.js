#!/usr/bin/env node
/*
 * Local equivalent of `npm pack` for the pathfinder-cli package.
 *
 * Rewrites package.json + README.md with the published shape, runs
 * `npm pack`, then restores both. The output tarball is identical to what
 * would be uploaded by `npm publish` from a CI checkout. Use this locally
 * to smoke-test the published artifact without going to the registry.
 *
 * The restore runs in a try/finally so an interrupted run still leaves
 * the working tree intact. Backups live in os.tmpdir() so npm pack can't
 * accidentally include them in the tarball.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const PACKAGE_JSON_PATH = path.join(REPO_ROOT, 'package.json');
const README_PATH = path.join(REPO_ROOT, 'README.md');
const BACKUP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pathfinder-pack-'));
const PACKAGE_JSON_BACKUP = path.join(BACKUP_DIR, 'package.json');
const README_BACKUP = path.join(BACKUP_DIR, 'README.md');

function readIfExists(p) {
  return fs.existsSync(p) ? fs.readFileSync(p) : null;
}

function restoreOrRemove(p, original) {
  if (original === null) {
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
    }
  } else {
    fs.writeFileSync(p, original);
  }
}

function main() {
  const originalPackageJson = readIfExists(PACKAGE_JSON_PATH);
  const originalReadme = readIfExists(README_PATH);
  if (originalPackageJson === null) {
    throw new Error(`package.json not found at ${PACKAGE_JSON_PATH}`);
  }

  // Build the CLI first if dist/cli/ is missing or empty. Otherwise the
  // resulting tarball is silently empty (npm pack honors the files
  // allowlist regardless of whether the listed paths exist on disk).
  const distCli = path.join(REPO_ROOT, 'dist/cli');
  if (!fs.existsSync(distCli) || fs.readdirSync(distCli).length === 0) {
    process.stderr.write('pack-cli: dist/cli/ missing or empty — running npm run build:cli\n');
    execFileSync('npm', ['run', 'build:cli'], { stdio: 'inherit', cwd: REPO_ROOT });
  }

  fs.writeFileSync(PACKAGE_JSON_BACKUP, originalPackageJson);
  if (originalReadme !== null) {
    fs.writeFileSync(README_BACKUP, originalReadme);
  }

  try {
    execFileSync('node', [path.join(__dirname, 'prepublish-cli.js'), '--write'], {
      stdio: 'inherit',
      cwd: REPO_ROOT,
    });
    execFileSync('npm', ['pack'], {
      stdio: 'inherit',
      cwd: REPO_ROOT,
    });
  } finally {
    restoreOrRemove(PACKAGE_JSON_PATH, originalPackageJson);
    restoreOrRemove(README_PATH, originalReadme);
    fs.rmSync(BACKUP_DIR, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`pack-cli: ${err.message}\n`);
    process.exit(1);
  }
}
