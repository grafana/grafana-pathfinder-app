/**
 * Resolve the progress storage key for a specific rendered guide.
 *
 * A block-editor preview's own URL wins over the ambient active tab, which may
 * belong to a docs panel mounted alongside the editor — otherwise a preview
 * would hydrate, and persist against, whichever real guide that panel happens
 * to hold. Everything else defers to {@link getContentKey}, because a journey's
 * `content.url` carries a `/content.json` suffix the rest of the progress
 * system does not use.
 *
 * Lives here rather than in either caller because the Mark complete control and
 * the renderer that hosts it must agree on the key: they react to the same
 * reset signal, and a disagreement would re-arm one without the other.
 */
import { getContentKey, sanitizeContentKey } from './content-key';
import { isPreviewContentKey } from './completion-store';

export function resolveGuideContentKey(contentUrl: string | undefined): string {
  if (contentUrl && isPreviewContentKey(contentUrl)) {
    return sanitizeContentKey(contentUrl);
  }
  return getContentKey();
}
