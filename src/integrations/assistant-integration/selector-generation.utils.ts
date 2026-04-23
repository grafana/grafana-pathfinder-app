/**
 * Selector regeneration utilities
 *
 * Helpers for "Regenerate selector with Assistant". We build a structured
 * summary of the target element (tag, role, text, stable attributes,
 * ancestry) plus a grounded list of candidate selectors produced by the
 * deterministic generator, and feed that into useInlineAssistant. The model
 * is instructed to pick or refine a candidate rather than invent selectors
 * from scratch.
 */

import { generateFallbackSelectors, getSelectorInfo, querySelectorAllEnhanced, type SelectorInfo } from '../../lib/dom';
import { SELECTOR_BEST_PRACTICES } from './guide-generation.utils';

const MAX_TEXT_LENGTH = 80;
const MAX_CANDIDATES = 4;
const MAX_PATH_NODES = 25;
const MAX_SIBLINGS = 5;
const STABLE_DATA_ATTRS = new Set([
  'data-testid',
  'data-cy',
  'data-test-id',
  'data-qa',
  'data-test-subj',
  'data-role',
  'data-column',
  'data-panel-id',
]);

export interface AncestorSummary {
  tag: string;
  testId?: string;
  id?: string;
  role?: string;
  dataAttrs?: Record<string, string>;
}

export interface SiblingSummary {
  /** Position relative to the target: "prev" (precedes it) or "next" (follows it). */
  position: 'prev' | 'next';
  tag: string;
  testId?: string;
  id?: string;
  role?: string;
  text?: string;
  value?: string;
}

export interface ElementContext {
  tag: string;
  role?: string;
  id?: string;
  text?: string;
  ariaLabel?: string;
  name?: string;
  placeholder?: string;
  href?: string;
  title?: string;
  testId?: string;
  value?: string;
  inputType?: string;
  dataAttrs: Record<string, string>;
  classes: string[];
  ancestors: AncestorSummary[];
  /**
   * Full DOM path from the document root (or the nearest sensible ancestor)
   * down to the target element. Each entry is a short string summary of one
   * node — tag plus any surviving stable attributes. Dropped intermediates
   * become a single "... (N omitted)" marker.
   */
  fullDomPath: string[];
  /** Stable siblings in the target's parent, useful for sibling-scoped selectors. */
  siblings: SiblingSummary[];
  selectorInfo: Pick<SelectorInfo, 'method' | 'isUnique' | 'matchCount' | 'quality' | 'warnings' | 'stabilityScore'>;
  candidates: string[];
}

/**
 * True when a class name looks like a meaningful BEM/component class rather
 * than an emotion/auto-generated hash. We keep this intentionally simple —
 * the downstream model only uses it as a hint.
 */
function isMeaningfulClass(className: string): boolean {
  if (!className || className.length > 60) {
    return false;
  }
  if (/^css-/.test(className)) {
    return false;
  }
  if (/^[A-Za-z]+-[a-f0-9]{5,}$/.test(className)) {
    return false;
  }
  if (/[a-f0-9]{8,}/.test(className)) {
    return false;
  }
  return true;
}

function getVisibleText(el: HTMLElement): string | undefined {
  const raw = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
  if (!raw) {
    return undefined;
  }
  return raw.slice(0, MAX_TEXT_LENGTH);
}

function collectDataAttrs(el: Element, onlyStable = false): Record<string, string> {
  const result: Record<string, string> = {};
  for (const attr of Array.from(el.attributes)) {
    if (!attr.name.startsWith('data-')) {
      continue;
    }
    if (onlyStable && !STABLE_DATA_ATTRS.has(attr.name)) {
      continue;
    }
    if (attr.value.length > 200) {
      continue;
    }
    result[attr.name] = attr.value;
  }
  return result;
}

function summariseAncestor(el: Element): AncestorSummary {
  const summary: AncestorSummary = {
    tag: el.tagName.toLowerCase(),
  };
  const testId = el.getAttribute('data-testid');
  if (testId) {
    summary.testId = testId;
  }
  const id = el.getAttribute('id');
  if (id && !/\d{3,}/.test(id)) {
    summary.id = id;
  }
  const role = el.getAttribute('role');
  if (role) {
    summary.role = role;
  }
  const stableAttrs = collectDataAttrs(el, true);
  if (Object.keys(stableAttrs).length > 0) {
    summary.dataAttrs = stableAttrs;
  }
  return summary;
}

/**
 * Walk up at most `maxDepth` ancestors, keeping those that expose a stable
 * anchor (test id, non-generated id, stable data-* attribute, or role).
 */
function collectAncestors(el: HTMLElement, maxDepth = 5): AncestorSummary[] {
  const result: AncestorSummary[] = [];
  let current: Element | null = el.parentElement;
  let depth = 0;
  while (current && depth < maxDepth) {
    const hasTestId = !!current.getAttribute('data-testid');
    const id = current.getAttribute('id');
    const hasStableId = id && !/\d{3,}/.test(id);
    const hasRole = !!current.getAttribute('role');
    const hasStableData = Object.keys(collectDataAttrs(current, true)).length > 0;
    if (hasTestId || hasStableId || hasRole || hasStableData) {
      result.push(summariseAncestor(current));
    }
    current = current.parentElement;
    depth += 1;
  }
  return result;
}

/**
 * Short one-line summary of an element for inclusion in the DOM path string.
 * Keeps only stability-surviving attributes (test ids, roles, stable data-*
 * attributes, stable ids, meaningful classes, input value/type).
 */
export function summariseElementForPath(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const parts: string[] = [tag];

  const id = el.getAttribute('id');
  if (id && !/:[a-z0-9]+:/i.test(id) && !/^[a-f0-9]{8,}$/i.test(id) && id.length < 40) {
    parts.push(`#${id}`);
  }

  const classes = Array.from(el.classList).filter(isMeaningfulClass).slice(0, 2);
  for (const cls of classes) {
    parts.push(`.${cls}`);
  }

  const attrs: string[] = [];
  const testId = el.getAttribute('data-testid');
  if (testId && testId.length < 60) {
    attrs.push(`data-testid='${testId}'`);
  }
  const role = el.getAttribute('role');
  if (role) {
    attrs.push(`role='${role}'`);
  }
  const stableData = collectDataAttrs(el, true);
  for (const [k, v] of Object.entries(stableData)) {
    if (k === 'data-testid') {
      continue;
    }
    if (v.length < 50) {
      attrs.push(`${k}='${v}'`);
    }
  }
  if (tag === 'input') {
    const type = (el as HTMLInputElement).type;
    if (type) {
      attrs.push(`type='${type}'`);
    }
    const value = el.getAttribute('value');
    if (value && value.length < 40 && !/\s/.test(value)) {
      attrs.push(`value='${value}'`);
    }
  }
  if (tag === 'a' && el.hasAttribute('href')) {
    const href = el.getAttribute('href')!;
    if (href.length < 80) {
      attrs.push(`href='${href}'`);
    }
  }
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.length < 60) {
    attrs.push(`aria-label='${ariaLabel}'`);
  }

  if (attrs.length > 0) {
    parts.push(`[${attrs.join(' ')}]`);
  }

  return parts.join('');
}

/**
 * Walk from the element up to the document root and return a cleaned summary
 * for each node, truncated from the top when the chain is very long.
 */
function buildFullDomPath(el: HTMLElement): string[] {
  const chain: Element[] = [];
  let current: Element | null = el;
  while (current && current !== document.documentElement) {
    chain.push(current);
    current = current.parentElement;
  }
  if (current === document.documentElement) {
    chain.push(document.documentElement);
  }
  chain.reverse(); // root -> target

  if (chain.length <= MAX_PATH_NODES) {
    return chain.map(summariseElementForPath);
  }
  // Keep the first few (near root) and the last MAX_PATH_NODES-few (near target).
  const keepHead = 2;
  const keepTail = MAX_PATH_NODES - keepHead - 1; // -1 for the omitted marker
  const omitted = chain.length - keepHead - keepTail;
  return [
    ...chain.slice(0, keepHead).map(summariseElementForPath),
    `... (${omitted} intermediate node${omitted === 1 ? '' : 's'} omitted)`,
    ...chain.slice(-keepTail).map(summariseElementForPath),
  ];
}

/**
 * Collect stable-looking siblings (same parent) of the target. Useful for
 * sibling-combinator selectors the assistant might emit.
 */
function collectSiblings(el: HTMLElement): SiblingSummary[] {
  const parent = el.parentElement;
  if (!parent) {
    return [];
  }
  const children = Array.from(parent.children);
  const targetIdx = children.indexOf(el);
  if (targetIdx < 0) {
    return [];
  }
  const summaries: SiblingSummary[] = [];
  for (let i = 0; i < children.length; i++) {
    if (i === targetIdx) {
      continue;
    }
    const sib = children[i]!;
    const summary: SiblingSummary = {
      position: i < targetIdx ? 'prev' : 'next',
      tag: sib.tagName.toLowerCase(),
    };
    const testId = sib.getAttribute('data-testid');
    if (testId) {
      summary.testId = testId;
    }
    const id = sib.getAttribute('id');
    if (id && !/:[a-z0-9]+:/i.test(id)) {
      summary.id = id;
    }
    const role = sib.getAttribute('role');
    if (role) {
      summary.role = role;
    }
    const text = (sib as HTMLElement).innerText || sib.textContent || '';
    const normalizedText = text.trim().replace(/\s+/g, ' ').slice(0, 60);
    if (normalizedText) {
      summary.text = normalizedText;
    }
    if (sib.tagName === 'INPUT' || sib.tagName === 'OPTION') {
      const value = sib.getAttribute('value');
      if (value) {
        summary.value = value.slice(0, 40);
      }
    }
    // Only keep siblings that have at least one stable identifier.
    if (summary.testId || summary.id || summary.role || summary.text || summary.value) {
      summaries.push(summary);
    }
    if (summaries.length >= MAX_SIBLINGS) {
      break;
    }
  }
  return summaries;
}

/**
 * Build a structured summary of an element suitable for inclusion in the
 * selector regeneration prompt. Never returns raw HTML.
 */
export function buildElementContext(el: HTMLElement, currentSelector: string): ElementContext {
  const classes = Array.from(el.classList).filter(isMeaningfulClass).slice(0, 6);
  const info = getSelectorInfo(el);
  const candidates = [currentSelector, ...generateFallbackSelectors(el, currentSelector)]
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_CANDIDATES + 1);

  const dataAttrs = collectDataAttrs(el, true);
  const value = el.getAttribute('value') ?? undefined;
  const inputType = el.tagName === 'INPUT' ? (el as HTMLInputElement).type || undefined : undefined;

  const context: ElementContext = {
    tag: el.tagName.toLowerCase(),
    role: el.getAttribute('role') ?? undefined,
    id: el.id || undefined,
    text: getVisibleText(el),
    ariaLabel: el.getAttribute('aria-label') ?? undefined,
    name: el.getAttribute('name') ?? undefined,
    placeholder: el.getAttribute('placeholder') ?? undefined,
    href: el.getAttribute('href') ?? undefined,
    title: el.getAttribute('title') ?? undefined,
    testId: el.getAttribute('data-testid') ?? undefined,
    value,
    inputType,
    dataAttrs,
    classes,
    ancestors: collectAncestors(el),
    fullDomPath: buildFullDomPath(el),
    siblings: collectSiblings(el),
    selectorInfo: {
      method: info.method,
      isUnique: info.isUnique,
      matchCount: info.matchCount,
      quality: info.quality,
      warnings: info.warnings,
      stabilityScore: info.stabilityScore,
    },
    candidates,
  };

  return context;
}

export interface BuildSelectorSystemPromptOptions {
  /** The interactive action the selector will be used for (highlight, button, etc.) */
  action: string;
  /** Structured context for the target element */
  context: ElementContext;
}

/**
 * System prompt for selector regeneration. The response must be a single
 * selector string — no prose, no fences.
 */
export function buildSelectorSystemPrompt({ action, context }: BuildSelectorSystemPromptOptions): string {
  const candidateList =
    context.candidates.length > 0
      ? context.candidates.map((c, i) => `${i + 1}. ${c}`).join('\n')
      : '(no candidates — generate one from the element context below)';

  const currentQuality = context.selectorInfo.quality;
  const currentMethod = context.selectorInfo.method;
  const warnings = context.selectorInfo.warnings.length > 0 ? context.selectorInfo.warnings.join('; ') : 'none';

  const ancestors =
    context.ancestors.length > 0
      ? context.ancestors
          .map((a, i) => {
            const attrs: string[] = [];
            if (a.testId) {
              attrs.push(`data-testid="${a.testId}"`);
            }
            if (a.id) {
              attrs.push(`id="${a.id}"`);
            }
            if (a.role) {
              attrs.push(`role="${a.role}"`);
            }
            if (a.dataAttrs) {
              for (const [k, v] of Object.entries(a.dataAttrs)) {
                attrs.push(`${k}="${v}"`);
              }
            }
            return `  ${i + 1}. <${a.tag}${attrs.length > 0 ? ' ' + attrs.join(' ') : ''}>`;
          })
          .join('\n')
      : '  (none with stable anchors)';

  const elementAttrs: string[] = [];
  if (context.testId) {
    elementAttrs.push(`data-testid="${context.testId}"`);
  }
  if (context.id) {
    elementAttrs.push(`id="${context.id}"`);
  }
  if (context.inputType) {
    elementAttrs.push(`type="${context.inputType}"`);
  }
  if (context.value) {
    elementAttrs.push(`value="${context.value}"`);
  }
  if (context.role) {
    elementAttrs.push(`role="${context.role}"`);
  }
  if (context.ariaLabel) {
    elementAttrs.push(`aria-label="${context.ariaLabel}"`);
  }
  if (context.name) {
    elementAttrs.push(`name="${context.name}"`);
  }
  if (context.placeholder) {
    elementAttrs.push(`placeholder="${context.placeholder}"`);
  }
  if (context.href) {
    elementAttrs.push(`href="${context.href}"`);
  }
  if (context.title) {
    elementAttrs.push(`title="${context.title}"`);
  }
  for (const [k, v] of Object.entries(context.dataAttrs)) {
    if (k === 'data-testid') {
      continue;
    }
    elementAttrs.push(`${k}="${v}"`);
  }

  const pathSection =
    context.fullDomPath.length > 0
      ? context.fullDomPath.map((node, i) => `  ${'  '.repeat(Math.min(i, 8))}${node}`).join('\n')
      : '  (empty)';

  const siblingsSection =
    context.siblings.length > 0
      ? context.siblings
          .map((s, i) => {
            const bits: string[] = [`<${s.tag}`];
            if (s.testId) {
              bits.push(`data-testid='${s.testId}'`);
            }
            if (s.id) {
              bits.push(`id='${s.id}'`);
            }
            if (s.role) {
              bits.push(`role='${s.role}'`);
            }
            if (s.value) {
              bits.push(`value='${s.value}'`);
            }
            const head = bits.join(' ') + '>';
            const text = s.text ? ` text=${JSON.stringify(s.text)}` : '';
            return `  ${i + 1}. [${s.position}] ${head}${text}`;
          })
          .join('\n')
      : '  (no stable siblings)';

  return `You are an expert at writing stable CSS selectors for Grafana Pathfinder interactive guides.
Choose the single best selector for the target element described below.

${SELECTOR_BEST_PRACTICES}

Target element:
  tag: <${context.tag}${elementAttrs.length > 0 ? ' ' + elementAttrs.join(' ') : ''}>
  visible text: ${context.text ? JSON.stringify(context.text) : '(none)'}
  meaningful classes: ${context.classes.length > 0 ? context.classes.join(', ') : '(none)'}

Ancestors with stable anchors (nearest first):
${ancestors}

DOM path from document root (stable summary — ephemeral attributes stripped):
${pathSection}

Stable siblings (same parent, for sibling-combinator selectors):
${siblingsSection}

Current selector quality: ${currentQuality} (method: ${currentMethod}, warnings: ${warnings})

Candidate selectors (already resolved to this element by the deterministic generator):
${candidateList}

Action the selector will drive: ${action}

Rules:
- Prefer the highest-priority candidate that uniquely identifies the element.
- You may refine a candidate by scoping it with an ancestor selector (e.g. "[data-testid='toolbar'] button[data-testid='save']") if that improves stability.
- When the target is inside a dialog/menu/listbox, scope with role='dialog' / role='menu' / role='listbox' so the selector matches only the visible popover.
- Prefer sibling combinators (label:contains('Builder') + input) over :nth-child / :nth-of-type when a stable label is next to the target.
- Prefer attribute-prefix matching ([id^='option-builder-']) when the id has a dynamic React suffix (for example :rXX:).
- Do not invent attributes that are not listed above.
- Do not use :nth-child, :nth-of-type, or :nth-match unless every other option is worse.
- Return the selector string ONLY. No prose, no explanation, no quotes, no markdown, no code fences.`;
}

/**
 * Check whether the given selector still resolves to the same element.
 * Uses querySelectorAllEnhanced so ":contains()" and ":has()" are supported.
 */
export function selectorStillMatches(selector: string, expectedElement: HTMLElement): boolean {
  if (!selector) {
    return false;
  }
  try {
    const result = querySelectorAllEnhanced(selector);
    if (result.elements.length === 0) {
      return false;
    }
    return result.elements.some((el) => el === expectedElement);
  } catch {
    return false;
  }
}
