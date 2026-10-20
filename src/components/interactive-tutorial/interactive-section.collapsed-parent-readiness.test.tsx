import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('@grafana/ui', () => require('../../test-utils/interactive-section-harness').createGrafanaUiMock());
jest.mock('@grafana/data', () => require('../../test-utils/interactive-section-harness').createGrafanaDataMock());
jest.mock('../../lib/analytics', () => require('../../test-utils/interactive-section-harness').createAnalyticsMock());
jest.mock('../../constants', () => require('../../test-utils/interactive-section-harness').createConstantsMock());
jest.mock('../../constants/interactive-config', () =>
  require('../../test-utils/interactive-section-harness').createInteractiveConfigMock()
);
jest.mock('../../global-state/alignment-pending-context', () =>
  require('../../test-utils/interactive-section-harness').createAlignmentContextMock()
);
jest.mock('../../interactive-engine', () =>
  require('../../test-utils/interactive-section-harness').createInteractiveEngineMock()
);
jest.mock('../../requirements-manager', () =>
  require('../../test-utils/interactive-section-harness').createRequirementsManagerMock()
);
jest.mock('../../docs-retrieval', () => ({
  ...require('../../test-utils/interactive-section-harness').createDocsRetrievalMock(),
  useGuideResponsesOptional: () => ({ responses: {} }),
}));
jest.mock('./interactive-step', () =>
  require('../../test-utils/interactive-section-harness').createInteractiveStepMock()
);
jest.mock('./interactive-multi-step', () =>
  require('../../test-utils/interactive-section-harness').createInteractiveMultiStepMock()
);
jest.mock('./interactive-guided', () =>
  require('../../test-utils/interactive-section-harness').createInteractiveGuidedMock()
);
jest.mock('./interactive-quiz', () =>
  require('../../test-utils/interactive-section-harness').createInteractiveQuizMock()
);
jest.mock('./terminal-step', () => require('../../test-utils/interactive-section-harness').createTerminalStepMock());
jest.mock('./terminal-connect-step', () =>
  require('../../test-utils/interactive-section-harness').createTerminalConnectStepMock()
);
jest.mock('./code-block-step', () => require('../../test-utils/interactive-section-harness').createCodeBlockStepMock());
jest.mock('./interactive-conditional', () =>
  require('../../test-utils/interactive-section-harness').createInteractiveConditionalMock()
);

import type { JsonBlock } from '../../types/json-guide.types';
import { computeGuideBlockIndex } from '../../lib/guide-stats';
import { createChoiceProgressModel } from '../../lib/guide-stats/choice-progress';
import { sectionCollapseStorage } from '../../lib/user-storage'; // real storage: jsdom localStorage
import {
  evictAllGuideIndexes,
  isGuideChoiceProgressReady,
  publishGuideIndex,
  setGuideChoiceResponses,
} from '../../global-state/active-guide-index';
import { setContentKeyOverride } from '../../global-state/content-key';
import { InteractiveSection, resetInteractiveCounters } from './interactive-section';
import { resetSectionHarness, silenceSectionWarnings } from '../../test-utils/interactive-section-harness';

type GateMode = 'hide' | 'heading-only';

let warnings: jest.SpyInstance;
beforeAll(() => {
  warnings = silenceSectionWarnings();
});
afterAll(() => warnings.mockRestore());

beforeEach(() => {
  localStorage.clear();
  resetSectionHarness();
  resetInteractiveCounters();
  evictAllGuideIndexes();
});

afterEach(() => {
  evictAllGuideIndexes();
  setContentKeyOverride(undefined);
  localStorage.clear();
});

/**
 * The nested gate carries an environment requirement, so choice-condition
 * evaluation cannot settle it: readiness depends on the rendered section
 * reporting its own visibility. The parent is an ordinary collapsible
 * section with no requirements, so it never gates anything itself.
 */
function guideBlocks(mode: GateMode): JsonBlock[] {
  return [
    {
      type: 'section',
      id: 'parent',
      title: 'Parent section',
      blocks: [
        {
          type: 'section',
          id: 'nested',
          title: 'Nested gated section',
          requirements: ['has-datasource:prometheus'],
          whenRequirementsUnmet: mode,
          blocks: [{ type: 'markdown', id: 'nested-step', content: 'Nested instructions' }],
        },
      ],
    },
  ];
}

function publishReadinessModel(contentKey: string, mode: GateMode): void {
  const blocks = guideBlocks(mode);
  const index = computeGuideBlockIndex(blocks);
  publishGuideIndex({
    contentKey,
    index,
    denominatorSource: 'live-pre-inlining',
    choiceModel: createChoiceProgressModel(blocks, index),
  });
  setGuideChoiceResponses(contentKey, {});
}

function Tree({ mode }: { mode: GateMode }) {
  return (
    <InteractiveSection id="parent" title="Parent section">
      <InteractiveSection
        id="nested"
        title="Nested gated section"
        requirements={['has-datasource:prometheus']}
        whenRequirementsUnmet={mode}
      >
        <p>Nested instructions</p>
      </InteractiveSection>
    </InteractiveSection>
  );
}

describe('collapsed parent section with a nested visibility gate', () => {
  it.each<GateMode>(['hide', 'heading-only'])(
    'keeps a reported %s gate settled when its parent collapses after the report',
    async (mode) => {
      // A preview key so the collapse toggle renders without completing the parent.
      const contentKey = `block-editor://preview/collapse-after-report-${mode}`;
      setContentKeyOverride(contentKey);
      publishReadinessModel(contentKey, mode);

      render(<Tree mode={mode} />);

      // The gate reports while the parent is expanded; readiness settles.
      await waitFor(() => expect(isGuideChoiceProgressReady(contentKey)).toBe(true));

      fireEvent.click(screen.getByTestId('interactive-section-toggle-section-parent'));

      expect(screen.getByTestId('interactive-section-section-parent').className).toContain('collapsed');
      // Collapse must not unmount the gate or forget its report.
      expect(screen.getByText('Nested instructions')).toBeInTheDocument();
      expect(isGuideChoiceProgressReady(contentKey)).toBe(true);
    }
  );

  it.each<GateMode>(['hide', 'heading-only'])(
    'reports a %s gate on reload while its parent is already collapsed',
    async (mode) => {
      const contentKey = `bundled:collapse-reload-${mode}`;
      setContentKeyOverride(contentKey);
      publishReadinessModel(contentKey, mode);
      // Reload path: the collapsed state is restored from storage on mount.
      await sectionCollapseStorage.set(contentKey, 'section-parent', true);

      render(<Tree mode={mode} />);

      await waitFor(() =>
        expect(screen.getByTestId('interactive-section-section-parent').className).toContain('collapsed')
      );
      // The gate mounts under the collapsed parent and reports in this session.
      await waitFor(() => expect(isGuideChoiceProgressReady(contentKey)).toBe(true));
      expect(screen.getByText('Nested instructions')).toBeInTheDocument();
    }
  );

  it('still blocks readiness while a gate has never reported', () => {
    const contentKey = 'bundled:collapse-safeguard';
    setContentKeyOverride(contentKey);
    publishReadinessModel(contentKey, 'hide');

    // Nothing mounted: the requirement-settling safeguard must stay in place.
    // Collapsed ancestors may not settle genuinely pending gates.
    expect(isGuideChoiceProgressReady(contentKey)).toBe(false);
  });
});
