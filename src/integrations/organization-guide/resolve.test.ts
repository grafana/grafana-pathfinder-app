import { AppPlatformPackageResolver } from '../../package-engine';
import { inlineSnippetRefsInGuideWithStatus } from '../../snippet-engine';
import { resolveOrganizationGuide } from './resolve';

jest.mock('../../package-engine', () => ({ AppPlatformPackageResolver: jest.fn() }));
jest.mock('../../snippet-engine', () => ({ inlineSnippetRefsInGuideWithStatus: jest.fn() }));
const resolve = jest.fn();
const resource = {
  metadata: { name: 'resource-name' },
  spec: {
    id: 'stable-content-id',
    title: 'Welcome',
    schemaVersion: '1.0',
    status: 'published',
    manifest: { type: 'guide', id: 'untrusted', repository: 'untrusted' },
    blocks: [{ type: 'markdown', content: 'Hello' }],
  },
};
beforeEach(() => {
  jest.mocked(AppPlatformPackageResolver).mockImplementation(() => ({ resolve }));
  resolve.mockResolvedValue({ ok: true, contentUrl: 'backend-guide:resource-name', probedResource: resource });
  jest
    .mocked(inlineSnippetRefsInGuideWithStatus)
    .mockImplementation(async (guide) => ({ guide, unresolvedSnippetIds: [] }));
});

it('requires publication and preserves resource identity separately from authoritative completion identity', async () => {
  const guide = await resolveOrganizationGuide('resource-name');
  expect(resolve).toHaveBeenCalledWith('resource-name', { verifyPublished: true });
  expect(guide).toMatchObject({
    resourceName: 'resource-name',
    guideId: 'stable-content-id',
    url: 'backend-guide:resource-name',
  });
  expect(guide?.content.metadata.packageManifest).toMatchObject({
    id: 'stable-content-id',
    repository: 'app-platform',
  });
  expect(guide?.content.countingSource.kind).toBe('pre-inlining');
});

it.each(['unpublished', 'invalid', 'path', 'snippets', 'network'])(
  'does not prepare %s content for an unsolicited opening',
  async (reason) => {
    if (reason === 'unpublished') {
      resolve.mockResolvedValue({ ok: false });
    }
    if (reason === 'invalid') {
      resolve.mockResolvedValue({
        ok: true,
        contentUrl: 'backend-guide:resource-name',
        probedResource: { metadata: resource.metadata, spec: {} },
      });
    }
    if (reason === 'path') {
      resolve.mockResolvedValue({
        ok: true,
        contentUrl: 'backend-guide:resource-name',
        probedResource: { ...resource, spec: { ...resource.spec, manifest: { type: 'path' } } },
      });
    }
    if (reason === 'snippets') {
      jest
        .mocked(inlineSnippetRefsInGuideWithStatus)
        .mockImplementation(async (guide) => ({ guide, unresolvedSnippetIds: ['missing'] }));
    }
    if (reason === 'network') {
      resolve.mockRejectedValue(new Error('private guide title must not reach logs'));
    }
    expect(await resolveOrganizationGuide('resource-name')).toBeNull();
  }
);
