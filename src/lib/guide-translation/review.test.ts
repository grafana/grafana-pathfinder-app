/**
 * @jest-environment node
 */

import type { TranslationEntry } from '../../types/translation-sidecar.schema';
import { canonicalEntryText, hasTranslatedText, hashEntryText, isEntryReviewed } from './review';

async function reviewedEntry(entry: TranslationEntry): Promise<TranslationEntry> {
  return { ...entry, reviewed: true, _reviewHash: await hashEntryText(entry) };
}

describe('canonicalEntryText', () => {
  // Golden vector: changing it invalidates every stamped `_reviewHash`.
  it('serializes the translated strings with sorted keys', () => {
    expect(
      canonicalEntryText({
        tooltip: 'ヒント',
        content: '本文',
        reviewed: true,
        _sourceHash: 'sha256:x',
        _reviewHash: 'sha256:y',
        steps: { b: { description: '二' }, a: { tooltip: 'ひと', description: '一' } },
      })
    ).toBe(
      '{"content":"本文","tooltip":"ヒント","steps":{"a":{"description":"一","tooltip":"ひと"},"b":{"description":"二"}}}'
    );
  });

  it('does not depend on key order', () => {
    expect(canonicalEntryText({ content: 'a', tooltip: 'b' })).toBe(canonicalEntryText({ tooltip: 'b', content: 'a' }));
  });

  it('normalizes Unicode and line endings like the source hash', () => {
    expect(canonicalEntryText({ content: 'Café\r\n本文' })).toBe(canonicalEntryText({ content: 'Café\n本文' }));
  });

  it('ignores the review mark and every tooling field', () => {
    const bare = canonicalEntryText({ content: '本文' });
    expect(canonicalEntryText({ content: '本文', reviewed: true })).toBe(bare);
    expect(canonicalEntryText({ content: '本文', _sourceHash: 'a', _reviewHash: 'b', _other: 'c' })).toBe(bare);
  });

  it('reads malformed entries as having no text', () => {
    for (const bad of [undefined, null, 'x', 4, [], { steps: 'nope' }, { steps: { a: null } }, { content: 7 }]) {
      expect(canonicalEntryText(bad)).toBe('{}');
    }
  });
});

describe('hasTranslatedText', () => {
  it('is true for a text field or a step field, and false for neither', () => {
    expect(hasTranslatedText({ content: '本文' })).toBe(true);
    expect(hasTranslatedText({ steps: { a: { description: '一' } } })).toBe(true);
    expect(hasTranslatedText({ reviewed: true, _sourceHash: 'sha256:x' })).toBe(false);
    expect(hasTranslatedText(undefined)).toBe(false);
  });
});

describe('isEntryReviewed', () => {
  it('counts an entry reviewed against its current text', async () => {
    expect(await isEntryReviewed(await reviewedEntry({ content: '本文' }))).toBe(true);
  });

  it('stops counting the entry once a translated field changes', async () => {
    const entry = await reviewedEntry({ content: '本文', tooltip: 'ヒント' });
    expect(await isEntryReviewed({ ...entry, content: '別の本文' })).toBe(false);
    expect(await isEntryReviewed({ ...entry, tooltip: undefined })).toBe(false);
  });

  it('stops counting the entry once a step field changes', async () => {
    const entry = await reviewedEntry({ steps: { open: { description: '開く' } } });
    expect(await isEntryReviewed({ ...entry, steps: { open: { description: '閉じる' } } })).toBe(false);
  });

  it('keeps counting the entry across a change that is not translated text', async () => {
    const entry = await reviewedEntry({ content: '本文' });
    expect(await isEntryReviewed({ ...entry, _sourceHash: `sha256:${'0'.repeat(64)}` })).toBe(true);
  });

  it('does not count a reviewed entry with no review hash, or a malformed one', async () => {
    expect(await isEntryReviewed({ content: '本文', reviewed: true })).toBe(false);
    expect(await isEntryReviewed({ content: '本文', reviewed: true, _reviewHash: 'not-a-hash' })).toBe(false);
  });

  it('does not count a hash stamped on an entry whose mark is not true', async () => {
    const entry = await reviewedEntry({ content: '本文' });
    expect(await isEntryReviewed({ ...entry, reviewed: false })).toBe(false);
    const { reviewed: _reviewed, ...unmarked } = entry;
    expect(await isEntryReviewed(unmarked)).toBe(false);
  });

  it.each([
    ['a missing entry', undefined],
    ['a null entry', null],
    ['a string', 'reviewed'],
  ])('does not count %s', async (_label, entry) => {
    expect(await isEntryReviewed(entry as never)).toBe(false);
  });
});
