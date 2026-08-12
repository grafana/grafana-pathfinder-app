/**
 * Tests for the DataCheckStep component.
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { DataCheckStep } from './data-check-step';
import {
  DATA_CHECK_REQUEST_EVENT,
  dispatchDataCheckResult,
  type DataCheckRequestDetail,
} from '../../integrations/assistant-integration/data-check-event';

const mockRunQuery = jest.fn();
const mockMarkStepCompleted = jest.fn();
const mockResetStep = jest.fn();
const mockCheckerResetStep = jest.fn();
const mockSetResponse = jest.fn();
const mockDeleteResponse = jest.fn();
let mockStoredCompleted = false;
let mockStoredReason: string | null = null;
let mockAssistantAvailable = true;
let mockStoredResponse: string | undefined;

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
  useStyles2: () => new Proxy({}, { get: () => '' }),
}));

jest.mock('@grafana/runtime', () => ({
  getDataSourceSrv: () => ({
    getList: () => [
      { uid: 'prom-1', name: 'Prometheus', type: 'prometheus' },
      { uid: 'prom-2', name: 'Prometheus staging', type: 'prometheus' },
      { uid: 'loki-1', name: 'Loki', type: 'loki' },
    ],
  }),
}));

jest.mock('../../lib/datasource/run-data-check-query', () => ({
  runDataCheckQuery: (...args: unknown[]) => mockRunQuery(...args),
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
    resetStep: (...args: unknown[]) => mockCheckerResetStep(...args),
  }),
  validateInteractiveRequirements: jest.fn(),
}));

jest.mock('../../global-state/completion-store', () => ({
  useStepCompletion: () => ({ completed: mockStoredCompleted, reason: mockStoredReason }),
  markStepCompleted: (...args: unknown[]) => mockMarkStepCompleted(...args),
  resetStep: (...args: unknown[]) => mockResetStep(...args),
  STANDALONE_SECTION_ID: '__standalone__',
}));

jest.mock('../../docs-retrieval', () => ({
  useGuideResponsesOptional: () => ({
    getResponse: () => mockStoredResponse,
    setResponse: (...args: unknown[]) => mockSetResponse(...args),
    deleteResponse: (...args: unknown[]) => mockDeleteResponse(...args),
    hasResponse: () => mockStoredResponse !== undefined,
    isLoading: false,
  }),
}));

jest.mock('../../integrations/assistant-integration/assistant-dev-mode', () => ({
  useIsAssistantAvailable: () => mockAssistantAvailable,
}));

const baseProps = {
  datasourceType: 'prometheus' as const,
  stepId: 'check-1',
  query: 'up',
  aiPrompt: 'has metrics',
};

function renderStep(props: Partial<React.ComponentProps<typeof DataCheckStep>> = {}) {
  return render(<DataCheckStep mode="query" {...baseProps} {...props} />);
}

async function selectDatasource(uid = 'prom-1') {
  await act(async () => {
    fireEvent.change(screen.getByLabelText(/Select a prometheus data source/i), { target: { value: uid } });
  });
}

async function click(testId: string) {
  await act(async () => {
    fireEvent.click(screen.getByTestId(testId));
  });
}

beforeEach(() => {
  mockRunQuery.mockReset();
  mockRunQuery.mockResolvedValue({ ok: true, hasData: true, seriesCount: 1, rowCount: 1 });
  mockMarkStepCompleted.mockReset();
  mockResetStep.mockReset();
  mockCheckerResetStep.mockReset();
  mockSetResponse.mockReset();
  mockDeleteResponse.mockReset();
  mockStoredCompleted = false;
  mockStoredReason = null;
  mockAssistantAvailable = true;
  mockStoredResponse = undefined;
});

describe('DataCheckStep', () => {
  describe('the premise: no query without a click', () => {
    it('does not query on mount', () => {
      renderStep();

      expect(mockRunQuery).not.toHaveBeenCalled();
    });

    it('does not query when the user only picks a data source', async () => {
      renderStep();

      await selectDatasource();

      expect(mockRunQuery).not.toHaveBeenCalled();
    });

    it('does not query on re-render', () => {
      const { rerender } = renderStep();

      rerender(<DataCheckStep mode="query" {...baseProps} title="Changed" />);

      expect(mockRunQuery).not.toHaveBeenCalled();
    });
  });

  describe('data source picker', () => {
    it('offers only data sources of the authored type', () => {
      renderStep();

      const options = screen.getAllByRole('option').map((o) => o.textContent);
      expect(options).toEqual(expect.arrayContaining(['Prometheus', 'Prometheus staging']));
      expect(options).not.toContain('Loki');
    });

    it('warns when no data source of the type exists', () => {
      renderStep({ datasourceType: 'tempo' });

      expect(screen.getByRole('alert')).toHaveTextContent(/No tempo data sources are configured/i);
    });

    it('stores the uid, not the name', async () => {
      renderStep();

      await selectDatasource('prom-2');

      expect(mockSetResponse).toHaveBeenCalledWith(expect.any(String), 'prom-2');
    });

    it('stores under the authored variable name when given', async () => {
      renderStep({ variableName: 'myDs' });

      await selectDatasource();

      expect(mockSetResponse).toHaveBeenCalledWith('myDs', 'prom-1');
    });

    it('restores a remembered pick', () => {
      mockStoredResponse = 'prom-2';

      renderStep();

      expect(screen.getByLabelText(/Select a prometheus data source/i)).toHaveValue('prom-2');
    });

    it('keeps the run button disabled until a data source is picked', () => {
      renderStep();

      expect(screen.getByTestId('data-check-run-query-check-1')).toBeDisabled();
    });
  });

  describe('query check', () => {
    it('completes the step when the query returns data', async () => {
      renderStep();
      await selectDatasource();

      await click('data-check-run-query-check-1');

      await waitFor(() => expect(mockMarkStepCompleted).toHaveBeenCalled());
    });

    it('runs the query against the selected data source', async () => {
      renderStep({ timeFrom: 'now-7d', timeTo: 'now' });
      await selectDatasource('prom-2');

      await click('data-check-run-query-check-1');

      await waitFor(() =>
        expect(mockRunQuery).toHaveBeenCalledWith(
          expect.objectContaining({ datasourceUid: 'prom-2', query: 'up', from: 'now-7d', to: 'now' })
        )
      );
    });

    it('leaves the step incomplete and warns when the query returns nothing', async () => {
      mockRunQuery.mockResolvedValue({ ok: true, hasData: false, seriesCount: 0, rowCount: 0 });
      renderStep({ failureMessage: 'No container CPU data found.' });
      await selectDatasource();

      await click('data-check-run-query-check-1');

      expect(await screen.findByTestId('data-check-failure-check-1')).toHaveTextContent('No container CPU data found.');
      expect(mockMarkStepCompleted).not.toHaveBeenCalled();
    });

    it('surfaces the data source error when the query fails', async () => {
      mockRunQuery.mockResolvedValue({ ok: false, error: 'parse error: unexpected identifier' });
      renderStep();
      await selectDatasource();

      await click('data-check-run-query-check-1');

      expect(await screen.findByTestId('data-check-failure-check-1')).toHaveTextContent('parse error');
    });

    it('offers a re-run after a failure', async () => {
      mockRunQuery.mockResolvedValue({ ok: true, hasData: false, seriesCount: 0, rowCount: 0 });
      renderStep();
      await selectDatasource();

      await click('data-check-run-query-check-1');

      expect(await screen.findByTestId('data-check-run-query-check-1')).toHaveTextContent('Run query again');
    });
  });

  describe('ai check', () => {
    it('dispatches a request carrying the selected data source', async () => {
      const requests: DataCheckRequestDetail[] = [];
      const listener = (e: Event) => requests.push((e as CustomEvent).detail);
      window.addEventListener(DATA_CHECK_REQUEST_EVENT, listener);

      renderStep({ mode: 'ai' });
      await selectDatasource('prom-2');
      await click('data-check-ask-ai-check-1');

      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        datasourceUid: 'prom-2',
        datasourceType: 'prometheus',
        aiPrompt: 'has metrics',
      });
      window.removeEventListener(DATA_CHECK_REQUEST_EVENT, listener);
    });

    it('completes the step on a passing verdict', async () => {
      let requestId = '';
      const listener = (e: Event) => (requestId = (e as CustomEvent).detail.requestId);
      window.addEventListener(DATA_CHECK_REQUEST_EVENT, listener);

      renderStep({ mode: 'ai' });
      await selectDatasource();
      await click('data-check-ask-ai-check-1');
      act(() => dispatchDataCheckResult({ requestId, passed: true, reason: 'Found metrics.' }));

      await waitFor(() => expect(mockMarkStepCompleted).toHaveBeenCalled());
      window.removeEventListener(DATA_CHECK_REQUEST_EVENT, listener);
    });

    it('shows the verdict reason and stays incomplete on a failing verdict', async () => {
      let requestId = '';
      const listener = (e: Event) => (requestId = (e as CustomEvent).detail.requestId);
      window.addEventListener(DATA_CHECK_REQUEST_EVENT, listener);

      renderStep({ mode: 'ai' });
      await selectDatasource();
      await click('data-check-ask-ai-check-1');
      act(() => dispatchDataCheckResult({ requestId, passed: false, reason: 'No container metrics found.' }));

      expect(await screen.findByTestId('data-check-failure-check-1')).toHaveTextContent('No container metrics found.');
      expect(mockMarkStepCompleted).not.toHaveBeenCalled();
      window.removeEventListener(DATA_CHECK_REQUEST_EVENT, listener);
    });

    it('fails the check rather than spinning when nothing answers the request', async () => {
      jest.useFakeTimers();
      try {
        renderStep({ mode: 'ai' });
        await selectDatasource();
        await click('data-check-ask-ai-check-1');

        expect(screen.getByText('Checking your data…')).toBeInTheDocument();

        await act(async () => {
          jest.advanceTimersByTime(45_000);
        });

        expect(await screen.findByTestId('data-check-failure-check-1')).toBeInTheDocument();
        expect(mockMarkStepCompleted).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it('ignores a result meant for another step', async () => {
      renderStep({ mode: 'ai' });
      await selectDatasource();
      await click('data-check-ask-ai-check-1');

      act(() => dispatchDataCheckResult({ requestId: 'someone-else', passed: true, reason: 'ok' }));

      expect(mockMarkStepCompleted).not.toHaveBeenCalled();
    });

    it('says so rather than stranding the user when ai is the only mode and the assistant is absent', () => {
      mockAssistantAvailable = false;
      renderStep({ mode: 'ai' });

      expect(screen.getByRole('alert')).toHaveTextContent(/Grafana Assistant/);
      expect(screen.queryByTestId('data-check-ask-ai-check-1')).not.toBeInTheDocument();
    });

    it('hides the AI affordance when the assistant is unavailable', () => {
      mockAssistantAvailable = false;

      renderStep({ mode: 'ai' });

      expect(screen.queryByTestId('data-check-ask-ai-check-1')).not.toBeInTheDocument();
    });
  });

  describe('either mode', () => {
    it('offers both checks', () => {
      renderStep({ mode: 'either' });

      expect(screen.getByTestId('data-check-run-query-check-1')).toBeInTheDocument();
      expect(screen.getByTestId('data-check-ask-ai-check-1')).toBeInTheDocument();
    });

    it('completes on the query check alone', async () => {
      renderStep({ mode: 'either' });
      await selectDatasource();

      await click('data-check-run-query-check-1');

      await waitFor(() => expect(mockMarkStepCompleted).toHaveBeenCalled());
    });

    it('degrades to the query check when the assistant is unavailable', () => {
      mockAssistantAvailable = false;

      renderStep({ mode: 'either' });

      expect(screen.getByTestId('data-check-run-query-check-1')).toBeInTheDocument();
      expect(screen.queryByTestId('data-check-ask-ai-check-1')).not.toBeInTheDocument();
    });
  });

  describe('form state and step state', () => {
    it('clears a failure when the data source changes', async () => {
      mockRunQuery.mockResolvedValue({ ok: true, hasData: false, seriesCount: 0, rowCount: 0 });
      renderStep();
      await selectDatasource('prom-1');
      await click('data-check-run-query-check-1');
      await screen.findByTestId('data-check-failure-check-1');

      await selectDatasource('prom-2');

      expect(screen.queryByTestId('data-check-failure-check-1')).not.toBeInTheDocument();
    });

    it('clears the verdict on a section reset but keeps the data source pick', async () => {
      mockRunQuery.mockResolvedValue({ ok: true, hasData: false, seriesCount: 0, rowCount: 0 });
      const { rerender } = render(<DataCheckStep mode="query" {...baseProps} resetTrigger={0} />);
      await selectDatasource('prom-2');
      await click('data-check-run-query-check-1');
      await screen.findByTestId('data-check-failure-check-1');

      rerender(<DataCheckStep mode="query" {...baseProps} resetTrigger={1} />);

      expect(screen.queryByTestId('data-check-failure-check-1')).not.toBeInTheDocument();
      expect(screen.getByLabelText(/Select a prometheus data source/i)).toHaveValue('prom-2');
    });
  });

  describe('skipping', () => {
    it('offers no skip by default', () => {
      renderStep();

      expect(screen.queryByTestId('data-check-skip-check-1')).not.toBeInTheDocument();
    });

    it('completes the step when the author allowed skipping', async () => {
      renderStep({ skippable: true });

      await click('data-check-skip-check-1');

      expect(mockMarkStepCompleted).toHaveBeenCalled();
    });

    it('records the skip as skipped rather than as a pass', async () => {
      renderStep({ skippable: true });

      await click('data-check-skip-check-1');

      expect(mockMarkStepCompleted).toHaveBeenCalledWith('check-1', undefined, 'skipped');
    });

    it('offers a skip when no data source of the type exists', () => {
      renderStep({ datasourceType: 'tempo', skippable: true });

      expect(screen.getByTestId('data-check-skip-check-1')).toBeInTheDocument();
    });
  });

  describe('completed state', () => {
    it('shows the completed badge and hides the controls', () => {
      mockStoredCompleted = true;

      renderStep();

      expect(screen.getByText('Data available')).toBeInTheDocument();
      expect(screen.queryByTestId('data-check-run-query-check-1')).not.toBeInTheDocument();
    });

    it('says skipped when that is how the step completed', () => {
      mockStoredCompleted = true;
      mockStoredReason = 'skipped';

      renderStep();

      expect(screen.getByText('Skipped')).toBeInTheDocument();
    });
  });

  describe('redo', () => {
    it('clears a standalone step back to unchecked', async () => {
      mockStoredCompleted = true;
      renderStep();

      await click('data-check-redo-check-1');

      expect(mockResetStep).toHaveBeenCalledWith('check-1', undefined);
      expect(mockCheckerResetStep).toHaveBeenCalledWith();
    });

    it('resets through the section when one owns the step', async () => {
      mockStoredCompleted = true;
      const onStepReset = jest.fn();
      renderStep({ onStepComplete: jest.fn(), onStepReset, sectionId: 'section-1' });

      await click('data-check-redo-check-1');

      // The section owns the tail reset; a per-step store write here would
      // wipe the preceding steps the user kept.
      expect(onStepReset).toHaveBeenCalledWith('check-1');
      expect(mockResetStep).not.toHaveBeenCalled();
      expect(mockCheckerResetStep).toHaveBeenCalledWith({ skipStoreWrite: true });
    });
  });
});
