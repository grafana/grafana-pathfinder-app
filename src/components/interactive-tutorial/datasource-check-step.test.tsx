/**
 * Tests for DatasourceCheckStep — the datasource picker when its author asked a
 * failing check to block.
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { DatasourceCheckStep } from './datasource-check-step';

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

jest.mock('@grafana/runtime', () => ({
  getDataSourceSrv: () => ({ getList: () => require('../../test-utils/data-check-stubs').DATASOURCE_LIST }),
}));

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
// the stored pick would ever see it.
jest.mock('../../docs-retrieval', () => {
  const react = require('react');
  return {
    useGuideResponsesOptional: () => {
      const [stored, setStored] = react.useState(() => mockStoredResponse);
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
  variableName: 'metricsDatasource',
  query: 'up',
  datasourceFilter: 'prometheus',
};

function renderStep(props: Partial<React.ComponentProps<typeof DatasourceCheckStep>> = {}) {
  return render(<DatasourceCheckStep {...baseProps} {...props} />);
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

const hasData = { ok: true, hasData: true, seriesCount: 1, rowCount: 3 };
const noData = { ok: true, hasData: false, seriesCount: 0, rowCount: 0 };

beforeEach(() => {
  jest.clearAllMocks();
  mockCheckerEnabled = true;
  mockStoredCompleted = false;
  mockStoredReason = null;
  mockStoredResponse = undefined;
  mockRunQuery.mockResolvedValue(hasData);
});

describe('the premise: a check only runs when the user asks', () => {
  it('runs nothing on mount', () => {
    renderStep();
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it('runs nothing on picking a data source', async () => {
    renderStep();
    await pick();
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it('runs nothing on a re-render', async () => {
    const { rerender } = renderStep();
    await pick();
    rerender(<DatasourceCheckStep {...baseProps} />);
    expect(mockRunQuery).not.toHaveBeenCalled();
  });
});

describe('the picker', () => {
  it('offers only data sources the filter matches', () => {
    renderStep();
    const options = screen.getByLabelText(/Select a data source/i).querySelectorAll('option');
    const labels = Array.from(options).map((o) => o.textContent);
    expect(labels).toContain('Prometheus');
    expect(labels).toContain('Prometheus staging');
    expect(labels).not.toContain('Loki');
    expect(labels).not.toContain('Reporting');
  });

  it('offers every data source when the author set no filter', () => {
    renderStep({ datasourceFilter: undefined });
    const labels = Array.from(screen.getByLabelText(/Select a data source/i).querySelectorAll('option')).map(
      (o) => o.textContent
    );
    expect(labels).toContain('Loki');
    expect(labels).toContain('Reporting');
  });

  it('stores the name, not the uid, so {{variable}} substitution still works', async () => {
    renderStep();
    await pick();
    expect(mockSetResponse).toHaveBeenCalledWith('metricsDatasource', 'Prometheus');
  });

  it('stores under the authored variable name', async () => {
    renderStep({ variableName: 'myDatasource' });
    await pick();
    expect(mockSetResponse).toHaveBeenCalledWith('myDatasource', 'Prometheus');
  });

  it('clears the stored pick when the user clears the picker', async () => {
    mockStoredResponse = 'Prometheus';
    renderStep();
    await pick('');
    expect(mockDeleteResponse).toHaveBeenCalledWith('metricsDatasource');
  });

  it('restores a remembered pick', () => {
    mockStoredResponse = 'Prometheus staging';
    renderStep();
    expect(screen.getByLabelText(/Select a data source/i)).toHaveValue('Prometheus staging');
  });

  // A `<select>` cannot hold a value that is not among its options, so asserting
  // on the rendered value alone would pass even with the guard removed. What has
  // to hold is that no check can run against a pick the picker never offered.
  it('refuses to run against a remembered pick that no longer exists', async () => {
    mockStoredResponse = 'Deleted data source';
    renderStep();
    expect(screen.getByTestId(TEST_IDS.run)).toBeDisabled();
    await click(TEST_IDS.run);
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it('refuses to run against a remembered pick the filter no longer offers', async () => {
    mockStoredResponse = 'Loki';
    renderStep({ datasourceFilter: 'prometheus' });
    expect(screen.getByLabelText(/Select a data source/i)).toHaveValue('');
    expect(screen.getByTestId(TEST_IDS.run)).toBeDisabled();
    await click(TEST_IDS.run);
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it('does not delete a remembered pick it cannot currently offer', () => {
    // A transient empty getList() would otherwise destroy a valid pick for good.
    mockStoredResponse = 'Deleted data source';
    renderStep();
    expect(mockDeleteResponse).not.toHaveBeenCalled();
  });

  it('warns instead of offering an empty picker when nothing matches', () => {
    renderStep({ datasourceFilter: 'elasticsearch' });
    expect(screen.getByRole('alert')).toHaveTextContent(/No data sources/i);
    expect(screen.queryByTestId(TEST_IDS.run)).not.toBeInTheDocument();
  });

  it('keeps Run disabled until something is picked', () => {
    renderStep();
    expect(screen.getByTestId(TEST_IDS.run)).toBeDisabled();
  });
});

describe('a data source type no check can query', () => {
  it('says so instead of offering a run button', async () => {
    renderStep({ datasourceFilter: 'mysql' });
    await pick('Reporting');
    expect(screen.getByRole('alert')).toHaveTextContent(/can't run here/i);
    expect(screen.queryByTestId(TEST_IDS.run)).not.toBeInTheDocument();
  });

  it('issues no query', async () => {
    renderStep({ datasourceFilter: 'mysql' });
    await pick('Reporting');
    expect(mockRunQuery).not.toHaveBeenCalled();
  });
});

describe('running the check', () => {
  it('completes the step when the query returns data', async () => {
    renderStep();
    await pick();
    await click(TEST_IDS.run);
    await waitFor(() => expect(mockMarkStepCompleted).toHaveBeenCalledWith('check-1', undefined, 'manual'));
  });

  it('queries the picked data source by uid and normalized type', async () => {
    renderStep();
    await pick('Prometheus staging');
    await click(TEST_IDS.run);
    expect(mockRunQuery).toHaveBeenCalledWith(
      expect.objectContaining({ datasourceUid: 'prom-2', datasourceType: 'prometheus', query: 'up' })
    );
  });

  it('passes the authored time range through', async () => {
    renderStep({ timeFrom: 'now-6h', timeTo: 'now-1h' });
    await pick();
    await click(TEST_IDS.run);
    expect(mockRunQuery).toHaveBeenCalledWith(expect.objectContaining({ from: 'now-6h', to: 'now-1h' }));
  });

  it('holds the step incomplete when the query returns nothing', async () => {
    mockRunQuery.mockResolvedValue(noData);
    renderStep();
    await pick();
    await click(TEST_IDS.run);
    await waitFor(() => expect(screen.getByTestId(TEST_IDS.failure)).toBeInTheDocument());
    expect(mockMarkStepCompleted).not.toHaveBeenCalled();
  });

  it("shows the author's failure message when the query returns nothing", async () => {
    mockRunQuery.mockResolvedValue(noData);
    renderStep({ failureMessage: 'No container metrics here.' });
    await pick();
    await click(TEST_IDS.run);
    await waitFor(() => expect(screen.getByTestId(TEST_IDS.failure)).toHaveTextContent('No container metrics here.'));
  });

  it("surfaces the data source's own error when there is no authored message", async () => {
    mockRunQuery.mockResolvedValue({ ok: false, error: 'parse error at line 1' });
    renderStep();
    await pick();
    await click(TEST_IDS.run);
    await waitFor(() => expect(screen.getByTestId(TEST_IDS.failure)).toHaveTextContent('parse error at line 1'));
  });

  it('offers another attempt after a failure', async () => {
    mockRunQuery.mockResolvedValue(noData);
    renderStep();
    await pick();
    await click(TEST_IDS.run);
    await waitFor(() => expect(screen.getByTestId(TEST_IDS.run)).toHaveTextContent(/Run check again/i));
  });

  it('reports the outcome without leaking the query or the data source name', async () => {
    const { reportAppInteraction } = require('../../lib/analytics');
    renderStep();
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
    renderStep();
    await pick();
    await click(TEST_IDS.run);
    await waitFor(() => expect(screen.getByTestId(TEST_IDS.failure)).toBeInTheDocument());

    await pick('Prometheus staging');
    expect(screen.queryByTestId(TEST_IDS.failure)).not.toBeInTheDocument();
  });

  it('resets completion, so a green check never stands against a data source the user left', async () => {
    renderStep();
    await pick();
    await pick('Prometheus staging');
    expect(mockResetStep).toHaveBeenCalledWith('check-1', undefined);
  });
});

describe('a section reset', () => {
  it('clears the verdict but keeps the pick', async () => {
    mockRunQuery.mockResolvedValue(noData);
    const { rerender } = renderStep({ resetTrigger: 0 });
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
    const { rerender } = renderStep({ resetTrigger: 0, onStepComplete: jest.fn() });
    await act(async () => {
      rerender(<DatasourceCheckStep {...baseProps} resetTrigger={1} onStepComplete={jest.fn()} />);
    });
    expect(mockCheckerResetStep).toHaveBeenCalledWith({ skipStoreWrite: true });
  });
});

describe('skipping', () => {
  it('offers no way out by default', () => {
    renderStep();
    expect(screen.queryByTestId(TEST_IDS.skip)).not.toBeInTheDocument();
  });

  it('records a skip as skipped, not as a check the user passed', async () => {
    renderStep({ skippable: true });
    await click(TEST_IDS.skip);
    expect(mockMarkStepCompleted).toHaveBeenCalledWith('check-1', undefined, 'skipped');
  });

  it('is offered when no data source of the authored type exists', () => {
    renderStep({ datasourceFilter: 'elasticsearch', skippable: true });
    expect(screen.getByTestId(TEST_IDS.skip)).toBeInTheDocument();
  });
});

describe('once completed', () => {
  beforeEach(() => {
    mockStoredCompleted = true;
    mockStoredReason = 'manual';
  });

  it('collapses to a badge and hides the controls', () => {
    renderStep();
    expect(screen.getByText('Data available')).toBeInTheDocument();
    expect(screen.queryByTestId(TEST_IDS.run)).not.toBeInTheDocument();
  });

  it('says Skipped when that is how it completed', () => {
    mockStoredReason = 'skipped';
    renderStep();
    expect(screen.getByText('Skipped')).toBeInTheDocument();
  });

  it('keeps Redo clickable even though the checker is spent', () => {
    mockCheckerEnabled = false;
    renderStep();
    expect(screen.getByTestId(TEST_IDS.redo)).toBeEnabled();
  });

  it('clears its own store entry on Redo when standalone', async () => {
    renderStep();
    await click(TEST_IDS.redo);
    expect(mockResetStep).toHaveBeenCalledWith('check-1', undefined);
  });

  it('routes Redo through the section when one owns the step', async () => {
    const onStepReset = jest.fn();
    renderStep({ onStepComplete: jest.fn(), onStepReset });
    await click(TEST_IDS.redo);
    expect(onStepReset).toHaveBeenCalledWith('check-1');
    expect(mockResetStep).not.toHaveBeenCalled();
  });
});

describe('unmet requirements', () => {
  it('does not offer the picker', () => {
    mockCheckerEnabled = false;
    renderStep({ hints: 'Connect a data source first.' });
    expect(screen.queryByTestId(TEST_IDS.picker)).not.toBeInTheDocument();
    expect(screen.getByText('Connect a data source first.')).toBeInTheDocument();
  });
});
