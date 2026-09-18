import { renderHook } from '@testing-library/react';

import { usePluginContext } from '@grafana/data';

import { useAiFixEnabled } from './use-ai-fix-enabled';
import { useIsAssistantAvailable } from './assistant-dev-mode';

jest.mock('@grafana/data', () => ({ usePluginContext: jest.fn() }));
jest.mock('./assistant-dev-mode', () => ({ useIsAssistantAvailable: jest.fn() }));
jest.mock('../../constants', () => ({
  getConfigWithDefaults: (jsonData: Record<string, unknown> | undefined) => ({
    enableAiAutoHeal: (jsonData?.enableAiAutoHeal as boolean | undefined) ?? true,
  }),
}));

function run(available: boolean, flag: boolean | undefined): boolean {
  (useIsAssistantAvailable as jest.Mock).mockReturnValue(available);
  (usePluginContext as jest.Mock).mockReturnValue({ meta: { jsonData: { enableAiAutoHeal: flag } } });
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
