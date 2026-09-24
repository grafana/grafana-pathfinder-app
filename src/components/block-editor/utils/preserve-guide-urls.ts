import { renderMarkdown } from '@grafana/data';
import type { JsonGuide } from '../../../types/json-guide.types';
import { sanitizeDocumentationHTML } from '../../../security';
import { resolveAssetUrl } from '../../../docs-retrieval';

export function preserveGuideUrls(guide: JsonGuide, baseUrl: string): JsonGuide {
  const source = new URL(baseUrl);
  const webBase = source.protocol === 'http:' || source.protocol === 'https:' ? source.href : 'https://grafana.com/';
  const resolve = (value: string, media: boolean): string => {
    // Grafana routes and in-guide anchors must stay local to the destination stack.
    if (!media && ((value.startsWith('/') && !value.startsWith('//')) || value.startsWith('#'))) {
      return value;
    }
    const resolved = new URL(resolveAssetUrl(value, baseUrl), webBase);
    if (resolved.protocol !== 'https:' && resolved.protocol !== 'http:' && (media || resolved.protocol !== 'mailto:')) {
      throw new Error('This guide contains an unsupported media or link URL.');
    }
    return resolved.href;
  };

  const rewriteHtml = (html: string): string | null => {
    if (!html.trim()) {
      return null;
    }
    const document = new DOMParser().parseFromString(sanitizeDocumentationHTML(html), 'text/html');
    let changed = false;
    for (const element of document.querySelectorAll('[src], [data-src], [href], [poster]')) {
      for (const attribute of ['src', 'data-src', 'href', 'poster']) {
        const value = element.getAttribute(attribute);
        if (value) {
          const replacement = resolve(value, attribute !== 'href');
          if (replacement !== value) {
            element.setAttribute(attribute, replacement);
            changed = true;
          }
        }
      }
    }
    return changed ? sanitizeDocumentationHTML(document.body.innerHTML) : null;
  };

  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map(walk);
    }
    if (!value || typeof value !== 'object') {
      return value;
    }
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(record).map(([key, child]) => {
        if (typeof child === 'string') {
          if (key === 'src' || key === 'poster' || key === 'href') {
            return [key, resolve(child, key !== 'href')];
          }
          if (['content', 'question', 'prompt', 'body', 'text', 'hint'].includes(key)) {
            const html = record.type === 'html' ? child : renderMarkdown(child);
            return [key, rewriteHtml(html) ?? child];
          }
        }
        return [key, walk(child)];
      })
    );
  };
  return { ...guide, blocks: walk(guide.blocks) as JsonGuide['blocks'] };
}
