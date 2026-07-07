/**
 * `useSectionAutoCollapse` — owns the collapsed/expanded state of an
 * interactive section.
 *
 * Three orthogonal behaviours collapsed into one hook:
 *   1. Manual toggle via `toggleCollapse` (with storage persistence
 *      gated by preview mode).
 *   2. Restore-from-storage on mount (skipped in preview mode).
 *   3. Auto-collapse-once-on-completion, with an internal
 *      `hasAutoCollapsedRef` guard so a manual expand isn't fought
 *      by the effect on the next render.
 *
 * Precedence order for auto-collapse (matching the pre-extraction
 * behaviour exactly):
 *   preview mode > author `autoCollapse: false` > user
 *   `disableAutoCollapse` config > default auto-collapse on
 *   completion.
 *
 * `resetCollapse()` is exposed for `handleResetSection`'s
 * "expand-and-re-arm" use case. It mirrors the two-line gesture from
 * the pre-extraction component (clear `isCollapsed`; clear
 * `hasAutoCollapsedRef`) so a future re-completion re-fires the
 * auto-collapse.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { sectionCollapseStorage } from '../../../lib/user-storage';
import { getContentKey } from '../get-content-key';

export interface UseSectionAutoCollapseArgs {
  sectionId: string;
  /** Whether the section is currently in a completed state (derived
   *  state from the reducer + objectives + ack). */
  isCompleted: boolean;
  /** Block-editor preview key — disables all storage writes and
   *  forces the section to start expanded. */
  isPreviewMode: boolean;
  /** Author opt-out: `autoCollapse={false}` on the section JSX. */
  autoCollapse: boolean | undefined;
  /** User config opt-out via plugin settings. */
  disableAutoCollapse: boolean | undefined;
}

export interface UseSectionAutoCollapseResult {
  isCollapsed: boolean;
  toggleCollapse: () => void;
  /** Force the section back to expanded + clear the
   *  auto-collapse-once guard. Used by `handleResetSection`. */
  resetCollapse: () => void;
}

export function useSectionAutoCollapse({
  sectionId,
  isCompleted,
  isPreviewMode,
  autoCollapse,
  disableAutoCollapse,
}: UseSectionAutoCollapseArgs): UseSectionAutoCollapseResult {
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Track if we've already auto-collapsed to prevent re-collapsing on
  // manual expand.
  const hasAutoCollapsedRef = useRef(false);

  // Toggle collapse state and persist to storage (skip persistence in
  // preview mode).
  const toggleCollapse = useCallback(() => {
    const newCollapseState = !isCollapsed;
    setIsCollapsed(newCollapseState);
    if (!isPreviewMode) {
      const contentKey = getContentKey();
      sectionCollapseStorage.set(contentKey, sectionId, newCollapseState);
    }
  }, [isCollapsed, sectionId, isPreviewMode]);

  // Restore collapse state from storage on mount (skip in preview mode).
  useEffect(() => {
    if (isPreviewMode) {
      return;
    }
    const restoreCollapseState = async () => {
      const contentKey = getContentKey();
      const savedCollapseState = await sectionCollapseStorage.get(contentKey, sectionId);
      setIsCollapsed(savedCollapseState);
    };
    restoreCollapseState();
  }, [sectionId, isPreviewMode]);

  // Auto-collapse section when it becomes complete (but only once,
  // don't override manual expansion). Precedence: preview mode >
  // author autoCollapse > user disableAutoCollapse > default.
  useEffect(() => {
    if (isPreviewMode) {
      return;
    }
    if (autoCollapse === false) {
      return;
    }
    if (disableAutoCollapse) {
      return;
    }
    if (isCompleted && !hasAutoCollapsedRef.current) {
      hasAutoCollapsedRef.current = true;
      // The ref guard above makes this setState conditional on the
      // first transition to `isCompleted=true`; it cannot loop.
      setIsCollapsed(true);
      const contentKey = getContentKey();
      sectionCollapseStorage.set(contentKey, sectionId, true);
    } else if (!isCompleted) {
      // Reset the flag when section becomes incomplete (e.g., after reset).
      hasAutoCollapsedRef.current = false;
    }
  }, [isCompleted, sectionId, isPreviewMode, autoCollapse, disableAutoCollapse]);

  const resetCollapse = useCallback(() => {
    setIsCollapsed(false);
    hasAutoCollapsedRef.current = false;
  }, []);

  return { isCollapsed, toggleCollapse, resetCollapse };
}
