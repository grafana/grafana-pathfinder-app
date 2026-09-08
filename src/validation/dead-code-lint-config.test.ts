/**
 * @jest-environment node
 *
 * Dead-code lint ratchet (Epic #603).
 *
 * `@grafana/eslint-config` does not extend `eslint:recommended`, so the
 * unreachable/vacuous-code rules only run if this repository turns them on.
 * These tests drive the real ESLint API over the repository's own
 * `eslint.config.mjs`, so a later config block that reorders, downgrades or
 * shadows the rules fails here rather than silently reopening the gap.
 */

import { execFileSync } from 'child_process';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

const RULES = [
  'no-unreachable',
  'no-unreachable-loop',
  'no-constant-condition',
  'no-dupe-else-if',
  'no-useless-return',
];

const VIOLATING_SOURCE = `
export function afterReturn(): number {
  return 1;
  const orphan = 2;
  return orphan;
}

export function loopRunsOnce(items: string[]): string | undefined {
  for (const item of items) {
    return item;
  }
  return undefined;
}

export function vacuousGuard(flag: boolean): string {
  if (true) {
    return 'always';
  }
  return flag ? 'a' : 'b';
}

export function dupeBranch(a: boolean, b: boolean): string {
  if (a) {
    return 'a';
  } else if (b) {
    return 'b';
  } else if (b) {
    return 'never';
  }
  return 'fallthrough';
}

export function uselessTail(flag: boolean): void {
  if (flag) {
    return;
  }
  return;
}
`;

const CLEAN_SOURCE = `
export function afterReturn(): number {
  const value = 2;
  return value;
}

export function loopRunsMany(items: string[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    out.push(item);
  }
  return out;
}

export function realGuard(flag: boolean): string {
  if (flag) {
    return 'yes';
  }
  return 'no';
}

export function distinctBranches(a: boolean, b: boolean): string {
  if (a) {
    return 'a';
  } else if (b) {
    return 'b';
  }
  return 'fallthrough';
}

export function earlyExit(flag: boolean, doWork: () => void): void {
  if (flag) {
    return;
  }
  doWork();
}
`;

const PROBE_PATH = 'src/dead-code-lint-probe.ts';

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

describe('dead-code lint ratchet', () => {
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

  it.each(RULES)('reports %s as an error', (rule) => {
    const reported = violations.filter((message) => message.ruleId === rule);

    expect(reported.length).toBeGreaterThan(0);
    expect(reported.every((message) => message.severity === 2)).toBe(true);
  });

  it('leaves live code that only resembles the dead shapes alone', () => {
    const reported = clean
      .filter((message) => message.ruleId !== null && RULES.includes(message.ruleId))
      .map((message) => `${message.ruleId}: ${message.message}`);

    expect(reported).toEqual([]);
  });
});
