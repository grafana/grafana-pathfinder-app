import { activePrPreview } from '../../../lib/pr-preview-fetch';
import { mapPreviewContentUrl } from '../../../lib/pr-preview-core';
import { stripPrTestMarker } from '../../../lib/pr-test-marker';

export function resolveAssetUrl(src: string, baseUrl?: string): string {
  const snapshot = baseUrl ? activePrPreview(baseUrl) : undefined;
  if (snapshot) {
    try {
      return stripPrTestMarker(mapPreviewContentUrl(new URL(src, baseUrl).href, snapshot, snapshot.fetchId));
    } catch {
      return '';
    }
  }
  if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('//') || src.startsWith('data:')) {
    return src;
  }

  if (!baseUrl) {
    return src;
  }

  const effectiveBaseUrl =
    baseUrl.startsWith('http://') || baseUrl.startsWith('https://') ? baseUrl : 'https://grafana.com/';

  return new URL(src, effectiveBaseUrl).href;
}
