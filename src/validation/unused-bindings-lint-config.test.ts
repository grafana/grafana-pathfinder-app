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
 * path fails here. The in-memory probes are linted at one synthetic path, so
 * they cannot see a block that narrows the rule away from a different subtree
 * via `files` or `ignores`; the `GRANDFATHERED` suite below covers exactly
 * that, by resolving the effective rule severity for every file under `src/`
 * and pinning both the narrowed set and the bindings it exempts.
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
 * Both probes share one ESLint instance in one process, since each instance
 * pays to build a fresh `projectService`.
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

const sources = JSON.parse(process.env.PROBE_SOURCES);
const results = {};
for (const [name, source] of Object.entries(sources)) {
  const [result] = await eslint.lintText(source, { filePath: process.env.PROBE_PATH });
  results[name] = result.messages;
}
process.stdout.write(JSON.stringify(results));
`;

type LintMessage = { ruleId: string | null; severity: number; message: string; fatal?: boolean };

function lintProbes(sources: Record<string, string>): Record<string, LintMessage[]> {
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', RUNNER], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    env: {
      ...process.env,
      PROBE_SOURCES: JSON.stringify(sources),
      PROBE_PATH: PROBE_PATH,
    },
    maxBuffer: 8 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

/** #1815 cleared — no grandfathered exemptions remain. */
const GRANDFATHERED: Record<string, string[]> = {};

/**
 * Resolves the rule's effective severity for every file under `src/` through
 * ESLint's own config resolver, then re-enables it over the grandfathered
 * files to recover the bindings the block hides. Asking the resolver rather
 * than reading `eslint.config.mjs` catches narrowing by `ignores` as well as
 * by `files`, and reports what ESLint actually applies.
 */
const GRANDFATHER_RUNNER = `
import { ESLint } from 'eslint';
import * as fs from 'fs';
import * as path from 'path';

const RULE = ${JSON.stringify(RULE)};
const OPTIONS = ['error', {
  args: 'after-used',
  argsIgnorePattern: '^_',
  caughtErrors: 'all',
  caughtErrorsIgnorePattern: '^_',
  ignoreRestSiblings: true,
}];

function walk(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, found);
    } else if (/\\.tsx?$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

const resolver = new ESLint({ cwd: process.cwd() });
const exempted = [];
for (const file of walk(path.join(process.cwd(), 'src'))) {
  const config = await resolver.calculateConfigForFile(file);
  const entry = config.rules?.[RULE];
  const severity = Array.isArray(entry) ? entry[0] : entry;
  if (severity !== 2 && severity !== 'error') {
    exempted.push(path.relative(process.cwd(), file));
  }
}
exempted.sort();

const reinstated = new ESLint({
  cwd: process.cwd(),
  overrideConfig: { files: exempted, rules: { [RULE]: OPTIONS } },
});
const bindings = {};
for (const result of exempted.length ? await reinstated.lintFiles(exempted) : []) {
  const file = path.relative(process.cwd(), result.filePath);
  bindings[file] = result.messages
    .filter((message) => message.ruleId === RULE)
    .map((message) => /^'([^']+)'/.exec(message.message)?.[1])
    .filter(Boolean)
    .sort();
}

process.stdout.write(JSON.stringify({ exempted, bindings }));
`;

type GrandfatherProbe = { exempted: string[]; bindings: Record<string, string[]> };

function probeGrandfathered(): GrandfatherProbe {
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', GRANDFATHER_RUNNER], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    maxBuffer: 8 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

describe('unused-bindings lint ratchet', () => {
  let violations: LintMessage[];
  let clean: LintMessage[];

  beforeAll(() => {
    const results = lintProbes({ violations: VIOLATING_SOURCE, clean: CLEAN_SOURCE });
    violations = results.violations;
    clean = results.clean;
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

describe('grandfathered exemptions (#1815)', () => {
  let probe: GrandfatherProbe;

  beforeAll(() => {
    probe = probeGrandfathered();
  }, 180_000);

  it('exempts no files — #1815 cleared the entire baseline', () => {
    expect(probe.exempted).toEqual([]);
  });

  it('has no grandfathered bindings', () => {
    expect(probe.bindings).toEqual(GRANDFATHERED);
  });
});
