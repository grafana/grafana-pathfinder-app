/**
 * `useGuideHistory` — block-editor undo/redo backed by a ring buffer.
 *
 * Wraps `useState` with the same call signature so existing setState
 * call sites in `useBlockEditor` keep working unchanged. Every set call
 * pushes the *previous* state onto a `past` stack (capped at
 * `MAX_HISTORY` entries and `MAX_HISTORY_BYTES` of estimated payload),
 * and clears the `future` stack.
 *
 * Mutations that should NOT contribute to history (UI-only changes
 * like view-mode toggles, full guide loads, save acks) opt out by
 * passing `{ skipHistory: true }` as the second argument.
 *
 * Inline editors that fire on every blur/keystroke can pass a
 * `coalesceKey` (e.g. `inlineEdit:<blockId>:title`) so consecutive
 * mutations within the coalesce window merge into a single history
 * entry — undo lands on the *original* pre-edit state, not on each
 * intermediate keystroke.
 *
 * History is in-session only — never persisted. The current state is
 * persisted by the caller (`useBlockPersistence`) as before.
 */

import { useCallback, useRef, useState } from 'react';
import type { BlockEditorState } from '../types';

/** Hard cap on history depth. Older entries are dropped from the bottom of `past`. */
export const MAX_HISTORY = 20;

/**
 * Soft cap on the total serialized size of `past`. When exceeded, the
 * oldest entries are dropped one by one until we're under the limit
 * or only one entry remains. Prevents huge guides from blowing memory.
 */
export const MAX_HISTORY_BYTES = 1_000_000;

/**
 * Window during which mutations sharing a `coalesceKey` collapse into
 * the same history entry. Tuned for inline-edit blur cycles
 * (typically 100-500 ms apart).
 */
export const COALESCE_MS = 500;

export interface HistoryOptions {
  /** Skip pushing this transition to history (UI-only, full-reset, save-ack). */
  skipHistory?: boolean;
  /**
   * If set, mutations sharing the same key within `COALESCE_MS` are
   * merged into one history entry. The first mutation in a sequence
   * still pushes; subsequent ones don't push but still extend the
   * coalesce window.
   */
  coalesceKey?: string;
  /** Optional human-readable label surfaced on undo/redo tooltips. */
  label?: string;
}

interface HistoryEntry {
  state: BlockEditorState;
  label?: string;
}

export type GuideStateSetter = (
  action: BlockEditorState | ((prev: BlockEditorState) => BlockEditorState),
  options?: HistoryOptions
) => void;

export interface UseGuideHistoryReturn {
  state: BlockEditorState;
  setState: GuideStateSetter;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Tooltip-friendly label for the next undo target ("Add block", etc.), or null. */
  undoLabel: string | null;
  /** Tooltip-friendly label for the next redo target, or null. */
  redoLabel: string | null;
  /** Drop all history (used after `loadGuide` / `resetGuide`). */
  resetHistory: () => void;
}

function estimateBytes(entries: HistoryEntry[]): number {
  // Rough — `JSON.stringify` is the canonical "size" measure we care
  // about because that's what would land in localStorage if we ever
  // persisted history. Skip if too many entries to avoid pathological
  // O(n*size) loops on giant guides; the count cap fires first anyway.
  if (entries.length === 0) {
    return 0;
  }
  try {
    return JSON.stringify(entries.map((e) => e.state)).length;
  } catch {
    return 0;
  }
}

export function useGuideHistory(initial: BlockEditorState): UseGuideHistoryReturn {
  const [state, setStateInternal] = useState<BlockEditorState>(initial);

  // Stacks live in refs so internal pushes don't force re-renders;
  // we drive the UI from `historyMeta` instead.
  const pastRef = useRef<HistoryEntry[]>([]);
  const futureRef = useRef<HistoryEntry[]>([]);
  const coalesceRef = useRef<{ key: string | null; until: number }>({ key: null, until: 0 });

  const [historyMeta, setHistoryMeta] = useState<{
    pastLen: number;
    futureLen: number;
    undoLabel: string | null;
    redoLabel: string | null;
  }>({ pastLen: 0, futureLen: 0, undoLabel: null, redoLabel: null });

  const refreshMeta = useCallback(() => {
    const past = pastRef.current;
    const future = futureRef.current;
    setHistoryMeta({
      pastLen: past.length,
      futureLen: future.length,
      undoLabel: past[past.length - 1]?.label ?? null,
      redoLabel: future[0]?.label ?? null,
    });
  }, []);

  const setState: GuideStateSetter = useCallback(
    (action, options) => {
      setStateInternal((prev) => {
        const next =
          typeof action === 'function' ? (action as (p: BlockEditorState) => BlockEditorState)(prev) : action;
        // No-op transitions (same reference) skip history regardless.
        if (next === prev) {
          return prev;
        }

        if (!options?.skipHistory) {
          const now = Date.now();
          const key = options?.coalesceKey ?? null;
          const insideCoalesceWindow =
            key !== null && key === coalesceRef.current.key && now < coalesceRef.current.until;

          if (!insideCoalesceWindow) {
            const past = pastRef.current;
            past.push({ state: prev, label: options?.label });
            // Count cap.
            while (past.length > MAX_HISTORY) {
              past.shift();
            }
            // Size cap (defensive, fires after count cap when payloads
            // are individually huge).
            while (past.length > 1 && estimateBytes(past) > MAX_HISTORY_BYTES) {
              past.shift();
            }
            pastRef.current = past;
            futureRef.current = [];
          }

          coalesceRef.current = key !== null ? { key, until: now + COALESCE_MS } : { key: null, until: 0 };
          refreshMeta();
        }

        return next;
      });
    },
    [refreshMeta]
  );

  const undo = useCallback(() => {
    const past = pastRef.current;
    if (past.length === 0) {
      return;
    }
    setStateInternal((current) => {
      const target = past.pop();
      if (!target) {
        return current;
      }
      pastRef.current = past;
      futureRef.current.unshift({ state: current, label: target.label });
      // Reset coalescing so the next setState starts a fresh entry.
      coalesceRef.current = { key: null, until: 0 };
      refreshMeta();
      return target.state;
    });
  }, [refreshMeta]);

  const redo = useCallback(() => {
    const future = futureRef.current;
    if (future.length === 0) {
      return;
    }
    setStateInternal((current) => {
      const target = future.shift();
      if (!target) {
        return current;
      }
      futureRef.current = future;
      pastRef.current.push({ state: current, label: target.label });
      coalesceRef.current = { key: null, until: 0 };
      refreshMeta();
      return target.state;
    });
  }, [refreshMeta]);

  const resetHistory = useCallback(() => {
    pastRef.current = [];
    futureRef.current = [];
    coalesceRef.current = { key: null, until: 0 };
    refreshMeta();
  }, [refreshMeta]);

  return {
    state,
    setState,
    undo,
    redo,
    canUndo: historyMeta.pastLen > 0,
    canRedo: historyMeta.futureLen > 0,
    undoLabel: historyMeta.undoLabel,
    redoLabel: historyMeta.redoLabel,
    resetHistory,
  };
}
