import { resolveSelectors, versionedComponents, versionedPages } from '@grafana/e2e-selectors';

import { toCssAttributeString } from './css-escape';

type SelectorNode = { [key: string]: SelectorNode | string | ((...args: never[]) => unknown) };

interface ReverseIndex {
  exact: Map<string, string>;
  templates: Array<{ regex: RegExp; path: string }>;
}

const selectorTrees = new Map<string, SelectorNode>();
const reverseIndexes = new Map<SelectorNode, ReverseIndex>();
const TEMPLATE_SENTINEL = 'PARAM';
const TESTID_PREFIX = /^data-testid\s*/;

function getResolvedSelectors(grafanaVersion: string): SelectorNode {
  const version = grafanaVersion || 'latest';
  const cached = selectorTrees.get(version);
  if (cached) {
    return cached;
  }

  const tree = resolveSelectors({ components: versionedComponents, pages: versionedPages }, version);
  const selectorTree = tree as unknown as SelectorNode;
  selectorTrees.set(version, selectorTree);
  return selectorTree;
}

export function toGrafanaSelectorForVersion(selectorPath: string, grafanaVersion: string, selectorId?: string): string {
  if (!selectorPath) {
    throw new Error('Selector path is required');
  }

  const parts = selectorPath.split('.');
  let current: SelectorNode[string] | undefined = getResolvedSelectors(grafanaVersion);

  for (const part of parts) {
    if (!current || typeof current !== 'object') {
      throw new Error(`Invalid selector path: ${selectorPath} (failed at ${part})`);
    }
    current = current[part];
    if (current === undefined) {
      throw new Error(`Selector not found: ${selectorPath} (${part} is undefined)`);
    }
  }

  let resolvedValue: string;
  if (typeof current === 'function') {
    if (!selectorId) {
      throw new Error(`Selector ${selectorPath} requires an ID parameter`);
    }
    const result = (current as (id: string) => unknown)(selectorId);
    if (typeof result !== 'string') {
      throw new Error(`Invalid selector type at ${selectorPath}: ${typeof result}`);
    }
    resolvedValue = result;
  } else if (typeof current === 'string') {
    resolvedValue = current;
  } else {
    throw new Error(`Invalid selector type at ${selectorPath}: ${typeof current}`);
  }

  const cssValue = toCssAttributeString(resolvedValue);
  return `:is([data-testid=${cssValue}], [aria-label=${cssValue}])`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildTemplate(fn: (...args: never[]) => unknown): { regex: RegExp; weight: number } | null {
  let resolved: unknown;
  try {
    resolved = (fn as (id: string) => unknown)(TEMPLATE_SENTINEL);
  } catch {
    return null;
  }
  if (typeof resolved !== 'string') {
    return null;
  }

  const first = resolved.indexOf(TEMPLATE_SENTINEL);
  if (first === -1 || first !== resolved.lastIndexOf(TEMPLATE_SENTINEL) || resolved.includes('undefined')) {
    return null;
  }

  const prefix = resolved.slice(0, first);
  const suffix = resolved.slice(first + TEMPLATE_SENTINEL.length);
  const discriminator = (prefix.replace(TESTID_PREFIX, '') + suffix).trim();
  if (discriminator.length < 3) {
    return null;
  }

  return { regex: new RegExp(`^${escapeRegExp(prefix)}(.+)${escapeRegExp(suffix)}$`), weight: discriminator.length };
}

function getReverseIndex(grafanaVersion: string): ReverseIndex {
  const root = getResolvedSelectors(grafanaVersion);
  const cached = reverseIndexes.get(root);
  if (cached) {
    return cached;
  }

  const exact = new Map<string, string>();
  const ambiguous = new Set<string>();
  const templates: Array<{ regex: RegExp; path: string; weight: number }> = [];

  const walk = (node: SelectorNode, path: string): void => {
    for (const key of Object.keys(node)) {
      const value = node[key];
      const childPath = path ? `${path}.${key}` : key;
      if (typeof value === 'string') {
        if (ambiguous.has(value)) {
          continue;
        }
        if (exact.has(value)) {
          exact.delete(value);
          ambiguous.add(value);
        } else {
          exact.set(value, childPath);
        }
      } else if (typeof value === 'function') {
        const template = buildTemplate(value);
        if (template) {
          templates.push({ regex: template.regex, path: childPath, weight: template.weight });
        }
      } else if (value && typeof value === 'object') {
        walk(value, childPath);
      }
    }
  };

  walk(root.components as SelectorNode, 'components');
  walk(root.pages as SelectorNode, 'pages');
  templates.sort((a, b) => b.weight - a.weight);

  const index = { exact, templates: templates.map(({ regex, path }) => ({ regex, path })) };
  reverseIndexes.set(root, index);
  return index;
}

export function findGrafanaSelectorPathForVersion(
  selectorValues: readonly string[],
  grafanaVersion: string
): string | null {
  const index = getReverseIndex(grafanaVersion);

  for (const value of selectorValues) {
    const exactPath = index.exact.get(value);
    if (exactPath) {
      return `grafana:${exactPath}`;
    }
  }

  for (const value of selectorValues) {
    let matched: string | null = null;
    for (const template of index.templates) {
      const match = template.regex.exec(value);
      if (!match || !match[1]) {
        continue;
      }
      if (matched) {
        matched = null;
        break;
      }
      matched = `grafana:${template.path}:${match[1]}`;
    }
    if (matched) {
      return matched;
    }
  }

  return null;
}
