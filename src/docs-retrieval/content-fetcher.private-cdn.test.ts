import { fetchPrivateCDNContent, PRIVATE_CDN_REF } from '../lib/private-cdn-client';
import { fetchContent } from './content-fetcher';
import { resolveSurfaceCompletionIdentity } from './learning-journey-helpers';

jest.mock('../lib/private-cdn-client', () => ({
  PRIVATE_CDN_GUIDE: 'builders-observability-foundations',
  PRIVATE_CDN_REF: 'private-cdn:builders-observability-foundations',
  fetchPrivateCDNContent: jest.fn(),
}));

beforeEach(() => {
  jest.mocked(fetchPrivateCDNContent).mockReset();
});

it('loads the private guide with a stable source identity and no signed URL in content state', async () => {
  jest
    .mocked(fetchPrivateCDNContent)
    .mockResolvedValue(
      JSON.stringify({ id: 'builders-observability-foundations', title: 'Synthetic guide', blocks: [] })
    );
  const result = await fetchContent(PRIVATE_CDN_REF);
  expect(result.content).toMatchObject({
    type: 'interactive',
    url: PRIVATE_CDN_REF,
    metadata: {
      title: 'Synthetic guide',
      repository: 'private-cdn',
      packageManifest: { id: 'builders-observability-foundations', type: 'guide', repository: 'private-cdn' },
    },
  });
  expect(JSON.stringify(result)).not.toContain('https://interactive-learning-private');
  expect(
    resolveSurfaceCompletionIdentity({
      baseUrl: PRIVATE_CDN_REF,
      currentUrl: PRIVATE_CDN_REF,
      contentUrl: result.content?.url,
      metadata: result.content?.metadata,
    })
  ).toMatchObject({ guideId: 'builders-observability-foundations', guideSource: 'private-cdn' });
});

it('does not fall back to another guide when the signed asset cannot be read', async () => {
  jest.mocked(fetchPrivateCDNContent).mockRejectedValue(new Error('Unavailable'));
  const result = await fetchContent(PRIVATE_CDN_REF);
  expect(result.content).toBeNull();
  expect(result.diagnostic).toMatchObject({ stage: 'fetch', reason: 'backend-unavailable' });
});

it('rejects content with a different guide identity', async () => {
  jest.mocked(fetchPrivateCDNContent).mockResolvedValue(JSON.stringify({ id: 'other', title: 'Other', blocks: [] }));
  const result = await fetchContent(PRIVATE_CDN_REF);
  expect(result.content).toBeNull();
});
