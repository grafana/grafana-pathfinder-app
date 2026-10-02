import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { of, throwError } from 'rxjs';

import { TangeloIntegration } from './TangeloIntegration';
import { testIds } from '../../constants/testIds';

const fetchMock = jest.fn();

jest.mock('@grafana/runtime', () => ({
  ...jest.requireActual('@grafana/runtime'),
  getBackendSrv: () => ({ fetch: fetchMock }),
}));

function routeFetch(
  status: unknown,
  settings: unknown = { jsonData: { tutorialUrl: 'keep-me' }, enabled: true, pinned: true }
) {
  fetchMock.mockImplementation(({ url, method }: { url: string; method: string }) => {
    if (url.endsWith('/tangelo-integration/status')) {
      return status instanceof Error ? throwError(() => status) : of({ data: status });
    }
    if (url.endsWith('/settings') && method === 'GET') {
      return of({ data: settings });
    }
    return of({ data: {} });
  });
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe('TangeloIntegration', () => {
  it('is off unless jsonData switches it on', async () => {
    routeFetch({ credentialsPresent: false, enabled: false });
    render(<TangeloIntegration pluginId="grafana-pathfinder-app" enabled={false} />);
    expect(screen.getByTestId(testIds.appConfig.tangeloToggle)).not.toBeChecked();
    expect(await screen.findByText('Tangelo credentials are not provisioned')).toBeInTheDocument();
  });

  it('reports provisioned credentials from the backend', async () => {
    routeFetch({ credentialsPresent: true, enabled: true });
    render(<TangeloIntegration pluginId="grafana-pathfinder-app" enabled />);
    expect(screen.getByTestId(testIds.appConfig.tangeloToggle)).toBeChecked();
    expect(await screen.findByText('Tangelo credentials are provisioned for this stack')).toBeInTheDocument();
  });

  it('says it could not check when the status route fails', async () => {
    routeFetch(new Error('404'));
    render(<TangeloIntegration pluginId="grafana-pathfinder-app" enabled={false} />);
    expect(await screen.findByText('Could not check Tangelo credentials')).toBeInTheDocument();
  });

  it('saves only the switch, keeping the rest of jsonData and sending no secure fields', async () => {
    routeFetch({ credentialsPresent: true, enabled: false });
    render(<TangeloIntegration pluginId="grafana-pathfinder-app" enabled={false} />);
    fireEvent.click(screen.getByTestId(testIds.appConfig.tangeloToggle));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.objectContaining({ method: 'POST' })));
    const post = fetchMock.mock.calls.map(([req]) => req).find((req) => req.method === 'POST');
    expect(post.url).toBe('/api/plugins/grafana-pathfinder-app/settings');
    expect(post.data).toEqual({
      enabled: true,
      pinned: true,
      jsonData: { tutorialUrl: 'keep-me', tangeloCompletionEnabled: true },
    });
    expect(post.data).not.toHaveProperty('secureJsonData');
  });
});
