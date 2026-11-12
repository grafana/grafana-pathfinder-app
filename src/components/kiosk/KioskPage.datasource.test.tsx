import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { KioskPage } from './KioskPage';
import { prepareKioskInputs } from './prepare-kiosk-inputs';
import { holdDatasourceList, mockDatasourceList, type ListedDatasource } from '../../test-utils/datasource-list';
import type { KioskPage as Page } from '../../types/kiosk-page.schema';

jest.mock(
  '@grafana/plugin-compat/datasources',
  () => require('../../test-utils/datasource-list').pluginCompatDatasourcesStub
);
jest.mock('@grafana/ui', () => ({
  ...jest.requireActual('@grafana/ui'),
  Combobox: require('../../test-utils/data-check-stubs').grafanaUiStub.Combobox,
}));
jest.mock('../../lib/retry-chunk-import', () => ({
  retryChunkImport: jest.fn((load: () => Promise<unknown>) => load()),
}));
jest.mock('../../lib/logging', () => ({ logger: { error: jest.fn(), warn: jest.fn(), exception: jest.fn() } }));
jest.mock('./prepare-kiosk-inputs', () => ({ prepareKioskInputs: jest.fn() }));
jest.mock('./launch-kiosk-guide', () => ({ launchKioskGuide: jest.fn() }));
jest.mock('./KioskTile', () => ({ KioskTile: () => null }));
jest.mock('../../lib/analytics', () => ({
  reportAppInteraction: jest.fn(),
  UserInteraction: { KioskInteraction: 'kiosk_interaction' },
}));

const page: Page = {
  version: 1,
  blocks: [
    {
      type: 'launch-form',
      ruleId: 'demo',
      label: 'Launch',
      inputs: [
        { inputType: 'datasource', variableName: 'metrics', prompt: 'Data source', datasourceFilter: 'prometheus' },
      ],
    },
  ],
};
const rules = [{ id: 'demo', title: 'Demo', url: 'bundled:welcome', description: '', type: 'guide' as const }];

const LIST: ListedDatasource[] = [
  { uid: 'prom-1', name: 'Prod metrics', type: 'prometheus' },
  { uid: 'amp-1', name: 'AWS metrics', type: 'grafana-amazonprometheus-datasource' },
  { uid: 'loki-1', name: 'Prod logs', type: 'loki' },
];

function offered(picker: HTMLElement) {
  return Array.from((picker as HTMLSelectElement).options)
    .map((option) => option.value)
    .filter(Boolean);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDatasourceList(LIST);
  jest.mocked(prepareKioskInputs).mockResolvedValue({} as Awaited<ReturnType<typeof prepareKioskInputs>>);
});

it('offers only data sources of the filtered type, valued by name, once the list arrives', async () => {
  const list = holdDatasourceList();
  render(<KioskPage page={page} rules={rules} mode="instance" onLaunch={jest.fn()} />);

  const picker = screen.getByRole('combobox');
  expect(picker).toBeDisabled();
  expect(picker).toHaveAttribute('aria-busy', 'true');
  expect(offered(picker)).toEqual([]);

  await act(async () => list.resolve(LIST));

  expect(picker).toBeEnabled();
  expect(picker).not.toHaveAttribute('aria-busy');
  expect(offered(picker)).toEqual(['Prod metrics', 'AWS metrics']);
});

it('submits the picked data source name with the form', async () => {
  render(<KioskPage page={page} rules={rules} mode="instance" onLaunch={jest.fn()} />);

  const picker = screen.getByRole('combobox');
  await waitFor(() => expect(picker).toBeEnabled());
  fireEvent.change(picker, { target: { value: 'AWS metrics' } });
  fireEvent.click(screen.getByRole('button', { name: 'Launch' }));

  await waitFor(() => expect(prepareKioskInputs).toHaveBeenCalled());
  expect(jest.mocked(prepareKioskInputs).mock.calls[0]![3]).toEqual({ metrics: 'AWS metrics' });
});
