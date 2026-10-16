/**
 * The bundled tier's `repository` stamp, isolated because it needs the sibling
 * manifest reader mocked at module scope.
 *
 * Every committed bundled manifest declares `repository: "bundled"`, so a test
 * against the real files cannot tell a stamp from an inheritance. This one
 * hands the tier a manifest claiming a repository it did not come from.
 */

jest.mock('../../lib/bundled-package-files', () => ({
  loadBundledManifest: jest.fn(),
}));

import { loadBundledManifest } from '../../lib/bundled-package-files';
import { fetchBundledInteractive } from './bundled';

describe('fetchBundledInteractive — repository stamp', () => {
  it.each(['bundled:welcome-to-grafana', 'bundled:welcome-to-grafana/content.json'])(
    'overrides a foreign manifest repository on %s',
    async (url) => {
      jest.mocked(loadBundledManifest).mockReturnValue({
        ok: true,
        data: { id: 'welcome-to-grafana', type: 'guide', repository: 'interactive-tutorials' },
      });

      const result = await fetchBundledInteractive(url);

      expect(result.content!.metadata.packageManifest!.repository).toBe('bundled');
    }
  );

  it('supplies the repository a manifest omits entirely', async () => {
    jest.mocked(loadBundledManifest).mockReturnValue({
      ok: true,
      data: { id: 'welcome-to-grafana', type: 'guide' },
    });

    const result = await fetchBundledInteractive('bundled:welcome-to-grafana');

    expect(result.content!.metadata.packageManifest!.repository).toBe('bundled');
  });

  it('stamps nothing when there is no sibling manifest to read', async () => {
    jest.mocked(loadBundledManifest).mockReturnValue({
      ok: false,
      error: { code: 'not-found', message: 'no manifest' },
    });

    const result = await fetchBundledInteractive('bundled:welcome-to-grafana');

    expect(result.content!.metadata.packageManifest).toBeUndefined();
  });
});
