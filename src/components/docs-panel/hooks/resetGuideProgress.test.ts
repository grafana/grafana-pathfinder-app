import { evictContentCache } from '../../../global-state/completion-store';
import {
  guideCompletionMarkStorage,
  interactiveCompletionStorage,
  interactiveStepStorage,
  milestoneCompletionStorage,
} from '../../../lib/user-storage';
import { invalidateEmittedCompletion } from '../../../completion-records';
import { resetGuideProgress } from './resetGuideProgress';

jest.mock('../../../global-state/completion-store');
jest.mock('../../../lib/user-storage');
jest.mock('../../../completion-records', () => ({
  resolveCompletionIdentity: jest.requireActual('../../../completion-records').resolveCompletionIdentity,
  resolveMilestoneCompletionIdentity:
    jest.requireActual('../../../completion-records').resolveMilestoneCompletionIdentity,
  resolveBundledGuideCompletionIdentity:
    jest.requireActual('../../../completion-records').resolveBundledGuideCompletionIdentity,
  resolveStandaloneGuideCompletionIdentity:
    jest.requireActual('../../../completion-records').resolveStandaloneGuideCompletionIdentity,
  invalidateEmittedCompletion: jest.fn(),
  normalizeGuideId: jest.requireActual('../../../completion-records').normalizeGuideId,
}));

const mockInvalidateEmittedCompletion = invalidateEmittedCompletion as jest.MockedFunction<
  typeof invalidateEmittedCompletion
>;

const mockEvictContentCache = evictContentCache as jest.MockedFunction<typeof evictContentCache>;
const mockInteractiveStepStorage = interactiveStepStorage as jest.Mocked<typeof interactiveStepStorage>;
const mockInteractiveCompletionStorage = interactiveCompletionStorage as jest.Mocked<
  typeof interactiveCompletionStorage
>;
const mockGuideCompletionMarkStorage = guideCompletionMarkStorage as jest.Mocked<typeof guideCompletionMarkStorage>;
const mockMilestoneCompletionStorage = milestoneCompletionStorage as jest.Mocked<typeof milestoneCompletionStorage>;

describe('resetGuideProgress', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInteractiveStepStorage.clearAllForContent.mockResolvedValue(undefined);
    mockInteractiveCompletionStorage.clear.mockResolvedValue(undefined);
    mockGuideCompletionMarkStorage.clear.mockResolvedValue(undefined);
    mockMilestoneCompletionStorage.removeCompleted.mockResolvedValue(undefined);
  });

  it('clears persisted and cached progress and emits the cleared event', async () => {
    const dispatchEvent = jest.spyOn(window, 'dispatchEvent');

    await resetGuideProgress('bundled:e2e-test');

    expect(mockInteractiveStepStorage.clearAllForContent).toHaveBeenCalledWith('bundled:e2e-test');
    expect(mockInteractiveCompletionStorage.clear).toHaveBeenCalledWith('bundled:e2e-test');
    expect(mockGuideCompletionMarkStorage.clear).toHaveBeenCalledWith('bundled:e2e-test');
    expect(mockEvictContentCache).toHaveBeenCalledWith('bundled:e2e-test');
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'interactive-progress-cleared',
        detail: { contentKey: 'bundled:e2e-test' },
      })
    );

    dispatchEvent.mockRestore();
  });

  it('is idempotent', async () => {
    await resetGuideProgress('bundled:e2e-test');
    await resetGuideProgress('bundled:e2e-test');

    expect(mockInteractiveStepStorage.clearAllForContent).toHaveBeenCalledTimes(2);
    expect(mockInteractiveCompletionStorage.clear).toHaveBeenCalledTimes(2);
    expect(mockEvictContentCache).toHaveBeenCalledTimes(2);
  });

  // Reset-then-re-mark defect: without this, a guide re-marked after a reset
  // gets deduped against the completion this reset just erased.
  it('lifts the completion-recorder dedupe guard using the resolved identity', async () => {
    await resetGuideProgress('bundled:e2e-test', {
      packageManifest: { id: 'e2e-test', repository: 'app-platform' },
    });

    expect(mockInvalidateEmittedCompletion).toHaveBeenCalledWith('app-platform', 'e2e-test');
  });

  it('falls back to a content-key-derived identity when no manifest is supplied', async () => {
    await resetGuideProgress('bundled:e2e-test');

    expect(mockInvalidateEmittedCompletion).toHaveBeenCalledWith('bundled', 'e2e-test');
  });

  // `markMilestoneDone` records a manifest-less milestone under its slug
  // alone, so a reset keyed on the milestone's full URL would leave the
  // guard set and silently swallow the second completion. No milestoneSlug
  // is passed here (the caller found no journey context), so this falls to
  // the standalone-guide identity — not 'bundled', since a non-bundled
  // content key was never recorded under that fallback in the first place.
  it('reduces a milestone URL to the slug the milestone was recorded under', async () => {
    await resetGuideProgress('https://grafana.com/docs/learning-journeys/demo/milestone-2/');

    expect(mockInvalidateEmittedCompletion).toHaveBeenCalledWith('interactive-tutorials', 'milestone-2');
  });

  // Regression (captain-approved fix on PR #1927, "legacy-milestone-backfill
  // -resurrects-reset", HIGH): resetting a milestone used to leave the legacy
  // `milestoneCompletionStorage` record untouched, so
  // `backfillLegacyMilestoneCompletion` (learning-journey-helpers.ts) read
  // that still-populated record on the very next render/read and silently
  // rewrote the just-reset milestone back to 100%. A per-milestone reset must
  // also clear this legacy record for the SAME slug.
  it('clears the legacy milestoneCompletionStorage record when resetting a milestone', async () => {
    await resetGuideProgress('https://grafana.com/docs/learning-journeys/demo/milestone-2/content.json', {
      milestoneSlug: 'milestone-2',
      journeyBaseUrl: 'https://grafana.com/docs/learning-journeys/demo/',
    });

    expect(mockMilestoneCompletionStorage.removeCompleted).toHaveBeenCalledWith(
      'https://grafana.com/docs/learning-journeys/demo/',
      'milestone-2'
    );
  });

  it('does not touch milestoneCompletionStorage for an ordinary (non-milestone) reset', async () => {
    await resetGuideProgress('bundled:e2e-test');

    expect(mockMilestoneCompletionStorage.removeCompleted).not.toHaveBeenCalled();
  });

  // Defensive: milestoneSlug and journeyBaseUrl are set together by their one
  // real caller (useContentReset.ts), but a future caller supplying one
  // without the other must not call removeCompleted with an undefined arg.
  it('does not touch milestoneCompletionStorage when milestoneSlug resolves but journeyBaseUrl is absent', async () => {
    await resetGuideProgress('https://grafana.com/docs/learning-journeys/demo/milestone-2/content.json', {
      milestoneSlug: 'milestone-2',
    });

    expect(mockMilestoneCompletionStorage.removeCompleted).not.toHaveBeenCalled();
  });

  // A track-only guide (COMPLETION-MODEL.md decision 10) has no journeyBaseUrl
  // in the same sense a Foundations milestone does — journeyBaseUrl here is
  // set to a track-only guide's own trackMemberBaseUrl fallback, which never
  // has a legacy record to begin with. Confirms this doesn't crash when
  // milestoneSlug resolves but there's nothing to remove.
  it('is a safe no-op when milestoneSlug resolves but there is no legacy record for it', async () => {
    await expect(
      resetGuideProgress('bundled:track-only/content.json', {
        milestoneSlug: 'track-only',
        journeyBaseUrl: 'bundled:the-path/content.json',
      })
    ).resolves.not.toThrow();

    expect(mockMilestoneCompletionStorage.removeCompleted).toHaveBeenCalledWith(
      'bundled:the-path/content.json',
      'track-only'
    );
  });
});
