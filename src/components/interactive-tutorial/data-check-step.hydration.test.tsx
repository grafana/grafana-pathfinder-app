/**
 * DataCheckStep against the real GuideResponseProvider.
 *
 * The provider starts empty and fills from storage a tick later, so a step that
 * read the remembered pick once — at mount — would show an empty picker on every
 * reload. These tests hold the resolution back until after mount deliberately.
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { DataCheckStep } from './data-check-step';
import { GuideResponseProvider } from '../../docs-retrieval/GuideResponseContext';

const mockGetForGuide = jest.fn();
const mockSetResponse = jest.fn();

jest.mock('@grafana/ui', () => ({
  Alert: ({ title, children }: any) => (
    <div role="alert">
      {title}
      {children}
    </div>
  ),
  Button: ({ children, onClick, disabled, ...rest }: any) => (
    <button onClick={onClick} disabled={disabled} {...rest}>
      {children}
    </button>
  ),
  Combobox: ({ options, value, onChange, placeholder, ...rest }: any) => (
    <select
      aria-label={placeholder}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value ? { value: e.target.value } : null)}
      {...rest}
    >
      <option value="">{placeholder}</option>
      {options.map((o: any) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
  Field: ({ children }: any) => <div>{children}</div>,
  Icon: ({ name }: any) => <span data-testid={`icon-${name}`} />,
  useStyles2: () => new Proxy({}, { get: (_target: unknown, key: string) => key }),
}));

jest.mock('@grafana/runtime', () => ({
  getDataSourceSrv: () => ({
    getList: () => [
      { uid: 'prom-1', name: 'Prometheus', type: 'prometheus' },
      { uid: 'prom-2', name: 'Prometheus staging', type: 'prometheus' },
    ],
  }),
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

jest.mock('../../lib/logging', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), exception: jest.fn() },
}));

jest.mock('../../lib/analytics', () => ({
  reportAppInteraction: jest.fn(),
  UserInteraction: {
    DataCheckRun: 'data_check_run',
    DataCheckPassed: 'data_check_passed',
    DataCheckFailed: 'data_check_failed',
    DataCheckSkipped: 'data_check_skipped',
  },
}));

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
