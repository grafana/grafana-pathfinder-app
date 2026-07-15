/**
 * Resolve a media/asset `src` against the base URL a guide was fetched from.
 *
 * Absolute URLs (`http(s)://`, protocol-relative `//`, `data:`) pass through
 * untouched. Relative values (`assets/demo.mp4`, `/media/demo.mp4`) resolve
 * against `baseUrl` so self-hosted assets can be co-located with the guide's
 * `content.json`. Synthetic bases used by the block editor and bundled
 * loaders (`block-editor://`, `bundled:`) are not real origins, so they fall
 * back to `https://grafana.com/` — matching image handling.
 */
export function resolveAssetUrl(src: string, baseUrl?: string): string {
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
