import React from 'react';
import { act, render, renderHook, waitFor } from '@testing-library/react';
import { config } from '@grafana/runtime';
import { StorageKeys } from '../lib/storage-keys';
import { resetGuideLanguageStateForTests } from '../global-state/guide-language';
import { resetGuideTranslationsFlagCache } from '../utils/guide-translations-enablement';
import { useGuideLanguage } from './useGuideLanguage';

const mockFlag = jest.fn();
jest.mock('../utils/openfeature', () => ({
  getFeatureFlagValue: (flag: string, fallback: boolean) => mockFlag(flag, fallback),
}));

const store = new Map<string, unknown>();
const mockGetItem = jest.fn(async (key: string) => (store.has(key) ? store.get(key) : null));
const mockSetItem = jest.fn(async (key: string, value: unknown) => {
  store.set(key, value);
});
const mockStorage = { getItem: mockGetItem, setItem: mockSetItem, removeItem: jest.fn(), clear: jest.fn() };
let mockSynced: Promise<void> = Promise.resolve();
jest.mock('../lib/user-storage', () => ({
  useUserStorage: () => mockStorage,
  whenGrafanaStorageSynced: () => mockSynced,
}));

interface SurfaceProps {
  onRender: (value: ReturnType<typeof useGuideLanguage>) => void;
}
function SidebarSurface({ onRender }: SurfaceProps): null {
  onRender(useGuideLanguage({ guideKey: 'guide-a' }));
  return null;
}
function FloatingSurface({ onRender }: SurfaceProps): null {
  onRender(useGuideLanguage({ guideKey: 'guide-a' }));
  return null;
}

function setGate(enabled: boolean): void {
  mockFlag.mockImplementation((_flag: string, fallback: boolean) => (enabled ? true : fallback));
  resetGuideTranslationsFlagCache();
}

function setUiLocale(language: string | undefined): void {
  (config.bootData as { user?: unknown }).user = { language };
}

beforeEach(() => {
  jest.clearAllMocks();
  store.clear();
  mockSynced = Promise.resolve();
  resetGuideLanguageStateForTests();
  setUiLocale('ja-JP');
});

describe('useGuideLanguage with the gate on', () => {
  beforeEach(() => setGate(true));

  it("follows Grafana's UI locale by default", async () => {
    const { result } = renderHook(() => useGuideLanguage());
    await waitFor(() => expect(mockGetItem).toHaveBeenCalledWith(StorageKeys.GUIDE_LANGUAGE));
    expect(result.current).toMatchObject({
      enabled: true,
      preferred: 'follow-grafana',
      effective: 'ja-JP',
      override: null,
    });
  });

  it('falls back to the canonical language when Grafana reports no locale', () => {
    setUiLocale(undefined);
    const { result } = renderHook(() => useGuideLanguage({ canonicalLanguage: 'en' }));
    expect(result.current.effective).toBe('en');
  });

  it('uses the saved tag', async () => {
    store.set(StorageKeys.GUIDE_LANGUAGE, 'fr');
    const { result } = renderHook(() => useGuideLanguage());
    await waitFor(() => expect(result.current.preferred).toBe('fr'));
    expect(result.current.effective).toBe('fr');
  });

  it.each(['nonsense value', 12, ''])('reads an invalid stored value %j as follow-grafana', async (stored) => {
    store.set(StorageKeys.GUIDE_LANGUAGE, stored);
    const { result } = renderHook(() => useGuideLanguage());
    await waitFor(() => expect(mockGetItem).toHaveBeenCalled());
    await act(async () => {});
    expect(result.current.preferred).toBe('follow-grafana');
    expect(result.current.effective).toBe('ja-JP');
  });

  it('persists a chosen preference to user storage', async () => {
    const { result } = renderHook(() => useGuideLanguage());
    await act(async () => {
      await result.current.setPreferred('de-DE');
    });
    expect(mockSetItem).toHaveBeenCalledWith(StorageKeys.GUIDE_LANGUAGE, 'de-DE');
    expect(result.current.preferred).toBe('de-DE');
    expect(result.current.effective).toBe('de-DE');
  });

  it('saves follow-grafana when the reader returns to the default', async () => {
    store.set(StorageKeys.GUIDE_LANGUAGE, 'fr');
    const { result } = renderHook(() => useGuideLanguage());
    await waitFor(() => expect(result.current.preferred).toBe('fr'));
    await act(async () => {
      await result.current.setPreferred('follow-grafana');
    });
    expect(mockSetItem).toHaveBeenCalledWith(StorageKeys.GUIDE_LANGUAGE, 'follow-grafana');
    expect(result.current.effective).toBe('ja-JP');
  });

  it('ignores an invalid preference instead of saving it', async () => {
    const { result } = renderHook(() => useGuideLanguage());
    await act(async () => {
      await result.current.setPreferred('not a tag');
    });
    expect(mockSetItem).not.toHaveBeenCalled();
    expect(result.current.preferred).toBe('follow-grafana');
  });

  it('shares the preference between hook instances', async () => {
    const first = renderHook(() => useGuideLanguage());
    const second = renderHook(() => useGuideLanguage());
    await act(async () => {
      await first.result.current.setPreferred('ko');
    });
    expect(second.result.current.preferred).toBe('ko');
  });

  it('picks up a preference that the Grafana storage sync brings in after mount', async () => {
    let finishSync: () => void = () => undefined;
    mockSynced = new Promise((resolve) => (finishSync = resolve));
    const { result } = renderHook(() => useGuideLanguage());
    await act(async () => {});
    expect(result.current.preferred).toBe('follow-grafana');
    await act(async () => {
      store.set(StorageKeys.GUIDE_LANGUAGE, 'fr');
      finishSync();
    });
    expect(result.current.preferred).toBe('fr');
    expect(result.current.effective).toBe('fr');
  });

  it('does not let a late read overwrite a preference chosen meanwhile', async () => {
    let resolveRead: (value: unknown) => void = () => undefined;
    mockGetItem.mockImplementationOnce(() => new Promise((resolve) => (resolveRead = resolve)));
    const { result } = renderHook(() => useGuideLanguage());
    await act(async () => {
      await result.current.setPreferred('ko');
    });
    await act(async () => {
      resolveRead('fr');
    });
    expect(result.current.preferred).toBe('ko');
  });

  describe('one-shot override', () => {
    it('wins over the saved tag and is never written to storage', async () => {
      store.set(StorageKeys.GUIDE_LANGUAGE, 'fr');
      const { result } = renderHook(() => useGuideLanguage());
      await waitFor(() => expect(result.current.preferred).toBe('fr'));
      act(() => result.current.applyOneShotOverride('ja'));
      expect(result.current.override).toBe('ja');
      expect(result.current.effective).toBe('ja');
      expect(result.current.preferred).toBe('fr');
      expect(mockSetItem).not.toHaveBeenCalled();
    });

    it('is cleared by clearOverride', () => {
      const { result } = renderHook(() => useGuideLanguage());
      act(() => result.current.applyOneShotOverride('ja'));
      act(() => result.current.clearOverride());
      expect(result.current.override).toBeNull();
      expect(result.current.effective).toBe('ja-JP');
    });

    it('ignores an invalid tag', () => {
      const { result } = renderHook(() => useGuideLanguage());
      act(() => result.current.applyOneShotOverride('nonsense value'));
      expect(result.current.override).toBeNull();
    });

    it('binds to the guide named when it is applied and is cleared when another guide opens', () => {
      setUiLocale('en-US');
      const { result, rerender } = renderHook(({ guideKey }) => useGuideLanguage({ guideKey }), {
        initialProps: { guideKey: 'guide-a' },
      });
      act(() => result.current.applyOneShotOverride('ja', 'guide-a'));
      rerender({ guideKey: 'guide-a' });
      expect(result.current.effective).toBe('ja');
      rerender({ guideKey: 'guide-b' });
      expect(result.current.override).toBeNull();
      expect(result.current.effective).toBe('en-US');
    });

    it('binds to the guide already open and does not carry over to the next guide', () => {
      setUiLocale('en-US');
      const { result, rerender } = renderHook(({ guideKey }) => useGuideLanguage({ guideKey }), {
        initialProps: { guideKey: 'guide-a' },
      });
      act(() => result.current.applyOneShotOverride('ja'));
      expect(result.current.effective).toBe('ja');
      rerender({ guideKey: 'guide-a' });
      expect(result.current.effective).toBe('ja');
      rerender({ guideKey: 'guide-b' });
      expect(result.current.override).toBeNull();
      expect(result.current.effective).toBe('en-US');
    });

    it('does not survive closing and reopening the guide it is bound to', async () => {
      setUiLocale('en-US');
      const { result, rerender } = renderHook(({ guideKey }) => useGuideLanguage({ guideKey }), {
        initialProps: { guideKey: 'guide-a' as string | undefined },
      });
      act(() => result.current.applyOneShotOverride('ja'));
      rerender({ guideKey: undefined });
      await act(async () => {});
      rerender({ guideKey: 'guide-a' });
      expect(result.current.override).toBeNull();
      expect(result.current.effective).toBe('en-US');
    });

    it('is dropped when its guide unmounts', async () => {
      const guide = renderHook(() => useGuideLanguage({ guideKey: 'guide-a' }));
      act(() => guide.result.current.applyOneShotOverride('ja'));
      guide.unmount();
      await act(async () => {});
      const reopened = renderHook(() => useGuideLanguage({ guideKey: 'guide-a' }));
      expect(reopened.result.current.override).toBeNull();
    });

    it('stays while another instance still shows its guide', async () => {
      const slot = renderHook(() => useGuideLanguage({ guideKey: 'guide-a' }));
      const resolver = renderHook(() => useGuideLanguage({ guideKey: 'guide-a' }));
      act(() => slot.result.current.applyOneShotOverride('ja'));
      slot.unmount();
      await act(async () => {});
      expect(resolver.result.current.override).toBe('ja');
      act(() => resolver.result.current.clearOverride());
      act(() => resolver.result.current.applyOneShotOverride('ko'));
      const nextGuide = renderHook(() => useGuideLanguage({ guideKey: 'guide-b' }));
      expect(nextGuide.result.current.override).toBeNull();
    });

    it('survives the same guide remounting on another surface in one commit', async () => {
      let latest: ReturnType<typeof useGuideLanguage> | undefined;
      const onRender = (value: ReturnType<typeof useGuideLanguage>) => {
        latest = value;
      };
      const view = render(React.createElement(SidebarSurface, { onRender }));
      act(() => latest?.applyOneShotOverride('ja'));
      view.rerender(React.createElement(FloatingSurface, { onRender }));
      await act(async () => {});
      expect(latest?.override).toBe('ja');
    });

    it('applies to the first guide opened after it is set, and only to that open', async () => {
      setUiLocale('en-US');
      const { result, rerender } = renderHook(({ guideKey }) => useGuideLanguage({ guideKey }), {
        initialProps: { guideKey: undefined as string | undefined },
      });
      act(() => result.current.applyOneShotOverride('ko'));
      rerender({ guideKey: 'guide-a' });
      expect(result.current.effective).toBe('ko');
      rerender({ guideKey: 'guide-a' });
      expect(result.current.effective).toBe('ko');
      rerender({ guideKey: undefined });
      await act(async () => {});
      rerender({ guideKey: 'guide-a' });
      expect(result.current.override).toBeNull();
      expect(result.current.effective).toBe('en-US');
    });
  });
});

describe('useGuideLanguage with the gate off', () => {
  beforeEach(() => setGate(false));

  it('reports disabled and the guide canonical language whatever the reader prefers', async () => {
    store.set(StorageKeys.GUIDE_LANGUAGE, 'fr');
    const { result } = renderHook(() => useGuideLanguage({ canonicalLanguage: 'en' }));
    await act(async () => {});
    expect(result.current.enabled).toBe(false);
    expect(result.current.effective).toBe('en');
    expect(result.current.override).toBeNull();
  });

  it('keeps the canonical language of a guide that is not English', () => {
    const { result } = renderHook(() => useGuideLanguage({ canonicalLanguage: 'pt-BR' }));
    expect(result.current.effective).toBe('pt-BR');
  });

  it('does not read user storage', async () => {
    renderHook(() => useGuideLanguage());
    await act(async () => {});
    expect(mockGetItem).not.toHaveBeenCalled();
  });

  it('neither changes nor saves the preference when asked to set one', async () => {
    const { result } = renderHook(() => useGuideLanguage());
    await act(async () => {
      await result.current.setPreferred('de-DE');
    });
    expect(mockSetItem).not.toHaveBeenCalled();
    expect(result.current.preferred).toBe('follow-grafana');
    expect(result.current.effective).toBe('en');
  });

  it('does nothing when asked to apply an override', () => {
    const { result } = renderHook(() => useGuideLanguage());
    act(() => result.current.applyOneShotOverride('ja'));
    expect(result.current.override).toBeNull();
    expect(result.current.effective).toBe('en');
  });

  it('ignores an override that was set while the gate was on', () => {
    setGate(true);
    const on = renderHook(() => useGuideLanguage());
    act(() => on.result.current.applyOneShotOverride('ja'));
    setGate(false);
    const off = renderHook(() => useGuideLanguage());
    expect(off.result.current.override).toBeNull();
    expect(off.result.current.effective).toBe('en');
  });
});
