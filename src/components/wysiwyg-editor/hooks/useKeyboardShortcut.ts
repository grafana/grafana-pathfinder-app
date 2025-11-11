import { useEffect } from 'react';

export type KeyboardShortcutHandler = (event: KeyboardEvent) => void;

export interface KeyboardShortcutOptions {
  key: string;
  handler: KeyboardShortcutHandler;
  enabled?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}

/**
 * Hook that handles keyboard shortcuts
 * @param options - Configuration for the keyboard shortcut
 */
export function useKeyboardShortcut(options: KeyboardShortcutOptions): void {
  const { key, handler, enabled = true, ctrlKey, shiftKey, altKey, metaKey } = options;

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const matches =
        event.key === key &&
        (ctrlKey === undefined || event.ctrlKey === ctrlKey) &&
        (shiftKey === undefined || event.shiftKey === shiftKey) &&
        (altKey === undefined || event.altKey === altKey) &&
        (metaKey === undefined || event.metaKey === metaKey);

      if (matches) {
        handler(event);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [key, handler, enabled, ctrlKey, shiftKey, altKey, metaKey]);
}

/**
 * Hook that handles the Escape key
 * @param handler - Callback function to execute when Escape is pressed
 * @param enabled - Whether the hook is active (default: true)
 */
export function useEscapeKey(handler: KeyboardShortcutHandler, enabled = true): void {
  useKeyboardShortcut({ key: 'Escape', handler, enabled });
}
