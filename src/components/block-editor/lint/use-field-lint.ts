/**
 * `useFieldLint` — debounced field-level lint hook.
 *
 * Returns a stable `Diagnostic[]` whose computation is debounced (~150ms) so
 * we don't lint on every keystroke. We deliberately do NOT call the heavy
 * `validateGuide` here — only the much cheaper `validateConditionString`
 * via `lintConditionField`.
 */

import { useMemo } from 'react';
import { useDebouncedValue } from '../useDebouncedValue';
import { lintConditionField } from './field-lint';
import type { Diagnostic } from './types';

export interface UseFieldLintOptions {
  /** Debounce in ms. Default 150ms. */
  debounceMs?: number;
  /** Pass `false` only in tests to disable mid-edit suppression. */
  suppressInProgress?: boolean;
}

const EMPTY: Diagnostic[] = [];

export function useFieldLint(value: string, options: UseFieldLintOptions = {}): Diagnostic[] {
  const { debounceMs = 150, suppressInProgress = true } = options;
  const debounced = useDebouncedValue(value, debounceMs);
  return useMemo(() => {
    const result = lintConditionField(debounced, { suppressInProgress });
    return result.diagnostics.length === 0 ? EMPTY : result.diagnostics;
  }, [debounced, suppressInProgress]);
}
