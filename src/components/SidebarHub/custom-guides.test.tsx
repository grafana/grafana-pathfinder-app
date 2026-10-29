import { reportAppInteraction, UserInteraction } from '../../lib/analytics';
import type { ResolvedAssignment } from '../../types/learning-paths.types';
import type { PublishedGuide } from '../../utils/usePublishedGuides';
import { toHubCustomGuides } from './custom-guides';

jest.mock('../../lib/analytics', () => ({
  ...jest.requireActual('../../lib/analytics'),
  reportAppInteraction: jest.fn(),
}));

const guide = (id: string, extra: Partial<PublishedGuide> = {}): PublishedGuide => ({
  id,
  title: `Guide ${id}`,
  status: 'published',
  manifest: { type: 'guide' } as PublishedGuide['manifest'],
  ...extra,
});

const path = (id: string): PublishedGuide =>
  guide(id, { title: `Path ${id}`, manifest: { type: 'path', milestones: ['a', 'b'] } as PublishedGuide['manifest'] });

const assignment = (targetId: string, trackId?: string): ResolvedAssignment => ({
  targetId,
  title: targetId,
  overdue: false,
  satisfied: false,
  progress: 0,
  trackId,
});

describe('toHubCustomGuides', () => {
  const openDocsPage = jest.fn();

  beforeEach(() => jest.clearAllMocks());

  it('lists paths before loose guides when any path exists', () => {
    const paths = [path('p1')];
    const orphans = [guide('g1')];

    const result = toHubCustomGuides({
      guides: [...paths, ...orphans],
      paths,
      orphanGuides: orphans,
      assignments: [],
      openDocsPage,
    });

    expect(result.map((item) => [item.key, item.kind, item.title])).toEqual([
      ['custom:p1', 'path', 'Path p1'],
      ['custom:g1', 'guide', 'Guide g1'],
    ]);
    expect(result.every((item) => item.organization)).toBe(true);
  });

  it('falls back to every published guide that has an id and title when there are no paths', () => {
    const result = toHubCustomGuides({
      guides: [guide('g1'), guide('g2', { title: '' }), guide('g3')],
      paths: [],
      orphanGuides: [],
      assignments: [],
      openDocsPage,
    });

    expect(result.map((item) => item.key)).toEqual(['custom:g1', 'custom:g3']);
  });

  it('opens a loose guide by its backend id without package info', () => {
    const [item] = toHubCustomGuides({
      guides: [guide('g1')],
      paths: [],
      orphanGuides: [],
      assignments: [],
      openDocsPage,
    });

    void item!.onLaunch();

    expect(openDocsPage).toHaveBeenCalledWith('backend-guide:g1', 'Guide g1', undefined);
    expect(reportAppInteraction).toHaveBeenCalledWith(
      UserInteraction.OpenResourceClick,
      expect.objectContaining({
        content_title: 'Guide g1',
        content_url: 'backend-guide:g1',
        interaction_location: 'hub_custom_guides',
      })
    );
  });

  it('opens a path with its manifest, custom guide launch source and the assigned track', () => {
    const paths = [path('p1')];
    const [item] = toHubCustomGuides({
      guides: paths,
      paths,
      orphanGuides: [],
      assignments: [assignment('p1', 'ops')],
      openDocsPage,
    });

    void item!.onLaunch();

    expect(openDocsPage).toHaveBeenCalledWith(
      'backend-guide:p1',
      'Path p1',
      expect.objectContaining({
        packageId: 'p1',
        packageManifest: expect.objectContaining({ id: 'p1', type: 'path' }),
        launchSource: 'custom_guide',
        trackId: 'ops',
      })
    );
    expect(item!.badges).toBeTruthy();
  });

  it('uses the manifest description, then the id, when a path has no title', () => {
    const untitled = guide('p2', {
      title: '',
      manifest: { type: 'path', description: 'Described path' } as PublishedGuide['manifest'],
    });
    const bare = guide('p3', { title: '', manifest: { type: 'path' } as PublishedGuide['manifest'] });

    const result = toHubCustomGuides({
      guides: [untitled, bare],
      paths: [untitled, bare],
      orphanGuides: [],
      assignments: [],
      openDocsPage,
    });

    expect(result.map((item) => item.title)).toEqual(['Described path', 'p3']);
  });
});
