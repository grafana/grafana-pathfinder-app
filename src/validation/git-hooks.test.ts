import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const HUSKY_DIR = '.husky';
const EXECUTABLE_MODE = '100755';
const LINT_STAGED_LINTED_GLOB = '*.{ts,tsx,js,mjs}';
const LINTER_COMMAND_PATTERN = /\beslint\b/;

interface TrackedHuskyFile {
  relPath: string;
  mode: string;
}

function listTrackedHuskyFiles(): TrackedHuskyFile[] {
  let output: string;
  try {
    output = execFileSync('git', ['ls-files', '-s', '--', `${HUSKY_DIR}/`], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
    });
  } catch (error) {
    throw new Error(`Could not enumerate tracked files under ${HUSKY_DIR}/ with \`git ls-files\`.\n${String(error)}`);
  }

  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      // `git ls-files -s` rows: "<mode> <blob-sha> <stage>\t<path>"
      const [info, relPath] = line.split('\t');
      const mode = info.split(' ')[0];
      return { relPath, mode };
    })
    .filter((file) => path.dirname(file.relPath) === HUSKY_DIR);
}

function firstNonBlankNonCommentLine(body: string): string | undefined {
  return body.split('\n').find((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith('#');
  });
}

function readLintStagedConfig(): Record<string, string | string[]> {
  const packageJsonPath = path.join(REPO_ROOT, 'package.json');
  const packageJson: unknown = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  if (
    typeof packageJson !== 'object' ||
    packageJson === null ||
    !('lint-staged' in packageJson) ||
    typeof (packageJson as { 'lint-staged': unknown })['lint-staged'] !== 'object'
  ) {
    throw new Error(`package.json has no "lint-staged" object. This ratchet expects one at the top level.`);
  }
  return (packageJson as { 'lint-staged': Record<string, string | string[]> })['lint-staged'];
}

describe('git hooks', () => {
  const trackedFiles = listTrackedHuskyFiles();

  it('should find at least one tracked hook to check', () => {
    expect(trackedFiles.length).toBeGreaterThan(0);
  });

  it('should mark every tracked file directly under .husky/ as executable (mode 100755)', () => {
    const nonExecutable = trackedFiles.filter((file) => file.mode !== EXECUTABLE_MODE);

    if (nonExecutable.length > 0) {
      throw new Error(
        `Git skips a hook that is not executable — it prints a hint and does nothing, silently. ` +
          `The following tracked ${HUSKY_DIR}/ files are not mode ${EXECUTABLE_MODE}:\n` +
          nonExecutable.map((file) => `  - ${file.relPath} (mode ${file.mode})`).join('\n') +
          `\n\nFix: \`git update-index --chmod=+x <path>\` and commit the mode change. See #1817.`
      );
    }
  });

  it('should start every hook body with `set -e` (after any leading comments/blank lines)', () => {
    const offenders = trackedFiles
      .map((file) => ({
        relPath: file.relPath,
        firstLine: firstNonBlankNonCommentLine(fs.readFileSync(path.join(REPO_ROOT, file.relPath), 'utf-8')),
      }))
      .filter((file) => file.firstLine !== 'set -e');

    if (offenders.length > 0) {
      throw new Error(
        `Without \`set -e\`, a hook keeps running after an earlier command in it fails — it fails open ` +
          `rather than blocking the commit. This matters under \`core.hooksPath=.husky\` (the legacy layout), ` +
          `where git execs the hook file directly with no wrapper to enforce this.\n\n` +
          `The following hooks do not start with \`set -e\` as their first non-comment, non-blank line:\n` +
          offenders.map((file) => `  - ${file.relPath} (found: ${file.firstLine ?? '<empty file>'})`).join('\n') +
          `\n\nFix: add a \`set -e\` line before the first command, after any leading comments.`
      );
    }
  });

  it('should run a linter over *.{ts,tsx,js,mjs} in the lint-staged config', () => {
    const lintStaged = readLintStagedConfig();
    const commands = lintStaged[LINT_STAGED_LINTED_GLOB];

    if (commands === undefined) {
      throw new Error(
        `package.json's "lint-staged" has no entry for "${LINT_STAGED_LINTED_GLOB}". Without it, this repo's ` +
          `eslint ratchets (unreachable code, unused bindings, undescribed eslint-disables, switch ` +
          `exhaustiveness, window globals, import boundaries, ...) only fire on \`npm run lint\` or in CI, ` +
          `not at commit time. See #1817.`
      );
    }

    const commandList = Array.isArray(commands) ? commands : [commands];
    const runsLinter = commandList.some((command) => LINTER_COMMAND_PATTERN.test(command));

    if (!runsLinter) {
      throw new Error(
        `package.json's "lint-staged" entry for "${LINT_STAGED_LINTED_GLOB}" does not invoke eslint:\n` +
          `  ${JSON.stringify(commandList)}\n\n` +
          `Without it, this repo's eslint ratchets only fire on \`npm run lint\` or in CI, not at commit time. ` +
          `See #1817.`
      );
    }
  });

  describe('detector', () => {
    it('should treat a hook with only comments before set -e as compliant', () => {
      expect(firstNonBlankNonCommentLine('# a comment\n\n# another\nset -e\nnpx lint-staged\n')).toBe('set -e');
    });

    it('should flag a hook whose first real line is not set -e', () => {
      expect(firstNonBlankNonCommentLine('# a comment\nnpx lint-staged\n')).toBe('npx lint-staged');
    });

    it('should report undefined for a hook with no non-comment lines', () => {
      expect(firstNonBlankNonCommentLine('# just a comment\n')).toBeUndefined();
    });
  });
});
