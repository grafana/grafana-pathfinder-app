import { renderHook } from '@testing-library/react';

import { usePathfinderPluginConfig } from '../../hooks';

import { useAiFixEnabled } from './use-ai-fix-enabled';
import { useIsAssistantAvailable } from './assistant-dev-mode';

jest.mock('../../hooks', () => ({ usePathfinderPluginConfig: jest.fn() }));
jest.mock('./assistant-dev-mode', () => ({ useIsAssistantAvailable: jest.fn() }));

function run(available: boolean, flag: boolean | undefined): boolean {
  (useIsAssistantAvailable as jest.Mock).mockReturnValue(available);
  (usePathfinderPluginConfig as jest.Mock).mockReturnValue({
    config: { enableAiAutoHeal: flag ?? true },
    isResolved: true,
  });
  return renderHook(() => useAiFixEnabled()).result.current;
}

describe('useAiFixEnabled', () => {
  it('is false when the admin opts out', () => {
    expect(run(true, false)).toBe(false);
  });

  it('is false when the assistant is unavailable, whatever the flag says', () => {
    expect(run(false, true)).toBe(false);
    expect(run(false, undefined)).toBe(false);
  });

  it('is true when the assistant is available and the admin has not opted out', () => {
    expect(run(true, true)).toBe(true);
    expect(run(true, undefined)).toBe(true);
  });
});
