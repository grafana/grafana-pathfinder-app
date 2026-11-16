import React from 'react';
import { act, cleanup, render } from '@testing-library/react';

jest.mock('@grafana/ui', () => require('../../test-utils/interactive-section-harness').createGrafanaUiMock());
jest.mock('@grafana/data', () => require('../../test-utils/interactive-section-harness').createGrafanaDataMock());
jest.mock('../../lib/analytics', () => require('../../test-utils/interactive-section-harness').createAnalyticsMock());
jest.mock('../../constants', () => require('../../test-utils/interactive-section-harness').createConstantsMock());
jest.mock('../../constants/interactive-config', () =>
  require('../../test-utils/interactive-section-harness').createInteractiveConfigMock()
);
jest.mock('../../lib/logging', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), exception: jest.fn() },
}));
jest.mock('../../lib/faro', () => ({
  withFaroUserAction: jest.fn((_name: string, _attributes: unknown, work: () => unknown) => work()),
  setFaroUserActionAttributes: jest.fn(),
  USER_ACTION_TIMEOUT_LONG_MS: 600000,
}));
jest.mock('../../lib/user-storage', () =>
  require('../../test-utils/interactive-section-harness').createUserStorageMock()
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
jest.mock('../../docs-retrieval', () =>
  require('../../test-utils/interactive-section-harness').createDocsRetrievalMock()
);
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

import { InteractiveStep } from './interactive-step';
import { InteractiveSection, resetInteractiveCounters } from './interactive-section';
import {
  resetSectionHarness,
  setStepCheckerCompletionReason,
  silenceSectionWarnings,
} from '../../test-utils/interactive-section-harness';
import { resetContentKeyForTests } from '../../global-state/content-key';
import { publishGuideIndex } from '../../global-state/active-guide-index';
import { subscribeProgressEvent } from '../../global-state/progress-events';
import { computeGuideBlockIndex } from '../../lib/guide-stats';

let warnSpy: jest.SpyInstance;
beforeAll(() => {
  warnSpy = silenceSectionWarnings();
});
afterAll(() => {
  warnSpy.mockRestore();
});
beforeEach(() => {
  resetSectionHarness();
  resetInteractiveCounters();
  resetContentKeyForTests();
});
afterEach(() => {
  cleanup();
});

// Without the passive coordinator, the section's own objectives checker
// decides whether objectives met on mount count as the reader's progress (#2102).
async function guideOriginsOnMount(): Promise<unknown[]> {
  publishGuideIndex({
    contentKey: '/',
    index: computeGuideBlockIndex([
      { type: 'markdown', id: 'section-obj-step-1' },
      { type: 'markdown' },
      { type: 'markdown' },
      { type: 'markdown' },
    ]),
    denominatorSource: 'live-pre-inlining',
  });
  const origins: unknown[] = [];
  const unsubscribe = subscribeProgressEvent((detail) => {
    if (detail.kind === 'guide') {
      origins.push(detail.origin);
    }
  });
  render(
    <InteractiveSection id="obj" title="Objectives section" autoCollapse={false}>
      <InteractiveStep targetAction="highlight" refTarget=".a">
        Step
      </InteractiveStep>
    </InteractiveSection>
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  unsubscribe();
  return origins;
}

describe('section objectives completion origin without passive completion', () => {
  it('saves objectives met on the first check without starting an attempt', async () => {
    setStepCheckerCompletionReason('objectives', 'load');

    const origins = await guideOriginsOnMount();

    expect(origins.length).toBeGreaterThan(0);
    expect(origins).not.toContain('change');
  });

  it('saves objectives met after an unmet check as a change', async () => {
    setStepCheckerCompletionReason('objectives', 'change');

    expect(await guideOriginsOnMount()).toContain('change');
  });
});
