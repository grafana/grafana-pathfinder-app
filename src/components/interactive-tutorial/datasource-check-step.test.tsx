/**
 * Tests for DatasourceCheckStep — the datasource picker when its author asked a
 * failing check to block.
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { DatasourceCheckStep } from './datasource-check-step';
import { holdDatasourceList, mockDatasourceList, settleDatasourceList } from '../../test-utils/datasource-list';
import { DATASOURCE_LIST } from '../../test-utils/data-check-stubs';

const mockRunQuery = jest.fn();
const mockMarkStepCompleted = jest.fn();
const mockResetStep = jest.fn();
const mockCheckerResetStep = jest.fn();
const mockCheckerMarkSkipped = jest.fn();
let mockCheckerEnabled = true;
const mockSetResponse = jest.fn();
const mockDeleteResponse = jest.fn();
let mockStoredCompleted = false;
let mockStoredReason: string | null = null;
let mockStoredResponse: string | undefined;

jest.mock('@grafana/ui', () => require('../../test-utils/data-check-stubs').grafanaUiStub);

jest.mock(
  '@grafana/plugin-compat/datasources',
  () => require('../../test-utils/datasource-list').pluginCompatDatasourcesStub
);

jest.mock('../../lib/datasource/run-data-check-query', () => ({
  runDataCheckQuery: (...args: unknown[]) => mockRunQuery(...args),
}));

jest.mock('../../lib/logging', () => require('../../test-utils/data-check-stubs').loggerStub);

jest.mock('../../lib/analytics', () => require('../../test-utils/data-check-stubs').analyticsStub);

jest.mock('../../requirements-manager', () => ({
  useStepChecker: () => ({
    isEnabled: mockCheckerEnabled,
    isChecking: false,
    explanation: null,
    markSkipped: (...args: unknown[]) => mockCheckerMarkSkipped(...args),
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

// Stateful like the real provider: a write has to re-render, or nothing reading
// the stored pick would ever see it. `mockOtherWriters` stands in for everything
// else that can own the same variable — a sibling advisory picker, a `{{var}}`
// write, a guide clear.
let mockOtherWriters: Array<(value: string | undefined) => void> = [];

jest.mock('../../docs-retrieval', () => {
  const react = require('react');
  return {
    useGuideResponsesOptional: () => {
      const [stored, setStored] = react.useState(() => mockStoredResponse);
      react.useEffect(() => {
        mockOtherWriters.push(setStored);
        return () => {
          mockOtherWriters = mockOtherWriters.filter((writer) => writer !== setStored);
        };
      }, []);
      return {
        getResponse: () => stored,
        setResponse: (key: string, value: string) => {
          mockSetResponse(key, value);
          setStored(value);
        },
        deleteResponse: (key: string) => {
          mockDeleteResponse(key);
          setStored(undefined);
        },
        hasResponse: () => stored !== undefined,
        isLoading: false,
      };
    },
  };
});

beforeEach(() => mockDatasourceList(DATASOURCE_LIST));

const TEST_IDS = {
  step: 'datasource-check-step-check-1',
  picker: 'datasource-check-picker-check-1',
  run: 'datasource-check-run-check-1',
  skip: 'datasource-check-skip-check-1',
  failure: 'datasource-check-failure-check-1',
  redo: 'interactive-redo-check-1',
};

const baseProps = {
  stepId: 'check-1',
  stepIndex: 3,
  totalSteps: 6,
  variableName: 'metricsDatasource',
  query: 'up',
  datasourceFilter: 'prometheus',
};

async function renderStep(props: Partial<React.ComponentProps<typeof DatasourceCheckStep>> = {}) {
  const view = render(<DatasourceCheckStep {...baseProps} {...props} />);
  await settleDatasourceList();
  return view;
}

async function pick(name = 'Prometheus') {
  await act(async () => {
    fireEvent.change(screen.getByLabelText(/Select a data source/i), { target: { value: name } });
  });
}

async function click(testId: string) {
  await act(async () => {
    fireEvent.click(screen.getByTestId(testId));
  });
}

/** Someone other than this picker writes the variable it reads. */
async function writeVariableElsewhere(value: string | undefined) {
  await act(async () => {
    mockOtherWriters.forEach((writer) => writer(value));
  });
}

const hasData = { ok: true, hasData: true, seriesCount: 1, rowCount: 3 };
const noData = { ok: true, hasData: false, seriesCount: 0, rowCount: 0 };

beforeEach(async () => {
  jest.clearAllMocks();
  mockCheckerEnabled = true;
  mockStoredCompleted = false;
  mockStoredReason = null;
  mockStoredResponse = undefined;
  mockOtherWriters = [];
  mockRunQuery.mockResolvedValue(hasData);
});

describe('the premise: a check only runs when the user asks', () => {
  it('runs nothing on mount', async () => {
    await renderStep();
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it('runs nothing on picking a data source', async () => {
    await renderStep();
    await pick();
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it('runs nothing on a re-render', async () => {
    const { rerender } = await renderStep();
    await pick();
    rerender(<DatasourceCheckStep {...baseProps} />);
    expect(mockRunQuery).not.toHaveBeenCalled();
  });
});

describe('the picker', () => {
  it('offers only data sources the filter matches', async () => {
    await renderStep();
    const options = screen.getByLabelText(/Select a data source/i).querySelectorAll('option');
    const labels = Array.from(options).map((o) => o.textContent);
    expect(labels).toContain('Prometheus');
    expect(labels).toContain('Prometheus staging');
    expect(labels).not.toContain('Loki');
    expect(labels).not.toContain('Reporting');
  });

  it('offers every data source when the author set no filter', async () => {
    await renderStep({ datasourceFilter: undefined });
    const labels = Array.from(screen.getByLabelText(/Select a data source/i).querySelectorAll('option')).map(
      (o) => o.textContent
    );
    expect(labels).toContain('Loki');
    expect(labels).toContain('Reporting');
  });

  it('stores the name, not the uid, so {{variable}} substitution still works', async () => {
    await renderStep();
    await pick();
    expect(mockSetResponse).toHaveBeenCalledWith('metricsDatasource', 'Prometheus');
  });

  it('stores under the authored variable name', async () => {
    await renderStep({ variableName: 'myDatasource' });
    await pick();
    expect(mockSetResponse).toHaveBeenCalledWith('myDatasource', 'Prometheus');
  });

  it('clears the stored pick when the user clears the picker', async () => {
    mockStoredResponse = 'Prometheus';
    await renderStep();
    await pick('');
    expect(mockDeleteResponse).toHaveBeenCalledWith('metricsDatasource');
  });

  it('restores a remembered pick', async () => {
    mockStoredResponse = 'Prometheus staging';
    await renderStep();
    expect(screen.getByLabelText(/Select a data source/i)).toHaveValue('Prometheus staging');
  });

  // A `<select>` cannot hold a value that is not among its options, so asserting
  // on the rendered value alone would pass even with the guard removed. What has
  // to hold is that no check can run against a pick the picker never offered.
  it('refuses to run against a remembered pick that no longer exists', async () => {
    mockStoredResponse = 'Deleted data source';
    await renderStep();
    expect(screen.getByTestId(TEST_IDS.run)).toBeDisabled();
    await click(TEST_IDS.run);
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it('refuses to run against a remembered pick the filter no longer offers', async () => {
    mockStoredResponse = 'Loki';
    await renderStep({ datasourceFilter: 'prometheus' });
    expect(screen.getByLabelText(/Select a data source/i)).toHaveValue('');
    expect(screen.getByTestId(TEST_IDS.run)).toBeDisabled();
    await click(TEST_IDS.run);
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it('does not delete a remembered pick it cannot currently offer', async () => {
    // A transient empty getList() would otherwise destroy a valid pick for good.
    mockStoredResponse = 'Deleted data source';
    await renderStep();
    expect(mockDeleteResponse).not.toHaveBeenCalled();
  });

  it('warns instead of offering an empty picker when nothing matches', async () => {
    await renderStep({ datasourceFilter: 'elasticsearch' });
    expect(screen.getByRole('alert')).toHaveTextContent(/No data sources/i);
    expect(screen.queryByTestId(TEST_IDS.run)).not.toBeInTheDocument();
  });

  it('keeps Run disabled until something is picked', async () => {
    await renderStep();
    expect(screen.getByTestId(TEST_IDS.run)).toBeDisabled();
  });
});

describe('while the data source list is still loading', () => {
  const picker = () => screen.getByLabelText(/Select a data source/i);
  const renderLoading = (props: Partial<React.ComponentProps<typeof DatasourceCheckStep>> = {}) => {
    const list = holdDatasourceList();
    const view = render(<DatasourceCheckStep {...baseProps} {...props} />);
    return { list, view };
  };

  it('shows the remembered pick in a busy, disabled picker and keeps it once the list arrives', async () => {
    mockStoredResponse = 'Prometheus staging';
    const { list } = renderLoading();

    expect(picker()).toHaveValue('Prometheus staging');
    expect(picker()).toBeDisabled();
    expect(picker()).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByTestId(TEST_IDS.run)).toBeDisabled();

    await act(async () => list.resolve(DATASOURCE_LIST));

    expect(picker()).toHaveValue('Prometheus staging');
    expect(picker()).toBeEnabled();
    expect(picker()).not.toHaveAttribute('aria-busy');
    expect(screen.getByTestId(TEST_IDS.run)).toBeEnabled();
    expect(mockDeleteResponse).not.toHaveBeenCalled();
    expect(mockSetResponse).not.toHaveBeenCalled();
    expect(mockResetStep).not.toHaveBeenCalled();
    expect(mockCheckerResetStep).not.toHaveBeenCalled();
  });

  it('keeps a durable pass standing through the load', async () => {
    mockStoredResponse = 'Prometheus';
    mockStoredCompleted = true;
    const onStepReset = jest.fn();
    const { list } = renderLoading({ onStepComplete: jest.fn(), onStepReset });

    await act(async () => list.resolve(DATASOURCE_LIST));

    expect(screen.getByTestId(TEST_IDS.redo)).toBeInTheDocument();
    expect(onStepReset).not.toHaveBeenCalled();
    expect(mockCheckerResetStep).not.toHaveBeenCalled();
  });

  it('drops a remembered pick only once the arrived list lacks it', async () => {
    mockStoredResponse = 'Deleted data source';
    const { list } = renderLoading();
    expect(picker()).toHaveValue('Deleted data source');

    await act(async () => list.resolve(DATASOURCE_LIST));

    expect(picker()).toHaveValue('');
    expect(screen.getByTestId(TEST_IDS.run)).toBeDisabled();
    expect(mockDeleteResponse).not.toHaveBeenCalled();
  });

  it('warns that nothing matches only after the list arrives', async () => {
    const { list } = renderLoading({ datasourceFilter: 'elasticsearch' });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(picker()).toHaveAttribute('aria-busy', 'true');

    await act(async () => list.resolve(DATASOURCE_LIST));

    expect(screen.getByRole('alert')).toHaveTextContent(/No data sources/i);
    expect(screen.queryByTestId(TEST_IDS.run)).not.toBeInTheDocument();
  });

  it('treats a failed list read as an empty list, not as still loading', async () => {
    const { list } = renderLoading();

    await act(async () => list.reject(new Error('host unavailable')));

    expect(screen.getByRole('alert')).toHaveTextContent(/No data sources/i);
  });
});

describe('a data source type no check can query', () => {
  it('says so instead of offering a run button', async () => {
    await renderStep({ datasourceFilter: 'mysql' });
    await pick('Reporting');
    expect(screen.getByRole('alert')).toHaveTextContent(/can't run here/i);
    expect(screen.queryByTestId(TEST_IDS.run)).not.toBeInTheDocument();
  });

  it('issues no query', async () => {
    await renderStep({ datasourceFilter: 'mysql' });
    await pick('Reporting');
    expect(mockRunQuery).not.toHaveBeenCalled();
  });
});

describe('running the check', () => {
  it('completes the step when the query returns data', async () => {
    await renderStep();
    await pick();
    await click(TEST_IDS.run);
    await waitFor(() => expect(mockMarkStepCompleted).toHaveBeenCalledWith('check-1', undefined, 'manual'));
  });

  it('queries the picked data source by uid and normalized type', async () => {
    await renderStep();
    await pick('Prometheus staging');
    await click(TEST_IDS.run);
    expect(mockRunQuery).toHaveBeenCalledWith(
      expect.objectContaining({ datasourceUid: 'prom-2', datasourceType: 'prometheus', query: 'up' })
    );
  });

  it('passes the authored time range through', async () => {
    await renderStep({ timeFrom: 'now-6h', timeTo: 'now-1h' });
    await pick();
    await click(TEST_IDS.run);
    expect(mockRunQuery).toHaveBeenCalledWith(expect.objectContaining({ from: 'now-6h', to: 'now-1h' }));
  });

  it('holds the step incomplete when the query returns nothing', async () => {
    mockRunQuery.mockResolvedValue(noData);
    await renderStep();
    await pick();
    await click(TEST_IDS.run);
    await waitFor(() => expect(screen.getByTestId(TEST_IDS.failure)).toBeInTheDocument());
    expect(mockMarkStepCompleted).not.toHaveBeenCalled();
  });

  it("shows the author's failure message when the query returns nothing", async () => {
    mockRunQuery.mockResolvedValue(noData);
    await renderStep({ failureMessage: 'No container metrics here.' });
    await pick();
    await click(TEST_IDS.run);
    await waitFor(() => expect(screen.getByTestId(TEST_IDS.failure)).toHaveTextContent('No container metrics here.'));
  });

  it("surfaces the data source's own error when there is no authored message", async () => {
    mockRunQuery.mockResolvedValue({ ok: false, error: 'parse error at line 1' });
    await renderStep();
    await pick();
    await click(TEST_IDS.run);
    await waitFor(() => expect(screen.getByTestId(TEST_IDS.failure)).toHaveTextContent('parse error at line 1'));
  });

  // A user told the metric is missing may skip a blocking step, when the real
  // problem is that the query never ran.
  it("does not dress a failed query up in the author's no-data message", async () => {
    mockRunQuery.mockResolvedValue({ ok: false, error: 'Query timed out after 15s.' });
    await renderStep({ failureMessage: 'No container metrics here.' });
    await pick();
    await click(TEST_IDS.run);

    await waitFor(() => expect(screen.getByTestId(TEST_IDS.failure)).toBeInTheDocument());
    const failure = screen.getByTestId(TEST_IDS.failure);
    expect(failure).toHaveTextContent('Query timed out after 15s.');
    expect(failure).toHaveTextContent(/could not run/i);
    expect(failure).not.toHaveTextContent('No container metrics here.');
  });

  it('distinguishes the two failures in telemetry', async () => {
    const { reportAppInteraction } = require('../../lib/analytics');
    mockRunQuery.mockResolvedValue(noData);
    await renderStep();
    await pick();
    await click(TEST_IDS.run);
    await waitFor(() =>
      expect(reportAppInteraction).toHaveBeenCalledWith(
        'data_check_failed',
        expect.objectContaining({ outcome: 'no-data' })
      )
    );

    mockRunQuery.mockResolvedValue({ ok: false, error: 'boom' });
    await click(TEST_IDS.run);
    await waitFor(() =>
      expect(reportAppInteraction).toHaveBeenCalledWith(
        'data_check_failed',
        expect.objectContaining({ outcome: 'error' })
      )
    );
  });

  it('offers another attempt after a failure', async () => {
    mockRunQuery.mockResolvedValue(noData);
    await renderStep();
    await pick();
    await click(TEST_IDS.run);
    await waitFor(() => expect(screen.getByTestId(TEST_IDS.run)).toHaveTextContent(/Run check again/i));
  });

  it('reports the outcome without leaking the query or the data source name', async () => {
    const { reportAppInteraction } = require('../../lib/analytics');
    await renderStep();
    await pick();
    await click(TEST_IDS.run);
    await waitFor(() => expect(reportAppInteraction).toHaveBeenCalledWith('data_check_passed', expect.anything()));
    for (const call of reportAppInteraction.mock.calls) {
      expect(JSON.stringify(call[1])).not.toContain('up');
      expect(JSON.stringify(call[1])).not.toContain('Prometheus');
    }
  });
});

describe('changing the data source', () => {
  it('clears a failure so the message does not outlive its data source', async () => {
    mockRunQuery.mockResolvedValue(noData);
    await renderStep();
    await pick();
    await click(TEST_IDS.run);
    await waitFor(() => expect(screen.getByTestId(TEST_IDS.failure)).toBeInTheDocument());

    await pick('Prometheus staging');
    expect(screen.queryByTestId(TEST_IDS.failure)).not.toBeInTheDocument();
  });

  it('resets completion, so a green check never stands against a data source the user left', async () => {
    await renderStep();
    await pick();
    await pick('Prometheus staging');
    expect(mockResetStep).toHaveBeenCalledWith('check-1', undefined);
  });

  it('tells the section to reset, not just its own store entry', async () => {
    const onStepReset = jest.fn();
    await renderStep({ onStepComplete: jest.fn(), onStepReset });
    await pick();
    await pick('Prometheus staging');
    expect(onStepReset).toHaveBeenCalledWith('check-1');
  });
});

// The pick is shared state. An advisory `input` block on the same
// `variableName` is exactly the pairing the demo guide ships, so a pass can be
// invalidated by something this component never hears from directly.
describe('a data source swapped by someone else', () => {
  it('retracts a pass a section is counting', async () => {
    mockStoredResponse = 'Prometheus';
    const onStepComplete = jest.fn();
    const onStepReset = jest.fn();
    await renderStep({ onStepComplete, onStepReset });
    await click(TEST_IDS.run);
    expect(onStepComplete).toHaveBeenCalledWith('check-1');

    await writeVariableElsewhere('Prometheus staging');
    expect(onStepReset).toHaveBeenCalledWith('check-1');
  });

  it('retracts a standalone pass from the completion store', async () => {
    mockStoredResponse = 'Prometheus';
    await renderStep();
    await click(TEST_IDS.run);
    expect(mockMarkStepCompleted).toHaveBeenCalledWith('check-1', undefined, 'manual');

    await writeVariableElsewhere('Prometheus staging');
    expect(mockResetStep).toHaveBeenCalledWith('check-1', undefined);
  });

  it('does not leave a failure standing against a data source nobody is looking at', async () => {
    mockRunQuery.mockResolvedValue(noData);
    mockStoredResponse = 'Prometheus';
    await renderStep();
    await click(TEST_IDS.run);
    await waitFor(() => expect(screen.getByTestId(TEST_IDS.failure)).toBeInTheDocument());

    await writeVariableElsewhere('Prometheus staging');
    expect(screen.queryByTestId(TEST_IDS.failure)).not.toBeInTheDocument();
  });

  it('retracts when a guide clear empties the picker', async () => {
    mockStoredResponse = 'Prometheus';
    const onStepReset = jest.fn();
    await renderStep({ onStepComplete: jest.fn(), onStepReset });
    await click(TEST_IDS.run);

    await writeVariableElsewhere(undefined);
    expect(onStepReset).toHaveBeenCalledWith('check-1');
  });

  // Hydration arrives the same way a foreign write does. Retracting on it would
  // wipe a durable pass on every reload.
  it('leaves a durable pass alone when the stored pick merely arrives late', async () => {
    mockStoredCompleted = true;
    mockStoredReason = 'manual';
    const onStepReset = jest.fn();
    await renderStep({ onStepComplete: jest.fn(), onStepReset });

    await writeVariableElsewhere('Prometheus');
    expect(onStepReset).not.toHaveBeenCalled();
    expect(mockResetStep).not.toHaveBeenCalled();
  });
});

describe('a section reset', () => {
  it('clears the verdict but keeps the pick', async () => {
    mockRunQuery.mockResolvedValue(noData);
    const { rerender } = await renderStep({ resetTrigger: 0 });
    await pick();
    await click(TEST_IDS.run);
    await waitFor(() => expect(screen.getByTestId(TEST_IDS.failure)).toBeInTheDocument());

    await act(async () => {
      rerender(<DatasourceCheckStep {...baseProps} resetTrigger={1} />);
    });

    expect(screen.queryByTestId(TEST_IDS.failure)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Select a data source/i)).toHaveValue('Prometheus');
  });

  it('suppresses its own store write, since the section already wrote one', async () => {
    const { rerender } = await renderStep({ resetTrigger: 0, onStepComplete: jest.fn() });
    await act(async () => {
      rerender(<DatasourceCheckStep {...baseProps} resetTrigger={1} onStepComplete={jest.fn()} />);
    });
    expect(mockCheckerResetStep).toHaveBeenCalledWith({ skipStoreWrite: true });
  });
});

describe('skipping', () => {
  it('offers no way out by default', async () => {
    await renderStep();
    expect(screen.queryByTestId(TEST_IDS.skip)).not.toBeInTheDocument();
  });

  it('records a skip as skipped, not as a check the user passed', async () => {
    await renderStep({ skippable: true });
    await click(TEST_IDS.skip);
    expect(mockMarkStepCompleted).toHaveBeenCalledWith('check-1', undefined, 'skipped');
  });

  it('is offered when no data source of the authored type exists', async () => {
    await renderStep({ datasourceFilter: 'elasticsearch', skippable: true });
    expect(screen.getByTestId(TEST_IDS.skip)).toBeInTheDocument();
  });

  describe('step_skipped', () => {
    function expectSkipReported(skipReason: string) {
      const { reportStepSkipped } = require('../../lib/analytics');
      expect(reportStepSkipped).toHaveBeenCalledTimes(1);
      expect(reportStepSkipped).toHaveBeenCalledWith(
        { targetAction: 'datasource-check', interactionLocation: 'data_check_step', skipReason },
        expect.objectContaining({ stepId: 'check-1', stepIndex: 3, totalSteps: 6 })
      );
    }

    it('reports a skip taken before any check as a user skip, beside data_check_skipped', async () => {
      const { reportAppInteraction } = require('../../lib/analytics');
      await renderStep({ skippable: true });
      await click(TEST_IDS.skip);
      expectSkipReported('user');
      expect(reportAppInteraction).toHaveBeenCalledWith('data_check_skipped', expect.anything());
    });

    it('reports a skip after the check found no data as after_failure', async () => {
      mockRunQuery.mockResolvedValue(noData);
      await renderStep({ skippable: true });
      await pick();
      await click(TEST_IDS.run);
      await waitFor(() => expect(screen.getByTestId(TEST_IDS.failure)).toBeInTheDocument());
      await click(TEST_IDS.skip);
      expectSkipReported('after_failure');
    });

    it('reports a skip with no data source of the authored type as requirements_unmet', async () => {
      await renderStep({ datasourceFilter: 'elasticsearch', skippable: true });
      await click(TEST_IDS.skip);
      expectSkipReported('requirements_unmet');
    });

    it('reports a skip past failed requirements as requirements_unmet', async () => {
      mockCheckerEnabled = false;
      await renderStep({ skippable: true, hints: 'Open the data sources page first' });
      await click(TEST_IDS.skip);
      expectSkipReported('requirements_unmet');
    });
  });

  describe('while a check is still running', () => {
    // Skip is clickable during a check, so giving up has to stop the query too.
    let settle: (result: unknown) => void;

    beforeEach(async () => {
      mockRunQuery.mockImplementation(
        (req: { signal?: AbortSignal }) =>
          new Promise((resolve) => {
            settle = resolve;
            req.signal?.addEventListener('abort', () => resolve({ ok: false, error: 'aborted' }));
          })
      );
      await renderStep({ skippable: true });
      await pick();
      await click(TEST_IDS.run);
    });

    it('says so, and refuses a second press until the first lands', async () => {
      expect(screen.getByTestId(TEST_IDS.step)).toHaveAttribute('data-test-step-state', 'executing');
      expect(screen.getByText('Checking your data…')).toBeInTheDocument();
      expect(screen.getByTestId(TEST_IDS.run)).toBeDisabled();
    });

    it('issues exactly one query however many times the button is pressed', async () => {
      await click(TEST_IDS.run);
      await click(TEST_IDS.run);
      expect(mockRunQuery).toHaveBeenCalledTimes(1);
    });

    it('aborts the in-flight query', async () => {
      const signal = mockRunQuery.mock.calls[0]![0].signal as AbortSignal;
      expect(signal.aborted).toBe(false);
      await click(TEST_IDS.skip);
      expect(signal.aborted).toBe(true);
    });

    it('records the skip rather than the pass the late query would report', async () => {
      await click(TEST_IDS.skip);
      expect(mockMarkStepCompleted).toHaveBeenCalledWith('check-1', undefined, 'skipped');

      // The abandoned request lands after the skip and must change nothing.
      await act(async () => {
        settle({ ok: true, hasData: true, seriesCount: 1, rowCount: 1 });
      });
      expect(mockMarkStepCompleted).toHaveBeenCalledTimes(1);
    });

    it('reports no outcome for the check it abandoned', async () => {
      const { reportAppInteraction } = require('../../lib/analytics');
      await click(TEST_IDS.skip);
      await act(async () => {
        settle({ ok: true, hasData: true, seriesCount: 1, rowCount: 1 });
      });
      const events = reportAppInteraction.mock.calls.map((c: unknown[]) => c[0]);
      expect(events).toContain('data_check_skipped');
      expect(events).not.toContain('data_check_passed');
      expect(events).not.toContain('data_check_failed');
    });

    it('leaves Redo working instead of inert until the query finishes', async () => {
      mockStoredCompleted = true;
      mockStoredReason = 'skipped';
      await click(TEST_IDS.skip);
      await click(TEST_IDS.redo);
      expect(mockResetStep).toHaveBeenCalledWith('check-1', undefined);
    });
  });
});

describe('once completed', () => {
  beforeEach(async () => {
    mockStoredCompleted = true;
    mockStoredReason = 'manual';
  });

  it('collapses to a badge and hides the controls', async () => {
    await renderStep();
    expect(screen.getByText('Data available')).toBeInTheDocument();
    expect(screen.queryByTestId(TEST_IDS.run)).not.toBeInTheDocument();
  });

  it('says Skipped when that is how it completed', async () => {
    mockStoredReason = 'skipped';
    await renderStep();
    expect(screen.getByText('Skipped')).toBeInTheDocument();
  });

  it('keeps Redo clickable even though the checker is spent', async () => {
    mockCheckerEnabled = false;
    await renderStep();
    expect(screen.getByTestId(TEST_IDS.redo)).toBeEnabled();
  });

  it('clears its own store entry on Redo when standalone', async () => {
    await renderStep();
    await click(TEST_IDS.redo);
    expect(mockResetStep).toHaveBeenCalledWith('check-1', undefined);
  });

  it('routes Redo through the section when one owns the step', async () => {
    const onStepReset = jest.fn();
    await renderStep({ onStepComplete: jest.fn(), onStepReset });
    await click(TEST_IDS.redo);
    expect(onStepReset).toHaveBeenCalledWith('check-1');
    expect(mockResetStep).not.toHaveBeenCalled();
  });
});

describe('unmet requirements', () => {
  it('does not offer the picker', async () => {
    mockCheckerEnabled = false;
    await renderStep({ hints: 'Connect a data source first.' });
    expect(screen.queryByTestId(TEST_IDS.picker)).not.toBeInTheDocument();
    expect(screen.getByText('Connect a data source first.')).toBeInTheDocument();
  });
});
