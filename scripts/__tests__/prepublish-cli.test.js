const fs = require('fs');
const path = require('path');

const {
  buildPublishManifest,
  readSchemaVersion,
  filterDependencies,
  CLI_RUNTIME_DEPENDENCIES,
  PUBLISHED_NAME,
  PUBLISHED_FILES,
} = require('../prepublish-cli');

const REPO_ROOT = path.resolve(__dirname, '../..');

const FIXTURE = {
  name: 'grafana-pathfinder-app',
  version: '2.10.0',
  description: 'Grafana Pathfinder app plugin.',
  bin: { 'pathfinder-cli': './dist/cli/cli/index.js' },
  files: ['dist/'],
  engines: { node: '>=22' },
  license: 'AGPL-3.0',
  author: 'Grafanalabs',
  scripts: { build: 'webpack', test: 'jest' },
  dependencies: {
    commander: '^14.0.0',
    zod: '^4.1.13',
    react: '18.3.1',
    '@grafana/ui': '^12.4.2',
  },
  devDependencies: { jest: '^30.2.0', webpack: '^5.0.0' },
  'lint-staged': { '*.ts': 'prettier --write' },
  overrides: { dompurify: '^3.3.2' },
  packageManager: 'npm@11.13.0',
};

describe('buildPublishManifest', () => {
  let manifest;
  beforeEach(() => {
    manifest = buildPublishManifest(FIXTURE, '1.1.0');
  });

  test('rewrites name to the published CLI name', () => {
    expect(manifest.name).toBe(PUBLISHED_NAME);
    expect(manifest.name).not.toBe(FIXTURE.name);
  });

  test('pins version to the supplied schema version', () => {
    expect(manifest.version).toBe('1.1.0');
    expect(manifest.version).not.toBe(FIXTURE.version);
  });

  test('narrows files to the CLI build output', () => {
    expect(manifest.files).toEqual(PUBLISHED_FILES);
    expect(manifest.files).toContain('dist/cli/');
    expect(manifest.files).not.toContain('dist/');
    // README.md is not listed: npm always includes it from the package
    // root, and listing it explicitly would match recursively.
    expect(manifest.files).not.toContain('README.md');
  });

  test('preserves the bin map verbatim', () => {
    expect(manifest.bin).toEqual(FIXTURE.bin);
  });

  test('drops devDependencies entirely', () => {
    expect(manifest.devDependencies).toBeUndefined();
  });

  test('filters dependencies to the CLI runtime allowlist', () => {
    expect(Object.keys(manifest.dependencies).sort()).toEqual([...CLI_RUNTIME_DEPENDENCIES].sort());
    expect(manifest.dependencies).not.toHaveProperty('react');
    expect(manifest.dependencies).not.toHaveProperty('@grafana/ui');
  });

  test('preserves dependency version specifiers', () => {
    expect(manifest.dependencies.commander).toBe(FIXTURE.dependencies.commander);
    expect(manifest.dependencies.zod).toBe(FIXTURE.dependencies.zod);
  });

  test('strips repo-only top-level keys', () => {
    expect(manifest['lint-staged']).toBeUndefined();
    expect(manifest.overrides).toBeUndefined();
    expect(manifest.packageManager).toBeUndefined();
  });

  test('drops repo-only scripts', () => {
    expect(manifest.scripts).toBeUndefined();
  });

  test('preserves engines', () => {
    expect(manifest.engines).toEqual(FIXTURE.engines);
  });

  test('throws if a CLI runtime dep is missing from the source manifest', () => {
    const broken = { ...FIXTURE, dependencies: { zod: '^4.0.0' } }; // commander missing
    expect(() => buildPublishManifest(broken, '1.1.0')).toThrow(/commander/);
  });

  test('produces deterministic JSON output', () => {
    const a = JSON.stringify(buildPublishManifest(FIXTURE, '1.1.0'));
    const b = JSON.stringify(buildPublishManifest(FIXTURE, '1.1.0'));
    expect(a).toBe(b);
  });
});

describe('filterDependencies', () => {
  test('returns only allowlisted entries', () => {
    const result = filterDependencies({ commander: '^14.0.0', zod: '^4.0.0', extra: '^1.0.0' }, ['commander', 'zod']);
    expect(result).toEqual({ commander: '^14.0.0', zod: '^4.0.0' });
  });

  test('throws when source is missing or empty', () => {
    expect(() => filterDependencies(undefined, ['commander'])).toThrow(/commander/);
    expect(() => filterDependencies({}, ['commander'])).toThrow(/commander/);
  });
});

describe('readSchemaVersion (integration with repo source)', () => {
  test('matches the literal in src/types/json-guide.schema.ts', () => {
    const version = readSchemaVersion();
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
    const source = fs.readFileSync(path.join(REPO_ROOT, 'src/types/json-guide.schema.ts'), 'utf8');
    expect(source).toContain(`CURRENT_SCHEMA_VERSION = '${version}'`);
  });
});

describe('integration with the live repo manifest', () => {
  test('rewriting the live package.json produces a valid published shape', () => {
    const sourceManifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    const schemaVersion = readSchemaVersion();
    const published = buildPublishManifest(sourceManifest, schemaVersion);

    expect(published.name).toBe(PUBLISHED_NAME);
    expect(published.version).toBe(schemaVersion);
    expect(published.bin).toHaveProperty('pathfinder-cli');
    expect(published.files).toEqual(PUBLISHED_FILES);
    expect(published.devDependencies).toBeUndefined();
    expect(Object.keys(published.dependencies).sort()).toEqual([...CLI_RUNTIME_DEPENDENCIES].sort());
  });
});
