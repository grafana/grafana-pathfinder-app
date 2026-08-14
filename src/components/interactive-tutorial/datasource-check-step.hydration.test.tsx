/**
 * DatasourceCheckStep against the real GuideResponseProvider, with storage held
 * back until after mount — the case a mount-time read of the pick gets wrong.
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { DatasourceCheckStep } from './datasource-check-step';
import { GuideResponseProvider } from '../../docs-retrieval/GuideResponseContext';

const mockGetForGuide = jest.fn();
const mockSetResponse = jest.fn();

jest.mock('@grafana/ui', () => require('../../test-utils/data-check-stubs').grafanaUiStub);

jest.mock('@grafana/runtime', () => ({
  getDataSourceSrv: () => ({ getList: () => require('../../test-utils/data-check-stubs').DATASOURCE_LIST }),
}));

// The step imports the barrel; the provider under test is the same module either way.
jest.mock('../../docs-retrieval', () => ({
  useGuideResponsesOptional: () => require('../../docs-retrieval/GuideResponseContext').useGuideResponsesOptional(),
}));

jest.mock('../../lib/user-storage', () => ({
  guideResponseStorage: {
    getForGuide: (...args: unknown[]) => mockGetForGuide(...args),
    setResponse: (...args: unknown[]) => mockSetResponse(...args),
    deleteResponse: jest.fn(),
    clearForGuide: jest.fn(),
  },
}));

jest.mock('../../lib/datasource/run-data-check-query', () => ({
  runDataCheckQuery: jest.fn().mockResolvedValue({ ok: true, hasData: true, seriesCount: 1, rowCount: 1 }),
}));

jest.mock('../../lib/logging', () => require('../../test-utils/data-check-stubs').loggerStub);

jest.mock('../../lib/analytics', () => require('../../test-utils/data-check-stubs').analyticsStub);

jest.mock('../../requirements-manager', () => ({
  useStepChecker: () => ({
    isEnabled: true,
    isChecking: false,
    explanation: null,
    markSkipped: jest.fn(),
    resetStep: jest.fn(),
  }),
  validateInteractiveRequirements: jest.fn(),
}));

jest.mock('../../global-state/completion-store', () => ({
  useStepCompletion: () => ({ completed: false, reason: null }),
  markStepCompleted: jest.fn(),
  resetStep: jest.fn(),
  STANDALONE_SECTION_ID: '__standalone__',
}));

const RUN_TEST_ID = 'datasource-check-run-check-1';

function renderInProvider(guideId = 'guide-1') {
  return render(
    <GuideResponseProvider guideId={guideId}>
      <DatasourceCheckStep stepId="check-1" variableName="myDs" query="up" datasourceFilter="prometheus" />
    </GuideResponseProvider>
  );
}

const picker = () => screen.getByLabelText(/Select a data source/i);

beforeEach(() => {
  jest.clearAllMocks();
});

it('restores the pick when storage resolves after mount', async () => {
  let release: (value: Record<string, string>) => void = () => {};
  mockGetForGuide.mockReturnValue(new Promise((resolve) => (release = resolve)));

  renderInProvider();
  // The provider starts empty, so a mount-time read sees nothing.
  expect(picker()).toHaveValue('');

  await act(async () => {
    release({ myDs: 'Prometheus staging' });
  });

  await waitFor(() => expect(picker()).toHaveValue('Prometheus staging'));
  expect(screen.getByTestId(RUN_TEST_ID)).toBeEnabled();
});

it('drops a restored pick that is not among the offered data sources', async () => {
  mockGetForGuide.mockResolvedValue({ myDs: 'Deleted data source' });

  renderInProvider();
  await waitFor(() => expect(mockGetForGuide).toHaveBeenCalled());

  expect(picker()).toHaveValue('');
  expect(screen.getByTestId(RUN_TEST_ID)).toBeDisabled();
});

it('keeps a pick made while the load was still in flight', async () => {
  let release: (value: Record<string, string>) => void = () => {};
  mockGetForGuide.mockReturnValue(new Promise((resolve) => (release = resolve)));

  renderInProvider();

  await act(async () => {
    fireEvent.change(picker(), { target: { value: 'Prometheus' } });
  });
  expect(picker()).toHaveValue('Prometheus');

  // Storage had nothing for this key; the load must not discard the fresh pick.
  await act(async () => {
    release({});
  });

  await waitFor(() => expect(picker()).toHaveValue('Prometheus'));
});

// The provider stays mounted across a guide swap, so unmounting and rendering
// again would clear the state for free and never touch the guard.
it("does not carry one guide's pick into the next", async () => {
  mockGetForGuide.mockResolvedValue({ myDs: 'Prometheus' });
  const { rerender } = renderInProvider('guide-1');
  await waitFor(() => expect(picker()).toHaveValue('Prometheus'));

  let release: (value: Record<string, string>) => void = () => {};
  mockGetForGuide.mockReturnValue(new Promise((resolve) => (release = resolve)));
  await act(async () => {
    rerender(
      <GuideResponseProvider guideId="guide-2">
        <DatasourceCheckStep stepId="check-1" variableName="myDs" query="up" datasourceFilter="prometheus" />
      </GuideResponseProvider>
    );
  });

  // Cleared on the swap itself, before the second guide's storage resolves.
  expect(picker()).toHaveValue('');

  await act(async () => {
    release({});
  });
  expect(picker()).toHaveValue('');
});
