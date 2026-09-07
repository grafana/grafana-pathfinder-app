/**
 * @jest-environment node
 *
 * Unused-bindings lint ratchet (Epic #603).
 *
 * `@grafana/eslint-config` turns `@typescript-eslint/no-unused-vars` off in
 * favour of TypeScript's `noUnusedLocals`. That flag cannot see an unused
 * function parameter (`noUnusedParameters` is separate and unset here) and no
 * compiler flag at all reports an unused `catch` binding. These tests drive
 * the real ESLint API over the repository's own `eslint.config.mjs`, so a
 * later config block that downgrades or shadows the rule at the probe's own
 * path fails here. It cannot detect a block that narrows the rule away from a
 * different subtree via `files` or `ignores` — the grandfather list in
 * `eslint.config.mjs` is that kind of narrowing, and #1815 tracks emptying it.
 */

import { execFileSync } from 'child_process';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

const RULE = '@typescript-eslint/no-unused-vars';

const VIOLATING_SOURCE = `
export function unusedTrailingParam(used: string, dead: string): string {
  return used;
}

export function unusedCatchBinding(work: () => void): boolean {
  try {
    work();
    return true;
  } catch (error) {
    return false;
  }
}

export function unusedLocal(value: string): string {
  const orphan = value.length;
  return value;
}

export function unusedDestructuredProperty(input: { keep: string; drop: string }): string {
  const { keep, drop } = input;
  return keep;
}
`;

const CLEAN_SOURCE = `
export function underscoreParam(used: string, _deliberate: string): string {
  return used;
}

export function underscoreCatchBinding(work: () => void): boolean {
  try {
    work();
    return true;
  } catch (_error) {
    return false;
  }
}

export function optionalCatchBinding(work: () => void): boolean {
  try {
    work();
    return true;
  } catch {
    return false;
  }
}

export function omitRestSibling(input: { drop: string; keep: string }): { keep: string } {
  const { drop, ...rest } = input;
  return rest;
}

export function unusedLeadingParam(dead: string, used: string): string {
  return used;
}
`;

const PROBE_PATH = 'src/unused-bindings-lint-probe.ts';

/**
 * Jest cannot dynamic-import `eslint.config.mjs` without
 * --experimental-vm-modules, so ESLint runs in a child Node process. The probe
 * is linted in memory under a default TS project: the repo config lints with
 * type information, which rejects a path no tsconfig includes, and writing the
 * probe into src/ would leak a stray module into the other file-walking suites.
 */
const RUNNER = `
import { ESLint } from 'eslint';

const eslint = new ESLint({
  cwd: process.cwd(),
  overrideConfig: {
    languageOptions: {
      parserOptions: {
        project: null,
        projectService: { allowDefaultProject: [process.env.PROBE_PATH] },
      },
    },
  },
});

const [result] = await eslint.lintText(process.env.PROBE_SOURCE, { filePath: process.env.PROBE_PATH });
process.stdout.write(JSON.stringify(result.messages));
`;

type LintMessage = { ruleId: string | null; severity: number; message: string; fatal?: boolean };

function lintProbe(source: string): LintMessage[] {
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', RUNNER], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    env: {
      ...process.env,
      PROBE_SOURCE: source,
      PROBE_PATH: PROBE_PATH,
    },
    maxBuffer: 8 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

describe('unused-bindings lint ratchet', () => {
  let violations: LintMessage[];
  let clean: LintMessage[];

  beforeAll(() => {
    violations = lintProbe(VIOLATING_SOURCE);
    clean = lintProbe(CLEAN_SOURCE);
  }, 180_000);

  it('parses both probes instead of reporting a fatal error', () => {
    expect(violations.filter((message) => message.fatal)).toEqual([]);
    expect(clean.filter((message) => message.fatal)).toEqual([]);
  });

  it.each([
    ['a trailing function parameter', "'dead' is defined but never used"],
    ['a catch binding', "'error' is defined but never used"],
    ['a local', "'orphan' is assigned a value but never used"],
    ['a destructured property with no rest sibling', "'drop' is assigned a value but never used"],
  ])('reports %s as an error', (_label, fragment) => {
    const reported = violations.filter((message) => message.ruleId === RULE && message.message.includes(fragment));

    expect(reported.length).toBeGreaterThan(0);
    expect(reported.every((message) => message.severity === 2)).toBe(true);
  });

  it('does not flag an unused parameter before a used one, which distinguishes after-used from all', () => {
    const reported = clean.filter((message) => message.ruleId === RULE && message.message.includes("'dead'"));

    expect(reported).toEqual([]);
  });

  it('leaves deliberate and live bindings alone', () => {
    const reported = clean.filter((message) => message.ruleId === RULE).map((message) => `${message.message}`);

    expect(reported).toEqual([]);
  });
});
