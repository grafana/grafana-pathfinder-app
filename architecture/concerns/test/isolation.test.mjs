import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, posix, relative } from 'node:path';
import { test } from 'node:test';
import { globToRegExp } from '../lib/selectors.mjs';
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

// Reads a value a build input really exports, by loading the module in a child
// process. The subproject keeps no import edge into the harness, and the test
// asserts on the resolved value rather than on the text that produced it.
function exportedValue(modulePath, name) {
  const result = spawnSync(
    process.execPath,
    [
      '-e',
      'process.stdout.write(JSON.stringify(require(process.argv[1])[process.argv[2]]))',
      join(REPOSITORY_ROOT, modulePath),
      name,
    ],
    { encoding: 'utf8' }
  );
  assert.equal(result.status, 0, `${modulePath} would not load: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

function expandBraces(pattern) {
  const group = /\{([^{}]*)\}/.exec(pattern);
  if (!group) {
    return [pattern];
  }
  return group[1]
    .split(',')
    .flatMap((option) =>
      expandBraces(`${pattern.slice(0, group.index)}${option}${pattern.slice(group.index + group[0].length)}`)
    );
}

// A pattern naming a directory selects everything beneath it, which is how both
// tsconfig's include/exclude and npm's files field read a bare path.
function selectionRegExps(patterns) {
  return patterns
    .map((pattern) => pattern.replace('<rootDir>/', '').replace(/\/$/, ''))
    .flatMap(expandBraces)
    .flatMap((pattern) => [pattern, `${pattern}/**`])
    .map(globToRegExp);
}

function filesSelectedBy(patterns, files) {
  const compiled = selectionRegExps(patterns);
  return files.filter((file) => compiled.some((regexp) => regexp.test(file)));
}

function subprojectSelection(patterns, files) {
  return filesSelectedBy(patterns, files).filter((file) => file.startsWith('architecture/'));
}

// Resolves the CopyWebpackPlugin patterns into the repository-relative globs
// they actually select, by pairing each `from` with the declared copy context.
function copyPatternGlobs() {
  const config = readFileSync(join(REPOSITORY_ROOT, '.config/webpack/webpack.config.ts'), 'utf8');
  const constants = readFileSync(join(REPOSITORY_ROOT, '.config/webpack/constants.ts'), 'utf8');
  const sourceDir = /export const SOURCE_DIR = '([^']+)'/.exec(constants);
  assert.ok(sourceDir, '.config/webpack/constants.ts must still declare SOURCE_DIR');
  assert.match(
    config,
    /context: path\.join\(process\.cwd\(\), SOURCE_DIR\)/,
    'the copy context must still be the plugin source directory'
  );
  const block = /new CopyWebpackPlugin\(\{\s*patterns: \[([\s\S]*?)\n\s*\],\s*\}\)/.exec(config);
  assert.ok(block, 'the CopyWebpackPlugin patterns must still be a literal array this test can resolve');
  const expressions = [...block[1].matchAll(/\{\s*from:([\s\S]*?),\s*to:/g)].map((match) => match[1]);
  assert.ok(expressions.length > 0, 'no copy pattern was resolved, so the check would pass vacuously');
  return expressions.flatMap((expression) => {
    const literals = [...expression.matchAll(/'([^']*)'/g)].map((match) => match[1]);
    assert.ok(literals.length > 0, `this test cannot resolve the copy pattern ${expression.trim()}`);
    return literals.map((from) => posix.normalize(posix.join(sourceDir[1], from)));
  });
}

const JS_SPECIFIER_PATTERNS = [
  /\bfrom\s+['"]([^'"]+)['"]/g,
  /\bimport\s+['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

// A relative specifier is resolved into the repository-relative file it names, so
// a traversal that never spells the subproject out still shows up as an edge.
function relativeImportEdges(path, source) {
  const directory = posix.dirname(path);
  const edges = [];
  for (const pattern of JS_SPECIFIER_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      if (match[1].startsWith('.')) {
        edges.push(posix.normalize(posix.join(directory, match[1])));
      }
    }
  }
  return edges;
}

function goModulePath() {
  const goMod = readFileSync(join(REPOSITORY_ROOT, 'go.mod'), 'utf8');
  const declared = /^module\s+(\S+)$/m.exec(goMod);
  assert.ok(declared, 'go.mod must still declare a module path');
  return declared[1];
}

// Go's own two ways of naming a file outside the current one: an import of a
// package inside this module, and an embed pattern. Both are resolved into
// repository-relative paths; neither needs the Go toolchain.
function goEdges(path, source, modulePath) {
  const specifiers = [];
  for (const block of source.matchAll(/import\s*\(([\s\S]*?)\)/g)) {
    for (const quoted of block[1].matchAll(/"([^"]+)"/g)) {
      specifiers.push(quoted[1]);
    }
  }
  for (const single of source.matchAll(/^\s*import\s+(?:[\w.]+\s+)?"([^"]+)"/gm)) {
    specifiers.push(single[1]);
  }
  const internal = specifiers
    .filter((specifier) => specifier === modulePath || specifier.startsWith(`${modulePath}/`))
    .map((specifier) => specifier.slice(modulePath.length).replace(/^\//, '') || '.');
  const embedded = [];
  for (const directive of source.matchAll(/^\s*\/\/go:embed\s+(.+)$/gm)) {
    for (const pattern of directive[1].trim().split(/\s+/)) {
      embedded.push(posix.normalize(posix.join(posix.dirname(path), pattern.replace(/^"|"$/g, ''))));
    }
  }
  return { internal, embedded };
}

function importSpecifiers(source) {
  return [...source.matchAll(/(?:^|\n)\s*import\s[^;]*?from\s+'([^']+)'/g)].map((match) => match[1]);
}

const subprojectFiles = repositoryFilesUnder(SUBPROJECT);
const repositoryFiles = repositoryFilesUnder('.');
const packageJson = readJson(join(REPOSITORY_ROOT, 'package.json'));

test('the subproject lives outside every product source tree', () => {
  assert.ok(subprojectFiles.length > 0, 'the subproject must be tracked');
  for (const path of subprojectFiles) {
    assert.ok(path.startsWith(`${SUBPROJECT}/`), path);
    assert.ok(!path.startsWith('src/') && !path.startsWith('pkg/'), path);
  }
});

test('no import edge in the frontend source tree resolves into the subproject', () => {
  const sources = repositoryFilesUnder('src').filter((file) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file));
  assert.ok(sources.length > 0, 'the frontend source tree must be tracked');
  const edges = sources.flatMap((path) =>
    relativeImportEdges(path, readFileSync(join(REPOSITORY_ROOT, path), 'utf8')).map((edge) => ({ path, edge }))
  );
  assert.ok(edges.length > 0, 'no import edge was resolved, so the check would pass vacuously');
  assert.deepEqual(
    edges.filter(({ edge }) => edge.startsWith('architecture/')),
    []
  );
});

test('no Go import or embed directive in the backend reaches the subproject', () => {
  const modulePath = goModulePath();
  const sources = repositoryFilesUnder('pkg').filter((file) => file.endsWith('.go'));
  assert.ok(sources.length > 0, 'the backend source tree must be tracked');
  const internal = [];
  const embedded = [];
  for (const path of sources) {
    const edges = goEdges(path, readFileSync(join(REPOSITORY_ROOT, path), 'utf8'), modulePath);
    internal.push(...edges.internal.map((edge) => ({ path, edge })));
    embedded.push(...edges.embedded.map((edge) => ({ path, edge })));
  }
  assert.ok(internal.length > 0, 'no in-module Go import was resolved, so the check would pass vacuously');
  for (const { path, edge } of [...internal, ...embedded]) {
    assert.ok(!edge.startsWith('architecture/'), `${path} reaches into the concern subproject: ${edge}`);
  }
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
  const runtimeDeps = exportedValue('scripts/cli-build-utils.js', 'RUNTIME_DEPS');
  assert.ok(runtimeDeps.length > 0, 'the shipped CLI runtime allowlist must still be readable');
  for (const name of ALLOWED_EXTERNAL_PACKAGES) {
    assert.ok(!runtimeDeps.includes(name), `${name} must stay out of the shipped CLI runtime allowlist`);
  }
});

test('the npm publication surface cannot reach the subproject', () => {
  assert.deepEqual(packageJson.files, ['dist/']);
  assert.deepEqual(subprojectSelection(packageJson.files, repositoryFiles), []);
  assert.match(packageJson.bin['pathfinder-cli'], /^\.\/dist\//, 'the published bin must come from the build output');
});

test('the plugin archive copy patterns select no subproject file', () => {
  assert.deepEqual(
    gitGrep('CopyWebpackPlugin', ['.config', 'webpack.config.ts']),
    ['.config/webpack/webpack.config.ts'],
    'the copy patterns this test resolves must be the only ones the build declares'
  );
  const globs = copyPatternGlobs();
  const selected = filesSelectedBy(globs, repositoryFiles);
  assert.ok(selected.length > 0, 'the resolved copy patterns must still select the files the archive ships');
  assert.deepEqual(subprojectSelection(globs, repositoryFiles), []);
});

test('the shipped CLI compile inputs select no subproject file', () => {
  const tsconfig = readJson(join(REPOSITORY_ROOT, 'tsconfig.cli.json'));
  const excluded = new Set(filesSelectedBy(tsconfig.exclude, repositoryFiles));
  const compiled = filesSelectedBy(tsconfig.include, repositoryFiles).filter((file) => !excluded.has(file));
  assert.ok(compiled.length > 0, 'the resolved compile inputs must still select the CLI sources');
  assert.deepEqual(
    compiled.filter((file) => file.startsWith('architecture/')),
    []
  );
});

// The subproject's own suite runs under `node --test`; jest must not pick it up
// and silently subject it to the plugin's browser test environment.
test('the jest suite selects no subproject test', () => {
  const testMatch = exportedValue('jest.config.js', 'testMatch');
  const selected = filesSelectedBy(testMatch, repositoryFiles);
  assert.ok(selected.length > 0, 'the resolved testMatch must still select the plugin suite');
  assert.deepEqual(subprojectSelection(testMatch, repositoryFiles), []);
  assert.deepEqual(filesSelectedBy(testMatch, subprojectFiles), []);
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

// Driven through npm rather than asserted as literals, so a behaviour-preserving
// rewrite of the command keeps passing and a broken one does not.
test('the root npm scripts reach the concerns CLI', () => {
  const npm = (args) => spawnSync('npm', ['run', '--silent', ...args], { cwd: REPOSITORY_ROOT, encoding: 'utf8' });

  const version = npm(['concerns', '--', '--version']);
  assert.equal(version.status, 0, version.stderr);
  assert.match(version.stdout, /^registry format version \d+$/m);

  const validate = npm(['concerns:validate']);
  assert.equal(validate.status, 0, validate.stderr);
  assert.match(validate.stdout, new RegExp(`^${SUBPROJECT}/registry\\.json: valid `, 'm'));
});
