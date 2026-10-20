/**
 * Guide details state for the block editor: the author's explicit manifest choices, and the notice
 * that tells them which name a save attributed their guide to.
 *
 * Held in editor memory and written at the next backend save — there is no local-draft slot for it.
 * The author name lives only in this state and the UI it feeds; it is never logged or reported.
 */

import { useCallback, useState } from 'react';
import type { DefaultedAuthor, GuideDetails } from '../utils/derive-manifest';

export interface UseGuideDetailsReturn {
  details: GuideDetails;
  /** Fold modal changes over the current ones; an omitted field is left as it was, an undefined one is cleared. */
  applyDetails: (changes: GuideDetails) => void;
  /** Name the last save attributed the guide to, until dismissed or the guide changes. */
  authorNotice: DefaultedAuthor | null;
  announceAuthor: (defaulted: DefaultedAuthor) => void;
  dismissAuthorNotice: () => void;
  /** Forget everything — a different guide is now open. */
  resetDetails: () => void;
}

export function useGuideDetails(): UseGuideDetailsReturn {
  const [details, setDetails] = useState<GuideDetails>({});
  const [authorNotice, setAuthorNotice] = useState<DefaultedAuthor | null>(null);

  const applyDetails = useCallback((changes: GuideDetails) => {
    setDetails((prev) => ({ ...prev, ...changes }));
    if ('authorName' in changes) {
      setAuthorNotice(null);
    }
  }, []);

  const announceAuthor = useCallback((defaulted: DefaultedAuthor) => setAuthorNotice(defaulted), []);
  const dismissAuthorNotice = useCallback(() => setAuthorNotice(null), []);
  const resetDetails = useCallback(() => {
    setDetails({});
    setAuthorNotice(null);
  }, []);

  return { details, applyDetails, authorNotice, announceAuthor, dismissAuthorNotice, resetDetails };
}
