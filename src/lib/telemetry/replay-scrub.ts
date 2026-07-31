import type { ReplayInstrumentationOptions } from '@grafana/faro-instrumentation-replay';
import { stripUrlSecrets } from './url';

type ReplayEvent = Parameters<NonNullable<ReplayInstrumentationOptions['beforeSend']>>[0];

const EVENT_TYPE_FULL_SNAPSHOT = 2;
const EVENT_TYPE_INCREMENTAL_SNAPSHOT = 3;
const EVENT_TYPE_META = 4;
const INCREMENTAL_SOURCE_MUTATION = 0;

const URL_ATTRIBUTES = new Set([
  'src',
  'href',
  'xlink:href',
  'poster',
  'action',
  'formaction',
  'data',
  'cite',
  'rr_src',
]);

// Allowlisted for rendering, but their values are CSS, so they get url()
// treatment rather than passing through verbatim.
const CSS_ATTRIBUTES = new Set(['style', '_cssText']);

// Allowlist, not denylist. rrweb masks text but never attributes, and Grafana
// puts real content in them — `data-testid="Panel header <panel title>"`,
// `aria-label`, `title`, `alt`, `placeholder`. With every text node already
// masked there is nothing to gain from keeping an attribute we haven't
// reasoned about, and an unrecognised attribute is exactly where the next leak
// lives. So: rendering-affecting and enumerated-value attributes only.
const SAFE_ATTRIBUTES = new Set([
  'class',
  'id',
  'type',
  'width',
  'height',
  'size',
  'rows',
  'cols',
  'colspan',
  'rowspan',
  'span',
  'start',
  'dir',
  'lang',
  'hidden',
  'disabled',
  'checked',
  'selected',
  'readonly',
  'multiple',
  'open',
  'reversed',
  'wrap',
  'inert',
  'popover',
  'tabindex',
  'draggable',
  'contenteditable',
  'spellcheck',
  'translate',
  'align',
  'valign',
  'border',
  'cellpadding',
  'cellspacing',
  'target',
  'rel',
  'media',
  'loading',
  'decoding',
  'crossorigin',
  'scope',
  'for',
  'headers',
  // ARIA that Grafana and its component libraries style on. The free-text
  // members of the family (aria-label, aria-description, aria-valuetext,
  // aria-placeholder, aria-roledescription) are deliberately absent.
  'role',
  'aria-hidden',
  'aria-expanded',
  'aria-selected',
  'aria-checked',
  'aria-current',
  'aria-pressed',
  'aria-disabled',
  'aria-invalid',
  'aria-busy',
  'aria-live',
  'aria-orientation',
  'aria-haspopup',
  // SVG geometry and paint — Grafana's icons and chart axes are unreadable
  // without these, and none of them can carry text.
  'd',
  'points',
  'viewBox',
  'preserveAspectRatio',
  'x',
  'y',
  'dx',
  'dy',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-opacity',
  'stroke-miterlimit',
  'opacity',
  'transform',
  'offset',
  'stop-color',
  'stop-opacity',
  'gradientUnits',
  'gradientTransform',
  'patternUnits',
  'spreadMethod',
  'clip-path',
  'clip-rule',
  'mask',
  'filter',
  'overflow',
  'display',
  'visibility',
  'pointer-events',
  'vector-effect',
  'shape-rendering',
  'marker-start',
  'marker-mid',
  'marker-end',
  'text-anchor',
  'dominant-baseline',
  'font-size',
  'font-family',
  'font-weight',
  'font-style',
  'letter-spacing',
  'xmlns',
  'xmlns:xlink',
  'version',
  // rrweb's own synthetic attributes, enumerated rather than prefix-matched so
  // that rr_dataURL (a rasterised canvas) stays out.
  'rr_width',
  'rr_height',
  'rr_scrollLeft',
  'rr_scrollTop',
  'rr_open',
  'rr_split',
  'rr_mediaState',
  'rr_mediaCurrentTime',
  'rr_mediaPlaybackRate',
  'rr_mediaMuted',
  'rr_mediaLoop',
  'rr_mediaVolume',
]);

// CSS is the one allowlisted value that can still smuggle a URL, and rrweb
// absolutifies those before we see them: a relative `url(logo.png?sig=…)`
// arrives fully qualified with the query intact.
const CSS_URL_PATTERN = /url\(\s*(['"]?)([^'")]*)\1\s*\)/gi;

function scrubCssUrls(css: string): string {
  return css.replace(CSS_URL_PATTERN, (match, _quote, target: string) =>
    target.startsWith('#') ? match : `url("${stripUrlSecrets(target)}")`
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function scrubAttributes(attributes: Record<string, unknown>): void {
  for (const key of Object.keys(attributes)) {
    const value = attributes[key];
    if (URL_ATTRIBUTES.has(key)) {
      if (typeof value === 'string') {
        attributes[key] = stripUrlSecrets(value);
      }
    } else if (CSS_ATTRIBUTES.has(key)) {
      if (typeof value === 'string') {
        attributes[key] = scrubCssUrls(value);
      }
    } else if (!SAFE_ATTRIBUTES.has(key)) {
      delete attributes[key];
    }
  }
}

// rrweb never masks the text inside <style> (masking it would strip the page
// of all styling), and it emits _cssText for any <style> with a live sheet
// whether or not inlineStylesheet is set — so stylesheet text reaches the
// collector by two routes, both needing the same url() treatment.
function scrubStyleText(node: Record<string, unknown>): void {
  if (String(node.tagName).toLowerCase() !== 'style' || !Array.isArray(node.childNodes)) {
    return;
  }
  for (const child of node.childNodes) {
    if (isRecord(child) && typeof child.textContent === 'string') {
      child.textContent = scrubCssUrls(child.textContent);
    }
  }
}

function scrubNode(node: unknown): void {
  if (!isRecord(node)) {
    return;
  }
  if (isRecord(node.attributes)) {
    scrubAttributes(node.attributes);
  }
  scrubStyleText(node);
  if (Array.isArray(node.childNodes)) {
    for (const child of node.childNodes) {
      scrubNode(child);
    }
  }
}

// Mutates in place. rrweb hands over the event it has just built and keeps no
// reference to it, and a full snapshot of a Grafana page is far too large to
// deep-clone on every emit.
export function scrubReplayEvent(event: ReplayEvent): ReplayEvent {
  const type: number = event.type;
  const data: unknown = event.data;
  if (!isRecord(data)) {
    return event;
  }

  if (type === EVENT_TYPE_META) {
    if (typeof data.href === 'string') {
      data.href = stripUrlSecrets(data.href);
    }
    return event;
  }

  if (type === EVENT_TYPE_FULL_SNAPSHOT) {
    scrubNode(data.node);
    return event;
  }

  if (type === EVENT_TYPE_INCREMENTAL_SNAPSHOT && data.source === INCREMENTAL_SOURCE_MUTATION) {
    if (Array.isArray(data.adds)) {
      for (const added of data.adds) {
        if (isRecord(added)) {
          scrubNode(added.node);
        }
      }
    }
    if (Array.isArray(data.attributes)) {
      for (const mutation of data.attributes) {
        if (isRecord(mutation) && isRecord(mutation.attributes)) {
          scrubAttributes(mutation.attributes);
        }
      }
    }
  }

  return event;
}
