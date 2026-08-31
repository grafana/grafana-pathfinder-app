import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { assertRatchet } from './import-graph';

const REPO_ROOT = path.resolve(__dirname, '../..');
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);
const DIRECTIVE_PATTERN = /(?:\/\/|\/\*)\s*eslint-disable(?:-next-line|-line)?(?:\s|$)/;
const JUSTIFICATION_SEPARATOR = ' -- ';

const UNDESCRIBED_ESLINT_DISABLE_BASELINE = new Set([
  'src/learning-paths/learning-paths.hook.ts:137',
  'src/learning-paths/learning-paths.hook.ts:243',
  'src/learning-paths/useDiscoverMore.ts:126',
  'src/components/docs-panel/hooks/useTabRestoration.ts:80',
  'src/components/docs-panel/hooks/useSessionJoinUrlCheck.ts:42',
  'src/components/content-renderer/content-renderer.tsx:374',
  'src/components/content-renderer/content-renderer.tsx:603',
  'src/package-engine/recommender-resolver.test.ts:387',
  'src/components/interactive-tutorial/interactive-step.tsx:475',
  'src/components/interactive-tutorial/interactive-step.tsx:925',
  'src/components/interactive-tutorial/hooks/use-section-requirements.ts:192',
  'src/components/interactive-tutorial/hooks/use-section-persistence.ts:141',
  'src/components/interactive-tutorial/interactive-quiz.tsx:223',
  'src/components/interactive-tutorial/datasource-check-step.tsx:228',
  'src/components/App/ContextPanel.tsx:31',
  'src/components/full-screen/FullScreenPanel.tsx:130',
  'src/components/block-editor/hooks/useBackendGuides.ts:391',
  'src/requirements-manager/step-checker.hook.ts:836',
  'src/requirements-manager/step-checker.hook.ts:959',
  'src/components/block-editor/hooks/useBlockPersistence.ts:225',
  'src/components/block-editor/GitHubPRModal.tsx:227',
  'src/components/block-editor/LintBadge.tsx:68',
  'src/docs-retrieval/learning-journey-helpers.ts:20',
  'src/global-state/completion-store.ts:482',
  'src/components/floating-panel/FloatingPanelManager.tsx:183',
  'src/integrations/assistant-integration/AssistantCustomizable.tsx:233',
  'src/integrations/assistant-integration/AssistantSelectionPopover.tsx:88',
  'src/utils/usePublishedGuides.ts:90',
  'src/utils/devtools/element-inspector.hook.ts:114',
]);

interface ScanResult {
  directiveCount: number;
  undescribed: Set<string>;
}

function isDocumentedExample(relPath: string, line: string): boolean {
  if (relPath === 'src/test-utils/interactive-section-harness.tsx' && line.trimStart().startsWith('*')) {
    return true;
  }
  return (
    relPath === 'src/requirements-manager/step-checker.hook.ts' && line.includes('eslint-disable on its dep array')
  );
}

export function scanEslintDisableComments(relPath: string, content: string): ScanResult {
  let directiveCount = 0;
  const undescribed = new Set<string>();

  content.split(/\r?\n/).forEach((line, index) => {
    if (!DIRECTIVE_PATTERN.test(line)) {
      return;
    }

    if (isDocumentedExample(relPath, line)) {
      return;
    }

    const location = `${relPath}:${index + 1}`;
    directiveCount++;
    if (!line.includes(JUSTIFICATION_SEPARATOR)) {
      undescribed.add(location);
    }
  });

  return { directiveCount, undescribed };
}

function trackedSourceFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z', 'src'], { cwd: REPO_ROOT })
    .toString('utf-8')
    .split('\0')
    .filter((relPath) => relPath && SOURCE_EXTENSIONS.has(path.extname(relPath)));
}

function scanTrackedSources(): ScanResult {
  const combined: ScanResult = { directiveCount: 0, undescribed: new Set() };

  for (const relPath of trackedSourceFiles()) {
    const result = scanEslintDisableComments(relPath, fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf-8'));
    combined.directiveCount += result.directiveCount;
    result.undescribed.forEach((location) => combined.undescribed.add(location));
  }

  return combined;
}

describe('eslint-disable justifications', () => {
  it('detects a newly introduced undescribed suppression', () => {
    const result = scanEslintDisableComments(
      'src/example.ts',
      '// eslint-disable-next-line react-hooks/exhaustive-deps\nuseEffect(() => {}, []);'
    );

    expect(result).toEqual({ directiveCount: 1, undescribed: new Set(['src/example.ts:1']) });
  });

  it('distinguishes a justified suppression from prose that mentions the directive', () => {
    const result = scanEslintDisableComments(
      'src/example.ts',
      [
        '// eslint-disable-next-line react-hooks/exhaustive-deps -- dependency is intentionally stable',
        '// This prose says eslint-disable but is not a directive.',
      ].join('\n')
    );

    expect(result).toEqual({ directiveCount: 1, undescribed: new Set() });
  });

  it('excludes the known documentation and prose examples', () => {
    const docExample = scanEslintDisableComments(
      'src/test-utils/interactive-section-harness.tsx',
      ' *   // eslint-disable-next-line @typescript-eslint/no-require-imports'
    );
    const proseExample = scanEslintDisableComments(
      'src/requirements-manager/step-checker.hook.ts',
      '// eslint-disable on its dep array). The callback closes over the value.'
    );

    expect(docExample).toEqual({ directiveCount: 0, undescribed: new Set() });
    expect(proseExample).toEqual({ directiveCount: 0, undescribed: new Set() });
  });

  it('matches the checked-in baseline and proves the scanner found real directives', () => {
    const result = scanTrackedSources();

    expect(result.directiveCount).toBeGreaterThan(UNDESCRIBED_ESLINT_DISABLE_BASELINE.size);
    assertRatchet(
      result.undescribed,
      UNDESCRIBED_ESLINT_DISABLE_BASELINE,
      'eslint-disable comments without a `--` justification',
      'UNDESCRIBED_ESLINT_DISABLE_BASELINE',
      'Explain the suppression after `--`, or remove it. Do not grow the baseline.'
    );
  });
});
