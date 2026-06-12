import type { EditorBlock } from '../types';
import type { JsonSectionBlock } from '../../../types/json-guide.types';
import {
  generateBlockId,
  isConditionalBlock,
  isGuidedBlock,
  isInteractiveBlock,
  isMultistepBlock,
  isSectionBlock,
  parseBlockId,
} from './useBlockEditor.helpers';

const makeSection = (id: string, nested: JsonSectionBlock['blocks']): EditorBlock => ({
  id,
  block: { type: 'section', title: 'Section', blocks: nested },
});

describe('type guards', () => {
  it('identifies each block kind', () => {
    expect(isSectionBlock({ type: 'section', title: 's', blocks: [] })).toBe(true);
    expect(isConditionalBlock({ type: 'conditional', conditions: [], whenTrue: [], whenFalse: [] })).toBe(true);
    expect(isInteractiveBlock({ type: 'interactive', action: 'button', reftarget: '#x', content: 'go' })).toBe(true);
    expect(isMultistepBlock({ type: 'multistep', content: '', steps: [] })).toBe(true);
    expect(isGuidedBlock({ type: 'guided', content: '', steps: [] })).toBe(true);

    expect(isSectionBlock({ type: 'markdown', content: '' })).toBe(false);
    expect(isInteractiveBlock({ type: 'markdown', content: '' })).toBe(false);
  });
});

describe('generateBlockId', () => {
  it('produces ids with the block- prefix', () => {
    expect(generateBlockId()).toMatch(/^block-\d+-[a-z0-9]+$/);
  });

  it('produces distinct ids on consecutive calls', () => {
    const ids = new Set([generateBlockId(), generateBlockId(), generateBlockId(), generateBlockId()]);
    expect(ids.size).toBe(4);
  });
});

describe('parseBlockId', () => {
  const sectionA = makeSection('section-a', [
    { type: 'markdown', content: 'first' },
    { type: 'markdown', content: 'second' },
  ]);
  const rootMarkdown: EditorBlock = { id: 'block-root-1', block: { type: 'markdown', content: 'top' } };
  const blocks: EditorBlock[] = [sectionA, rootMarkdown];

  it('resolves a root-level block by id', () => {
    const parsed = parseBlockId('block-root-1', blocks);
    expect(parsed.isNested).toBe(false);
    expect(parsed.rootIndex).toBe(1);
    expect(parsed.block).toEqual({ type: 'markdown', content: 'top' });
  });

  it('returns an empty result when a root id is unknown', () => {
    expect(parseBlockId('does-not-exist', blocks)).toEqual({ isNested: false });
  });

  it('resolves a nested block by composite id', () => {
    const parsed = parseBlockId('section-a-nested-1', blocks);
    expect(parsed.isNested).toBe(true);
    expect(parsed.sectionId).toBe('section-a');
    expect(parsed.nestedIndex).toBe(1);
    expect(parsed.sectionRootIndex).toBe(0);
    expect(parsed.block).toEqual({ type: 'markdown', content: 'second' });
  });

  it('reports nested with no block when the index is out of range', () => {
    const parsed = parseBlockId('section-a-nested-9', blocks);
    expect(parsed.isNested).toBe(true);
    expect(parsed.sectionRootIndex).toBe(0);
    expect(parsed.block).toBeUndefined();
  });

  it('reports nested with no sectionRootIndex when the section id is unknown', () => {
    const parsed = parseBlockId('ghost-section-nested-0', blocks);
    expect(parsed.isNested).toBe(true);
    expect(parsed.sectionRootIndex).toBeUndefined();
    expect(parsed.block).toBeUndefined();
  });

  it('treats a non-numeric suffix after -nested- as not a nested id, falling back to root lookup', () => {
    expect(parseBlockId('section-a-nested-foo', blocks)).toEqual({ isNested: false });
  });

  it('uses the last -nested- marker so section ids containing -nested- still parse', () => {
    const trickySection = makeSection('weird-nested-name', [{ type: 'markdown', content: 'hi' }]);
    const parsed = parseBlockId('weird-nested-name-nested-0', [trickySection]);
    expect(parsed.isNested).toBe(true);
    expect(parsed.sectionId).toBe('weird-nested-name');
    expect(parsed.nestedIndex).toBe(0);
    expect(parsed.block).toEqual({ type: 'markdown', content: 'hi' });
  });
});
