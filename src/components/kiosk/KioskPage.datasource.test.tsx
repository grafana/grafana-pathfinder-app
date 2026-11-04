import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { KioskPage } from './KioskPage';
import { prepareKioskInputs } from './prepare-kiosk-inputs';
import { mockDatasourceList } from '../../test-utils/datasource-list';
import type { KioskPage as Page } from '../../types/kiosk-page.schema';

jest.mock('@grafana/runtime', () => ({
  ...jest.requireActual('@grafana/runtime'),
  ...require('../../test-utils/datasource-list').runtimeDatasourceSrvStub,
}));
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

beforeEach(() => {
  jest.clearAllMocks();
  mockDatasourceList([
    { uid: 'prom-1', name: 'Prod metrics', type: 'prometheus' },
    { uid: 'amp-1', name: 'AWS metrics', type: 'grafana-amazonprometheus-datasource' },
    { uid: 'loki-1', name: 'Prod logs', type: 'loki' },
  ]);
  jest.mocked(prepareKioskInputs).mockResolvedValue({} as Awaited<ReturnType<typeof prepareKioskInputs>>);
});

it('offers only data sources of the filtered type, valued by name', async () => {
  render(<KioskPage page={page} rules={rules} mode="instance" onLaunch={jest.fn()} />);

  const picker = await screen.findByRole('combobox');
  const offered = Array.from((picker as HTMLSelectElement).options)
    .map((option) => option.value)
    .filter(Boolean);
  expect(offered).toEqual(['Prod metrics', 'AWS metrics']);
});

it('submits the picked data source name with the form', async () => {
  render(<KioskPage page={page} rules={rules} mode="instance" onLaunch={jest.fn()} />);

  fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'AWS metrics' } });
  fireEvent.click(screen.getByRole('button', { name: 'Launch' }));

  await waitFor(() => expect(prepareKioskInputs).toHaveBeenCalled());
  expect(jest.mocked(prepareKioskInputs).mock.calls[0]![3]).toEqual({ metrics: 'AWS metrics' });
});
