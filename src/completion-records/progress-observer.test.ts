jest.mock('../lib/analytics', () => ({
  ...jest.requireActual('../lib/analytics'),
  reportAppInteraction: jest.fn(),
}));
// No requireActual: the openfeature/openfeature-tracking import cycle breaks it inside a factory.
jest.mock('../utils/openfeature', () => ({
  getFeatureFlagValue: jest.fn(() => true),
}));

let mockOwner = 'user-7:org-3';
jest.mock('./completion-write-storage', () => ({
  ...jest.requireActual('./completion-write-storage'),
  currentCompletionQueueOwnerKey: () => mockOwner,
}));

import { reportAppInteraction, UserInteraction } from '../lib/analytics';
import { completionEmittedStorage } from '../lib/user-storage';
import { dispatchProgress, type ProgressOrigin } from '../global-state/progress-events';
import { getFeatureFlagValue } from '../utils/openfeature';

import { __resetRecorderForTests } from './completion-recorder';
import { closeAttempt, getOrMintAttempt, readAttempt } from './guide-attempts';
import {
  registerGuideIdentity,
  __resetGuideIdentityRegistryForTests,
  type RegisteredGuideIdentity,
} from './guide-identity-registry';
import { installProgressObserver, __resetProgressObserverForTests } from './progress-observer';

const CONTENT_KEY = 'bundled:intro';
const IDENTITY: RegisteredGuideIdentity = {
  guideSource: 'bundled',
  guideId: 'intro',
  guideTitle: 'Intro',
  guideCategory: 'interactive',
};
const KEY = { guideSource: 'bundled', guideId: 'intro' };

const reportMock = reportAppInteraction as jest.Mock;
const flagMock = getFeatureFlagValue as jest.Mock;

function progress(percentage: number, origin?: ProgressOrigin, contentKey = CONTENT_KEY): void {
  dispatchProgress({ kind: 'guide', contentKey, percentage, hasProgress: true, ...(origin && { origin }) });
}

function progressEvents(): Array<Record<string, unknown>> {
  return reportMock.mock.calls
    .filter(([type]) => type === UserInteraction.GuideProgress)
    .map(([, properties]) => properties);
}

function thresholds(): unknown[] {
  return progressEvents().map((properties) => properties.threshold);
}

beforeEach(() => {
  mockOwner = 'user-7:org-3';
  localStorage.clear();
  reportMock.mockClear();
  flagMock.mockReset();
  flagMock.mockReturnValue(true);
  __resetRecorderForTests();
  __resetGuideIdentityRegistryForTests();
  __resetProgressObserverForTests();
  installProgressObserver();
  registerGuideIdentity(CONTENT_KEY, IDENTITY);
});

afterAll(() => {
  __resetProgressObserverForTests();
});

describe('progress observer — what it ignores', () => {
  it.each([
    ['a load', 40, 'load' as const],
    ['an event with no origin', 40, undefined],
    ['a change at 0%', 0, 'change' as const],
    ['a change at 100%', 100, 'change' as const],
  ])('ignores %s', (_label, percentage, origin) => {
    progress(percentage, origin);

    expect(readAttempt(KEY)).toBeNull();
    expect(progressEvents()).toEqual([]);
  });

  it('ignores a preview content key, even with an identity registered for it', () => {
    registerGuideIdentity('block-editor://preview/demo', IDENTITY);

    progress(40, 'change', 'block-editor://preview/demo');

    expect(readAttempt(KEY)).toBeNull();
    expect(progressEvents()).toEqual([]);
  });

  it('ignores a content key no surface registered', () => {
    progress(40, 'change', 'bundled:somebody-else');

    expect(readAttempt(KEY)).toBeNull();
    expect(progressEvents()).toEqual([]);
  });

  it('ignores a guide whose completion is already recorded, as one completed before the upgrade is', async () => {
    await completionEmittedStorage.markEmitted('guide:bundled:intro');

    progress(40, 'change');

    expect(readAttempt(KEY)).toBeNull();
    expect(progressEvents()).toEqual([]);
  });

  it('ignores progress on a closed attempt', () => {
    const { attempt } = getOrMintAttempt(KEY, () => 'analytics');
    closeAttempt(KEY, attempt.attemptId);

    progress(40, 'change');

    expect(readAttempt(KEY)).toMatchObject({ attemptId: attempt.attemptId, closed: true, highWater: 0 });
    expect(progressEvents()).toEqual([]);
  });
});

describe('progress observer — attempts and analytics', () => {
  it("records a new owner's lower percentage instead of inheriting the previous high-water mark", () => {
    progress(70, 'change');
    const first = readAttempt(KEY)!;
    mockOwner = 'user-8:org-3';
    progress(30, 'change');
    const second = readAttempt(KEY)!;
    expect(second.attemptId).not.toBe(first.attemptId);
    expect(second.highWater).toBe(30);
    expect(progressEvents()).toHaveLength(2);
    expect(progressEvents()[1]).toMatchObject({ percent: 30, attempt_id: second.attemptId });
    mockOwner = 'user-7:org-3';
    expect(readAttempt(KEY)).toEqual(first);
  });

  it('mints an attempt on the first real change and reports it at threshold 0', () => {
    progress(5, 'change');

    const attempt = readAttempt(KEY);
    expect(attempt).toMatchObject({ closed: false, highWater: 5, mode: 'analytics' });
    expect(progressEvents()).toEqual([
      {
        guide_source: 'bundled',
        guide_id: 'intro',
        percent: 5,
        threshold: 0,
        attempt_id: attempt!.attemptId,
      },
    ]);
  });

  it('reports only the highest threshold a step crosses', () => {
    for (const percentage of [30, 55, 80, 95]) {
      progress(percentage, 'change');
    }

    expect(thresholds()).toEqual([0, 50, 75]);
  });

  it('reports every threshold a step-by-step attempt crosses, four times at most', () => {
    for (const percentage of [5, 26, 55, 80, 95]) {
      progress(percentage, 'change');
    }

    expect(thresholds()).toEqual([0, 25, 50, 75]);
  });

  it('reports a crossing once, however often the percentage comes back to it', () => {
    for (const percentage of [5, 30, 20, 30, 35]) {
      progress(percentage, 'change');
    }

    expect(thresholds()).toEqual([0, 25]);
  });

  it('keeps one attempt id across the whole attempt', () => {
    for (const percentage of [5, 30, 55]) {
      progress(percentage, 'change');
    }

    expect(new Set(progressEvents().map((properties) => properties.attempt_id)).size).toBe(1);
  });

  it('carries the path id when the identity has one', () => {
    registerGuideIdentity(CONTENT_KEY, { ...IDENTITY, pathId: 'linux-path' });

    progress(5, 'change');

    expect(progressEvents()[0]).toMatchObject({ path_id: 'linux-path' });
  });

  it('reports nothing with the kill switch off, but still tracks the attempt', () => {
    flagMock.mockReturnValue(false);

    progress(30, 'change');
    progress(60, 'change');

    expect(flagMock).toHaveBeenCalledWith('pathfinder.progress-analytics', false);
    expect(progressEvents()).toEqual([]);
    expect(readAttempt(KEY)).toMatchObject({ highWater: 60 });
  });

  it('installs once, however often it is asked to', () => {
    installProgressObserver();
    installProgressObserver();

    progress(5, 'change');

    expect(progressEvents()).toHaveLength(1);
  });
});
