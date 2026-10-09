import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

let mockResponses: Record<string, string> = {};
jest.mock('@grafana/ui', () => require('../../test-utils/interactive-section-harness').createGrafanaUiMock());
jest.mock('@grafana/data', () => require('../../test-utils/interactive-section-harness').createGrafanaDataMock());
jest.mock('../../lib/analytics', () => require('../../test-utils/interactive-section-harness').createAnalyticsMock());
jest.mock('../../constants', () => require('../../test-utils/interactive-section-harness').createConstantsMock());
jest.mock('../../constants/interactive-config', () =>
  require('../../test-utils/interactive-section-harness').createInteractiveConfigMock()
);
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
jest.mock('../../docs-retrieval', () => ({
  ...require('../../test-utils/interactive-section-harness').createDocsRetrievalMock(),
  useGuideResponsesOptional: () => ({ responses: mockResponses }),
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

import { InteractiveSection, resetInteractiveCounters } from './interactive-section';
import {
  resetSectionHarness,
  setCheckRequirementsResult,
  silenceSectionWarnings,
} from '../../test-utils/interactive-section-harness';

let warnings: jest.SpyInstance;
beforeAll(() => {
  warnings = silenceSectionWarnings();
});
afterAll(() => warnings.mockRestore());
beforeEach(() => {
  resetSectionHarness();
  resetInteractiveCounters();
  mockResponses = {};
  setCheckRequirementsResult({ pass: false, error: [] });
});

function Section({ mode }: { mode?: 'disable' | 'heading-only' | 'hide' }) {
  return (
    <InteractiveSection
      id="logs"
      title="Logs setup"
      requirements={['var-signals:includes:logs']}
      whenRequirementsUnmet={mode}
      autoCollapse={false}
    >
      <p>Logs instructions</p>
    </InteractiveSection>
  );
}

it('retains visible content when the setting is absent', async () => {
  render(<Section />);
  expect(screen.getByText('Logs setup')).toBeInTheDocument();
  expect(screen.getByText('Logs instructions')).toBeInTheDocument();
});

it.each(['heading-only', 'hide'] as const)(
  'applies %s to all children and reacts immediately to a choice',
  async (mode) => {
    const view = render(<Section mode={mode} />);
    expect(screen.queryByText('Logs instructions')).not.toBeInTheDocument();
    expect(Boolean(screen.queryByText('Logs setup'))).toBe(mode === 'heading-only');
    mockResponses = { signals: 'logs' };
    view.rerender(<Section mode={mode} />);
    expect(screen.getByText('Logs instructions')).toBeInTheDocument();
    mockResponses = {};
    view.rerender(<Section mode={mode} />);
    expect(screen.queryByText('Logs instructions')).not.toBeInTheDocument();
  }
);

it('rechecks ordinary section requirements on a response change without waiting for the interval', async () => {
  render(<Section />);
  await waitFor(() =>
    expect(screen.getByTestId('interactive-section-requirements-banner-section-logs')).toBeInTheDocument()
  );
  setCheckRequirementsResult({ pass: true, error: [] });
  await act(async () => {
    window.dispatchEvent(new CustomEvent('guide-response-changed', { detail: { variableName: 'signals' } }));
  });
  await waitFor(() =>
    expect(screen.queryByTestId('interactive-section-requirements-banner-section-logs')).not.toBeInTheDocument()
  );
});

it('returns focus to a choice when externally changed responses hide focused content', () => {
  mockResponses = { signals: 'logs' };
  const content = () => (
    <div data-guide-content-root="true">
      <div data-choice-question="signals">
        <input type="checkbox" aria-label="Logs choice" />
      </div>
      <InteractiveSection
        id="logs"
        title="Logs setup"
        requirements={['var-signals:includes:logs']}
        whenRequirementsUnmet="hide"
      >
        <button>Inside section</button>
      </InteractiveSection>
    </div>
  );
  const view = render(content());
  fireEvent.focus(screen.getByRole('button', { name: 'Inside section' }));
  mockResponses = {};
  view.rerender(content());
  expect(screen.getByRole('checkbox', { name: 'Logs choice' })).toHaveFocus();
});
