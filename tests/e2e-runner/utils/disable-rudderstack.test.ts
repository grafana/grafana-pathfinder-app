import { runInNewContext } from 'node:vm';

import { disableRudderstack } from './disable-rudderstack';

function createDocument() {
  const window: Record<string, unknown> = {};
  runInNewContext(`(${disableRudderstack.toString()})()`, { window });
  return window;
}

function assignBootData(window: Record<string, unknown>) {
  const bootData = {
    settings: {
      rudderstackWriteKey: 'synthetic-production-key',
      rudderstackDataPlaneUrl: 'https://analytics.example.com',
      appUrl: 'https://grafana.example.com',
    },
    user: { login: 'synthetic-e2e-user' },
  };
  window.grafanaBootData = bootData;
  return bootData;
}

describe('E2E RudderStack suppression', () => {
  it('clears credentials before Grafana can read assigned boot data', () => {
    const window = createDocument();
    expect(window.grafanaBootData).toBeUndefined();

    const bootData = assignBootData(window);

    expect(window.grafanaBootData).toBe(bootData);
    expect(bootData.settings).toEqual({
      rudderstackWriteKey: '',
      rudderstackDataPlaneUrl: '',
      appUrl: 'https://grafana.example.com',
    });
    expect(bootData.user).toEqual({ login: 'synthetic-e2e-user' });
  });

  it('suppresses subsequent boot-data assignments', () => {
    const window = createDocument();
    assignBootData(window);

    const replacement = assignBootData(window);

    expect(window.grafanaBootData).toBe(replacement);
    expect(replacement.settings.rudderstackWriteKey).toBe('');
    expect(replacement.settings.rudderstackDataPlaneUrl).toBe('');
  });

  it('works as a serialized init script in fresh documents', () => {
    for (let document = 0; document < 3; document++) {
      const bootData = assignBootData(createDocument());
      expect(bootData.settings.rudderstackWriteKey && bootData.settings.rudderstackDataPlaneUrl).toBeFalsy();
    }
  });
});
