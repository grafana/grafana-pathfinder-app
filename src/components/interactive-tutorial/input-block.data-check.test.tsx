/**
 * The advisory half of the data check: a datasource picker that reports what it
 * found and stays passive. It must never write completion state — that is what
 * separates it from the blocking form, which is its own tracked step.
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { StorageEvents } from '../../lib/event-names';
import { InputBlock } from './input-block';
import { holdDatasourceList, mockDatasourceList, settleDatasourceList } from '../../test-utils/datasource-list';
import { DATASOURCE_LIST } from '../../test-utils/data-check-stubs';

const mockRunQuery = jest.fn();
const mockSetResponse = jest.fn();

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

// `mockOtherWriters` stands in for everything else that can own the same
// variable — the blocking step, a `{{var}}` write, a guide clear.
let mockOtherWriters: Array<(value: string | undefined) => void> = [];

jest.mock('../../docs-retrieval', () => {
  const react = require('react');
  return {
    useGuideResponsesOptional: () => {
      const [stored, setStored] = react.useState(undefined);
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
        deleteResponse: () => setStored(undefined),
        hasResponse: () => stored !== undefined,
        isLoading: false,
      };
    },
  };
});

beforeEach(() => mockDatasourceList(DATASOURCE_LIST));

const RUN = 'input-data-check-run-metricsDatasource';
const FAILURE = 'input-data-check-failure-metricsDatasource';

const baseProps = {
  prompt: 'Pick a data source.',
  inputType: 'datasource' as const,
  variableName: 'metricsDatasource',
  datasourceFilter: 'prometheus',
};

async function renderPicker(props: Partial<React.ComponentProps<typeof InputBlock>> = {}) {
  const view = render(<InputBlock {...baseProps} {...props} />);
  await settleDatasourceList();
  return view;
}

async function pick(name = 'Prometheus') {
  await act(async () => {
    fireEvent.change(screen.getByLabelText(/Select a data source/i), { target: { value: name } });
  });
}

/** Someone other than this picker writes the variable it reads. */
async function writeVariableElsewhere(value: string | undefined) {
  await act(async () => {
    mockOtherWriters.forEach((writer) => writer(value));
    window.dispatchEvent(
      new CustomEvent(StorageEvents.GuideResponseChanged, {
        detail: { variableName: baseProps.variableName, value },
      })
    );
  });
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockOtherWriters = [];
  mockRunQuery.mockResolvedValue({ ok: true, hasData: true, seriesCount: 1, rowCount: 2 });
});

describe('a picker with no check configured', () => {
  it('offers no run button', async () => {
    await renderPicker();
    expect(screen.queryByTestId(RUN)).not.toBeInTheDocument();
  });

  it('runs no query', async () => {
    await renderPicker();
    await pick();
    expect(mockRunQuery).not.toHaveBeenCalled();
  });
});

describe('an advisory check', () => {
  it('offers a run button, disabled until something is picked', async () => {
    await renderPicker({ dataCheckQuery: 'up' });
    expect(screen.getByTestId(RUN)).toBeDisabled();
  });

  it('runs nothing until the user asks', async () => {
    await renderPicker({ dataCheckQuery: 'up' });
    await pick();
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it('queries the picked data source by uid and normalized type', async () => {
    await renderPicker({ dataCheckQuery: 'up' });
    await pick('Prometheus staging');
    await act(async () => {
      fireEvent.click(screen.getByTestId(RUN));
    });
    expect(mockRunQuery).toHaveBeenCalledWith(
      expect.objectContaining({ datasourceUid: 'prom-2', datasourceType: 'prometheus', query: 'up' })
    );
  });

  it('confirms when the data is there', async () => {
    await renderPicker({ dataCheckQuery: 'up' });
    await pick();
    await act(async () => {
      fireEvent.click(screen.getByTestId(RUN));
    });
    await waitFor(() => expect(screen.getByText('Data available')).toBeInTheDocument());
  });

  it("shows the author's message when it is not", async () => {
    mockRunQuery.mockResolvedValue({ ok: true, hasData: false, seriesCount: 0, rowCount: 0 });
    await renderPicker({ dataCheckQuery: 'up', dataCheckFailureMessage: 'No container metrics here.' });
    await pick();
    await act(async () => {
      fireEvent.click(screen.getByTestId(RUN));
    });
    await waitFor(() => expect(screen.getByTestId(FAILURE)).toHaveTextContent('No container metrics here.'));
  });

  it('still lets the user save a failing pick — advisory never blocks', async () => {
    mockRunQuery.mockResolvedValue({ ok: true, hasData: false, seriesCount: 0, rowCount: 0 });
    await renderPicker({ dataCheckQuery: 'up' });
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
    await renderPicker({ dataCheckQuery: 'up' });
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
    await renderPicker({ dataCheckQuery: 'up' });
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
    await renderPicker({ dataCheckQuery: 'up', dataCheckFailureMessage: 'No container metrics here.' });
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
    await renderPicker({ dataCheckQuery: 'up', datasourceFilter: 'mysql' });
    await pick('Reporting');
    expect(screen.getByRole('alert')).toHaveTextContent(/can't run here/i);
    expect(screen.queryByTestId(RUN)).not.toBeInTheDocument();
    expect(mockRunQuery).not.toHaveBeenCalled();
  });
});

describe('while a check is still running', () => {
  beforeEach(async () => {
    mockRunQuery.mockImplementation(() => new Promise(() => {}));
    await renderPicker({ dataCheckQuery: 'up' });
    await pick();
    await act(async () => {
      fireEvent.click(screen.getByTestId(RUN));
    });
  });

  it('says so, and refuses a second press until the first lands', async () => {
    expect(screen.getByText('Checking your data…')).toBeInTheDocument();
    expect(screen.getByTestId(RUN)).toBeDisabled();
  });

  it('issues exactly one query however many times the button is pressed', async () => {
    await act(async () => {
      fireEvent.click(screen.getByTestId(RUN));
      fireEvent.click(screen.getByTestId(RUN));
    });
    expect(mockRunQuery).toHaveBeenCalledTimes(1);
  });
});

// The blocking step is the other writer this pairing ships with, so a verdict
// here can be invalidated without this block's own handler ever running.
describe('a data source swapped by someone else', () => {
  it('drops a pass rather than reporting it against the new pick', async () => {
    await renderPicker({ dataCheckQuery: 'up' });
    await pick();
    await act(async () => {
      fireEvent.click(screen.getByTestId(RUN));
    });
    await waitFor(() => expect(screen.getByText('Data available')).toBeInTheDocument());

    await writeVariableElsewhere('Prometheus staging');
    expect(screen.queryByText('Data available')).not.toBeInTheDocument();
  });

  it('drops a failure rather than blaming it on the new pick', async () => {
    mockRunQuery.mockResolvedValue({ ok: true, hasData: false, seriesCount: 0, rowCount: 0 });
    await renderPicker({ dataCheckQuery: 'up', dataCheckFailureMessage: 'No container metrics here.' });
    await pick();
    await act(async () => {
      fireEvent.click(screen.getByTestId(RUN));
    });
    await waitFor(() => expect(screen.getByTestId(FAILURE)).toBeInTheDocument());

    await writeVariableElsewhere('Prometheus staging');
    expect(screen.queryByTestId(FAILURE)).not.toBeInTheDocument();
  });

  it('drops a pass when a guide clear empties the picker', async () => {
    await renderPicker({ dataCheckQuery: 'up' });
    await pick();
    await act(async () => {
      fireEvent.click(screen.getByTestId(RUN));
    });
    await waitFor(() => expect(screen.getByText('Data available')).toBeInTheDocument());

    await writeVariableElsewhere(undefined);
    expect(screen.queryByText('Data available')).not.toBeInTheDocument();
  });
});

describe('while the data source list is still loading', () => {
  const picker = () => screen.getByLabelText(/Select a data source/i);

  it('shows the pick in a busy, disabled picker and keeps it once the list arrives', async () => {
    const list = holdDatasourceList();
    render(<InputBlock {...baseProps} dataCheckQuery="up" defaultValue="Prometheus staging" />);

    expect(picker()).toHaveValue('Prometheus staging');
    expect(picker()).toBeDisabled();
    expect(picker()).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByTestId(RUN)).toBeDisabled();

    await act(async () => list.resolve(DATASOURCE_LIST));

    expect(picker()).toHaveValue('Prometheus staging');
    expect(picker()).toBeEnabled();
    expect(screen.getByTestId(RUN)).toBeEnabled();
  });

  it('refuses to check a pick the arrived list lacks', async () => {
    const list = holdDatasourceList();
    render(<InputBlock {...baseProps} dataCheckQuery="up" defaultValue="Deleted data source" />);

    await act(async () => list.resolve(DATASOURCE_LIST));

    expect(screen.getByTestId(RUN)).toBeDisabled();
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it('warns that nothing matches only after the list arrives', async () => {
    const list = holdDatasourceList();
    render(<InputBlock {...baseProps} datasourceFilter="elasticsearch" />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await act(async () => list.resolve(DATASOURCE_LIST));

    expect(screen.getByRole('alert')).toHaveTextContent(/No data sources/i);
  });
});
