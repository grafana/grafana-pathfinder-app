import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

function files(root) {
  if (lstatSync(root).isSymbolicLink()) {
    throw new Error(`Symlink is not allowed in a bundled tutorial: ${root}`);
  }
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (lstatSync(path).isSymbolicLink()) {
      throw new Error(`Symlink is not allowed in a bundled tutorial: ${path}`);
    }
    return entry.isDirectory() ? files(path) : [path];
  });
}

function digest(root) {
  const hash = createHash('sha256');
  for (const path of files(root).sort()) {
    hash.update(relative(root, path));
    hash.update(readFileSync(path));
  }
  return hash.digest('hex');
}

function validateAssets(content, root) {
  root = realpathSync(root);
  const check = (value) => {
    if (!value || /^(?:https?:|data:|#)/.test(value)) {
      return;
    }
    const path = resolve(root, value);
    if (!path.startsWith(`${root}/`) || !existsSync(path) || !realpathSync(path).startsWith(`${root}/`)) {
      throw new Error(`Missing or unsafe tutorial asset: ${value}`);
    }
  };
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        if ((key === 'src' || key === 'poster') && typeof child === 'string') {
          check(child);
        }
        visit(child);
      }
    } else if (typeof value === 'string') {
      for (const match of value.matchAll(/!\[[^\]]*\]\(([^\s)]+)(?:\s+[^)]*)?\)/g)) {
        check(match[1]);
      }
    }
  };
  visit(content);
}

export function syncBundledTutorials(source, { root = appRoot, revision, validate } = {}) {
  source = resolve(source);
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim();
  if (!/^[a-f0-9]{40}$/.test(revision ?? '') || revision !== sha) {
    throw new Error('Supply the exact checked-out upstream commit SHA');
  }
  if (
    execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: source, encoding: 'utf8' }).trim()
  ) {
    throw new Error('Upstream checkout must have no tracked modifications');
  }
  const config = readJson(join(root, 'src/constants/bundled-tutorials.json'));
  const bundled = join(root, 'src/bundled-interactives');
  const temp = mkdtempSync(join(tmpdir(), 'bundled-tutorials-'));
  const stage = join(temp, 'bundled');
  const cli = join(root, 'dist/cli/cli/index.js');
  const runCli = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: root, stdio: 'pipe' });
  try {
    cpSync(bundled, stage, { recursive: true });
    const index = [];
    const changed = [];
    for (const entry of config) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.id)) {
        throw new Error(`Invalid tutorial ID: ${entry.id}`);
      }
      if (
        execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', entry.id], {
          cwd: source,
          encoding: 'utf8',
        }).trim()
      ) {
        throw new Error(`Tutorial must match the pinned commit: ${entry.id}`);
      }
      const from = join(source, entry.id);
      files(from);
      const content = readJson(join(from, 'content.json'));
      const manifest = readJson(join(from, 'manifest.json'));
      if (content.id !== entry.id || manifest.id !== entry.id || manifest.type !== 'guide') {
        throw new Error(`Mismatched tutorial identity: ${entry.id}`);
      }
      validateAssets(content, from);
      const to = join(stage, entry.id);
      rmSync(to, { recursive: true, force: true });
      cpSync(from, to, { recursive: true });
      writeJson(join(to, 'manifest.json'), { ...manifest, repository: 'bundled' });
      if (validate) {
        validate(to);
      } else {
        runCli('validate', '--package', to);
      }
      index.push({
        id: entry.id,
        title: content.title,
        summary: manifest.description,
        filename: `${entry.id}/content.json`,
        url: entry.url,
        ...(entry.targetPlatform ? { targetPlatform: entry.targetPlatform } : {}),
      });
    }
    writeJson(join(stage, 'index.json'), { interactives: index });
    if (!validate) {
      runCli('build-stats', stage);
      runCli('build-repository', stage, '-o', join(stage, 'repository.json'));
      execFileSync(
        process.execPath,
        [
          join(root, 'node_modules/prettier/bin/prettier.cjs'),
          '--config',
          join(root, '.prettierrc.js'),
          '--write',
          `${stage}/**/*.json`,
        ],
        { stdio: 'pipe' }
      );
    }
    for (const entry of config) {
      if (digest(join(stage, entry.id)) !== digest(join(bundled, entry.id))) {
        changed.push(entry.id);
      }
    }
    const indexesChanged = ['index.json', 'repository.json'].some(
      (name) => readFileSync(join(stage, name), 'utf8') !== readFileSync(join(bundled, name), 'utf8')
    );
    if (!changed.length && !indexesChanged) {
      return { revision: sha, changed: [] };
    }
    for (const entry of config) {
      rmSync(join(bundled, entry.id), { recursive: true });
      cpSync(join(stage, entry.id), join(bundled, entry.id), { recursive: true });
    }
    for (const name of ['index.json', 'repository.json']) {
      cpSync(join(stage, name), join(bundled, name));
    }
    writeJson(join(root, 'src/constants/bundled-tutorials-source.json'), {
      repository: 'grafana/interactive-tutorials',
      revision: sha,
    });
    return { revision: sha, changed: changed.length ? changed : config.map(({ id }) => id) };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [source, revision] = process.argv.slice(2);
  if (!source || !revision) {
    throw new Error('Usage: node scripts/sync-bundled-tutorials.mjs UPSTREAM_CHECKOUT COMMIT_SHA');
  }
  const result = syncBundledTutorials(source, { revision });
  console.log(JSON.stringify(result));
  if (process.env.GITHUB_OUTPUT) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_OUTPUT, `changed=${result.changed.join(', ')}\nrevision=${result.revision}\n`);
  }
}
