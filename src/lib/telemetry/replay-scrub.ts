import type { ReplayInstrumentationOptions } from '@grafana/faro-instrumentation-replay';
import { stripUrlSecrets } from './url';

type ReplayEvent = Parameters<NonNullable<ReplayInstrumentationOptions['beforeSend']>>[0];

const EVENT_TYPE_FULL_SNAPSHOT = 2;
const EVENT_TYPE_INCREMENTAL_SNAPSHOT = 3;
const EVENT_TYPE_META = 4;

// Emotion's insertRule traffic and React's inline-style writes arrive as their
// own incremental sources rather than as DOM mutations, so each one is a
// separate route CSS takes to the collector.
const INCREMENTAL_SOURCE_MUTATION = 0;
const INCREMENTAL_SOURCE_STYLESHEET_RULE = 8;
const INCREMENTAL_SOURCE_FONT = 10;
const INCREMENTAL_SOURCE_STYLE_DECLARATION = 13;
const INCREMENTAL_SOURCE_ADOPTED_STYLESHEET = 15;

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
// reasoned about, and an unrecognized attribute is exactly where the next leak
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
  // that rr_dataURL (a rasterized canvas) stays out.
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
//
// The three arms are not interchangeable. A quoted URL may legally contain
// parentheses (`url("a(1).png")`, or a data: SVG full of them), so it has to
// run to its closing quote rather than to the first `)`. An unquoted one may
// not contain parens, quotes or whitespace at all, so there the stricter class
// is what keeps the match from running past the end of the value.
const CSS_URL_PATTERN = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^'")\s]*))\s*\)/gi;

// Not every CSS resource reference is wrapped in url(): `@import "a.css?t=…"`
// and `image-set("a.png?sig=…" 1x)` are bare strings. Both are Grafana-origin
// in practice, so this is depth rather than a known leak.
const CSS_IMPORT_PATTERN = /(@import\s+)(["'])([^"']*)\2/gi;
const CSS_IMAGE_SET_OPEN = /(?:-webkit-)?image-set\(/gi;
const CSS_QUOTED_STRING = /(["'])([^"']*)\1/g;
// Every quoted string in an image-set argument list is a resource reference
// except the MIME type in `type("image/avif")`, which a URL rewrite would
// mangle into an absolute path.
const CSS_IMAGE_SET_ENTRY = /(type\(\s*)?(["'])([^"']*)\2/g;

// `content` and custom properties are the two declarations that can put
// author-supplied text on screen, and rrweb masks neither: stylesheet text is
// exempt from maskTextSelector (masking it would strip the page of styling),
// and CSSOM writes never pass through the text path at all.
//
// The value runs to the declaration's end, but `;` and `}` are legal inside a
// quoted string — `content: "Acme; Inc"` — so the quoted arms have to consume
// those before the bare class sees them. The three arms cannot match the same
// first character, so there is no backtracking to pay for.
const CSS_TEXT_DECLARATION = /(^|[^\w-])((?:content|--[\w-]+)\s*:\s*)((?:[^;}"']|"[^"]*"|'[^']*')*)/gi;
const CSS_TEXT_PROPERTY = /^(?:content|--)/i;

// Escapes survive masking so `content: "\e900"` still draws its icon glyph
// rather than an asterisk; everything else in the string is author text.
const CSS_ESCAPE_OR_GLYPH = /\\(?:[0-9a-f]{1,6}\s?|[\s\S])|\S/gi;

// Same case-insensitivity as the patterns it guards, and deliberately not
// `toLowerCase().includes(...)` — that would copy the whole stylesheet on
// every call just to decide there is nothing to do. Non-global, so it carries
// no lastIndex state between calls. The `content` arm excludes `align-content`
// and `justify-content`, which are everywhere in Grafana's flex layouts.
const HAS_SCRUBBABLE_CSS = /url\(|@import|image-set\(|(?:^|[^\w-])content\s*:|--[\w-]+\s*:/i;

function maskCssString(text: string): string {
  return text.replace(CSS_ESCAPE_OR_GLYPH, (token) => (token.startsWith('\\') ? token : '*'));
}

function maskQuotedStrings(value: string): string {
  return value.replace(
    CSS_QUOTED_STRING,
    (_match, quote: string, text: string) => `${quote}${maskCssString(text)}${quote}`
  );
}

// Resource functions are stepped over rather than masked — their targets came
// through the URL pass already, and asterisking one would break the image.
// Everything around them is still author text: `content: url(i.png) / "alt"`
// is the standard alt-text form and puts a real string beside a real URL, so
// skipping the whole declaration on sight of a `url(` would ship it.
const CSS_RESOURCE_OPEN = /(?:-webkit-)?(?:url|image-set)\(/gi;

function maskCssTextValue(value: string): string {
  CSS_RESOURCE_OPEN.lastIndex = 0;
  let masked = '';
  let cursor = 0;
  let opening: RegExpExecArray | null;
  while ((opening = CSS_RESOURCE_OPEN.exec(value)) !== null) {
    const resourceEnd = findClosingParen(value, opening.index + opening[0].length);
    if (resourceEnd < 0) {
      break;
    }
    masked += maskQuotedStrings(value.slice(cursor, opening.index)) + value.slice(opening.index, resourceEnd + 1);
    cursor = resourceEnd + 1;
    CSS_RESOURCE_OPEN.lastIndex = cursor;
  }
  return masked + maskQuotedStrings(value.slice(cursor));
}

function findClosingParen(css: string, from: number): number {
  let depth = 1;
  let quote = '';
  for (let index = from; index < css.length; index++) {
    const char = css[index];
    if (quote) {
      if (char === '\\') {
        index++;
      } else if (char === quote) {
        quote = '';
      }
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '(') {
      depth++;
    } else if (char === ')' && --depth === 0) {
      return index;
    }
  }
  return -1;
}

// image-set mixes url() entries with bare strings, and either can contain a
// parenthesis — `image-set(url(a.png) 1x, "b.png?sig=…" 2x)` and a filename
// like `a(1).png` both defeat a match that stops at the first `)`, leaving
// every later entry unscrubbed. Walking to the balanced close is what makes
// the whole argument list reachable.
function scrubImageSets(css: string): string {
  CSS_IMAGE_SET_OPEN.lastIndex = 0;
  let scrubbed = '';
  let cursor = 0;
  let opening: RegExpExecArray | null;
  while ((opening = CSS_IMAGE_SET_OPEN.exec(css)) !== null) {
    const argsStart = opening.index + opening[0].length;
    const argsEnd = findClosingParen(css, argsStart);
    if (argsEnd < 0) {
      break;
    }
    const args = css
      .slice(argsStart, argsEnd)
      .replace(CSS_IMAGE_SET_ENTRY, (match, mimeType: string | undefined, _quote, target: string) =>
        mimeType === undefined ? `"${stripUrlSecrets(target)}"` : match
      );
    scrubbed += css.slice(cursor, argsStart) + args;
    cursor = argsEnd;
    CSS_IMAGE_SET_OPEN.lastIndex = argsEnd;
  }
  return cursor === 0 ? css : scrubbed + css.slice(cursor);
}

function scrubCss(css: string): string {
  // Emotion rewrites rules constantly, so the common case has to stay cheap.
  if (!HAS_SCRUBBABLE_CSS.test(css)) {
    return css;
  }
  const withUrlsScrubbed = scrubImageSets(
    css
      .replace(CSS_URL_PATTERN, (match, doubleQuoted?: string, singleQuoted?: string, bare?: string): string => {
        const target = doubleQuoted ?? singleQuoted ?? bare ?? '';
        return target.startsWith('#') ? match : `url("${stripUrlSecrets(target)}")`;
      })
      .replace(CSS_IMPORT_PATTERN, (_match, keyword: string, _quote, target: string) => {
        return `${keyword}"${stripUrlSecrets(target)}"`;
      })
  );
  return withUrlsScrubbed.replace(
    CSS_TEXT_DECLARATION,
    (_match, before: string, property: string, value: string) => `${before}${property}${maskCssTextValue(value)}`
  );
}

function scrubCssText(value: unknown): unknown {
  return typeof value === 'string' ? scrubCss(value) : value;
}

// A CSSOM write arrives as a property/value pair rather than as a declaration,
// so the text mask has no `content:` to key off and needs the name passed in.
function scrubCssDeclaration(property: unknown, value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  const scrubbed = scrubCss(value);
  return typeof property === 'string' && CSS_TEXT_PROPERTY.test(property) ? maskCssTextValue(scrubbed) : scrubbed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// An attribute mutation carries `style` as rrweb's styleOMValue diff — a map
// of property to either a string or a [value, priority] pair — rather than the
// flat string a snapshot carries.
function scrubStyleDiff(style: Record<string, unknown>): void {
  for (const key of Object.keys(style)) {
    const value = style[key];
    if (typeof value === 'string') {
      style[key] = scrubCssDeclaration(key, value);
    } else if (Array.isArray(value) && typeof value[0] === 'string') {
      value[0] = scrubCssDeclaration(key, value[0]);
    }
  }
}

function scrubAttributes(attributes: Record<string, unknown>): void {
  for (const key of Object.keys(attributes)) {
    const value = attributes[key];
    if (URL_ATTRIBUTES.has(key)) {
      if (typeof value === 'string') {
        attributes[key] = stripUrlSecrets(value);
      }
    } else if (CSS_ATTRIBUTES.has(key)) {
      if (isRecord(value)) {
        scrubStyleDiff(value);
      } else {
        attributes[key] = scrubCssText(value);
      }
    } else if (!SAFE_ATTRIBUTES.has(key)) {
      delete attributes[key];
    }
  }
}

function scrubStyleRules(rules: unknown): void {
  if (!Array.isArray(rules)) {
    return;
  }
  for (const entry of rules) {
    if (isRecord(entry)) {
      entry.rule = scrubCssText(entry.rule);
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
      child.textContent = scrubCss(child.textContent);
    }
  }
}

// rrweb's masking is TEXT_NODE-only, and neither it nor our options slim
// comments out, so a comment's textContent is serialized verbatim. Pathfinder's
// own sanitizer strips comments and React's markers hold no data, which leaves
// third-party panel plugins as the only realistic writer — cheap enough to
// close rather than reason about per plugin.
const NODE_TYPE_COMMENT = 5;

function maskCommentText(node: Record<string, unknown>): void {
  if (node.type === NODE_TYPE_COMMENT && typeof node.textContent === 'string') {
    node.textContent = node.textContent.replace(/\S/g, '*');
  }
}

function scrubNode(node: unknown): void {
  if (!isRecord(node)) {
    return;
  }
  if (isRecord(node.attributes)) {
    scrubAttributes(node.attributes);
  }
  maskCommentText(node);
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

  if (type !== EVENT_TYPE_INCREMENTAL_SNAPSHOT) {
    return event;
  }

  switch (data.source) {
    case INCREMENTAL_SOURCE_MUTATION: {
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
      // Text mutations are masked to asterisks except inside <style>, where
      // rrweb leaves the CSS intact — so this only has real work to do in the
      // stylesheet case, and is a no-op everywhere else.
      if (Array.isArray(data.texts)) {
        for (const text of data.texts) {
          if (isRecord(text)) {
            text.value = scrubCssText(text.value);
          }
        }
      }
      break;
    }
    case INCREMENTAL_SOURCE_STYLESHEET_RULE: {
      scrubStyleRules(data.adds);
      if (typeof data.replace === 'string') {
        data.replace = scrubCss(data.replace);
      }
      if (typeof data.replaceSync === 'string') {
        data.replaceSync = scrubCss(data.replaceSync);
      }
      break;
    }
    case INCREMENTAL_SOURCE_ADOPTED_STYLESHEET: {
      if (Array.isArray(data.styles)) {
        for (const sheet of data.styles) {
          if (isRecord(sheet)) {
            scrubStyleRules(sheet.rules);
          }
        }
      }
      break;
    }
    case INCREMENTAL_SOURCE_STYLE_DECLARATION: {
      if (isRecord(data.set)) {
        data.set.value = scrubCssDeclaration(data.set.property, data.set.value);
      }
      break;
    }
    case INCREMENTAL_SOURCE_FONT: {
      // collectFonts is off, so this should never arrive — but fontSource is a
      // bare URL, not CSS, and that default is not this module's to rely on.
      if (typeof data.fontSource === 'string') {
        data.fontSource = stripUrlSecrets(data.fontSource);
      }
      break;
    }
  }

  return event;
}
