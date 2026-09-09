/**
 * Reader progress → persisted storage → join, with nothing mocked in between.
 *
 * `path-member-join.test.ts` drives the real `getContentKey` but hands the
 * join a record it built itself. Here the record is the one the product
 * actually writes: a reader opens a guide, completes some of its steps, and
 * `completion-store` persists the percentage through the real
 * `interactiveCompletionStorage`. The join then has to find that percentage
 * from the path definition alone — the whole point of the module.
 */
jest.mock('@grafana/runtime', () => ({
  config: { namespace: 'stacks-123' },
  usePluginUserStorage: jest.fn(),
  getAppEvents: jest.fn(() => ({ publish: jest.fn() })),
  reportInteraction: jest.fn(),
}));

import { interactiveCompletionStorage, journeyCompletionStorage } from '../lib/user-storage';

import { markStepCompleted, resetCompletionStoreForTests } from './completion-store';
import { resetContentKeyForTests, setActiveTabUrl } from './content-key';
import { registerSectionSteps, resetRegistry } from './section-registry';
import { resolvePathMemberPercentages, type PathMember } from './path-member-join';

const SECTION_ID = 'section-one';
const STEP_IDS = ['step-1', 'step-2', 'step-3', 'step-4'];

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** A reader opens `launchUrl` and completes `completedSteps` of its four steps. */
async function readerProgresses(launchUrl: string, completedSteps: number): Promise<void> {
  resetRegistry();
  resetCompletionStoreForTests();
  setActiveTabUrl(launchUrl);
  registerSectionSteps(SECTION_ID, STEP_IDS.length, 0);
  for (const stepId of STEP_IDS.slice(0, completedSteps)) {
    markStepCompleted(stepId, SECTION_ID, 'manual');
  }
  await flush();
  setActiveTabUrl(undefined);
}

beforeEach(() => {
  localStorage.clear();
  resetRegistry();
  resetCompletionStoreForTests();
  resetContentKeyForTests();
  delete (window as unknown as Record<string, unknown>).__DocsPluginActiveTabUrl;
  delete (window as unknown as Record<string, unknown>).__DocsPluginContentKey;
});

afterEach(() => {
  setActiveTabUrl(undefined);
});

describe('path member join over the record the product actually writes', () => {
  it('resolves a partially progressed App Platform member from persisted storage', async () => {
    await readerProgresses('backend-guide:fe-alerting-01', 1);

    const result = resolvePathMemberPercentages([{ id: 'fe-alerting-01' }], {
      completedMemberIds: [],
      persistedPercentages: await interactiveCompletionStorage.getAll(),
    });

    expect(result.members[0]).toEqual({
      memberId: 'fe-alerting-01',
      percent: 25,
      source: 'persisted',
      contentKey: 'backend-guide:fe-alerting-01',
    });
    expect(result.excludedCount).toBe(0);
  });

  it('finds nothing for that same member in the journey namespace', async () => {
    // Decision 4: `journeyCompletionStorage` holds no record under
    // `backend-guide:` for a partially progressed member, so joining against
    // it would exclude every one of them.
    await readerProgresses('backend-guide:fe-alerting-01', 1);

    const journeyRecord = await journeyCompletionStorage.getAll();
    const result = resolvePathMemberPercentages([{ id: 'fe-alerting-01' }], {
      completedMemberIds: [],
      persistedPercentages: journeyRecord,
    });

    expect(journeyRecord).toEqual({});
    expect(result.members[0]!.source).toBe('unopened');
    expect(result.resolvedPercentages).toEqual([0]);
  });

  it('resolves a bundled member the reader opened from the package surface', async () => {
    // The context panel launches a recommended bundled guide at
    // `bundled:<id>/content.json`; My Learning launches the same guide bare.
    await readerProgresses('bundled:first-dashboard/content.json', 2);

    const result = resolvePathMemberPercentages([{ id: 'first-dashboard' }], {
      completedMemberIds: [],
      persistedPercentages: await interactiveCompletionStorage.getAll(),
    });

    expect(result.members[0]).toEqual({
      memberId: 'first-dashboard',
      percent: 50,
      source: 'persisted',
      contentKey: 'bundled:first-dashboard/content.json',
    });
  });

  it('takes the furthest of the two launch surfaces for one bundled guide', async () => {
    await readerProgresses('bundled:first-dashboard', 1);
    await readerProgresses('bundled:first-dashboard/content.json', 3);

    const persistedPercentages = await interactiveCompletionStorage.getAll();
    const result = resolvePathMemberPercentages([{ id: 'first-dashboard' }], {
      completedMemberIds: [],
      persistedPercentages,
    });

    expect(persistedPercentages).toEqual({
      'bundled:first-dashboard': 25,
      'bundled:first-dashboard/content.json': 75,
    });
    expect(result.members[0]!.percent).toBe(75);
  });

  it('scores a whole path, excluding and counting the members it cannot answer for', async () => {
    await readerProgresses('backend-guide:fe-alerting-01', 3);

    const members: PathMember[] = [{ id: 'fe-alerting-01' }, { id: 'fe-alerting-02' }, { id: 'fe-alerting-03' }];
    const withIds = resolvePathMemberPercentages(members, {
      completedMemberIds: ['fe-alerting-03'],
      persistedPercentages: await interactiveCompletionStorage.getAll(),
    });

    expect(withIds.members.map((m) => [m.memberId, m.percent, m.source])).toEqual([
      ['fe-alerting-01', 75, 'persisted'],
      ['fe-alerting-02', 0, 'unopened'],
      ['fe-alerting-03', 100, 'completed'],
    ]);
    expect(withIds.resolvedPercentages).toEqual([75, 0, 100]);
    expect(withIds.excludedCount).toBe(0);

    // The same members under a URL-based path whose milestone URLs never
    // resolved: excluded from the mean and named, never scored zero.
    const unresolvable = resolvePathMemberPercentages([{ id: 'fe-alerting-01' }, { id: 'fe-alerting-02' }], {
      pathBaseUrl: 'https://grafana.com/docs/learning-journeys/loki/',
      completedMemberIds: [],
      persistedPercentages: await interactiveCompletionStorage.getAll(),
    });

    expect(unresolvable.resolvedPercentages).toEqual([]);
    expect(unresolvable.excludedCount).toBe(2);
    expect(unresolvable.excludedMemberIds).toEqual(['fe-alerting-01', 'fe-alerting-02']);
  });
});
