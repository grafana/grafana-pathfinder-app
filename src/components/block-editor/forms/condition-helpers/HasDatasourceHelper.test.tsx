import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import { HasDatasourceHelper } from './HasDatasourceHelper';
import { mockDatasourceList, mockDatasourceListFailure } from '../../../../test-utils/datasource-list';

jest.mock('@grafana/runtime', () => ({
  ...jest.requireActual('@grafana/runtime'),
  ...require('../../../../test-utils/datasource-list').runtimeDatasourceSrvStub,
}));

const LIST = [
  { uid: 'grafana', name: '-- Grafana --', type: 'grafana', meta: { builtIn: true } },
  { uid: 'prom-1', name: 'Prod metrics', type: 'prometheus' },
  { uid: 'prom-2', name: 'Staging metrics', type: 'prometheus' },
  { uid: 'loki-1', name: 'Prod logs', type: 'loki' },
  { uid: 'mixed', name: '-- Mixed --', type: 'mixed', meta: { builtIn: true } },
];

function renderHelper(onChange = jest.fn()) {
  render(<HasDatasourceHelper value="" onChange={onChange} onSubmit={jest.fn()} testId="has-ds" />);
  return onChange;
}

it('offers each type once and each named instance, skipping built-in data sources', async () => {
  mockDatasourceList(LIST);
  const onChange = renderHelper();

  expect(await screen.findByText('By type (recommended — survives renames)')).toBeInTheDocument();
  expect(screen.getAllByText('prometheus')).toHaveLength(1);
  expect(screen.getByText('loki')).toBeInTheDocument();
  expect(screen.getByText('Prod metrics')).toBeInTheDocument();
  expect(screen.getByText('Staging metrics')).toBeInTheDocument();
  expect(screen.getByText('Prod logs')).toBeInTheDocument();
  for (const builtIn of ['grafana', 'mixed', '-- Grafana --', '-- Mixed --']) {
    expect(screen.queryByText(builtIn)).not.toBeInTheDocument();
  }

  fireEvent.click(screen.getByText('prometheus'));
  expect(onChange).toHaveBeenLastCalledWith('prometheus');
  fireEvent.click(screen.getByText('Prod logs'));
  expect(onChange).toHaveBeenLastCalledWith('Prod logs');
});

it('groups instance names under their type', async () => {
  mockDatasourceList(LIST);
  renderHelper();

  const prometheus = await screen.findByText('prometheus');
  fireEvent.mouseEnter(prometheus);
  expect(await screen.findByText('Match any of the 2 prometheus datasources you have configured')).toBeInTheDocument();
});

it('shows only the free-text input when the data source service fails', async () => {
  mockDatasourceListFailure();
  renderHelper();

  expect(await screen.findByTestId('has-ds')).toBeInTheDocument();
  expect(screen.queryByText('By type (recommended — survives renames)')).not.toBeInTheDocument();
  expect(screen.queryByText('Or by name (matches one specific datasource)')).not.toBeInTheDocument();
});
