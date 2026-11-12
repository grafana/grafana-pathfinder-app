import { mapPreviewContentUrl, parseSnapshotUrl, prPreviewContext, snapshotFileUrl } from './pr-preview-core';
import { withPrTestMarker } from './pr-test-marker';
import { getGuideResponseId } from './guide-response-id';

const snapshot = { owner: 'reviewer', repo: 'interactive-tutorials', sha: 'a'.repeat(40) };
const url = snapshotFileUrl(snapshot, 'demo/content.json');

it('preserves the legacy preview marker across repeated navigation', () => {
  expect(
    mapPreviewContentUrl(
      'https://interactive-learning.grafana.net/guides/demo/content.json',
      snapshot,
      'kiosklegacy123'
    )
  ).toBe(`${url}#pf-pr-kiosklegacy123`);
});

it('pins CDN aliases to the same repository snapshot and preserves external content', () => {
  for (const root of ['guides', 'packages']) {
    expect(
      mapPreviewContentUrl(`https://interactive-learning.grafana.net/${root}/demo/content.json`, snapshot, 'kiosk123')
    ).toBe(`${url}#pf-pr-${root === 'guides' ? 'kiosklegacy' : 'kiosk'}123`);
  }
  expect(mapPreviewContentUrl('https://grafana.com/docs/example/', snapshot, 'kiosk123')).toBe(
    'https://grafana.com/docs/example/#pf-pr-kiosk123'
  );
});
it('requires both an immutable snapshot and a kiosk preview marker', () => {
  expect(prPreviewContext(url)).toBeUndefined();
  expect(prPreviewContext(withPrTestMarker(url, 'ordinary'))).toBeUndefined();
  expect(prPreviewContext(withPrTestMarker(url, 'kiosk123'))).toEqual({
    ...snapshot,
    path: 'demo/content.json',
    fetchId: 'kiosk123',
  });
  expect(prPreviewContext(withPrTestMarker(url.replace(snapshot.sha, 'main'), 'kiosk123'))).toBeUndefined();
});
it.each(['../secret', 'a/../../b', 'x\\y', 'a/./b', '/root', 'a//b'])('rejects unsafe repository paths: %s', (path) => {
  expect(() => snapshotFileUrl(snapshot, path)).toThrow();
});
it('rejects encoded traversal and credentials', () => {
  expect(parseSnapshotUrl(url.replace('demo', '%2e%2e%2fsecret'))).toBeUndefined();
  expect(parseSnapshotUrl(url.replace('https://', 'https://user:pass@'))).toBeUndefined();
});
it('isolates answers per fetch while preserving normal storage identities', () => {
  expect(getGuideResponseId(url, 'https://example.com')).toBe(
    `reviewer-interactive-tutorials-${snapshot.sha}-demo-content.json`
  );
  expect(getGuideResponseId(withPrTestMarker(url, 'kiosk123'), 'https://example.com')).not.toBe(
    getGuideResponseId(url, 'https://example.com')
  );
  expect(getGuideResponseId(withPrTestMarker(url, 'kiosk123'), 'https://example.com')).not.toBe(
    getGuideResponseId(withPrTestMarker(url, 'kiosk456'), 'https://example.com')
  );
});
