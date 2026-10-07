import { useEffect } from 'react';

import { registerGuideIdentity } from '../../completion-records';
import { resolveSurfaceGuideIdentity, type SurfaceCompletionInput } from '../../docs-retrieval';
import { resolveGuideContentKey } from '../../global-state/guide-content-key';

/**
 * Register the rendered guide's completion identity under the content key its
 * progress is announced on, for as long as this surface renders it.
 *
 * Pass the same input the surface hands `recordGuideCompletionForSurface`, so
 * live progress and the terminal completion key on one identity. `null` input
 * registers nothing.
 */
export function useGuideIdentityRegistration(
  contentUrl: string | undefined,
  input: SurfaceCompletionInput | null
): void {
  const identity = input ? resolveSurfaceGuideIdentity(input) : null;
  const guideSource = identity?.guideSource;
  const guideId = identity?.guideId;
  const guideTitle = identity?.guideTitle;
  const guideCategory = identity?.guideCategory;
  const pathId = identity?.pathId;

  useEffect(() => {
    if (!guideSource || !guideId || guideTitle === undefined || !guideCategory) {
      return;
    }
    // Resolved here, not during render: the panel publishes the active tab URL
    // in a layout effect, which has run by the time passive effects do.
    const contentKey = resolveGuideContentKey(contentUrl);
    if (!contentKey) {
      return;
    }
    return registerGuideIdentity(contentKey, { guideSource, guideId, guideTitle, guideCategory, pathId });
  }, [contentUrl, guideSource, guideId, guideTitle, guideCategory, pathId]);
}
