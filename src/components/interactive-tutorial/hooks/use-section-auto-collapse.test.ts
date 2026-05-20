/**
 * PERMANENT — unit tests for `useSectionAutoCollapse`.
 *
 * Covers all four precedence branches of the auto-collapse effect,
 * the storage-write gating by preview mode, the
 * restore-from-storage-on-mount path, and the
 * `resetCollapse()` re-arm gesture used by `handleResetSection`.
 */

import { act, renderHook, waitFor } from '@testing-library/react';

import { useSectionAutoCollapse } from './use-section-auto-collapse';

// In-memory backing store for the harness.
const memoryStore = new Map<string, unknown>();
const collapseKey = (contentKey: string, sectionId: string) => `section-collapse::${contentKey}::${sectionId}`;

jest.mock('../../../lib/user-storage', () => ({
  sectionCollapseStorage: {
    get: jest.fn(async (contentKey: string, sectionId: string) => {
      return (memoryStore.get(collapseKey(contentKey, sectionId)) as boolean) ?? false;
    }),
    set: jest.fn(async (contentKey: string, sectionId: string, value: boolean) => {
      memoryStore.set(collapseKey(contentKey, sectionId), value);
    }),
    clear: jest.fn(async (contentKey: string, sectionId: string) => {
      memoryStore.delete(collapseKey(contentKey, sectionId));
    }),
  },
}));

// `getContentKey` reads `window.__DocsPluginActiveTabUrl` / pathname.
// Default to `/` (non-preview) per the harness convention.
beforeEach(() => {
  memoryStore.clear();
  (window as any).__DocsPluginActiveTabUrl = undefined;
});

const SECTION_ID = 'test-section';
const NON_PREVIEW_KEY = '/';

describe('useSectionAutoCollapse', () => {
  describe('initial state', () => {
    it('starts expanded (isCollapsed=false)', () => {
      const { result } = renderHook(() =>
        useSectionAutoCollapse({
          sectionId: SECTION_ID,
          isCompleted: false,
          isPreviewMode: false,
          autoCollapse: undefined,
          disableAutoCollapse: undefined,
        })
      );
      expect(result.current.isCollapsed).toBe(false);
    });
  });

  describe('toggleCollapse', () => {
    it('flips isCollapsed and persists to storage in non-preview mode', async () => {
      const { result } = renderHook(() =>
        useSectionAutoCollapse({
          sectionId: SECTION_ID,
          isCompleted: false,
          isPreviewMode: false,
          autoCollapse: undefined,
          disableAutoCollapse: undefined,
        })
      );
      act(() => {
        result.current.toggleCollapse();
      });
      expect(result.current.isCollapsed).toBe(true);
      await waitFor(() => {
        expect(memoryStore.get(collapseKey(NON_PREVIEW_KEY, SECTION_ID))).toBe(true);
      });
    });

    it('flips isCollapsed but skips storage write in preview mode', async () => {
      (window as any).__DocsPluginActiveTabUrl = 'block-editor://preview/g1';
      const { result } = renderHook(() =>
        useSectionAutoCollapse({
          sectionId: SECTION_ID,
          isCompleted: false,
          isPreviewMode: true,
          autoCollapse: undefined,
          disableAutoCollapse: undefined,
        })
      );
      act(() => {
        result.current.toggleCollapse();
      });
      expect(result.current.isCollapsed).toBe(true);
      await waitFor(() => {
        expect(memoryStore.get(collapseKey('block-editor://preview/g1', SECTION_ID))).toBeUndefined();
      });
    });
  });

  describe('restore-from-storage on mount', () => {
    it('reads the saved collapse state and applies it (non-preview)', async () => {
      memoryStore.set(collapseKey(NON_PREVIEW_KEY, SECTION_ID), true);
      const { result } = renderHook(() =>
        useSectionAutoCollapse({
          sectionId: SECTION_ID,
          isCompleted: false,
          isPreviewMode: false,
          autoCollapse: undefined,
          disableAutoCollapse: undefined,
        })
      );
      await waitFor(() => {
        expect(result.current.isCollapsed).toBe(true);
      });
    });

    it('ignores storage in preview mode (always start expanded)', async () => {
      (window as any).__DocsPluginActiveTabUrl = 'block-editor://preview/g1';
      memoryStore.set(collapseKey('block-editor://preview/g1', SECTION_ID), true);
      const { result } = renderHook(() =>
        useSectionAutoCollapse({
          sectionId: SECTION_ID,
          isCompleted: false,
          isPreviewMode: true,
          autoCollapse: undefined,
          disableAutoCollapse: undefined,
        })
      );
      // Give the effect a tick to potentially mis-fire — it must not.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(result.current.isCollapsed).toBe(false);
    });
  });

  describe('auto-collapse-on-completion (precedence ladder)', () => {
    it('auto-collapses when isCompleted goes true and persists', async () => {
      const { result, rerender } = renderHook(
        ({ isCompleted }) =>
          useSectionAutoCollapse({
            sectionId: SECTION_ID,
            isCompleted,
            isPreviewMode: false,
            autoCollapse: undefined,
            disableAutoCollapse: undefined,
          }),
        { initialProps: { isCompleted: false } }
      );
      expect(result.current.isCollapsed).toBe(false);
      rerender({ isCompleted: true });
      await waitFor(() => expect(result.current.isCollapsed).toBe(true));
      await waitFor(() => {
        expect(memoryStore.get(collapseKey(NON_PREVIEW_KEY, SECTION_ID))).toBe(true);
      });
    });

    it('does NOT auto-re-collapse after the user manually expands a completed section', async () => {
      // Start expanded + incomplete to avoid the mount-time async-restore
      // vs sync-auto-collapse race (pre-existing in the original component;
      // not part of this hook's contract).
      const { result, rerender } = renderHook(
        ({ isCompleted }) =>
          useSectionAutoCollapse({
            sectionId: SECTION_ID,
            isCompleted,
            isPreviewMode: false,
            autoCollapse: undefined,
            disableAutoCollapse: undefined,
          }),
        { initialProps: { isCompleted: false } }
      );
      // Let the mount-time restore effect settle.
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(result.current.isCollapsed).toBe(false);

      // Completion fires the auto-collapse.
      rerender({ isCompleted: true });
      await waitFor(() => expect(result.current.isCollapsed).toBe(true));

      // User manually expands.
      act(() => {
        result.current.toggleCollapse();
      });
      expect(result.current.isCollapsed).toBe(false);

      // Trigger a rerender while isCompleted stays true. The
      // `hasAutoCollapsedRef` guard must keep us expanded — no
      // re-collapse fire.
      rerender({ isCompleted: true });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(result.current.isCollapsed).toBe(false);
    });

    it('preview mode: never auto-collapses', async () => {
      (window as any).__DocsPluginActiveTabUrl = 'block-editor://preview/g1';
      const { result, rerender } = renderHook(
        ({ isCompleted }) =>
          useSectionAutoCollapse({
            sectionId: SECTION_ID,
            isCompleted,
            isPreviewMode: true,
            autoCollapse: undefined,
            disableAutoCollapse: undefined,
          }),
        { initialProps: { isCompleted: false } }
      );
      rerender({ isCompleted: true });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(result.current.isCollapsed).toBe(false);
    });

    it('author override autoCollapse=false: never auto-collapses', async () => {
      const { result, rerender } = renderHook(
        ({ isCompleted }) =>
          useSectionAutoCollapse({
            sectionId: SECTION_ID,
            isCompleted,
            isPreviewMode: false,
            autoCollapse: false,
            disableAutoCollapse: undefined,
          }),
        { initialProps: { isCompleted: false } }
      );
      rerender({ isCompleted: true });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(result.current.isCollapsed).toBe(false);
    });

    it('user config disableAutoCollapse=true: never auto-collapses', async () => {
      const { result, rerender } = renderHook(
        ({ isCompleted }) =>
          useSectionAutoCollapse({
            sectionId: SECTION_ID,
            isCompleted,
            isPreviewMode: false,
            autoCollapse: undefined,
            disableAutoCollapse: true,
          }),
        { initialProps: { isCompleted: false } }
      );
      rerender({ isCompleted: true });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(result.current.isCollapsed).toBe(false);
    });
  });

  describe('resetCollapse', () => {
    it('expands the section and re-arms the auto-collapse guard for the next completion', async () => {
      const { result, rerender } = renderHook(
        ({ isCompleted }) =>
          useSectionAutoCollapse({
            sectionId: SECTION_ID,
            isCompleted,
            isPreviewMode: false,
            autoCollapse: undefined,
            disableAutoCollapse: undefined,
          }),
        { initialProps: { isCompleted: true } }
      );
      await waitFor(() => expect(result.current.isCollapsed).toBe(true));

      // Reset gesture: handleResetSection calls resetCollapse() then
      // dispatches RESET_SECTION which flips isCompleted to false.
      act(() => {
        result.current.resetCollapse();
      });
      expect(result.current.isCollapsed).toBe(false);

      // Simulate the rerender after RESET → re-completion cycle.
      rerender({ isCompleted: false });
      rerender({ isCompleted: true });
      // The guard was cleared, so a fresh completion re-fires the auto-collapse.
      await waitFor(() => expect(result.current.isCollapsed).toBe(true));
    });
  });
});
