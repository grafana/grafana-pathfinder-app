/**
 * Modal Manager Hook
 *
 * Manages boolean state for multiple modals in the BlockEditor.
 * Provides a cleaner API than multiple useState calls.
 *
 * Note: isBlockFormOpen is NOT included - it coordinates with persistence
 * and must stay in BlockEditor.
 */

import { useState, useCallback } from 'react';

/**
 * Modal names managed by this hook.
 */
export type ModalName = 'metadata' | 'newGuideConfirm' | 'import' | 'githubPr' | 'tour';

/**
 * Return type for useModalManager hook
 */
export interface UseModalManagerReturn {
  /** Check if a modal is open */
  isOpen: (name: ModalName) => boolean;
  /** Open a modal */
  open: (name: ModalName) => void;
  /** Close a modal */
  close: (name: ModalName) => void;
  /** Toggle a modal */
  toggle: (name: ModalName) => void;
}

/**
 * Manages boolean state for multiple modals.
 * Provides a cleaner API than multiple useState calls.
 */
export function useModalManager(): UseModalManagerReturn {
  const [openModals, setOpenModals] = useState<Set<ModalName>>(new Set());

  const isOpen = useCallback(
    (name: ModalName): boolean => {
      return openModals.has(name);
    },
    [openModals]
  );

  const open = useCallback((name: ModalName): void => {
    setOpenModals((prev) => {
      const next = new Set(prev);
      next.add(name);
      return next;
    });
  }, []);

  const close = useCallback((name: ModalName): void => {
    setOpenModals((prev) => {
      const next = new Set(prev);
      next.delete(name);
      return next;
    });
  }, []);

  const toggle = useCallback((name: ModalName): void => {
    setOpenModals((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }, []);

  return { isOpen, open, close, toggle };
}
