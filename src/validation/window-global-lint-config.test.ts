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

const [result] = await eslint.lintText(process.env.PROBE_SOURCE, { filePath: process.env.PROBE_PATH });
process.stdout.write(JSON.stringify(result.messages));
`;

type LintMessage = { ruleId: string | null; severity: number; message: string; fatal?: boolean };

function lintProbe(source: string, filePath = PROBE_PATH): LintMessage[] {
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', RUNNER], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    env: { ...process.env, PROBE_SOURCE: source, PROBE_PATH: filePath },
    maxBuffer: 8 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

describe('window-global lint contract', () => {
  it('rejects a window as any cast for a Pathfinder global', () => {
    const messages = lintProbe(`(window as any).__pathfinderPluginConfig = {};`);
    const violation = messages.find(
      (message) =>
        message.ruleId === 'no-restricted-syntax' && message.message.includes('typed Pathfinder window-global contract')
    );

    expect(messages.filter((message) => message.fatal)).toEqual([]);
    expect(violation?.severity).toBe(2);
  });

  it('allows typed access and unrelated window casts', () => {
    const messages = lintProbe(`
window.__pathfinderPluginConfig = undefined;
const bootData = (window as any).grafanaBootData;
void bootData;
`);
    const violations = messages.filter(
      (message) =>
        message.ruleId === 'no-restricted-syntax' && message.message.includes('typed Pathfinder window-global contract')
    );

    expect(messages.filter((message) => message.fatal)).toEqual([]);
    expect(violations).toEqual([]);
  });
});
