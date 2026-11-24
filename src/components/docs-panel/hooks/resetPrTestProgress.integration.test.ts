import {
  createLocalStorage,
  guideCompletionMarkStorage,
  interactiveCompletionStorage,
  interactiveStepStorage,
  sectionAcknowledgementStorage,
  sectionDoneStorage,
  setGlobalStorage,
} from '../../../lib/user-storage';
import { resetPrTestProgress } from './resetGuideProgress';

// Real-storage exercise of acceptance criterion 4 of #2349: several preview
// generations plus a real guide seeded across every per-content progress
// namespace, then only the preview records must be gone. Unlike
// resetGuideProgress.test.ts (which mocks user-storage), this runs the actual
// localStorage-backed storage so the marker-scan and the reset path are
// verified end to end.
jest.mock('@grafana/runtime', () => ({
  usePluginUserStorage: jest.fn(),
  getAppEvents: jest.fn(),
}));

const marked = (fetchId: string) => `https://example.com/raw/guide.json#pf-pr-${fetchId}`;
const REAL_GUIDE = 'https://grafana.com/docs/learning-journeys/demo/content.json';

async function seed(contentKey: string): Promise<void> {
  await interactiveStepStorage.setCompleted(contentKey, 'section-1', new Set(['step-1', 'step-2']));
  await sectionAcknowledgementStorage.set(contentKey, 'section-1', true);
  await sectionDoneStorage.set(contentKey, 'section-1', true);
  await interactiveCompletionStorage.set(contentKey, 75);
  await guideCompletionMarkStorage.set(contentKey, true);
}

async function hasAnyRecord(contentKey: string): Promise<boolean> {
  return (
    (await interactiveStepStorage.hasProgress(contentKey)) ||
    (await sectionAcknowledgementStorage.get(contentKey, 'section-1')) === true ||
    (await sectionDoneStorage.get(contentKey, 'section-1')) === true ||
    (await interactiveCompletionStorage.get(contentKey)) > 0 ||
    guideCompletionMarkStorage.isMarked(contentKey)
  );
}

describe('resetPrTestProgress (real storage)', () => {
  beforeEach(() => {
    localStorage.clear();
    setGlobalStorage(createLocalStorage());
  });

  it('removes every preview generation across all namespaces and leaves the real guide intact', async () => {
    const previewOne = marked('abc1');
    const previewTwo = marked('def2');

    await seed(previewOne);
    await seed(previewTwo);
    await seed(REAL_GUIDE);

    // Sanity: everything is present before the reset.
    expect(await hasAnyRecord(previewOne)).toBe(true);
    expect(await hasAnyRecord(previewTwo)).toBe(true);
    expect(await hasAnyRecord(REAL_GUIDE)).toBe(true);

    await resetPrTestProgress();

    // Every preview record, in every namespace, is gone.
    expect(await hasAnyRecord(previewOne)).toBe(false);
    expect(await hasAnyRecord(previewTwo)).toBe(false);

    // The real guide's records are untouched.
    expect(await interactiveStepStorage.hasProgress(REAL_GUIDE)).toBe(true);
    expect(await sectionAcknowledgementStorage.get(REAL_GUIDE, 'section-1')).toBe(true);
    expect(await sectionDoneStorage.get(REAL_GUIDE, 'section-1')).toBe(true);
    expect(await interactiveCompletionStorage.get(REAL_GUIDE)).toBe(75);
    expect(guideCompletionMarkStorage.isMarked(REAL_GUIDE)).toBe(true);
  });
});
