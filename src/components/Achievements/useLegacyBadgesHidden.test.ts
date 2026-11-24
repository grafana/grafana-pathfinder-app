import { act, renderHook } from '@testing-library/react';

import {
  __resetAchievementDisplayForTests,
  __setAchievementDisplayDepsForTests,
} from '../../completion-records/achievements/achievement-display';
import type { MyAchievementsResult } from '../../completion-records/achievements';

import { useLegacyBadgesHidden } from './useLegacyBadgesHidden';

const mockFlag = jest.fn(() => true);
jest.mock('../../utils/openfeature', () => ({ useBooleanFlag: () => mockFlag() }));

const available: MyAchievementsResult = {
  kind: 'ok',
  data: { capability: { available: true }, truncated: false, awards: [], progress: [], legacy: [] },
};

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  __resetAchievementDisplayForTests();
  mockFlag.mockReturnValue(true);
});

describe('useLegacyBadgesHidden', () => {
  it('hides the legacy badges once /my reports achievements available', async () => {
    __setAchievementDisplayDepsForTests({ fetchMy: async () => available });
    const { result } = renderHook(() => useLegacyBadgesHidden());
    expect(result.current).toBe(false);
    await settle();
    expect(result.current).toBe(true);
  });

  it('keeps the legacy badges when achievements are unavailable', async () => {
    __setAchievementDisplayDepsForTests({ fetchMy: async () => ({ kind: 'unavailable' }) });
    const { result } = renderHook(() => useLegacyBadgesHidden());
    await settle();
    expect(result.current).toBe(false);
  });

  it('keeps the legacy badges and makes no request when the flag is off', async () => {
    mockFlag.mockReturnValue(false);
    const fetchMy = jest.fn(async () => available);
    __setAchievementDisplayDepsForTests({ fetchMy });
    const { result } = renderHook(() => useLegacyBadgesHidden());
    await settle();
    expect(result.current).toBe(false);
    expect(fetchMy).not.toHaveBeenCalled();
  });
});
