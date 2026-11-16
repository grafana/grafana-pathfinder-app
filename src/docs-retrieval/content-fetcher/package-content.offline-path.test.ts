import { fetchPackageContent, setPackageResolver } from './package-content';
import { getCachedPackageRecommendations } from '../../lib/package-recommendations-client';
import {
  getNextMilestoneUrl,
  getPreviousMilestoneUrl,
  resolveSurfaceGuideIdentity,
  resolveActiveMilestoneToolbarContext,
} from '../learning-journey-helpers';
import type { Milestone } from '../../types/content.types';

jest.mock('../../lib/package-recommendations-client', () => ({
  ...jest.requireActual('../../lib/package-recommendations-client'),
  getCachedPackageRecommendations: jest.fn(),
}));

const memberUrl = 'https://interactive-learning.grafana.net/packages/welcome-to-grafana/content.json';
const pathUrl = 'https://interactive-learning.grafana.net/packages/courses/intro/v2/content.json';
const manifest = { id: 'getting-started', type: 'path', milestones: ['welcome-to-grafana', 'prometheus-grafana-101'] };
const milestones: Milestone[] = manifest.milestones.map((id, i) => ({
  id,
  number: i + 1,
  title: id,
  url: `https://interactive-learning.grafana.net/packages/${id}/content.json`,
  isActive: false,
}));
const originalFetch = global.fetch;
const resolve = jest.fn();

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.mocked(getCachedPackageRecommendations).mockReturnValue(null);
  global.fetch = jest.fn(() => new Promise(() => {}));
  resolve.mockImplementation(() => new Promise(() => {}));
  setPackageResolver({ resolve });
});

afterEach(() => {
  global.fetch = originalFetch;
  jest.useRealTimers();
});

it.each([true, false])(
  'settles within the original deadline with a hung resolver (supplied milestones: %s)',
  async (supplied) => {
    jest.mocked(getCachedPackageRecommendations).mockReturnValue({
      baseUrl: 'https://interactive-learning.grafana.net/packages/',
      packages: [{ id: manifest.id, path: 'courses/intro/v2', manifest }],
    });
    const settled = jest.fn();
    const pending = fetchPackageContent(
      memberUrl,
      manifest,
      supplied ? milestones : undefined,
      'interactive-tutorials'
    );
    void pending.then(settled);
    await jest.advanceTimersByTimeAsync(1_499);
    expect(settled).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(settled).toHaveBeenCalledTimes(1);
    expect(resolve).not.toHaveBeenCalled();

    const { content } = await pending;
    expect(content?.metadata.learningJourney).toMatchObject({
      currentMilestone: 1,
      totalMilestones: 2,
      baseUrl: pathUrl,
    });
    expect(content?.metadata.journeyManifest).toMatchObject(manifest);
    expect(getPreviousMilestoneUrl(content!)).toBe(pathUrl);
    expect(getNextMilestoneUrl(content!)).toBe(milestones[1]!.url);
    expect(JSON.parse(content!.content).id).toBe('welcome-to-grafana');
  }
);

it('uses the saved owner URL without reading the network when the index is cold', async () => {
  const pending = fetchPackageContent(
    memberUrl,
    manifest,
    milestones,
    'interactive-tutorials',
    undefined,
    undefined,
    pathUrl
  );
  await jest.advanceTimersByTimeAsync(1_500);
  const { content } = await pending;
  expect(content?.metadata.learningJourney?.baseUrl).toBe(pathUrl);
  expect(resolve).not.toHaveBeenCalled();
});

it('does not substitute the member for an unknown owner or classify it as a standalone completion', async () => {
  const pending = fetchPackageContent(memberUrl, manifest, milestones, 'interactive-tutorials');
  await jest.advanceTimersByTimeAsync(1_500);
  const { content } = await pending;
  expect(content?.metadata.learningJourney).toMatchObject({ currentMilestone: 1, baseUrl: '' });
  expect(content?.metadata.journeyManifest).toMatchObject(manifest);
  expect(getPreviousMilestoneUrl(content!)).toBeNull();
  expect(
    resolveSurfaceGuideIdentity({ contentUrl: memberUrl, currentUrl: memberUrl, metadata: content!.metadata })
  ).toBeNull();
  expect(resolve).not.toHaveBeenCalled();
});

it('marks unknown required members unavailable instead of dropping them from the path', async () => {
  const owner = { ...manifest, milestones: ['welcome-to-grafana', 'not-cached'] };
  const pending = fetchPackageContent(
    memberUrl,
    owner,
    undefined,
    'interactive-tutorials',
    undefined,
    undefined,
    pathUrl
  );
  await jest.advanceTimersByTimeAsync(1_500);
  const { content } = await pending;
  expect(content?.metadata.learningJourney).toMatchObject({
    currentMilestone: 1,
    totalMilestones: 2,
    hasUnavailableMilestones: true,
    milestones: [
      expect.objectContaining({ id: 'welcome-to-grafana', url: memberUrl }),
      expect.objectContaining({ id: 'not-cached', url: '', isLocked: true }),
    ],
  });
  expect(getNextMilestoneUrl(content!)).toBeNull();
  expect(resolve).not.toHaveBeenCalled();
});

it('uses cached full track membership without fetching a parent or track guide', async () => {
  const owner = {
    ...manifest,
    milestones: ['first-dashboard'],
    tracks: [{ trackId: 'extra', label: 'Extra', guides: ['welcome-to-grafana', 'prometheus-grafana-101'] }],
  };
  jest.mocked(getCachedPackageRecommendations).mockReturnValue({
    baseUrl: 'https://interactive-learning.grafana.net/packages/',
    packages: [{ id: manifest.id, path: 'courses/intro/v2', manifest: owner }],
  });
  const pending = fetchPackageContent(
    memberUrl,
    { ...manifest, milestones: owner.milestones },
    undefined,
    'interactive-tutorials'
  );
  await jest.advanceTimersByTimeAsync(1_500);
  const { content } = await pending;
  expect(content?.metadata.learningJourney).toBeUndefined();
  expect(content?.metadata.trackMemberBaseUrl).toBe(pathUrl);
  expect(getNextMilestoneUrl(content!, 'extra', null)).toBe(milestones[1]!.url);
  expect(resolveActiveMilestoneToolbarContext(content!, 'extra', null)).toMatchObject({
    currentMilestone: 1,
    totalMilestones: 2,
    baseUrl: pathUrl,
  });
  expect(content?.metadata.journeyManifest).toMatchObject(owner);
  expect(resolve).not.toHaveBeenCalled();
});

it('does not borrow a public locator or manifest for a private parent with the same id', async () => {
  const owner = { ...manifest, repository: 'app-platform' };
  jest.mocked(getCachedPackageRecommendations).mockReturnValue({
    baseUrl: 'https://interactive-learning.grafana.net/packages/',
    packages: [{ id: manifest.id, path: 'wrong-public-path', manifest }],
  });
  const pending = fetchPackageContent(
    memberUrl,
    owner,
    milestones,
    'app-platform',
    undefined,
    undefined,
    'backend-guide:private-path'
  );
  await jest.advanceTimersByTimeAsync(1_500);
  const { content } = await pending;
  expect(content?.metadata.learningJourney?.baseUrl).toBe('backend-guide:private-path');
  expect(content?.metadata.journeyManifest).toMatchObject(owner);
  expect(content?.metadata.repository).toBe('app-platform');
  expect(getCachedPackageRecommendations).not.toHaveBeenCalled();
  expect(resolve).not.toHaveBeenCalled();
});

it('reconciles a stale supplied sequence against cached required members and their order', async () => {
  const owner = { ...manifest, milestones: ['not-cached', 'welcome-to-grafana'] };
  jest.mocked(getCachedPackageRecommendations).mockReturnValue({
    baseUrl: 'https://interactive-learning.grafana.net/packages/',
    packages: [{ id: manifest.id, path: 'courses/intro/v2', manifest: owner }],
  });
  const pending = fetchPackageContent(memberUrl, manifest, milestones, 'interactive-tutorials');
  await jest.advanceTimersByTimeAsync(1_500);
  const { content } = await pending;
  expect(content?.metadata.learningJourney).toMatchObject({
    currentMilestone: 2,
    totalMilestones: 2,
    hasUnavailableMilestones: true,
    milestones: [
      expect.objectContaining({ id: 'not-cached', number: 1, isLocked: true }),
      expect.objectContaining({ id: 'welcome-to-grafana', number: 2, url: memberUrl }),
    ],
  });
  expect(getNextMilestoneUrl(content!)).toBeNull();
});

it.each([
  { ...manifest, type: 'guide' },
  { ...manifest, milestones: [123] },
  { ...manifest, id: 'another-path' },
])('does not replace valid ownership with an invalid cached parent: %j', async (cachedManifest) => {
  jest.mocked(getCachedPackageRecommendations).mockReturnValue({
    baseUrl: 'https://interactive-learning.grafana.net/packages/',
    packages: [{ id: manifest.id, path: 'courses/intro/v2', manifest: cachedManifest }],
  });
  const pending = fetchPackageContent(memberUrl, manifest, milestones, 'interactive-tutorials');
  await jest.advanceTimersByTimeAsync(1_500);
  const { content } = await pending;
  expect(content?.type).toBe('learning-journey');
  expect(content?.metadata.journeyManifest).toEqual(manifest);
  expect(content?.metadata.learningJourney).toMatchObject({ currentMilestone: 1, totalMilestones: 2 });
});
