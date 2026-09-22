import type { LearningJourneyTab } from '../../../types/content-panel.types';
import type { JsonGuide } from '../../../types/json-guide.types';
import type { SnippetResolver } from '../../../snippet-engine/types';
import { canCopyPublicGuide } from './private-guide-eligibility';
import { preparePrivateGuideCopy } from './private-guide-copy';

const guide: JsonGuide = {
  id: 'public-guide',
  title: 'Public guide',
  blocks: [{ type: 'markdown', content: 'Original content' }],
};

function tab(overrides: Partial<LearningJourneyTab> = {}): LearningJourneyTab {
  const url = 'https://grafana.com/docs/interactive/demo/content.json';
  return {
    id: 'public',
    type: 'docs',
    title: guide.title,
    baseUrl: url,
    currentUrl: url,
    isLoading: false,
    error: null,
    content: {
      content: JSON.stringify(guide),
      url,
      metadata: { title: guide.title },
      isNativeJson: true,
      type: 'interactive',
      lastFetched: '',
    },
    ...overrides,
  };
}

describe('public guide copy', () => {
  it('allows standalone public JSON guides only for admins', () => {
    expect(canCopyPublicGuide(tab(), true)).toBe(true);
    expect(canCopyPublicGuide(tab(), false)).toBe(false);
    const bundled = tab();
    bundled.baseUrl = bundled.currentUrl = bundled.content!.url = 'bundled:welcome-to-grafana/content.json';
    expect(canCopyPublicGuide(bundled, true)).toBe(true);
  });

  it.each(['learning-journey', 'editor', 'devtools', 'recommendations'] as const)('excludes %s tabs', (type) => {
    expect(canCopyPublicGuide(tab({ type }), true)).toBe(false);
  });

  it.each(['path', 'journey'])('excludes %s metadata on JSON guide tabs', (type) => {
    const source = tab();
    expect(canCopyPublicGuide({ ...source, packageInfo: { packageManifest: { type } } }, true)).toBe(false);
    source.content!.metadata.packageManifest = { type };
    expect(canCopyPublicGuide(source, true)).toBe(false);
  });

  it('excludes milestones, loading, errors, HTML-derived guides and private sources', () => {
    expect(canCopyPublicGuide(tab({ pathContext: {} as LearningJourneyTab['pathContext'] }), true)).toBe(false);
    expect(canCopyPublicGuide(tab({ isLoading: true }), true)).toBe(false);
    expect(canCopyPublicGuide(tab({ error: 'failed' }), true)).toBe(false);
    expect(canCopyPublicGuide(tab({ packageInfo: { repository: 'app-platform' } }), true)).toBe(false);
    const source = tab();
    source.content!.isNativeJson = false;
    expect(canCopyPublicGuide(source, true)).toBe(false);
  });

  it.each([
    'backend-guide:private',
    'block-editor://preview/test',
    'bundled:wysiwyg-preview',
    'bundled:e2e-test',
    'https://grafana.com/docs/learning-journeys/demo/content.json',
    'https://grafana.com/docs/learning-paths/demo/milestone-1/content.json',
  ])('excludes source URL %s', (url) => {
    expect(canCopyPublicGuide(tab({ currentUrl: url }), true)).toBe(false);
  });

  it('creates independent identities without changing the original', async () => {
    const source = tab();
    const original = JSON.stringify(source);
    const first = await preparePrivateGuideCopy(source);
    const second = await preparePrivateGuideCopy(source);
    expect(first.id).toMatch(/^private-[a-f0-9-]+$/);
    expect(first.id).not.toBe(second.id);
    expect(first.title).toBe('Public guide (copy)');
    expect(first.blocks).toEqual(guide.blocks);
    first.blocks.push({ type: 'divider' });
    expect(JSON.stringify(source)).toBe(original);
  });

  it('expands nested shared content from the original tree instead of copying failure placeholders', async () => {
    const source = tab();
    const original: JsonGuide = {
      ...guide,
      blocks: [{ type: 'section', title: 'Shared', blocks: [{ type: 'snippet-ref', snippetId: 'shared' }] }],
    };
    source.content!.countingSource = { kind: 'pre-inlining', guideJson: JSON.stringify(original) };
    const resolver: SnippetResolver = {
      resolve: jest.fn().mockResolvedValue({
        ok: true,
        id: 'shared',
        source: 'online-cdn',
        snippet: { id: 'shared', title: 'Shared', description: '', blocks: guide.blocks },
      }),
    };
    const copied = await preparePrivateGuideCopy(source, resolver);
    expect(copied.blocks).toEqual([{ type: 'section', title: 'Shared', blocks: guide.blocks }]);
    expect(resolver.resolve).toHaveBeenCalledWith('shared');
    resolver.resolve = jest.fn().mockResolvedValue({ ok: false, id: 'shared', error: { code: 'network-error' } });
    await expect(preparePrivateGuideCopy(source, resolver)).rejects.toThrow('shared content could not be loaded');
  });

  it('rejects unavailable original content and malformed JSON', async () => {
    const source = tab();
    source.content!.content = '{ invalid';
    await expect(preparePrivateGuideCopy(source)).rejects.toThrow('could not be imported');
    source.content!.countingSource = { kind: 'unavailable' };
    await expect(preparePrivateGuideCopy(source)).rejects.toThrow('original content is unavailable');
  });
});
