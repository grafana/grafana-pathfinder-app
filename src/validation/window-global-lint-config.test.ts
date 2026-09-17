/**
 * @jest-environment node
 */

import { execFileSync } from 'child_process';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PROBE_PATH = 'src/window-global-lint-probe.ts';

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

/**
 * Runs every named probe through one ESLint instance in one child process.
 * Each probe pays for its own `projectService` build, so batching keeps that
 * cost paid once per test run instead of once per `it()`.
 */
function lintProbes(sources: Record<string, string>): Record<string, LintMessage[]> {
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', RUNNER], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    env: { ...process.env, PROBE_SOURCES: JSON.stringify(sources), PROBE_PATH },
    maxBuffer: 8 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

describe('window-global lint contract', () => {
  let results: Record<string, LintMessage[]>;

  beforeAll(() => {
    results = lintProbes({
      windowAsAnyCast: `(window as any).__pathfinderPluginConfig = {};`,
      nestedIdentifierCast: `
const __DocsPluginContentKey = '__DocsPluginContentKey';
void (window as unknown as Record<string, unknown>)[__DocsPluginContentKey];
`,
      nestedStringLiteralCast: `void (window as unknown as Record<string, unknown>)['__DocsPluginContentKey'];`,
      computedWindowAsAnyCast: `void (window as any)['__DocsPluginContentKey'];`,
      typedAccessAndUnrelated: `
window.__pathfinderPluginConfig = undefined;
const bootData = (window as any).grafanaBootData;
const nestedBootData = (window as unknown as { grafanaBootData: unknown }).grafanaBootData;
const nestedComputedBootData = (window as unknown as Record<string, unknown>)['grafanaBootData'];
void bootData;
void nestedBootData;
void nestedComputedBootData;
`,
    });
  }, 180_000);

  it('rejects a window as any cast for a Pathfinder global', () => {
    const messages = results.windowAsAnyCast;
    const violation = messages.find(
      (message) =>
        message.ruleId === 'no-restricted-syntax' && message.message.includes('typed Pathfinder window-global contract')
    );

    expect(messages.filter((message) => message.fatal)).toEqual([]);
    expect(violation?.severity).toBe(2);
  });

  it('rejects a nested window cast with an identifier-named Pathfinder global', () => {
    const messages = results.nestedIdentifierCast;
    const violation = messages.find(
      (message) =>
        message.ruleId === 'no-restricted-syntax' && message.message.includes('typed Pathfinder window-global contract')
    );

    expect(messages.filter((message) => message.fatal)).toEqual([]);
    expect(violation?.severity).toBe(2);
  });

  it('rejects a nested window cast with a string-literal Pathfinder global', () => {
    const messages = results.nestedStringLiteralCast;
    const violation = messages.find(
      (message) =>
        message.ruleId === 'no-restricted-syntax' && message.message.includes('typed Pathfinder window-global contract')
    );

    expect(messages.filter((message) => message.fatal)).toEqual([]);
    expect(violation?.severity).toBe(2);
  });

  it('rejects a computed window as any cast for a Pathfinder global', () => {
    const messages = results.computedWindowAsAnyCast;
    const violation = messages.find(
      (message) =>
        message.ruleId === 'no-restricted-syntax' && message.message.includes('typed Pathfinder window-global contract')
    );

    expect(messages.filter((message) => message.fatal)).toEqual([]);
    expect(violation?.severity).toBe(2);
  });

  it('allows typed access and unrelated window casts', () => {
    const messages = results.typedAccessAndUnrelated;
    const violations = messages.filter(
      (message) =>
        message.ruleId === 'no-restricted-syntax' && message.message.includes('typed Pathfinder window-global contract')
    );

    expect(messages.filter((message) => message.fatal)).toEqual([]);
    expect(violations).toEqual([]);
  });
});
