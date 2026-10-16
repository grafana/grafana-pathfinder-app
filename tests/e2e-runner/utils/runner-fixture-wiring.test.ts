/** @jest-environment node */

// The specs the CLI launches reach real Grafana stacks, so their `test` must be the one that disables RudderStack.

import { readFileSync } from 'fs';
import { join } from 'path';
import * as ts from 'typescript';

import { test as runnerTest } from '../fixtures';
import { disableRudderstack } from './disable-rudderstack';

// Stands in for the Playwright base fixture, so `test` is the object the runner fixture passes to `extend`.
jest.mock('../../fixtures', () => ({ test: { extend: (fixtures: unknown) => fixtures } }));

type ContextFixture = (args: { context: unknown }, use: (context: unknown) => Promise<void>) => Promise<void>;

const RUNNER_ROOT = join(__dirname, '..');
const CLI_LAUNCHED_SPECS = ['guide-runner.spec.ts', 'shared-guide-runner.spec.ts'];
const RUNNER_FIXTURE_MODULE = './fixtures';
const TEST_MODULES = [RUNNER_FIXTURE_MODULE, '../fixtures', '@playwright/test'];

function moduleOf(declaration: ts.ImportDeclaration): string {
  return ts.isStringLiteral(declaration.moduleSpecifier) ? declaration.moduleSpecifier.text : '';
}

function canSupplyTest(declaration: ts.ImportDeclaration): boolean {
  const clause = declaration.importClause;
  if (!clause || clause.isTypeOnly) {
    return false;
  }
  const bindings = clause.namedBindings;
  if (bindings && ts.isNamedImports(bindings)) {
    const namesTest = bindings.elements.some(
      (element) => !element.isTypeOnly && (element.propertyName ?? element.name).text === 'test'
    );
    if (namesTest) {
      return true;
    }
  }
  const importsWholeModule = clause.name !== undefined || (bindings !== undefined && ts.isNamespaceImport(bindings));
  return importsWholeModule && TEST_MODULES.includes(moduleOf(declaration));
}

function modulesSupplyingTest(sourceText: string): string[] {
  return ts
    .createSourceFile('source.ts', sourceText, ts.ScriptTarget.Latest, true)
    .statements.filter(ts.isImportDeclaration)
    .filter(canSupplyTest)
    .map(moduleOf);
}

function runnerContextFixture(): ContextFixture {
  const declared = (runnerTest as unknown as { context?: ContextFixture | [ContextFixture, unknown] }).context;
  const fixture = Array.isArray(declared) ? declared[0] : declared;
  if (typeof fixture !== 'function') {
    throw new Error('tests/e2e-runner/fixtures.ts no longer overrides the context fixture');
  }
  return fixture;
}

describe('CLI guide runner RudderStack suppression wiring', () => {
  it.each(CLI_LAUNCHED_SPECS)('%s takes test from the runner fixture only', (spec) => {
    expect(modulesSupplyingTest(readFileSync(join(RUNNER_ROOT, spec), 'utf-8'))).toEqual([RUNNER_FIXTURE_MODULE]);
  });

  it('the runner fixture finishes installing the suppression helper before it exposes the context', async () => {
    let finishInstall = () => {};
    const install = new Promise<void>((resolve) => {
      finishInstall = resolve;
    });
    const context = { addInitScript: jest.fn(() => install) };
    const use = jest.fn(async () => {});

    const fixtureRun = runnerContextFixture()({ context }, use);
    await new Promise((resolve) => setImmediate(resolve));

    expect(context.addInitScript).toHaveBeenCalledWith(disableRudderstack);
    expect(use).not.toHaveBeenCalled();

    finishInstall();
    await fixtureRun;

    expect(use).toHaveBeenCalledWith(context);
  });
});

describe('the spec import check', () => {
  it.each([
    ["import { test, expect } from './fixtures';", ['./fixtures']],
    ["import { test as runnerTest } from './fixtures';", ['./fixtures']],
    ["import { test } from './fixtures';\nimport { expect } from '@playwright/test';", ['./fixtures']],
    ["import { test, expect } from '../fixtures';", ['../fixtures']],
    ["import { expect, test, type Page } from '@playwright/test';", ['@playwright/test']],
    [
      "import { test } from './fixtures';\nimport { test as unsuppressed } from '@playwright/test';",
      ['./fixtures', '@playwright/test'],
    ],
    [
      "import { test } from './fixtures';\nimport * as playwright from '@playwright/test';",
      ['./fixtures', '@playwright/test'],
    ],
    ["import playwrightTest from '@playwright/test';", ['@playwright/test']],
    ["import * as base from '../fixtures';", ['../fixtures']],
    ["import { expect } from './fixtures';", []],
    ["import type { test } from './fixtures';", []],
    ["import * as path from 'path';\nimport type * as playwright from '@playwright/test';", []],
  ])('reports which modules can supply test in %j', (specText, expected) => {
    expect(modulesSupplyingTest(specText)).toEqual(expected);
  });
});
