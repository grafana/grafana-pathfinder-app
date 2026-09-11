import { evictContentCache } from '../../../global-state/completion-store';
import {
  guideCompletionMarkStorage,
  interactiveCompletionStorage,
  interactiveStepStorage,
} from '../../../lib/user-storage';
import { resetGuideProgress } from './resetGuideProgress';

jest.mock('../../../global-state/completion-store');
jest.mock('../../../lib/user-storage');

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
});
