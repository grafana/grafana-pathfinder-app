/**
 * Catalog `targeting.match` trees, compiled once per index and evaluated for
 * page matching and platform filtering.
 *
 * Only URL (`urlPrefix`, `urlPrefixIn`, `urlRegex`) and `targetPlatform`
 * leaves are evaluated. Every other leaf (`tag`, `source`, `userRole`, …)
 * describes runtime context the MCP cannot see, so it counts as satisfied.
 */

import { compileBoundedRegex, testBoundedRegex, type BoundedRegex } from './bounded-regex';

export type SearchPlatform = 'cloud' | 'oss';

export type TargetingNode =
  | { kind: 'all' | 'any'; children: TargetingNode[] }
  | { kind: 'url-prefix'; prefixes: string[] }
  | { kind: 'url-regex'; pattern: BoundedRegex | null }
  | { kind: 'platform'; platform: string }
  | { kind: 'context' };

export interface TargetingContext {
  /** Normalized page path; when absent every URL leaf counts as satisfied. */
  pageUrl?: string;
  /** When absent every platform leaf counts as satisfied. */
  platform?: SearchPlatform;
}

interface Evaluation {
  ok: boolean;
  /** Length of the most specific URL leaf that matched `pageUrl`; -1 when none did. */
  urlMatchLength: number;
}

const MAX_TARGETING_DEPTH = 16;

/** Caps how many `urlRegex` leaves one index compiles, so total regex time stays bounded however large the catalog. */
export const MAX_URL_REGEX_PATTERNS = 64;

export interface RegexBudget {
  remaining: number;
}

export function createRegexBudget(): RegexBudget {
  return { remaining: MAX_URL_REGEX_PATTERNS };
}

export function compileTargeting(
  match: unknown,
  budget: RegexBudget = createRegexBudget(),
  depth = 0
): TargetingNode | null {
  if (!isRecord(match) || depth > MAX_TARGETING_DEPTH) {
    return null;
  }
  const children: TargetingNode[] = [];
  for (const [key, value] of Object.entries(match)) {
    const node = compileClause(key, value, budget, depth);
    if (node) {
      children.push(node);
    }
  }
  if (children.length === 0) {
    return null;
  }
  return children.length === 1 ? children[0]! : { kind: 'all', children };
}

function compileClause(key: string, value: unknown, budget: RegexBudget, depth: number): TargetingNode | null {
  switch (key) {
    case 'and':
    case 'or': {
      const children = Array.isArray(value)
        ? value.map((child) => compileTargeting(child, budget, depth + 1)).filter((c): c is TargetingNode => c !== null)
        : [];
      return children.length > 0 ? { kind: key === 'and' ? 'all' : 'any', children } : null;
    }
    case 'urlPrefix':
      return typeof value === 'string' && value !== '' ? { kind: 'url-prefix', prefixes: [value] } : null;
    case 'urlPrefixIn': {
      const prefixes = Array.isArray(value) ? value.filter((p): p is string => typeof p === 'string' && p !== '') : [];
      return prefixes.length > 0 ? { kind: 'url-prefix', prefixes } : null;
    }
    case 'urlRegex': {
      const pattern = budget.remaining > 0 ? compileBoundedRegex(value) : null;
      if (pattern) {
        budget.remaining--;
      }
      return { kind: 'url-regex', pattern };
    }
    case 'targetPlatform':
      return typeof value === 'string' ? { kind: 'platform', platform: value } : null;
    default:
      return { kind: 'context' };
  }
}

export function evaluateTargeting(node: TargetingNode, context: TargetingContext): Evaluation {
  switch (node.kind) {
    case 'all': {
      let urlMatchLength = -1;
      for (const child of node.children) {
        const result = evaluateTargeting(child, context);
        if (!result.ok) {
          return { ok: false, urlMatchLength: -1 };
        }
        urlMatchLength = Math.max(urlMatchLength, result.urlMatchLength);
      }
      return { ok: true, urlMatchLength };
    }
    case 'any': {
      let ok = false;
      let urlMatchLength = -1;
      for (const child of node.children) {
        const result = evaluateTargeting(child, context);
        if (result.ok) {
          ok = true;
          urlMatchLength = Math.max(urlMatchLength, result.urlMatchLength);
        }
      }
      return { ok, urlMatchLength };
    }
    case 'url-prefix': {
      if (context.pageUrl === undefined) {
        return { ok: true, urlMatchLength: -1 };
      }
      const page = context.pageUrl;
      const lengths = node.prefixes.filter((prefix) => page.startsWith(prefix)).map((prefix) => prefix.length);
      return lengths.length > 0
        ? { ok: true, urlMatchLength: Math.max(...lengths) }
        : { ok: false, urlMatchLength: -1 };
    }
    case 'url-regex': {
      if (context.pageUrl === undefined) {
        return { ok: true, urlMatchLength: -1 };
      }
      const matched = node.pattern !== null && testBoundedRegex(node.pattern, context.pageUrl);
      return matched ? { ok: true, urlMatchLength: context.pageUrl.length } : { ok: false, urlMatchLength: -1 };
    }
    case 'platform':
      return { ok: context.platform === undefined || context.platform === node.platform, urlMatchLength: -1 };
    case 'context':
      return { ok: true, urlMatchLength: -1 };
  }
}

/** Specificity of the targeting match for `pageUrl`, or -1 when the entry is not targeted at that page. */
export function pageMatchLength(node: TargetingNode, pageUrl: string, platform?: SearchPlatform): number {
  const result = evaluateTargeting(node, { pageUrl, platform });
  return result.ok ? result.urlMatchLength : -1;
}

/** Whether the entry can apply on `platform` at all, on some page. */
export function isAvailableOnPlatform(node: TargetingNode, platform: SearchPlatform): boolean {
  return evaluateTargeting(node, { platform }).ok;
}

/**
 * Reduce a caller's page reference to the path the catalog targets: drop any
 * origin, query string, and fragment.
 */
export function normalizePageUrl(raw: string): string | undefined {
  let value = raw.trim();
  if (/^https?:\/\//i.test(value)) {
    try {
      value = new URL(value).pathname;
    } catch {
      return undefined;
    }
  }
  value = value.split(/[?#]/, 1)[0]!;
  if (value === '') {
    return undefined;
  }
  return value.startsWith('/') ? value : `/${value}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
