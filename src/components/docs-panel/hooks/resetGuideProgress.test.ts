import { evictContentCache } from '../../../global-state/completion-store';
import {
  guideCompletionMarkStorage,
  interactiveCompletionStorage,
  interactiveStepStorage,
} from '../../../lib/user-storage';
import { invalidateEmittedCompletion } from '../../../completion-records';
import { resetGuideProgress } from './resetGuideProgress';

jest.mock('../../../global-state/completion-store');
jest.mock('../../../lib/user-storage');
jest.mock('../../../completion-records', () => ({
  resolveCompletionIdentity: jest.requireActual('../../../completion-records').resolveCompletionIdentity,
  invalidateEmittedCompletion: jest.fn(),
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

describe('resetGuideProgress', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInteractiveStepStorage.clearAllForContent.mockResolvedValue(undefined);
    mockInteractiveCompletionStorage.clear.mockResolvedValue(undefined);
    mockGuideCompletionMarkStorage.clear.mockResolvedValue(undefined);
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
  // guard set and silently swallow the second completion.
  it('reduces a milestone URL to the slug the milestone was recorded under', async () => {
    await resetGuideProgress('https://grafana.com/docs/learning-journeys/demo/milestone-2/');

    expect(mockInvalidateEmittedCompletion).toHaveBeenCalledWith('bundled', 'milestone-2');
  });
});
