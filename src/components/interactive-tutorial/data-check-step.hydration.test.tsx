/**
 * DataCheckStep against the real GuideResponseProvider, with storage held back
 * until after mount — the case a mount-time read of the pick gets wrong.
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { DataCheckStep } from './data-check-step';
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

jest.mock('../../integrations/assistant-integration/assistant-dev-mode', () => ({
  useIsAssistantAvailable: () => true,
}));

function renderInProvider() {
  return render(
    <GuideResponseProvider guideId="guide-1">
      <DataCheckStep mode="query" datasourceType="prometheus" stepId="check-1" query="up" variableName="myDs" />
    </GuideResponseProvider>
  );
}

const picker = () => screen.getByLabelText(/Select a prometheus data source/i);

beforeEach(() => {
  mockGetForGuide.mockReset();
  mockSetResponse.mockReset();
});

describe('DataCheckStep hydration', () => {
  it('restores the pick once storage resolves after mount', async () => {
    let resolveStorage: (value: Record<string, string>) => void = () => {};
    mockGetForGuide.mockReturnValue(
      new Promise<Record<string, string>>((resolve) => {
        resolveStorage = resolve;
      })
    );

    renderInProvider();

    expect(picker()).toHaveValue('');
    expect(screen.getByTestId('data-check-run-query-check-1')).toBeDisabled();

    await act(async () => {
      resolveStorage({ myDs: 'prom-2' });
    });

    await waitFor(() => expect(picker()).toHaveValue('prom-2'));
    expect(screen.getByTestId('data-check-run-query-check-1')).toBeEnabled();
  });

  it('drops a restored pick that is not among the offered data sources', async () => {
    mockGetForGuide.mockResolvedValue({ myDs: 'deleted-ds' });

    renderInProvider();

    await act(async () => {
      await Promise.resolve();
    });

    expect(picker()).toHaveValue('');
    expect(screen.getByTestId('data-check-run-query-check-1')).toBeDisabled();
  });

  it('keeps a pick made while storage was still loading', async () => {
    let resolveStorage: (value: Record<string, string>) => void = () => {};
    mockGetForGuide.mockReturnValue(
      new Promise<Record<string, string>>((resolve) => {
        resolveStorage = resolve;
      })
    );

    renderInProvider();

    await act(async () => {
      fireEvent.change(picker(), { target: { value: 'prom-1' } });
    });

    await act(async () => {
      resolveStorage({});
    });

    expect(picker()).toHaveValue('prom-1');
    expect(mockSetResponse).toHaveBeenCalledWith('guide-1', 'myDs', 'prom-1');
  });
});
