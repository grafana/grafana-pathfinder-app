import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { assertRatchet } from './import-graph';

const REPO_ROOT = path.resolve(__dirname, '../..');
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);
const DIRECTIVE_PATTERN =
  /(?:\/\/\s*(eslint-disable-(?:next-line|line))|\/\*\s*(eslint-disable(?:-(?:next-line|line))?))(?=\s|\*\/|$)/;
const JUSTIFICATION_SEPARATOR = ' -- ';
const ESLINT_DISABLE_DIRECTIVE = ['eslint', 'disable'].join('-');

/**
 * Shrink-only baseline for #1752. Keys are `path::rule#occurrence`, where the
 * occurrence counts undescribed suppressions for that rule within the file.
 * Line numbers stay diagnostic-only so unrelated edits cannot invalidate it.
 */
const UNDESCRIBED_ESLINT_DISABLE_BASELINE = new Set([
  'src/learning-paths/learning-paths.hook.ts::react-hooks/exhaustive-deps#1',
  'src/learning-paths/learning-paths.hook.ts::react-hooks/exhaustive-deps#2',
  'src/learning-paths/useDiscoverMore.ts::react-hooks/exhaustive-deps#1',
  'src/components/docs-panel/hooks/useTabRestoration.ts::react-hooks/exhaustive-deps#1',
  'src/components/docs-panel/hooks/useSessionJoinUrlCheck.ts::react-hooks/exhaustive-deps#1',
  'src/components/content-renderer/content-renderer.tsx::react-hooks/exhaustive-deps#1',
  'src/components/content-renderer/content-renderer.tsx::react-hooks/exhaustive-deps#2',
  'src/package-engine/recommender-resolver.test.ts::@typescript-eslint/no-namespace#1',
  'src/components/interactive-tutorial/interactive-step.tsx::react-hooks/exhaustive-deps#1',
  'src/components/interactive-tutorial/interactive-step.tsx::react-hooks/exhaustive-deps#2',
  'src/components/interactive-tutorial/hooks/use-section-requirements.ts::react-hooks/set-state-in-effect#1',
  'src/components/interactive-tutorial/hooks/use-section-persistence.ts::react-hooks/exhaustive-deps#1',
  'src/components/interactive-tutorial/interactive-quiz.tsx::react-hooks/exhaustive-deps#1',
  'src/components/interactive-tutorial/datasource-check-step.tsx::react-hooks/exhaustive-deps#1',
  'src/components/App/ContextPanel.tsx::react-hooks/exhaustive-deps#1',
  'src/components/full-screen/FullScreenPanel.tsx::react-hooks/exhaustive-deps#1',
  'src/components/block-editor/hooks/useBackendGuides.ts::react-hooks/exhaustive-deps#1',
  'src/requirements-manager/step-checker.hook.ts::react-hooks/exhaustive-deps#1',
  'src/requirements-manager/step-checker.hook.ts::react-hooks/exhaustive-deps#2',
  'src/components/block-editor/hooks/useBlockPersistence.ts::react-hooks/exhaustive-deps#1',
  'src/components/block-editor/GitHubPRModal.tsx::react-hooks/exhaustive-deps#1',
  'src/components/block-editor/LintBadge.tsx::react-hooks/exhaustive-deps#1',
  'src/docs-retrieval/learning-journey-helpers.ts::no-restricted-imports#1',
  'src/global-state/completion-store.ts::react-hooks/exhaustive-deps#1',
  'src/components/floating-panel/FloatingPanelManager.tsx::react-hooks/exhaustive-deps#1',
  'src/integrations/assistant-integration/AssistantCustomizable.tsx::react-hooks/set-state-in-effect#1',
  'src/integrations/assistant-integration/AssistantSelectionPopover.tsx::react-hooks/set-state-in-effect#1',
  'src/utils/usePublishedGuides.ts::react-hooks/exhaustive-deps#1',
  'src/utils/devtools/element-inspector.hook.ts::react-hooks/exhaustive-deps#1',
]);

type DirectiveForm = 'block' | 'block-next-line' | 'line' | 'line-next-line';

interface ScanResult {
  directiveCount: number;
  directiveForms: Record<DirectiveForm, number>;
  undescribed: Set<string>;
  undescribedLocations: Map<string, string>;
}

function emptyDirectiveForms(): Record<DirectiveForm, number> {
  return { block: 0, 'block-next-line': 0, line: 0, 'line-next-line': 0 };
}

function directiveForm(lineDirective: string, blockDirective: string | undefined): DirectiveForm {
  const prefix = blockDirective ? 'block' : 'line';
  return lineDirective.endsWith('-next-line') || blockDirective?.endsWith('-next-line')
    ? `${prefix}-next-line`
    : prefix;
}

function directiveRule(line: string, match: RegExpMatchArray): string {
  const remainder = line.slice((match.index ?? 0) + match[0].length);
  const beforeJustification = remainder.split(JUSTIFICATION_SEPARATOR, 1)[0] ?? '';
  return (
    beforeJustification
      .replace(/\*\/.*$/, '')
      .trim()
      .replace(/\s*,\s*/g, ',') || '<all>'
  );
}

export function scanEslintDisableComments(relPath: string, content: string): ScanResult {
  let directiveCount = 0;
  const directiveForms = emptyDirectiveForms();
  const undescribed = new Set<string>();
  const undescribedLocations = new Map<string, string>();
  const occurrences = new Map<string, number>();

  content.split(/\r?\n/).forEach((line, index) => {
    const match = line.match(DIRECTIVE_PATTERN);
    if (!match || line.trimStart().startsWith('*')) {
      return;
    }

    directiveCount++;
    const lineDirective = match[1] ?? '';
    const blockDirective = match[2];
    directiveForms[directiveForm(lineDirective, blockDirective)]++;
    if (!line.includes(JUSTIFICATION_SEPARATOR)) {
      const baseKey = `${relPath}::${directiveRule(line, match)}`;
      const occurrence = (occurrences.get(baseKey) ?? 0) + 1;
      occurrences.set(baseKey, occurrence);
      const key = `${baseKey}#${occurrence}`;
      undescribed.add(key);
      undescribedLocations.set(key, `${relPath}:${index + 1}`);
    }
  });

  return { directiveCount, directiveForms, undescribed, undescribedLocations };
}

function trackedSourceFiles(): string[] {
  try {
    return execFileSync('git', ['ls-files', '-z', 'src'], { cwd: REPO_ROOT })
      .toString('utf-8')
      .split('\0')
      .filter((relPath) => {
        if (!relPath || !SOURCE_EXTENSIONS.has(path.extname(relPath))) {
          return false;
        }
        const fullPath = path.join(REPO_ROOT, relPath);
        return fs.existsSync(fullPath) && fs.statSync(fullPath).isFile();
      });
  } catch (error) {
    throw new Error(
      `Could not enumerate tracked source files with \`git ls-files\` in ${REPO_ROOT}. ` +
        `This governance check needs a git checkout with git on PATH.\n${String(error)}`
    );
  }
}

function scanTrackedSources(): ScanResult {
  const combined: ScanResult = {
    directiveCount: 0,
    directiveForms: emptyDirectiveForms(),
    undescribed: new Set(),
    undescribedLocations: new Map(),
  };

  for (const relPath of trackedSourceFiles()) {
    const result = scanEslintDisableComments(relPath, fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf-8'));
    combined.directiveCount += result.directiveCount;
    for (const form of Object.keys(result.directiveForms) as DirectiveForm[]) {
      combined.directiveForms[form] += result.directiveForms[form];
    }
    result.undescribed.forEach((key) => {
      combined.undescribed.add(key);
      combined.undescribedLocations.set(key, result.undescribedLocations.get(key) ?? key);
    });
  }

  return combined;
}

describe('eslint-disable justifications', () => {
  it('detects a newly introduced undescribed suppression', () => {
    const result = scanEslintDisableComments(
      'src/example.ts',
      `// ${ESLINT_DISABLE_DIRECTIVE}-next-line react-hooks/exhaustive-deps\nuseEffect(() => {}, []);`
    );

    expect(result).toEqual({
      directiveCount: 1,
      directiveForms: { block: 0, 'block-next-line': 0, line: 0, 'line-next-line': 1 },
      undescribed: new Set(['src/example.ts::react-hooks/exhaustive-deps#1']),
      undescribedLocations: new Map([['src/example.ts::react-hooks/exhaustive-deps#1', 'src/example.ts:1']]),
    });
  });

  it('distinguishes a justified suppression from prose that mentions the directive', () => {
    const result = scanEslintDisableComments(
      'src/example.ts',
      [
        `// ${ESLINT_DISABLE_DIRECTIVE}-next-line react-hooks/exhaustive-deps -- dependency is intentionally stable`,
        '// This prose says eslint-disable but is not a directive.',
      ].join('\n')
    );

    expect(result).toEqual({
      directiveCount: 1,
      directiveForms: { block: 0, 'block-next-line': 0, line: 0, 'line-next-line': 1 },
      undescribed: new Set(),
      undescribedLocations: new Map(),
    });
  });

  it('keeps baseline keys stable across line shifts and counts repeated rules', () => {
    const directives = [
      `// ${ESLINT_DISABLE_DIRECTIVE}-next-line react-hooks/exhaustive-deps`,
      'first();',
      `// ${ESLINT_DISABLE_DIRECTIVE}-next-line react-hooks/exhaustive-deps`,
      'second();',
    ].join('\n');
    const shifted = scanEslintDisableComments('src/example.ts', `const unrelated = true;\n${directives}`);

    expect(shifted.undescribed).toEqual(
      new Set(['src/example.ts::react-hooks/exhaustive-deps#1', 'src/example.ts::react-hooks/exhaustive-deps#2'])
    );
    expect(shifted.undescribedLocations).toEqual(
      new Map([
        ['src/example.ts::react-hooks/exhaustive-deps#1', 'src/example.ts:2'],
        ['src/example.ts::react-hooks/exhaustive-deps#2', 'src/example.ts:4'],
      ])
    );
  });

  it('recognizes every directive form without matching line-comment prose', () => {
    const docExample = scanEslintDisableComments(
      'src/test-utils/interactive-section-harness.tsx',
      ` *   // ${ESLINT_DISABLE_DIRECTIVE}-next-line @typescript-eslint/no-require-imports`
    );
    const result = scanEslintDisableComments(
      'src/example.ts',
      [
        `// ${ESLINT_DISABLE_DIRECTIVE}-next-line first/rule`,
        `value(); // ${ESLINT_DISABLE_DIRECTIVE}-line second/rule`,
        `/*${ESLINT_DISABLE_DIRECTIVE}*/`,
        `/* ${ESLINT_DISABLE_DIRECTIVE}-next-line*/`,
        `// ${ESLINT_DISABLE_DIRECTIVE} is prose, not a directive`,
      ].join('\n')
    );

    expect(docExample.directiveCount).toBe(0);
    expect(result.directiveForms).toEqual({ block: 1, 'block-next-line': 1, line: 1, 'line-next-line': 1 });
    expect(result.directiveCount).toBe(4);
  });

  it('matches the checked-in baseline and proves the scanner found real directives', () => {
    const result = scanTrackedSources();

    expect(result.directiveCount).toBeGreaterThan(UNDESCRIBED_ESLINT_DISABLE_BASELINE.size);
    expect(result.directiveForms).toEqual({ block: 5, 'block-next-line': 2, line: 10, 'line-next-line': 66 });
    const locatedUndescribed = new Set(
      [...result.undescribed].map((key) => `${key} (${result.undescribedLocations.get(key) ?? 'unknown location'})`)
    );
    const locatedBaseline = new Set(
      [...UNDESCRIBED_ESLINT_DISABLE_BASELINE].map(
        (key) => `${key} (${result.undescribedLocations.get(key) ?? 'removed'})`
      )
    );
    assertRatchet(
      locatedUndescribed,
      locatedBaseline,
      'eslint-disable comments without a `--` justification',
      'UNDESCRIBED_ESLINT_DISABLE_BASELINE',
      'Explain the suppression after `--`, or remove it. Do not grow the baseline.'
    );
  });
});
