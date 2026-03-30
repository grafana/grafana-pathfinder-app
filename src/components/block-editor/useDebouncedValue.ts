/**
 * useDebouncedValue hook
 *
 * Returns a debounced version of the given value that only updates
 * after the specified delay has elapsed since the last change.
 */

import { useState, useEffect } from 'react';

export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value);
    }, delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
