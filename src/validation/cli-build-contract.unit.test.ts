/** @jest-environment node */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  buildTypeScriptCompileClosure,
  getTypeScriptCompileClosure,
  isPathExcludedByDockerignore,
  parseDockerfileLocalCopySources,
  parseWorkflowPathFilters,
  validateCliBuildContract,
  type TypeScriptCompileClosure,
} from './cli-build-contract';

describe('CLI build contract helpers', () => {
  let fixtureDir: string;
  let closure: TypeScriptCompileClosure;

  beforeAll(() => {
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-build-contract-'));
    fs.mkdirSync(path.join(fixtureDir, 'src', 'cli'), { recursive: true });
    fs.mkdirSync(path.join(fixtureDir, 'src', 'shared'), { recursive: true });
    fs.mkdirSync(path.join(fixtureDir, 'src', 'constants'), { recursive: true });
    fs.writeFileSync(
      path.join(fixtureDir, 'tsconfig.cli.json'),
      JSON.stringify({
        compilerOptions: { module: 'esnext', moduleResolution: 'bundler', target: 'ES2020' },
        include: ['src/cli/**/*'],
        exclude: ['**/*.test.ts'],
      })
    );
    fs.writeFileSync(
      path.join(fixtureDir, 'src', 'cli', 'index.ts'),
      `import type { Shared } from '../shared/shared';\nexport type CliValue = Shared;`
    );
    fs.writeFileSync(
      path.join(fixtureDir, 'src', 'shared', 'shared.ts'),
      `import type { Constant } from '../constants/value';\nexport type Shared = Constant;`
    );
    fs.writeFileSync(path.join(fixtureDir, 'src', 'constants', 'value.ts'), `export type Constant = string;`);
    fs.writeFileSync(path.join(fixtureDir, 'src', 'cli', 'ignored.test.ts'), `export const ignored = true;`);
    closure = getTypeScriptCompileClosure(path.join(fixtureDir, 'tsconfig.cli.json'));
  });

  afterAll(() => {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  });

  it('derives roots from tsconfig includes and excludes and follows type-only imports', () => {
    expect(closure.roots).toEqual(['src/cli/index.ts']);
    expect(closure.files).toEqual(['src/cli/index.ts', 'src/constants/value.ts', 'src/shared/shared.ts']);
    expect(closure.chains.get('src/constants/value.ts')).toEqual([
      'src/cli/index.ts',
      'src/shared/shared.ts',
      'src/constants/value.ts',
    ]);
  });

  it('memoizes a compile closure by tsconfig path', () => {
    const tsconfigPath = path.join(fixtureDir, 'tsconfig.cli.json');
    expect(getTypeScriptCompileClosure(tsconfigPath)).toBe(closure);
  });

  it('rejects an empty compile closure', () => {
    const emptyTsconfigPath = path.join(fixtureDir, 'tsconfig.empty.json');
    fs.writeFileSync(emptyTsconfigPath, JSON.stringify({ include: ['src/missing/**/*'] }));
    const emptyClosure = buildTypeScriptCompileClosure(emptyTsconfigPath);
    const errors = validateCliBuildContract(emptyClosure, {
      dockerfile: 'FROM node AS builder',
      dockerignore: '',
      workflows: {},
    });
    expect(errors).toContain('tsconfig.cli.json compile closure is empty.');
  });

  it('parses only local COPY sources from the requested Docker stage', () => {
    const dockerfile = [
      'FROM node AS builder',
      'COPY package.json tsconfig.cli.json ./',
      'COPY src/cli ./src/cli',
      'FROM node AS runtime',
      'COPY --from=builder /build/dist ./dist',
    ].join('\n');
    expect(parseDockerfileLocalCopySources(dockerfile, 'builder')).toEqual([
      'package.json',
      'tsconfig.cli.json',
      'src/cli',
    ]);
  });

  it('reports an uncovered Docker path with its type-only import chain', () => {
    const errors = validateCliBuildContract(closure, {
      dockerfile: ['FROM node AS builder', 'COPY src/cli ./src/cli', 'COPY src/shared ./src/shared'].join('\n'),
      dockerignore: '',
      workflows: {},
    });
    expect(errors.join('\n')).toContain('Dockerfile.cli builder COPY does not cover src/constants/value.ts');
    expect(errors.join('\n')).toContain('src/cli/index.ts -> src/shared/shared.ts -> src/constants/value.ts');
  });

  it('rejects a COPY source that lands at the wrong builder path', () => {
    const errors = validateCliBuildContract(closure, {
      dockerfile: ['FROM node AS builder', 'COPY src ./wrong-place'].join('\n'),
      dockerignore: '',
      workflows: {},
    });
    expect(errors.join('\n')).toContain('Dockerfile.cli builder COPY does not cover src/cli/index.ts');
  });

  it('reports files excluded from the Docker build context', () => {
    const errors = validateCliBuildContract(closure, {
      dockerfile: ['FROM node AS builder', 'COPY src ./src'].join('\n'),
      dockerignore: ['src/constants', '!src/constants/other'].join('\n'),
      workflows: {},
    });
    expect(errors.join('\n')).toContain('.dockerignore excludes required file src/constants/value.ts');
  });

  it('honors ordered Dockerignore inclusions for required subdirectories', () => {
    const dockerignore = ['src/lib', '!src/lib/guide-stats'].join('\n');
    expect(isPathExcludedByDockerignore('src/lib/browser-only.ts', dockerignore)).toBe(true);
    expect(isPathExcludedByDockerignore('src/lib/guide-stats/index.ts', dockerignore)).toBe(false);
  });

  it('anchors slashless Dockerignore patterns at the context root', () => {
    expect(isPathExcludedByDockerignore('e2e/root-test.ts', 'e2e')).toBe(true);
    expect(isPathExcludedByDockerignore('src/cli/e2e/runner.ts', 'e2e')).toBe(false);
  });

  it('requires push and pull request filters in every workflow to cover the closure', () => {
    const workflow = [
      'on:',
      '  push:',
      '    paths:',
      "      - 'src/cli/**'",
      "      - 'src/shared/**'",
      '  pull_request:',
      '    paths:',
      "      - 'src/cli/**'",
      "      - 'src/shared/**'",
    ].join('\n');
    expect(parseWorkflowPathFilters(workflow)).toEqual({
      push: ['src/cli/**', 'src/shared/**'],
      pull_request: ['src/cli/**', 'src/shared/**'],
    });
    const errors = validateCliBuildContract(closure, {
      dockerfile: ['FROM node AS builder', 'COPY src ./src'].join('\n'),
      dockerignore: '',
      workflows: { 'publish.yml': workflow },
    });
    expect(errors.join('\n')).toContain('publish.yml push paths do not cover required file src/constants/value.ts');
    expect(errors.join('\n')).toContain(
      'publish.yml pull_request paths do not cover required file src/constants/value.ts'
    );
  });
});
