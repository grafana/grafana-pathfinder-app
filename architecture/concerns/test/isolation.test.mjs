import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { readJson, REPOSITORY_ROOT } from './helpers.mjs';

const SUBPROJECT = 'architecture/concerns';
const ALLOWED_EXTERNAL_PACKAGES = ['ajv'];

function git(args) {
  return execFileSync('git', args, { cwd: REPOSITORY_ROOT, encoding: 'utf8' });
}

// Untracked-but-not-ignored files count too: a boundary check that only saw
// committed files would pass on a working tree that has already broken it.
function repositoryFilesUnder(prefix) {
  return git(['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', prefix])
    .split('\x00')
    .filter((path) => path.length > 0)
    .sort();
}

function gitGrep(pattern, pathspecs) {
  try {
    return git(['grep', '--files-with-matches', '--fixed-strings', pattern, '--', ...pathspecs])
      .split('\n')
      .filter((line) => line.length > 0);
  } catch (error) {
    if (error.status === 1) {
      return [];
    }
    throw error;
  }
}

function importSpecifiers(source) {
  return [...source.matchAll(/(?:^|\n)\s*import\s[^;]*?from\s+'([^']+)'/g)].map((match) => match[1]);
}

const subprojectFiles = repositoryFilesUnder(SUBPROJECT);
const packageJson = readJson(join(REPOSITORY_ROOT, 'package.json'));

test('the subproject lives outside every product source tree', () => {
  assert.ok(subprojectFiles.length > 0, 'the subproject must be tracked');
  for (const path of subprojectFiles) {
    assert.ok(path.startsWith(`${SUBPROJECT}/`), path);
    assert.ok(!path.startsWith('src/') && !path.startsWith('pkg/'), path);
  }
});

test('production source never reads or imports the concern subproject', () => {
  assert.deepEqual(gitGrep(SUBPROJECT, ['src', 'pkg']), []);
  assert.deepEqual(gitGrep('registry.schema.json', ['src', 'pkg']), []);
});

test('the concern implementation never imports product code or a harness directory', () => {
  const forbidden = ['src/', 'pkg/', '.cursor/', 'scripts/', 'tests/'];
  for (const path of subprojectFiles.filter((file) => file.endsWith('.mjs'))) {
    const source = readFileSync(join(REPOSITORY_ROOT, path), 'utf8');
    for (const specifier of importSpecifiers(source)) {
      if (specifier.startsWith('node:')) {
        continue;
      }
      if (specifier.startsWith('.')) {
        const resolved = relative(REPOSITORY_ROOT, join(REPOSITORY_ROOT, path, '..', specifier));
        assert.ok(resolved.startsWith(`${SUBPROJECT}/`), `${path} imports outside the subproject: ${specifier}`);
        continue;
      }
      const packageName = specifier.split('/')[0];
      assert.ok(
        ALLOWED_EXTERNAL_PACKAGES.includes(packageName),
        `${path} imports the unapproved package ${packageName}`
      );
      for (const prefix of forbidden) {
        assert.ok(!specifier.startsWith(prefix), `${path} imports ${specifier}`);
      }
    }
  }
});

test('the only external dependency is an existing dev dependency outside the shipped CLI runtime', () => {
  for (const name of ALLOWED_EXTERNAL_PACKAGES) {
    assert.ok(packageJson.devDependencies[name], `${name} must stay a dev dependency`);
    assert.ok(!packageJson.dependencies?.[name], `${name} must not become a runtime dependency`);
  }
  const cliBuildUtils = readFileSync(join(REPOSITORY_ROOT, 'scripts/cli-build-utils.js'), 'utf8');
  const runtimeDeps = cliBuildUtils.match(/const RUNTIME_DEPS = \[([^\]]*)\]/)[1];
  for (const name of ALLOWED_EXTERNAL_PACKAGES) {
    assert.ok(!runtimeDeps.includes(`'${name}'`), `${name} must stay out of the shipped CLI runtime allowlist`);
  }
});

test('the npm publication surface cannot reach the subproject', () => {
  assert.deepEqual(packageJson.files, ['dist/']);
  assert.ok(!JSON.stringify(packageJson.files).includes('architecture'));
  assert.ok(!packageJson.bin['pathfinder-cli'].includes('architecture'));
});

test('no build input names the subproject, so it cannot reach the plugin archive', () => {
  const buildInputs = [
    'webpack.config.ts',
    '.config/webpack/webpack.config.ts',
    'tsconfig.cli.json',
    'jest.config.js',
    'Magefile.go',
    'Dockerfile.cli',
    'Dockerfile.e2e-runner',
  ];
  for (const path of buildInputs) {
    const source = readFileSync(join(REPOSITORY_ROOT, path), 'utf8');
    assert.ok(!source.includes('architecture'), `${path} must not name the architecture subproject`);
  }
});

test('the E2E runner image ignores the subproject its COPY would otherwise take', () => {
  const dockerfile = readFileSync(join(REPOSITORY_ROOT, 'Dockerfile.e2e-runner'), 'utf8');
  assert.match(dockerfile, /^COPY --chown=node:node \. \.$/m, 'the runner still copies the whole context');
  const ignore = readFileSync(join(REPOSITORY_ROOT, 'Dockerfile.e2e-runner.dockerignore'), 'utf8')
    .split('\n')
    .map((line) => line.trim());
  assert.ok(ignore.includes('architecture'), 'Dockerfile.e2e-runner.dockerignore must exclude architecture/');
});

test('the shipped CLI image build context excludes the subproject', () => {
  const dockerfile = readFileSync(join(REPOSITORY_ROOT, 'Dockerfile.cli'), 'utf8');
  const copied = [...dockerfile.matchAll(/^COPY\s+(.*)$/gm)].map((match) => match[1]);
  for (const line of copied) {
    assert.ok(!line.includes('architecture'), `Dockerfile.cli copies ${line}`);
    assert.ok(!/^\.\s/.test(line), `Dockerfile.cli must not copy a whole context: ${line}`);
  }
  const ignore = readFileSync(join(REPOSITORY_ROOT, '.dockerignore'), 'utf8')
    .split('\n')
    .map((line) => line.trim());
  assert.ok(ignore.includes('architecture'), '.dockerignore must exclude architecture/');
});

test('the subproject is a plain-Node root with no manifest, lockfile, or build output of its own', () => {
  for (const path of subprojectFiles) {
    const name = path.slice(SUBPROJECT.length + 1);
    assert.ok(
      !['package.json', 'package-lock.json', 'tsconfig.json'].includes(name),
      `${path} would make the subproject a package`
    );
    assert.ok(/\.(mjs|json)$/.test(name), `${path} is not a plain-Node source or data file`);
  }
});

test('the root scripts expose the subproject without touching the shipped CLI', () => {
  assert.equal(packageJson.scripts.concerns, `node ${SUBPROJECT}/bin/concerns.mjs`);
  assert.equal(packageJson.scripts['concerns:validate'], 'npm run concerns -- validate');
  assert.equal(packageJson.scripts['test:concerns'], `node --test ${SUBPROJECT}/test/*.test.mjs`);
  const cliCommands = readFileSync(join(REPOSITORY_ROOT, 'src/cli/cli-commands.ts'), 'utf8');
  assert.ok(!cliCommands.includes('concerns'), 'the shipped CLI must not gain a concerns command');
});
