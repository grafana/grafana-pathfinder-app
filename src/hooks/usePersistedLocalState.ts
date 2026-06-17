/**
 * `usePersistedLocalState` — a small `useState` wrapper that lazy-reads its
 * initial value from `localStorage` and writes through to localStorage on
 * every change.
 *
 * Replaces the hand-rolled `useState(() => localStorage.getItem(KEY) || x)`
 * + `useEffect(() => localStorage.setItem(KEY, ...))` pattern that was
 * duplicated across the dev/UI-pref components surveyed in
 * `.cursor/local/USER_STORAGE_ANALYSIS.md`:
 *   - PrTester, UrlTester, SelectorDebugPanel (devtool prefs)
 *   - HealthStatusBar, ConditionChipsField (block-editor UI prefs)
 *
 * Designed for ephemeral *UI preferences* — anything where a localStorage
 * read miss should fall back to a fixed default without surfacing an error.
 * Quota and parse failures are deliberately swallowed in line with the
 * existing call-site contract; UI state is local-only and not synced to
 * Grafana user storage.
 *
 * Three flavors are provided so callers don't have to write the same
 * deserialize/serialize boilerplate every time:
 *
 *   - `usePersistedString`    → string values, stored as-is
 *   - `usePersistedBoolean`   → boolean values, stored as `"true"` / `"false"`
 *   - `usePersistedLocalState` → arbitrary `T`, callers provide
 *                                serialize / deserialize callbacks
 */
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

export interface UsePersistedLocalStateOptions<T> {
  /** Storage key — must come from `StorageKeys` for new call sites. */
  key: string;
  /** Default returned when the key is absent or deserialize fails. */
  defaultValue: T;
  /** Convert the storage string into `T`. Throwing falls back to `defaultValue`. */
  deserialize: (raw: string) => T;
  /** Convert `T` into the string to store. */
  serialize: (value: T) => string;
}

/**
 * Generic persisted-state hook. Reads `key` once on mount via the lazy
 * initializer; writes on every state change via an effect. Returns the
 * same `[value, setValue]` tuple as `useState`.
 */
export function usePersistedLocalState<T>({
  key,
  defaultValue,
  deserialize,
  serialize,
}: UsePersistedLocalStateOptions<T>): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored === null) {
        return defaultValue;
      }
      return deserialize(stored);
    } catch {
      return defaultValue;
    }
  });

  // Skip the write on the first effect run. The mount write would otherwise
  // turn the default value into a persisted value, changing observable
  // behavior for call sites that previously only wrote on user-driven change.
  const isFirstEffectRun = useRef(true);

  useEffect(() => {
    if (isFirstEffectRun.current) {
      isFirstEffectRun.current = false;
      return;
    }
    try {
      localStorage.setItem(key, serialize(value));
    } catch {
      // Storage unavailable / quota — UI preferences degrade silently.
    }
  }, [key, value, serialize]);

  return [value, setValue];
}

/**
 * String-valued persisted state. The default is `''` unless overridden.
 */
export function usePersistedString(
  key: string,
  defaultValue = ''
): [string, Dispatch<SetStateAction<string>>] {
  const deserialize = useCallback((raw: string) => raw, []);
  const serialize = useCallback((value: string) => value, []);
  return usePersistedLocalState({
    key,
    defaultValue,
    deserialize,
    serialize,
  });
}

/**
 * Boolean-valued persisted state. Stored as `"true"` / `"false"` strings
 * for compatibility with existing call sites. Only `"true"` is treated as
 * `true` on read — any other value defaults to `false` (or `defaultValue`
 * when the key is absent).
 */
export function usePersistedBoolean(
  key: string,
  defaultValue = false
): [boolean, Dispatch<SetStateAction<boolean>>] {
  const deserialize = useCallback((raw: string) => raw === 'true', []);
  const serialize = useCallback((value: boolean) => String(value), []);
  return usePersistedLocalState({
    key,
    defaultValue,
    deserialize,
    serialize,
  });
}
