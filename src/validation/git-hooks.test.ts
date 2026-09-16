import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const HUSKY_DIR = '.husky';
const EXECUTABLE_MODE = '100755';
const LINTED_EXTENSIONS = ['ts', 'tsx', 'js', 'mjs'];
const LINTER_COMMAND_PATTERN = /\beslint\b/;
const SET_E_PREFIX = /^set\s+-e/;
const BRACE_LIST_GLOB = /^\*\.\{([^{}]*)\}$/;
const SINGLE_EXTENSION_GLOB = /^\*\.([a-zA-Z0-9]+)$/;

interface TrackedHook {
  relPath: string;
  mode: string;
}

// `git ls-files -s` rows: "<mode> <blob-sha> <stage>\t<path>"
const LS_FILES_ROW = /^(\d{6}) [0-9a-f]+ \d\t(.+)$/;

function parseLsFilesRow(line: string): TrackedHook {
  const [, mode, relPath] = LS_FILES_ROW.exec(line) ?? [];
  if (mode === undefined || relPath === undefined) {
    throw new Error(`Could not parse a \`git ls-files -s\` row: ${JSON.stringify(line)}`);
  }
  return { mode, relPath };
}

function isHookPath(relPath: string): boolean {
  // Git hook names carry no extension, so a sibling like `common.sh` or `README.md` is not exec'd.
  return path.dirname(relPath) === HUSKY_DIR && path.extname(relPath) === '';
}

function listTrackedHooks(): TrackedHook[] {
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
    .map(parseLsFilesRow)
    .filter((hook) => isHookPath(hook.relPath));
}

function firstNonBlankNonCommentLine(body: string): string | undefined {
  return body.split('\n').find((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith('#');
  });
}

function startsWithSetE(line: string | undefined): boolean {
  return line !== undefined && SET_E_PREFIX.test(line.trim());
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

function extensionsMatchedBy(glob: string): string[] {
  const [, braceList] = BRACE_LIST_GLOB.exec(glob) ?? [];
  if (braceList !== undefined) {
    return braceList.split(',').map((extension) => extension.trim());
  }
  const [, extension] = SINGLE_EXTENSION_GLOB.exec(glob) ?? [];
  return extension === undefined ? [] : [extension];
}

function extensionsWithoutLinting(lintStaged: Record<string, string | string[]>): string[] {
  const linted = new Set(
    Object.entries(lintStaged)
      .filter(([, commands]) =>
        (Array.isArray(commands) ? commands : [commands]).some((command) => LINTER_COMMAND_PATTERN.test(command))
      )
      .flatMap(([glob]) => extensionsMatchedBy(glob))
  );
  return LINTED_EXTENSIONS.filter((extension) => !linted.has(extension));
}

describe('git hooks: .husky/ hook text is an owned contract, executed directly by git', () => {
  const hooks = listTrackedHooks();

  it('should find at least one tracked hook to check', () => {
    expect(hooks.length).toBeGreaterThan(0);
  });

  it('should mark every tracked hook as executable (mode 100755)', () => {
    const nonExecutable = hooks.filter((hook) => hook.mode !== EXECUTABLE_MODE);

    if (nonExecutable.length > 0) {
      throw new Error(
        `Git skips a hook that is not executable — it prints a hint and does nothing, silently. ` +
          `The following tracked ${HUSKY_DIR}/ hooks are not mode ${EXECUTABLE_MODE}:\n` +
          nonExecutable.map((hook) => `  - ${hook.relPath} (mode ${hook.mode})`).join('\n') +
          `\n\nFix: \`git update-index --chmod=+x <path>\` and commit the mode change. See #1817.`
      );
    }
  });

  it('should start every hook body with `set -e` (after any leading comments/blank lines)', () => {
    const offenders = hooks
      .map((hook) => ({
        relPath: hook.relPath,
        firstLine: firstNonBlankNonCommentLine(fs.readFileSync(path.join(REPO_ROOT, hook.relPath), 'utf-8')),
      }))
      .filter((hook) => !startsWithSetE(hook.firstLine));

    if (offenders.length > 0) {
      throw new Error(
        `Without \`set -e\`, a hook keeps running after an earlier command in it fails — it fails open ` +
          `rather than blocking the commit. This matters under \`core.hooksPath=.husky\` (the legacy layout), ` +
          `where git execs the hook file directly with no wrapper to enforce this.\n\n` +
          `The following hooks do not start with \`set -e\` as their first non-comment, non-blank line:\n` +
          offenders.map((hook) => `  - ${hook.relPath} (found: ${hook.firstLine ?? '<empty file>'})`).join('\n') +
          `\n\nFix: add a \`set -e\` line before the first command, after any leading comments.`
      );
    }
  });

  it('should run eslint over every linted source extension in the lint-staged config', () => {
    const uncovered = extensionsWithoutLinting(readLintStagedConfig());

    if (uncovered.length > 0) {
      throw new Error(
        `package.json's "lint-staged" has no eslint-invoking entry matching: ` +
          `${uncovered.map((extension) => `*.${extension}`).join(', ')}. Without one, this repo's eslint ratchets ` +
          `(unreachable code, unused bindings, undescribed eslint-disables, switch exhaustiveness, window globals, ` +
          `import boundaries, ...) only fire on \`npm run lint\` or in CI, not at commit time. See #1817.`
      );
    }
  });

  describe('detectors', () => {
    it('should treat a hook with only comments before set -e as compliant', () => {
      expect(firstNonBlankNonCommentLine('# a comment\n\n# another\nset -e\nnpx lint-staged\n')).toBe('set -e');
    });

    it('should report undefined for a hook with no non-comment lines', () => {
      expect(firstNonBlankNonCommentLine('# just a comment\n')).toBeUndefined();
    });

    it.each(['set -e', '  set -e  ', 'set -eu', 'set -euo pipefail'])('should accept %p', (line) => {
      expect(startsWithSetE(line)).toBe(true);
    });

    it.each<string | undefined>([
      'npx lint-staged',
      'set -u',
      'set +e',
      'set -o pipefail',
      'set -o errexit',
      undefined,
    ])('should reject %p', (line) => {
      expect(startsWithSetE(line)).toBe(false);
    });

    it.each<[string, string[]]>([
      ['*.{ts,tsx,js,mjs}', ['ts', 'tsx', 'js', 'mjs']],
      ['*.{json,yaml,md}', ['json', 'yaml', 'md']],
      ['*.ts', ['ts']],
      ['*.{ts,tsx', []],
      ['src/**/*.ts', []],
    ])('should read %p as covering %p', (glob, expected) => {
      expect(extensionsMatchedBy(glob)).toEqual(expected);
    });

    it('should report an extension whose only matching entry does not invoke eslint', () => {
      expect(extensionsWithoutLinting({ '*.{ts,tsx}': 'eslint --fix', '*.{js,mjs}': 'prettier --write' })).toEqual([
        'js',
        'mjs',
      ]);
    });

    it('should report nothing when split entries each invoke eslint', () => {
      expect(extensionsWithoutLinting({ '*.{ts,tsx}': ['eslint --fix'], '*.{js,mjs,cjs}': ['eslint --fix'] })).toEqual(
        []
      );
    });
  });
});
