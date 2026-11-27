import { renderHook } from '@testing-library/react';
import { getContentKey, resetContentKeyForTests, setActiveTabUrl } from '../global-state/content-key';
import { usePublishSurfaceContentKey } from './usePublishSurfaceContentKey';

beforeEach(() => {
  resetContentKeyForTests();
  delete window.__DocsPluginActiveTabUrl;
  delete window.__DocsPluginContentKey;
});

afterEach(() => {
  resetContentKeyForTests();
  delete window.__DocsPluginActiveTabUrl;
  delete window.__DocsPluginContentKey;
});

it('restores a companion key after a nested preview closes', () => {
  const companion = 'bundled:create-your-first-guide/content.json';
  setActiveTabUrl(companion);
  window.__DocsPluginActiveTabUrl = companion;
  const { unmount } = renderHook(() =>
    usePublishSurfaceContentKey('block-editor://preview/practice', { restorePrevious: true })
  );
  expect(getContentKey()).toBe('block-editor://preview/practice');
  unmount();
  expect(getContentKey()).toBe(companion);
  expect(window.__DocsPluginActiveTabUrl).toBe(companion);
});

it('does not overwrite a different surface opened while a preview was mounted', () => {
  setActiveTabUrl('bundled:original/content.json');
  const { unmount } = renderHook(() =>
    usePublishSurfaceContentKey('block-editor://preview/practice', { restorePrevious: true })
  );
  setActiveTabUrl('bundled:other/content.json');
  window.__DocsPluginActiveTabUrl = 'bundled:other/content.json';
  unmount();
  expect(getContentKey()).toBe('bundled:other/content.json');
});

it('keeps a newer sidebar key even when only the legacy global changed', () => {
  setActiveTabUrl('bundled:original/content.json');
  const { unmount } = renderHook(() =>
    usePublishSurfaceContentKey('block-editor://preview/practice', { restorePrevious: true })
  );
  window.__DocsPluginActiveTabUrl = 'bundled:other/content.json';
  unmount();
  expect(getContentKey()).toBe('bundled:other/content.json');
});

it('retains the default legacy-global behavior for normal surface handoff', () => {
  const { unmount } = renderHook(() => usePublishSurfaceContentKey('bundled:guide/content.json'));
  unmount();
  expect(window.__DocsPluginActiveTabUrl).toBe('bundled:guide/content.json');
});
