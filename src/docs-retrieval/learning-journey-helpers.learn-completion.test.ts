/**
 * Grafana Learn completion identity against real storage (#2513,
 * docs/design/GRAFANA_LEARN.md section 7). Learn step slugs repeat across
 * journeys (`01-course-overview` appears in twelve), so a Learn step must key
 * on its path below the Learn root and never on its bare slug.
 */
jest.mock('@grafana/runtime', () => ({
  config: { namespace: 'stacks-123' },
  usePluginUserStorage: jest.fn(),
  getAppEvents: jest.fn(() => ({ publish: jest.fn() })),
  reportInteraction: jest.fn(),
}));

const getPathsDataMock = jest.fn();
const markGuideCompletedSpy = jest.fn();
const awardBadgeSpy = jest.fn();

jest.mock('../lib/guide-completion-bridge', () => {
  const { matchesPathUrl }: typeof import('../learning-paths/paths-data') =
    jest.requireActual('../learning-paths/paths-data');
  const coordinator: typeof import('../learning-paths/badge-coordinator') = jest.requireActual(
    '../learning-paths/badge-coordinator'
  );
  return {
    __esModule: true,
    markGuideCompleted: (guideId: string) => {
      markGuideCompletedSpy(guideId);
      return coordinator.markGuideCompleted(guideId);
    },
    awardBadge: (badgeId: string) => {
      awardBadgeSpy(badgeId);
      return coordinator.awardBadge(badgeId);
    },
    findPathByUrl: (url: string) =>
      (getPathsDataMock().paths as Array<{ url?: string; badgeId?: string; id?: string }>).find((path) =>
        matchesPathUrl(path, url)
      ),
  };
});

jest.mock('../global-state/completion-store', () => ({
  __esModule: true,
  evictContentCache: jest.fn(),
}));

import { interactiveCompletionStorage, learningProgressStorage } from '../lib/user-storage';
import { sanitizeContentKey } from '../global-state/content-key';
import {
  journeyMilestonePercentages,
  markMilestoneDone,
  recordGuideCompletionForSurface,
  resetMilestoneBackfillGuardForTests,
  resolveSurfaceCompletionIdentity,
} from './learning-journey-helpers';
import { resetGuideProgress } from '../components/docs-panel/hooks/resetGuideProgress';
import { onCompletionRecorded, __resetRecorderForTests, type CompletionFact } from '../completion-records';
import type { ContentMetadata, Milestone } from '../types/content.types';

const HUB = 'https://grafana.com/docs/learning-hub';
const OVERVIEW = '01-course-overview';

interface Journey {
  slug: string;
  baseUrl: string;
  stepPaths: string[];
}

function journey(slug: string, stepPaths: string[]): Journey {
  return { slug, baseUrl: `${HUB}/${slug}`, stepPaths: stepPaths.map((path) => `${slug}/${path}`) };
}

const CLOUD = journey('get-started-grafana-cloud', [`01-intro/${OVERVIEW}`, '01-intro/02-sign-up']);
const ASSISTANT = journey('intro-to-grafana-assistant', [`01-modules/${OVERVIEW}`, '01-modules/02-ask']);

function stepUrl(path: string): string {
  return `${HUB}/${path}/`;
}

function milestones(j: Journey): Milestone[] {
  return j.stepPaths.map((path, index) => ({
    number: index + 1,
    title: path,
    url: stepUrl(path),
    isActive: false,
  }));
}

function metadata(j: Journey, extra: { hasUnavailableMilestones?: boolean } = {}): ContentMetadata {
  const ms = milestones(j);
  return {
    title: j.slug,
    learningJourney: {
      currentMilestone: 1,
      totalMilestones: ms.length,
      milestones: ms,
      baseUrl: j.baseUrl,
      ...extra,
    },
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function completeStep(
  j: Journey,
  index: number,
  options: { currentUrl?: string; hasUnavailableMilestones?: boolean } = {}
): Promise<void> {
  const url = options.currentUrl ?? stepUrl(j.stepPaths[index]!);
  recordGuideCompletionForSurface({
    baseUrl: j.baseUrl,
    contentUrl: url,
    currentUrl: url,
    contentType: 'learning-journey',
    metadata: metadata(j, { hasUnavailableMilestones: options.hasUnavailableMilestones }),
    guideTitle: `Title of ${j.stepPaths[index]}`,
  });
  await flush();
}

function guideFacts(): CompletionFact[] {
  return emitted.filter((fact) => fact.kind === 'guide');
}

function journeyFacts(): CompletionFact[] {
  return emitted.filter((fact) => fact.kind === 'journey');
}

let emitted: CompletionFact[];
let unsubscribe: () => void;

beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
  __resetRecorderForTests();
  resetMilestoneBackfillGuardForTests();
  getPathsDataMock.mockReturnValue({ paths: [] });
  emitted = [];
  unsubscribe = onCompletionRecorded((fact) => {
    emitted.push(fact);
    return true;
  });
});

afterEach(() => {
  unsubscribe();
});

describe('Grafana Learn step completion', () => {
  it('records the step under its Learn path and journey slug', async () => {
    await completeStep(CLOUD, 0);

    expect(guideFacts()).toEqual([
      expect.objectContaining({
        guideSource: 'grafana-learn',
        guideId: `get-started-grafana-cloud/01-intro/${OVERVIEW}`,
        guideCategory: 'learning-journey',
        pathId: 'get-started-grafana-cloud',
        guideTitle: `Title of get-started-grafana-cloud/01-intro/${OVERVIEW}`,
        completionPercent: 100,
      }),
    ]);
    expect(journeyFacts()).toEqual([]);
  });

  it('does not credit a step with the same slug in another journey', async () => {
    await completeStep(CLOUD, 0);

    expect(guideFacts().map((fact) => fact.guideId)).toEqual([`get-started-grafana-cloud/01-intro/${OVERVIEW}`]);
    expect(emitted.some((fact) => fact.pathId === ASSISTANT.slug || fact.guideId === OVERVIEW)).toBe(false);

    const stored = await interactiveCompletionStorage.getAll();
    expect(stored[sanitizeContentKey(stepUrl(CLOUD.stepPaths[0]!))]).toBe(100);
    expect(stored[sanitizeContentKey(stepUrl(ASSISTANT.stepPaths[0]!))]).toBeUndefined();
    const assistantPercentages = journeyMilestonePercentages(ASSISTANT.baseUrl, milestones(ASSISTANT));
    expect(assistantPercentages.map(({ percent }) => percent)).toEqual([0, 0]);

    await completeStep(ASSISTANT, 0);
    expect(guideFacts().map((fact) => [fact.guideId, fact.pathId])).toEqual([
      [`get-started-grafana-cloud/01-intro/${OVERVIEW}`, CLOUD.slug],
      [`intro-to-grafana-assistant/01-modules/${OVERVIEW}`, ASSISTANT.slug],
    ]);
  });

  it('leaves shared learning progress, curated paths and badges alone', async () => {
    getPathsDataMock.mockReturnValue({
      paths: [{ id: 'curated', url: CLOUD.baseUrl, badgeId: 'curated-badge' }],
    });

    await completeStep(CLOUD, 0);
    await completeStep(CLOUD, 1);

    expect(markGuideCompletedSpy).not.toHaveBeenCalled();
    expect(awardBadgeSpy).not.toHaveBeenCalled();
    const progress = await learningProgressStorage.get();
    expect(progress.completedGuides).toEqual([]);
    expect(progress.earnedBadges).toEqual([]);
    expect(journeyFacts()).toEqual([expect.objectContaining({ guideId: CLOUD.slug, pathId: CLOUD.slug })]);
  });

  it('records the same identity for every spelling of the step URL', async () => {
    await completeStep(CLOUD, 0, { currentUrl: `${HUB}/${CLOUD.stepPaths[0]}/unstyled.html` });

    expect(guideFacts().map((fact) => fact.guideId)).toEqual([`get-started-grafana-cloud/01-intro/${OVERVIEW}`]);
    const stored = await interactiveCompletionStorage.getAll();
    expect(stored[sanitizeContentKey(stepUrl(CLOUD.stepPaths[0]!))]).toBe(100);
  });

  it('records nothing durable for a Learn page above step depth', async () => {
    await markMilestoneDone(CLOUD.baseUrl, '01-intro', `${CLOUD.baseUrl}/01-intro/`, undefined, {});
    await flush();

    expect(emitted).toEqual([]);
    expect(markGuideCompletedSpy).not.toHaveBeenCalled();
  });
});

describe('Grafana Learn journey completion', () => {
  it('records the journey once, after every available step is complete', async () => {
    await completeStep(CLOUD, 0);
    expect(journeyFacts()).toEqual([]);

    await completeStep(CLOUD, 1);
    await completeStep(CLOUD, 1);

    expect(journeyFacts()).toEqual([
      expect.objectContaining({
        kind: 'journey',
        guideSource: 'grafana-learn',
        guideId: CLOUD.slug,
        guideCategory: 'learning-journey',
        pathId: CLOUD.slug,
      }),
    ]);
  });

  it('does not record a journey from a tree with unavailable milestones', async () => {
    await completeStep(CLOUD, 0, { hasUnavailableMilestones: true });
    await completeStep(CLOUD, 1, { hasUnavailableMilestones: true });

    expect(guideFacts()).toHaveLength(2);
    expect(journeyFacts()).toEqual([]);
  });

  it('does not let one journey complete another that shares a step slug', async () => {
    await completeStep(ASSISTANT, 1);
    await completeStep(CLOUD, 0);
    await completeStep(CLOUD, 1);

    expect(journeyFacts().map((fact) => fact.guideId)).toEqual([CLOUD.slug]);
  });

  it('keeps steps that share a slug within one journey apart', async () => {
    const twoOverviews = journey('two-overviews', [`01-intro/${OVERVIEW}`, `02-next/${OVERVIEW}`]);

    await completeStep(twoOverviews, 0);
    expect(journeyFacts()).toEqual([]);
    const stored = await interactiveCompletionStorage.getAll();
    expect(stored[sanitizeContentKey(stepUrl(twoOverviews.stepPaths[1]!))]).toBeUndefined();

    await completeStep(twoOverviews, 1);
    expect(guideFacts().map((fact) => fact.guideId)).toEqual([
      `two-overviews/01-intro/${OVERVIEW}`,
      `two-overviews/02-next/${OVERVIEW}`,
    ]);
    expect(journeyFacts().map((fact) => fact.guideId)).toEqual(['two-overviews']);
  });
});

describe('Grafana Learn identity on the other completion surfaces', () => {
  it('hands the footer the same identity the writer records', () => {
    const url = stepUrl(CLOUD.stepPaths[0]!);
    expect(
      resolveSurfaceCompletionIdentity({ baseUrl: CLOUD.baseUrl, currentUrl: url, metadata: metadata(CLOUD) })
    ).toEqual({
      guideSource: 'grafana-learn',
      guideId: `get-started-grafana-cloud/01-intro/${OVERVIEW}`,
      sourceConfirmed: true,
      pathIdentity: { guideSource: 'grafana-learn', guideId: CLOUD.slug, sourceConfirmed: true },
    });
    expect(
      resolveSurfaceCompletionIdentity({
        baseUrl: CLOUD.baseUrl,
        currentUrl: `${CLOUD.baseUrl}/01-intro/`,
        metadata: metadata(CLOUD),
      })
    ).toBeUndefined();
  });

  it('lets a reset lift the guard on the Learn identity so the step records again', async () => {
    const url = stepUrl(CLOUD.stepPaths[0]!);
    await completeStep(CLOUD, 0);

    await resetGuideProgress(sanitizeContentKey(url), {
      milestoneSlug: OVERVIEW,
      journeyBaseUrl: CLOUD.baseUrl,
      milestoneUrl: url,
    });
    await completeStep(CLOUD, 0);

    expect(guideFacts().map((fact) => fact.guideId)).toEqual([
      `get-started-grafana-cloud/01-intro/${OVERVIEW}`,
      `get-started-grafana-cloud/01-intro/${OVERVIEW}`,
    ]);
  });
});
