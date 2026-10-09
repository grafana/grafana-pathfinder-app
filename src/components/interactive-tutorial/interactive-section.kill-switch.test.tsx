import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';

import { testIds } from '../../constants/testIds';

let mockAutoDetection: boolean | undefined = true;
let mockPassiveFlag = true;
const mockCheckPostconditions = jest.fn(async () => ({ pass: false, verdict: 'unsatisfied' }));

jest.mock('../../hooks', () => ({
  usePathfinderPluginConfig: () => ({ config: { enableAutoDetection: mockAutoDetection }, isResolved: true }),
}));
jest.mock('../../utils/openfeature', () => ({
  getFeatureFlagValue: (name: string, fallback: unknown) =>
    name === 'pathfinder.passive-completion' ? mockPassiveFlag : fallback,
}));
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
jest.mock('../../interactive-engine', () => ({
  ...require('../../test-utils/interactive-section-harness').createInteractiveEngineMock(),
  observePassiveActions: () => () => {},
  observePassiveNavigation: () => () => {},
  matchesPassiveAction: () => false,
  matchesFormfillState: () => false,
  matchesPassiveNavigation: () => false,
}));
jest.mock('../../requirements-manager', () => ({
  ...require('../../test-utils/interactive-section-harness').createRequirementsManagerMock(),
  useGuideRequirements: () => ({ checkPostconditions: mockCheckPostconditions }),
  splitGuideScopedRequirements: (requirements: unknown) => ({ guideScoped: [], remaining: requirements }),
  getPostVerifyExplanation: (token: string) => `Needs ${token}`,
}));
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
import { CompletionObservationProvider } from '../content-renderer/completion-observation-provider';
import { resetHeldRequestsForTests } from '../../global-state/observation/coordinator';
import { memoryStore, resetSectionHarness, silenceSectionWarnings } from '../../test-utils/interactive-section-harness';

const SECTION = 'section-objective';
const STEP = `${SECTION}-step-1`;
const CONTENT_KEY = '/';

let warnSpy: jest.SpyInstance;
beforeAll(() => {
  warnSpy = silenceSectionWarnings();
});
afterAll(() => {
  warnSpy.mockRestore();
});
beforeEach(() => {
  mockAutoDetection = true;
  mockPassiveFlag = true;
  mockCheckPostconditions.mockClear();
  resetSectionHarness();
  resetInteractiveCounters();
});
afterEach(() => {
  cleanup();
  resetHeldRequestsForTests();
});

function renderGuide() {
  return render(
    <CompletionObservationProvider contentKey={CONTENT_KEY}>
      <InteractiveSection
        id="objective"
        title="Objective section"
        objectives={['has-datasource:testdata']}
        autoCollapse={false}
      >
        <InteractiveStep targetAction="highlight" refTarget=".a">
          Step
        </InteractiveStep>
      </InteractiveSection>
    </CompletionObservationProvider>
  );
}

async function finishTheStep() {
  await act(async () => {
    screen.getByTestId(`harness-complete-${STEP}`).click();
  });
}

describe('a section with an unmet objective after its steps are done', () => {
  it('waits for the objective while passive completion is on', async () => {
    renderGuide();
    await finishTheStep();
    await waitFor(() => expect(screen.getByTestId(testIds.interactive.completionWaiting(SECTION))).toBeInTheDocument());
    expect(screen.queryByTestId(testIds.interactive.resetSectionButton(SECTION))).not.toBeInTheDocument();
  });

  it.each([
    ['pathfinder.passive-completion is off', () => (mockPassiveFlag = false)],
    ['the tenant stores enableAutoDetection: false', () => (mockAutoDetection = false)],
  ])('completes under the previous rules when %s', async (_name, switchOff) => {
    switchOff();
    renderGuide();
    await finishTheStep();
    await waitFor(() =>
      expect(screen.getByTestId(testIds.interactive.resetSectionButton(SECTION))).toBeInTheDocument()
    );
    expect(screen.getByTestId(testIds.interactive.section(SECTION))).toHaveClass('completed');
    expect(screen.queryByTestId(testIds.interactive.completionWaiting(SECTION))).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /check completion/i })).not.toBeInTheDocument();
    await waitFor(() => expect(memoryStore.get(`section-done::${CONTENT_KEY}::${SECTION}`)).toBe(true));
    expect(mockCheckPostconditions).not.toHaveBeenCalled();
  });
});
