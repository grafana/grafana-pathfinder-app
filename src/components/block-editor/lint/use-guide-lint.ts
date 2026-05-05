/**
 * `useGuideLint` — guide-level lint hook with structural-hash caching.
 *
 * Calling `lintGuide(guide)` runs Zod over the whole guide, which is fine
 * once but expensive if a parent component re-renders frequently. We cache
 * by the JSON-stringified guide so consecutive renders with an unchanged
 * guide reuse the result. The hash is the JSON itself — small guides
 * stringify in microseconds, and a structural mismatch is what we want.
 */

import { useMemo, useRef } from 'react';
import type { JsonGuide } from '../../../types/json-guide.types';
import { lintGuide, type GuideLintResult } from './guide-lint';

export function useGuideLint(guide: JsonGuide | null | undefined): GuideLintResult {
  const lastJsonRef = useRef<string | null>(null);
  const lastResultRef = useRef<GuideLintResult | null>(null);

  return useMemo(() => {
    if (!guide) {
      return lintGuide(null);
    }
    const json = JSON.stringify(guide);
    if (json === lastJsonRef.current && lastResultRef.current) {
      return lastResultRef.current;
    }
    const result = lintGuide(guide);
    lastJsonRef.current = json;
    lastResultRef.current = result;
    return result;
  }, [guide]);
}
