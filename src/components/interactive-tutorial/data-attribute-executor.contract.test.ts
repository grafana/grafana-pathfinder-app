import * as fs from 'fs';
import * as path from 'path';

const COMPONENT_DIR = __dirname;
const RENDERER_FILES = ['interactive-step.tsx', 'interactive-multi-step.tsx'];

/**
 * These attributes identify a rendered/test node or carry composite data for
 * the multistep driver; they are not individual action fields for the generic
 * DOM/React executor seam this tripwire checks.
 */
const NON_ACTION_ATTRIBUTES = new Set(['data-step-id', 'data-testid', 'data-internal-actions']);

/** Gaps recorded on the first run; remove an entry only when the path is fixed. */
const KNOWN_UNREACHABLE = ['data-openguide', 'data-targetcomment'];

const ACTION_ATTRIBUTE_FIELDS = {
  'data-targetaction': 'targetAction',
  'data-reftarget': 'refTarget',
  'data-targetvalue': 'targetValue',
  'data-targetstate': 'targetState',
  'data-targetcomment': 'targetComment',
  'data-openguide': 'openGuide',
} as const;

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(COMPONENT_DIR, relativePath), 'utf8');
}

function rendererAttributes(): Set<string> {
  const attributes = new Set<string>();
  for (const file of RENDERER_FILES) {
    const source = fs.readFileSync(path.join(COMPONENT_DIR, file), 'utf8');
    for (const match of source.matchAll(/\b(data-[a-z][a-z0-9-]*)\s*=/g)) {
      const attribute = match[1]!;
      if (!attribute.startsWith('data-test-') && !NON_ACTION_ATTRIBUTES.has(attribute)) {
        attributes.add(attribute);
      }
    }
  }
  return attributes;
}

function domExtractorAttributes(): Set<string> {
  const source = read('../../lib/dom/dom-utils.ts');
  return new Set(
    [...source.matchAll(/getAttribute\('([^']+)'\)/g)]
      .map((match) => match[1]!)
      .filter((attribute) => attribute.startsWith('data-'))
  );
}

function directExecutorAttributes(): Set<string> {
  const source = read('../../types/interactive.types.ts');
  const start = source.indexOf('export type InteractiveActionRequest');
  if (start < 0) {
    throw new Error('InteractiveActionRequest type not found');
  }
  const request = source.slice(start, source.indexOf('\n};', start));
  return new Set(
    Object.entries(ACTION_ATTRIBUTE_FIELDS)
      .filter(([, field]) => request.includes(`'${field}'`))
      .map(([attribute]) => attribute)
  );
}

function unreachableAttributes(): string[] {
  const written = rendererAttributes();
  const extracted = domExtractorAttributes();
  const direct = directExecutorAttributes();
  return [...written].filter((attribute) => !extracted.has(attribute) || !direct.has(attribute)).sort();
}

describe('renderer data attributes reach an action executor', () => {
  it('keeps the documented shrink-only baseline honest', () => {
    expect(unreachableAttributes()).toEqual([...KNOWN_UNREACHABLE].sort());
  });

  it('keeps every baseline entry live on the renderer side', () => {
    const written = rendererAttributes();

    for (const attribute of KNOWN_UNREACHABLE) {
      expect(written).toContain(attribute);
    }
  });

  it('does not count test, identity, or composite metadata as action gaps', () => {
    const written = rendererAttributes();

    expect(written).not.toContain('data-testid');
    expect(written).not.toContain('data-step-id');
    expect(written).not.toContain('data-internal-actions');
  });
});
