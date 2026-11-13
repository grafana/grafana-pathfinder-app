import { preparePrKiosk } from './pr-kiosk-preview';
import { fetchSnapshotJson } from '../../lib/pr-preview-fetch';
import event from '../../../docs/examples/kiosk/event-v2.json';

jest.mock('../../lib/pr-preview-fetch', () => ({ fetchSnapshotJson: jest.fn() }));
jest.mock('../../security/url-validator', () => ({
  isAllowedContentUrl: (url: string) => url.startsWith('https://interactive-learning.grafana.net/'),
  validateInternalNavigationPath: (value: string) => (value.startsWith('/') ? value : null),
  parseUrlSafely: (value: string) => {
    try {
      return new URL(value);
    } catch {
      return null;
    }
  },
  isLocalhostUrl: () => false,
}));
jest.mock('../../lib/logging', () => ({ logger: { warn: jest.fn() } }));
jest.mock('../../lib/telemetry', () => ({ recordKioskCatalogLoaded: jest.fn() }));
jest.mock('../../lib/analytics', () => ({ reportAppInteraction: jest.fn() }));
const rawUrl = `https://raw.githubusercontent.com/fork/tutorials/${'a'.repeat(40)}/kiosk/demo/rules.json`;

it('uses the selected snapshot and marks guides for isolated launches', async () => {
  jest.mocked(fetchSnapshotJson).mockResolvedValue(event);
  const result = await preparePrKiosk(rawUrl, '123', new AbortController().signal);
  expect(result.data.catalogUrl).toBe(rawUrl);
  expect(result.data.rules[0]).toEqual(
    expect.objectContaining({
      preview: true,
      url: `https://raw.githubusercontent.com/fork/tutorials/${'a'.repeat(40)}/welcome-to-grafana/content.json#pf-pr-kiosk123`,
    })
  );
});
it('rejects malformed catalogs instead of loading a fallback', async () => {
  jest.mocked(fetchSnapshotJson).mockResolvedValue({ ...event, page: { version: 99 } });
  await expect(preparePrKiosk(rawUrl, '123', new AbortController().signal)).rejects.toThrow();
  jest.mocked(fetchSnapshotJson).mockRejectedValue(new Error('HTTP 404'));
  await expect(preparePrKiosk(rawUrl, '123', new AbortController().signal)).rejects.toThrow('404');
});
it('does not return stale data after cancellation', async () => {
  const controller = new AbortController();
  jest.mocked(fetchSnapshotJson).mockImplementation(async () => {
    controller.abort();
    return event;
  });
  await expect(preparePrKiosk(rawUrl, '123', controller.signal)).rejects.toThrow();
});
