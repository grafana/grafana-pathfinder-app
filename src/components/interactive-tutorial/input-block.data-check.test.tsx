/**
 * The advisory half of the data check: a datasource picker that reports what it
 * found and stays passive. It must never write completion state — that is what
 * separates it from the blocking form, which is its own tracked step.
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { InputBlock } from './input-block';

const mockRunQuery = jest.fn();
const mockSetResponse = jest.fn();

jest.mock('@grafana/ui', () => require('../../test-utils/data-check-stubs').grafanaUiStub);

jest.mock('@grafana/runtime', () => ({
  getDataSourceSrv: () => ({ getList: () => require('../../test-utils/data-check-stubs').DATASOURCE_LIST }),
}));

jest.mock('../../lib/datasource/run-data-check-query', () => ({
  runDataCheckQuery: (...args: unknown[]) => mockRunQuery(...args),
}));

jest.mock('../../lib/logging', () => require('../../test-utils/data-check-stubs').loggerStub);

jest.mock('../../lib/analytics', () => require('../../test-utils/data-check-stubs').analyticsStub);

jest.mock('../../docs-retrieval', () => {
  const react = require('react');
  return {
    useGuideResponsesOptional: () => {
      const [stored, setStored] = react.useState(undefined);
      return {
        getResponse: () => stored,
        setResponse: (key: string, value: string) => {
          mockSetResponse(key, value);
          setStored(value);
        },
        deleteResponse: () => setStored(undefined),
        hasResponse: () => stored !== undefined,
        isLoading: false,
      };
    },
  };
});

const RUN = 'datasource-check-run-metricsDatasource';
const FAILURE = 'datasource-check-failure-metricsDatasource';

const baseProps = {
  prompt: 'Pick a data source.',
  inputType: 'datasource' as const,
  variableName: 'metricsDatasource',
  datasourceFilter: 'prometheus',
};

function renderPicker(props: Partial<React.ComponentProps<typeof InputBlock>> = {}) {
  return render(<InputBlock {...baseProps} {...props} />);
}

async function pick(name = 'Prometheus') {
  await act(async () => {
    fireEvent.change(screen.getByLabelText(/Select a data source/i), { target: { value: name } });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRunQuery.mockResolvedValue({ ok: true, hasData: true, seriesCount: 1, rowCount: 2 });
});

describe('a picker with no check configured', () => {
  it('offers no run button', () => {
    renderPicker();
    expect(screen.queryByTestId(RUN)).not.toBeInTheDocument();
  });

  it('runs no query', async () => {
    renderPicker();
    await pick();
    expect(mockRunQuery).not.toHaveBeenCalled();
  });
});

describe('an advisory check', () => {
  it('offers a run button, disabled until something is picked', () => {
    renderPicker({ dataCheckQuery: 'up' });
    expect(screen.getByTestId(RUN)).toBeDisabled();
  });

  it('runs nothing until the user asks', async () => {
    renderPicker({ dataCheckQuery: 'up' });
    await pick();
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it('queries the picked data source by uid and normalized type', async () => {
    renderPicker({ dataCheckQuery: 'up' });
    await pick('Prometheus staging');
    await act(async () => {
      fireEvent.click(screen.getByTestId(RUN));
    });
    expect(mockRunQuery).toHaveBeenCalledWith(
      expect.objectContaining({ datasourceUid: 'prom-2', datasourceType: 'prometheus', query: 'up' })
    );
  });

  it('confirms when the data is there', async () => {
    renderPicker({ dataCheckQuery: 'up' });
    await pick();
    await act(async () => {
      fireEvent.click(screen.getByTestId(RUN));
    });
    await waitFor(() => expect(screen.getByText('Data available')).toBeInTheDocument());
  });

  it("shows the author's message when it is not", async () => {
    mockRunQuery.mockResolvedValue({ ok: true, hasData: false, seriesCount: 0, rowCount: 0 });
    renderPicker({ dataCheckQuery: 'up', dataCheckFailureMessage: 'No container metrics here.' });
    await pick();
    await act(async () => {
      fireEvent.click(screen.getByTestId(RUN));
    });
    await waitFor(() => expect(screen.getByTestId(FAILURE)).toHaveTextContent('No container metrics here.'));
  });

  it('still lets the user save a failing pick — advisory never blocks', async () => {
    mockRunQuery.mockResolvedValue({ ok: true, hasData: false, seriesCount: 0, rowCount: 0 });
    renderPicker({ dataCheckQuery: 'up' });
    await pick();
    await act(async () => {
      fireEvent.click(screen.getByTestId(RUN));
    });
    await waitFor(() => expect(screen.getByTestId(FAILURE)).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByTestId('interactive-input-save-metricsDatasource'));
    });
    expect(mockSetResponse).toHaveBeenCalledWith('metricsDatasource', 'Prometheus');
  });

  it('clears a stale verdict when the user resets the input', async () => {
    mockRunQuery.mockResolvedValue({ ok: true, hasData: false, seriesCount: 0, rowCount: 0 });
    renderPicker({ dataCheckQuery: 'up' });
    await pick();
    await act(async () => {
      fireEvent.click(screen.getByTestId(RUN));
    });
    await waitFor(() => expect(screen.getByTestId(FAILURE)).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByTestId('interactive-input-save-metricsDatasource'));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('interactive-input-reset-metricsDatasource'));
    });
    expect(screen.queryByTestId(FAILURE)).not.toBeInTheDocument();
  });

  it('clears a stale verdict when the data source changes', async () => {
    mockRunQuery.mockResolvedValue({ ok: true, hasData: false, seriesCount: 0, rowCount: 0 });
    renderPicker({ dataCheckQuery: 'up' });
    await pick();
    await act(async () => {
      fireEvent.click(screen.getByTestId(RUN));
    });
    await waitFor(() => expect(screen.getByTestId(FAILURE)).toBeInTheDocument());

    await pick('Prometheus staging');
    expect(screen.queryByTestId(FAILURE)).not.toBeInTheDocument();
  });

  it("does not dress a failed query up in the author's no-data message", async () => {
    mockRunQuery.mockResolvedValue({ ok: false, error: 'Query timed out after 15s.' });
    renderPicker({ dataCheckQuery: 'up', dataCheckFailureMessage: 'No container metrics here.' });
    await pick();
    await act(async () => {
      fireEvent.click(screen.getByTestId(RUN));
    });

    await waitFor(() => expect(screen.getByTestId(FAILURE)).toBeInTheDocument());
    const failure = screen.getByTestId(FAILURE);
    expect(failure).toHaveTextContent('Query timed out after 15s.');
    expect(failure).not.toHaveTextContent('No container metrics here.');
  });

  it('says so rather than querying a data source type no check can read', async () => {
    renderPicker({ dataCheckQuery: 'up', datasourceFilter: 'mysql' });
    await pick('Reporting');
    expect(screen.getByRole('alert')).toHaveTextContent(/can't run here/i);
    expect(screen.queryByTestId(RUN)).not.toBeInTheDocument();
    expect(mockRunQuery).not.toHaveBeenCalled();
  });
});
