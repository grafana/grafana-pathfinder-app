/**
 * Tests for `markGuideCompleted` — the badge / analytics / event-dispatch
 * coordinator that replaced the equivalent code path previously embedded in
 * `learningProgressStorage.markGuideCompleted`.
 *
 * Pins:
 *   - persists a guideId only once (no duplicate completion entries)
 *   - awards badges via `getBadgesToAward`, adds them to pending celebrations,
 *     and fires one `BadgeUnlocked` analytics event per newly-awarded badge
 *   - dispatches `StorageEvents.LearningProgressUpdated` with the
 *     `{ type: 'guide-completed', guideId, newBadges, progress }` shape
 *   - newBadges contains only THIS-call awards (not all pending celebrations)
 *   - the streak is updated using the previous lastActivityDate, then
 *     lastActivityDate is advanced to today
 *   - error path still dispatches the event so UI listeners never hang
 */
import type { LearningProgress } from '../types/learning-paths.types';
import { StorageEvents } from '../lib/event-names';

const reportAppInteractionMock = jest.fn();
const learningProgressGetMock = jest.fn();
const learningProgressUpdateMock = jest.fn();

jest.mock('../lib/analytics', () => ({
  __esModule: true,
  reportAppInteraction: (...args: unknown[]) => reportAppInteractionMock(...args),
  UserInteraction: { BadgeUnlocked: 'badge-unlocked' },
}));

jest.mock('../lib/user-storage', () => ({
  __esModule: true,
  learningProgressStorage: {
    get: () => learningProgressGetMock(),
    update: (updates: unknown) => learningProgressUpdateMock(updates),
  },
}));

const getPathsDataMock = jest.fn();
const getBadgesToAwardMock = jest.fn();
const getBadgeByIdMock = jest.fn();
const calculateUpdatedStreakMock = jest.fn();

jest.mock('./paths-data', () => ({
  __esModule: true,
  getPathsData: () => getPathsDataMock(),
}));

jest.mock('./badges', () => ({
  __esModule: true,
  getBadgesToAward: (...args: unknown[]) => getBadgesToAwardMock(...args),
  getBadgeById: (id: string) => getBadgeByIdMock(id),
}));

jest.mock('./streak-tracker', () => ({
  __esModule: true,
  calculateUpdatedStreak: (...args: unknown[]) => calculateUpdatedStreakMock(...args),
}));

import { markGuideCompleted } from './badge-coordinator';

function emptyProgress(overrides: Partial<LearningProgress> = {}): LearningProgress {
  return {
    completedGuides: [],
    earnedBadges: [],
    pendingCelebrations: [],
    streakDays: 0,
    lastActivityDate: '',
    ...overrides,
  } as LearningProgress;
}

beforeEach(() => {
  jest.clearAllMocks();
  getPathsDataMock.mockReturnValue({ paths: [] });
  getBadgesToAwardMock.mockReturnValue([]);
  calculateUpdatedStreakMock.mockReturnValue(1);
});

describe('markGuideCompleted', () => {
  it('persists the guideId, advances streak, and dispatches the updated event', async () => {
    learningProgressGetMock.mockResolvedValue(emptyProgress());

    const events: CustomEvent[] = [];
    const listener = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener(StorageEvents.LearningProgressUpdated, listener);

    try {
      await markGuideCompleted('guide-a');
    } finally {
      window.removeEventListener(StorageEvents.LearningProgressUpdated, listener);
    }

    expect(learningProgressUpdateMock).toHaveBeenCalledTimes(1);
    const written = learningProgressUpdateMock.mock.calls[0]![0] as LearningProgress;
    expect(written.completedGuides).toEqual(['guide-a']);
    expect(written.streakDays).toBe(1);
    expect(written.lastActivityDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    expect(events).toHaveLength(1);
    expect(events[0]!.detail).toMatchObject({
      type: 'guide-completed',
      guideId: 'guide-a',
      newBadges: [],
    });
  });

  it('is a no-op (no write) when guideId is already completed, but still settles', async () => {
    learningProgressGetMock.mockResolvedValue(emptyProgress({ completedGuides: ['guide-a'] }));

    await markGuideCompleted('guide-a');

    expect(learningProgressUpdateMock).not.toHaveBeenCalled();
  });

  it('reports BadgeUnlocked once per newly-awarded badge', async () => {
    learningProgressGetMock.mockResolvedValue(emptyProgress());
    getBadgesToAwardMock.mockReturnValue(['b1', 'b2']);
    getBadgeByIdMock.mockImplementation((id: string) => ({
      id,
      title: `${id}-title`,
      trigger: { type: 'guide-count' },
    }));

    await markGuideCompleted('guide-a');

    expect(reportAppInteractionMock).toHaveBeenCalledTimes(2);
    const ids = reportAppInteractionMock.mock.calls.map((c) => c[1].badge_id).sort();
    expect(ids).toEqual(['b1', 'b2']);
  });

  it('does not re-award badges already in earnedBadges', async () => {
    learningProgressGetMock.mockResolvedValue(
      emptyProgress({
        earnedBadges: [{ id: 'b1', earnedAt: 1 }],
      })
    );
    getBadgesToAwardMock.mockReturnValue(['b1', 'b2']);
    getBadgeByIdMock.mockImplementation((id: string) => ({
      id,
      title: `${id}-title`,
      trigger: { type: 'guide-count' },
    }));

    const events: CustomEvent[] = [];
    const listener = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener(StorageEvents.LearningProgressUpdated, listener);

    try {
      await markGuideCompleted('guide-a');
    } finally {
      window.removeEventListener(StorageEvents.LearningProgressUpdated, listener);
    }

    // Only b2 is new -> one analytics event, newBadges has one entry.
    expect(reportAppInteractionMock).toHaveBeenCalledTimes(1);
    expect(reportAppInteractionMock.mock.calls[0]![1].badge_id).toBe('b2');
    expect(events[0]!.detail.newBadges).toEqual(['b2']);
  });

  it('streak uses the previous lastActivityDate, not today', async () => {
    learningProgressGetMock.mockResolvedValue(emptyProgress({ streakDays: 4, lastActivityDate: '2025-01-01' }));
    calculateUpdatedStreakMock.mockReturnValue(5);

    await markGuideCompleted('guide-a');

    expect(calculateUpdatedStreakMock).toHaveBeenCalledWith(4, '2025-01-01');
    const written = learningProgressUpdateMock.mock.calls[0]![0] as LearningProgress;
    expect(written.streakDays).toBe(5);
  });

  it('on error, still dispatches a guide-completed event with { error: true }', async () => {
    learningProgressGetMock.mockRejectedValue(new Error('boom'));
    const errSpy = jest.spyOn(console, 'error').mockImplementation();

    const events: CustomEvent[] = [];
    const listener = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener(StorageEvents.LearningProgressUpdated, listener);

    try {
      await markGuideCompleted('guide-a');
    } finally {
      window.removeEventListener(StorageEvents.LearningProgressUpdated, listener);
      errSpy.mockRestore();
    }

    expect(events).toHaveLength(1);
    expect(events[0]!.detail).toMatchObject({
      type: 'guide-completed',
      guideId: 'guide-a',
      newBadges: [],
      error: true,
    });
    expect(learningProgressUpdateMock).not.toHaveBeenCalled();
  });
});
