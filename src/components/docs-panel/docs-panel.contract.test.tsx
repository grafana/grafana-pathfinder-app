/**
 * E2E Contract Tests: Docs panel test IDs and behavior contract
 *
 * These tests validate the contract between the docs panel and its consumers/e2e tests.
 * They assert stable test IDs and that the panel source continues to use them, so that
 * refactors do not silently remove or change IDs. Full render behavior is covered by
 * e2e tests (Grafana theme is not available in Jest).
 *
 * Coverage:
 * - testIds.docsPanel and testIds.devTools (preview) values are stable and documented
 * - docs-panel.tsx and related components reference these test IDs (source contract)
 * - Scroll-restoration DOM id (inner-docs-content) is present in panel source
 * - Window globals (__pathfinderPluginConfig, __DocsPluginActiveTabId,
 *   __DocsPluginActiveTabUrl) are assigned in panel source
 * - Exhaustiveness: every testIds.docsPanel key is covered; no orphan patterns exist
 * - Documented intended full-render contract (container, tab bar, content, tab switch) for e2e
 *
 * Maintenance during refactoring:
 * When extracting a component from docs-panel.tsx, update SOURCE_CONTRACT so the file
 * that now owns the JSX for each test ID holds the corresponding reference. Adding a
 * new testIds.docsPanel key will auto-fail exhaustiveness until a SOURCE_CONTRACT
 * entry covers it.
 *
 * @see .cursor/plans/docs_panel_refactor_plan_fe6aa766.plan.md
 * @see .cursor/local/DOCS_PANEL_REFACTOR_PHASE0_INVESTIGATION.md
 */

import * as fs from 'fs';
import * as path from 'path';
import { testIds } from '../testIds';

// Test ID constants contract: values must match what e2e and docs-panel use
describe('E2E Contract: Docs panel test IDs', () => {
  describe('docsPanel constants', () => {
    it('container', () => {
      expect(testIds.docsPanel.container).toBe('docs-panel-container');
    });

    it('closeButton', () => {
      expect(testIds.docsPanel.closeButton).toBe('docs-panel-close-button');
    });

    it('tabBar', () => {
      expect(testIds.docsPanel.tabBar).toBe('docs-panel-tab-bar');
    });

    it('tabList', () => {
      expect(testIds.docsPanel.tabList).toBe('docs-panel-tab-list');
    });

    it('content', () => {
      expect(testIds.docsPanel.content).toBe('docs-panel-content');
    });

    it('recommendationsTab', () => {
      expect(testIds.docsPanel.recommendationsTab).toBe('docs-panel-tab-recommendations');
    });

    it('loadingState', () => {
      expect(testIds.docsPanel.loadingState).toBe('docs-panel-loading-state');
    });

    it('errorState', () => {
      expect(testIds.docsPanel.errorState).toBe('docs-panel-error-state');
    });

    it('tab(id) pattern', () => {
      expect(testIds.docsPanel.tab('devtools')).toBe('docs-panel-tab-devtools');
    });

    it('tabCloseButton(id) pattern', () => {
      expect(testIds.docsPanel.tabCloseButton('tab-1')).toBe('docs-panel-tab-close-tab-1');
    });

    it('tabOverflowButton, tabDropdown, tabDropdownItem(id)', () => {
      expect(testIds.docsPanel.tabOverflowButton).toBe('docs-panel-tab-overflow-button');
      expect(testIds.docsPanel.tabDropdown).toBe('docs-panel-tab-dropdown');
      expect(testIds.docsPanel.tabDropdownItem('tab-1')).toBe('docs-panel-tab-dropdown-item-tab-1');
    });

    it('myLearningTab', () => {
      expect(testIds.docsPanel.myLearningTab).toBe('docs-panel-tab-my-learning');
    });
  });

  describe('devTools preview IDs (used in docs-panel content)', () => {
    it('previewBanner, previewModeIndicator, returnToEditorButton', () => {
      expect(testIds.devTools.previewBanner).toBe('dev-tools-preview-banner');
      expect(testIds.devTools.previewModeIndicator).toBe('dev-tools-preview-mode-indicator');
      expect(testIds.devTools.returnToEditorButton).toBe('dev-tools-return-to-editor');
    });
  });
});

/**
 * Source contract: maps each source file to the test ID references it must contain.
 *
 * Assertion method: substring check (not AST). We verify the source code text contains
 * the reference string (e.g., 'testIds.docsPanel.container'). E2E tests verify the IDs
 * actually appear on DOM elements at runtime.
 *
 * REFACTOR MAINTENANCE:
 * When extracting a component from docs-panel.tsx, move the corresponding test ID
 * references to the new file's entry in this mapping. For example, if DocsPanelContent.tsx
 * takes ownership of testIds.docsPanel.content, move that reference from the docs-panel.tsx
 * entry to a new { file: 'components/DocsPanelContent.tsx', references: [...] } entry.
 *
 * The exhaustiveness check auto-derives expected patterns from testIds.docsPanel, so
 * adding a new test ID constant will fail the test until a SOURCE_CONTRACT entry covers it.
 */
const SOURCE_CONTRACT: Array<{ file: string; references: string[] }> = [
  {
    file: 'docs-panel.tsx',
    references: [
      'testIds.docsPanel.container',
      'testIds.docsPanel.tabBar',
      'testIds.docsPanel.tabList',
      'testIds.docsPanel.content',
      'testIds.docsPanel.recommendationsTab',
      'testIds.docsPanel.tabOverflowButton',
      'testIds.docsPanel.tabDropdown',
      'testIds.docsPanel.tab(',
      'testIds.docsPanel.tabCloseButton(',
      'testIds.docsPanel.tabDropdownItem(',
      'testIds.devTools.previewBanner',
      'testIds.devTools.previewModeIndicator',
      'testIds.devTools.returnToEditorButton',
    ],
  },
  {
    file: 'components/TabBarActions.tsx',
    references: ['testIds.docsPanel.closeButton', 'testIds.docsPanel.myLearningTab'],
  },
  { file: 'components/LoadingIndicator.tsx', references: ['testIds.docsPanel.loadingState'] },
  { file: 'components/ErrorDisplay.tsx', references: ['testIds.docsPanel.errorState'] },
];

/**
 * Auto-derive expected reference patterns from testIds constants.
 *
 * All testIds.docsPanel keys are included automatically — adding a new key to
 * testIds.docsPanel will fail the exhaustiveness check until a SOURCE_CONTRACT
 * entry is added for it. The devTools preview subset is listed explicitly because
 * only those three IDs are rendered inside the docs-panel source tree.
 *
 * Assumes testIds.docsPanel is a flat namespace (string | function values).
 * If nested objects are introduced, update this derivation accordingly.
 */
const deriveExpectedPatterns = (): string[] => {
  const patterns: string[] = [];

  for (const [key, value] of Object.entries(testIds.docsPanel)) {
    patterns.push(typeof value === 'function' ? `testIds.docsPanel.${key}(` : `testIds.docsPanel.${key}`);
  }

  // devTools preview IDs rendered inside docs-panel content (subset of testIds.devTools)
  patterns.push(
    'testIds.devTools.previewBanner',
    'testIds.devTools.previewModeIndicator',
    'testIds.devTools.returnToEditorButton'
  );

  return patterns;
};

const EXPECTED_REFERENCE_PATTERNS: string[] = deriveExpectedPatterns();

describe('E2E Contract: Docs panel source references test IDs', () => {
  const sourceCache = new Map<string, string>();

  beforeAll(() => {
    for (const { file } of SOURCE_CONTRACT) {
      const fullPath = path.join(__dirname, file);
      sourceCache.set(file, fs.readFileSync(fullPath, 'utf-8'));
    }
  });

  for (const { file, references } of SOURCE_CONTRACT) {
    it(`${file} contains all required test ID references`, () => {
      const src = sourceCache.get(file);
      expect(src).toBeDefined();
      for (const ref of references) {
        expect(src).toContain(ref);
      }
    });
  }

  it('every in-scope test ID pattern is required in exactly one file (exhaustiveness)', () => {
    const allRefs = SOURCE_CONTRACT.flatMap(({ references }) => references);

    // Safety floor: prevent accidental mass deletion of contract entries
    expect(EXPECTED_REFERENCE_PATTERNS.length).toBeGreaterThanOrEqual(16);

    for (const pattern of EXPECTED_REFERENCE_PATTERNS) {
      const count = allRefs.filter((r) => r === pattern).length;
      expect(count).toBe(1);
    }
  });

  it('SOURCE_CONTRACT contains no unrecognized patterns (reverse exhaustiveness)', () => {
    const allRefs = SOURCE_CONTRACT.flatMap(({ references }) => references);
    for (const ref of allRefs) {
      expect(EXPECTED_REFERENCE_PATTERNS).toContain(ref);
    }
  });
});

/** Scroll-restoration target id required by useScrollPositionPreservation (Phase 2). */
const SCROLL_TARGET_ID = 'inner-docs-content';

describe('E2E Contract: Scroll-restoration DOM id', () => {
  it('at least one tracked panel source file contains the scroll target id', () => {
    const filesToCheck = SOURCE_CONTRACT.map(({ file }) => ({
      file,
      path: path.join(__dirname, file),
    }));
    const hasScrollTarget = filesToCheck.some(({ path: filePath }) => {
      const src = fs.readFileSync(filePath, 'utf-8');
      return src.includes(SCROLL_TARGET_ID);
    });
    expect(hasScrollTarget).toBe(true);
  });
});

/**
 * Window globals assigned in docs-panel.tsx for cross-component communication.
 * These are read by dev-mode utilities, SelectorDebugPanel, interactive-section,
 * and analytics. Do not remove during refactoring — document for future migration
 * to React Context.
 */
const WINDOW_GLOBALS = ['__pathfinderPluginConfig', '__DocsPluginActiveTabId', '__DocsPluginActiveTabUrl'];

describe('E2E Contract: Window globals assigned in docs-panel', () => {
  it('docs-panel.tsx references all required window globals', () => {
    const src = fs.readFileSync(path.join(__dirname, 'docs-panel.tsx'), 'utf-8');
    for (const global of WINDOW_GLOBALS) {
      expect(src).toContain(global);
    }
  });
});

/**
 * Full-render behavioral contract: intended assertions when panel is rendered.
 *
 * NOT run in Jest — @grafana/scenes depends on @grafana/ui which requires a Grafana
 * theme provider not available in the unit test environment. E2E tests are the
 * authority for these behaviors.
 *
 * These todos document the behavioral surface that e2e tests must cover to ensure
 * refactoring preserves user-visible behavior. If the Grafana test environment
 * evolves to support theme setup, these can be unskipped.
 */
describe.skip('E2E Contract: Docs panel full render (covered by e2e)', () => {
  it.todo('renders container with docs-panel-container');
  it.todo('renders tab bar, tab list, content area with stable test IDs');
  it.todo('renders recommendations tab; devtools tab when dev mode');
  it.todo('default active tab is recommendations');
  it.todo('loading state shows docs-panel-loading-state');
  it.todo('error state shows docs-panel-error-state with retry');
});
