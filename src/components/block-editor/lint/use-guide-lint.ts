/**
 * `useGuideLint` — guide-level lint hook with structural-hash caching.
 *
 * Calling `lintGuide(guide)` runs Zod over the whole guide. We cache by the
 * JSON-stringified guide so consecutive renders with an unchanged guide
 * reuse the result. The `useMemo` dependency is the JSON string itself —
 * small guides stringify in microseconds, and a structural mismatch is
 * what we want to invalidate on (object identity changes too eagerly when
 * the editor rebuilds the guide on every render).
 */

import { useMemo } from 'react';
import type { JsonGuide } from '../../../types/json-guide.types';
import { lintGuide, type GuideLintResult } from './guide-lint';

export function useGuideLint(guide: JsonGuide | null | undefined): GuideLintResult {
  const guideJson = guide ? JSON.stringify(guide) : '';
  // eslint-disable-next-line react-hooks/exhaustive-deps -- guide is stable for a given guideJson; we deliberately key on the hash.
  return useMemo(() => lintGuide(guide), [guideJson]);
}
