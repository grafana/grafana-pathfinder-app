/**
 * @jest-environment node
 */

import * as fs from 'fs';
import * as path from 'path';

import type { JsonBlock } from '../../types/json-guide.types';
import { ContentJsonSchema, ManifestJsonSchema } from '../../types/package.schema';
import type { ContentJson } from '../../types/package.types';
import { TranslationSidecarSchema, type TranslationSidecar } from '../../types/translation-sidecar.schema';
import { availableLocales, compileLocale } from './compile-locale';
import { isEntryReviewed } from './review';
import { hashBlockSource, hashGuideTitleSource, hashManifestSource } from './source-hash';
import { formatEntryRef, parseEntryRef, syncTranslations, type SidecarSync } from './sync-translations';

const PACKAGE_DIR = path.join(__dirname, 'fixtures', 'packages', 'translation-golden');

function readJson(...segments: string[]): unknown {
  return JSON.parse(fs.readFileSync(path.join(...segments), 'utf-8'));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

type Mutable = Record<string, any>;

const content = ContentJsonSchema.parse(readJson(PACKAGE_DIR, 'content.json')) as ContentJson;
const manifest = ManifestJsonSchema.parse(readJson(PACKAGE_DIR, 'manifest.json'));
const ja = TranslationSidecarSchema.parse(readJson(PACKAGE_DIR, 'i18n', 'ja.json'));
const jaJP = TranslationSidecarSchema.parse(readJson(PACKAGE_DIR, 'i18n', 'ja-JP.json'));

const BASE_REF = { commit: 'a'.repeat(40), path: 'guides/golden/content.json' };
const OLD_HASH = `sha256:${'0'.repeat(64)}`;

function flatten(blocks: JsonBlock[]): JsonBlock[] {
  return blocks.flatMap((block) => {
    const children = (['blocks', 'whenTrue', 'whenFalse'] as const).flatMap(
      (key) => (block as Partial<Record<typeof key, JsonBlock[]>>)[key] ?? []
    );
    return [block, ...flatten(children)];
  });
}

function blockById(guide: ContentJson, id: string): Mutable {
  return flatten(guide.blocks).find((block) => block.id === id) as unknown as Mutable;
}

/** The fixture sidecars with every tooling field removed, as a translator hands them over. */
function bare(sidecar: TranslationSidecar): Mutable {
  const copy = clone(sidecar) as Mutable;
  delete copy._available;
  delete copy.baseRef;
  for (const entry of [copy.guide, copy.manifest, ...Object.values<Mutable>(copy.blocks ?? {})]) {
    delete entry?._sourceHash;
    delete entry?._reviewHash;
  }
  return copy;
}

/** The fixture sidecars exactly as committed: fully stamped. */
function stamped(): Record<string, TranslationSidecar> {
  return { ja: clone(ja), 'ja-JP': clone(jaJP) };
}

function syncOf(syncs: SidecarSync[], tag: string): SidecarSync {
  const found = syncs.find((sync) => sync.tag === tag);
  if (!found) {
    throw new Error(`no sync for ${tag}`);
  }
  return found;
}

describe('entry references', () => {
  it.each([
    ['guide', { kind: 'guide' }],
    ['manifest', { kind: 'manifest' }],
    ['intro', { kind: 'block', id: 'intro' }],
    ['block:guide', { kind: 'block', id: 'guide' }],
    ['block:manifest', { kind: 'block', id: 'manifest' }],
    ['block:block:x', { kind: 'block', id: 'block:x' }],
  ])('parses %s', (token, expected) => {
    expect(parseEntryRef(token)).toEqual(expected);
  });

  it('names a block called guide or manifest unambiguously, and round-trips every form', () => {
    expect(formatEntryRef({ kind: 'guide' })).toBe('guide');
    expect(formatEntryRef({ kind: 'block', id: 'guide' })).toBe('block:guide');
    expect(formatEntryRef({ kind: 'block', id: 'manifest' })).toBe('block:manifest');
    for (const token of ['guide', 'manifest', 'intro', 'block:guide', 'block:manifest', 'block:block:x']) {
      expect(formatEntryRef(parseEntryRef(token))).toBe(token);
    }
  });
});

describe('_sourceHash', () => {
  it('stamps every translated block, the guide entry and the manifest entry with the current English hash', async () => {
    const syncs = await syncTranslations(content, manifest, { ja: bare(ja) as TranslationSidecar });
    const next = syncOf(syncs, 'ja').sidecar;
    expect(next.guide?._sourceHash).toBe(await hashGuideTitleSource(content.title));
    expect(next.manifest?._sourceHash).toBe(await hashManifestSource(manifest));
    for (const [id, entry] of Object.entries(next.blocks ?? {})) {
      expect(entry._sourceHash).toBe(await hashBlockSource(blockById(content, id) as JsonBlock));
    }
    expect(next).toEqual(ja);
    expect(syncOf(syncs, 'ja').inSync).toBe(true);
  });

  it('never re-stamps a present hash that no longer matches, so a stale entry stays stale', async () => {
    const edited = clone(content);
    blockById(edited, 'intro').content = 'Rewritten English.';
    const syncs = await syncTranslations(edited, manifest, stamped());
    const sync = syncOf(syncs, 'ja');
    expect(sync.sidecar.blocks?.['intro']?._sourceHash).toBe(ja.blocks?.['intro']?._sourceHash);
    expect(sync.stale).toEqual(['intro']);
    expect(sync.changes.filter((change) => change.kind === 'source-hash')).toEqual([]);
    const again = await syncTranslations(edited, manifest, { ja: sync.sidecar });
    expect(syncOf(again, 'ja').stale).toEqual(['intro']);
  });

  it('never re-stamps a malformed hash either', async () => {
    const sidecars = stamped() as Record<string, Mutable>;
    sidecars.ja!.blocks.intro._sourceHash = 'garbled';
    const sync = syncOf(await syncTranslations(content, manifest, sidecars as never), 'ja');
    expect(sync.sidecar.blocks?.['intro']?._sourceHash).toBe('garbled');
    expect(sync.stale).toEqual(['intro']);
  });

  it('re-stamps only the entries named by accept', async () => {
    const edited = clone(content);
    blockById(edited, 'intro').content = 'Rewritten English.';
    blockById(edited, 'save-dashboard').content = 'Rewritten English.';
    edited.title = 'A new title';
    const syncs = await syncTranslations(edited, manifest, stamped(), {
      tags: ['ja'],
      accept: [parseEntryRef('intro'), parseEntryRef('guide')],
    });
    const sync = syncOf(syncs, 'ja');
    expect(sync.sidecar.blocks?.['intro']?._sourceHash).toBe(
      await hashBlockSource(blockById(edited, 'intro') as JsonBlock)
    );
    expect(sync.sidecar.guide?._sourceHash).toBe(await hashGuideTitleSource('A new title'));
    expect(sync.sidecar.blocks?.['save-dashboard']?._sourceHash).toBe(ja.blocks?.['save-dashboard']?._sourceHash);
    expect(sync.stale).toEqual(['save-dashboard']);
    expect(sync.changes.filter((change) => change.accepted).map((change) => change.entry)).toEqual(['guide', 'intro']);
  });

  it('accepts a block called guide without touching the guide entry', async () => {
    const edited = clone(content);
    blockById(edited, 'intro').id = 'guide';
    edited.title = 'A new title';
    const sidecars = stamped() as Record<string, Mutable>;
    sidecars.ja!.blocks.guide = sidecars.ja!.blocks.intro;
    delete sidecars.ja!.blocks.intro;
    const sync = syncOf(
      await syncTranslations(edited, manifest, sidecars as never, {
        tags: ['ja'],
        accept: [parseEntryRef('block:guide')],
      }),
      'ja'
    );
    expect(sync.sidecar.blocks?.['guide']?._sourceHash).toBe(
      await hashBlockSource(blockById(edited, 'guide') as JsonBlock)
    );
    expect(sync.sidecar.guide?._sourceHash).toBe(ja.guide?._sourceHash);
    expect(sync.stale).toEqual(['guide']);
  });

  it('reports an accept that names no entry, and one with no English to accept against', async () => {
    const sidecars = stamped() as Record<string, Mutable>;
    sidecars.ja!.blocks.ghost = { content: '幽霊', reviewed: true };
    const sync = syncOf(
      await syncTranslations(content, manifest, sidecars as never, {
        tags: ['ja'],
        accept: [parseEntryRef('ghost'), parseEntryRef('nowhere')],
      }),
      'ja'
    );
    expect(sync.unknownAccepts).toEqual(['nowhere']);
    expect(sync.unmatched).toEqual(['ghost']);
  });

  it('leaves an entry with no English source unstamped and out of sync', async () => {
    const sidecars = stamped() as Record<string, Mutable>;
    sidecars.ja!.blocks.ghost = { content: '幽霊' };
    const sync = syncOf(await syncTranslations(content, manifest, sidecars as never, { tags: ['ja'] }), 'ja');
    expect(sync.sidecar.blocks?.['ghost']).toEqual({ content: '幽霊' });
    expect(sync.unmatched).toEqual(['ghost']);
    expect(sync.inSync).toBe(false);
  });

  it('ignores an entry that has neither translated text nor a hash', async () => {
    const sidecars = stamped() as Record<string, Mutable>;
    sidecars.ja!.blocks.intro = { reviewed: false };
    const sync = syncOf(await syncTranslations(content, manifest, sidecars as never, { tags: ['ja'] }), 'ja');
    expect(sync.sidecar.blocks?.['intro']).toEqual({ reviewed: false });
    expect(sync.inSync).toBe(true);
  });

  it('has no manifest to hash against for a package without manifest.json', async () => {
    const sync = syncOf(await syncTranslations(content, undefined, { ja: bare(ja) as never }), 'ja');
    expect(sync.sidecar.manifest?._sourceHash).toBeUndefined();
    expect(sync.unmatched).toEqual(['manifest']);
  });
});

describe('_reviewHash', () => {
  it('stamps a reviewed entry that has none, over its current text', async () => {
    const sync = syncOf(await syncTranslations(content, manifest, { ja: bare(ja) as never }), 'ja');
    expect(sync.sidecar).toEqual(ja);
    expect(await isEntryReviewed(sync.sidecar.blocks?.['intro'])).toBe(true);
  });

  it('does not stamp an entry that is not marked reviewed', async () => {
    const sidecars = { ja: bare(ja) as Mutable };
    sidecars.ja.blocks.intro.reviewed = false;
    const sync = syncOf(await syncTranslations(content, manifest, sidecars as never), 'ja');
    expect(sync.sidecar.blocks?.['intro']?._reviewHash).toBeUndefined();
    expect(sync.sidecar.blocks?.['intro']?._sourceHash).toEqual(expect.any(String));
  });

  it('never re-stamps after the translation was edited: the review lapses and says so', async () => {
    const sidecars = stamped() as Record<string, Mutable>;
    sidecars.ja!.blocks.intro.content = '書き換えた本文。';
    const sync = syncOf(await syncTranslations(content, manifest, sidecars as never), 'ja');
    expect(sync.sidecar.blocks?.['intro']?._reviewHash).toBe(ja.blocks?.['intro']?._reviewHash);
    expect(sync.reviewLapsed).toEqual(['intro']);
    expect(await isEntryReviewed(sync.sidecar.blocks?.['intro'])).toBe(false);
    expect(sync.changes).toEqual([]);
  });

  it('ratifies an edited entry that has no review hash in one run', async () => {
    const sidecars = { ja: bare(ja) as Mutable };
    sidecars.ja.blocks.intro.content = '書き換えた本文。';
    const sync = syncOf(await syncTranslations(content, manifest, sidecars as never), 'ja');
    expect(await isEntryReviewed(sync.sidecar.blocks?.['intro'])).toBe(true);
  });

  it('does not restore a lapsed review when the translator accepts an updated translation', async () => {
    const edited = clone(content);
    blockById(edited, 'intro').content = 'Rewritten English.';
    const sidecars = stamped() as Record<string, Mutable>;
    sidecars.ja!.blocks.intro.content = '書き換えた本文。';
    const sync = syncOf(
      await syncTranslations(edited, manifest, sidecars as never, { tags: ['ja'], accept: [parseEntryRef('intro')] }),
      'ja'
    );
    expect(sync.sidecar.blocks?.['intro']?._sourceHash).toBe(
      await hashBlockSource(blockById(edited, 'intro') as JsonBlock)
    );
    expect(sync.stale).toEqual([]);
    expect(sync.sidecar.blocks?.['intro']?._reviewHash).toBe(ja.blocks?.['intro']?._reviewHash);
    expect(await isEntryReviewed(sync.sidecar.blocks?.['intro'])).toBe(false);
    expect(sync.reviewLapsed).toEqual(['intro']);
    expect(sync.changes.map((change) => change.kind)).toEqual(['source-hash']);
  });

  it('re-affirms an edited entry when a reviewer removes its review hash and runs again', async () => {
    const sidecars = stamped() as Record<string, Mutable>;
    sidecars.ja!.blocks.intro.content = '書き換えた本文。';
    delete sidecars.ja!.blocks.intro._reviewHash;
    const sync = syncOf(await syncTranslations(content, manifest, sidecars as never, { tags: ['ja'] }), 'ja');
    expect(await isEntryReviewed(sync.sidecar.blocks?.['intro'])).toBe(true);
    expect(sync.reviewLapsed).toEqual([]);
    expect(sync.changes).toEqual([{ tag: 'ja', kind: 'review-hash', entry: 'intro' }]);
  });

  it('puts the edited entry out of coverage for availability and for compilation', async () => {
    const sidecars = stamped() as Record<string, Mutable>;
    delete sidecars.ja!._available;
    sidecars.ja!.guide.title = '書き換えたタイトル';
    const set = sidecars as never;
    expect(await availableLocales(content, manifest, set)).toEqual(['ja-JP']);
    const compiled = await compileLocale(content, manifest, set, 'ja');
    expect(compiled.content.title).toBe(content.title);
    const synced = syncOf(await syncTranslations(content, manifest, set, { tags: ['ja'] }), 'ja');
    expect(synced.sidecar._available).toBeUndefined();
  });
});

describe('_available', () => {
  it('stamps the latch the first time every unit resolves to a reviewed translation', async () => {
    const syncs = await syncTranslations(content, manifest, { ja: bare(ja) as never });
    expect(syncOf(syncs, 'ja').sidecar._available).toBe(true);
    expect(syncOf(syncs, 'ja').changes.map((change) => change.kind)).toContain('available');
  });

  it('stamps nothing for a translation that is incomplete', async () => {
    const sidecars = { ja: bare(ja) as Mutable };
    delete sidecars.ja.blocks.intro;
    const sync = syncOf(await syncTranslations(content, manifest, sidecars as never), 'ja');
    expect(sync.sidecar._available).toBeUndefined();
  });

  it('stamps nothing for an entry that is not marked reviewed', async () => {
    const sidecars = { ja: bare(ja) as Mutable };
    sidecars.ja.manifest.reviewed = false;
    const sync = syncOf(await syncTranslations(content, manifest, sidecars as never), 'ja');
    expect(sync.sidecar._available).toBeUndefined();
  });

  it('keeps the latch after the English adds a block, and never removes it', async () => {
    const grown = clone(content);
    grown.blocks.push({ type: 'markdown', id: 'brand-new', content: 'Added after translation.' });
    const syncs = await syncTranslations(grown, manifest, stamped());
    expect(syncOf(syncs, 'ja').sidecar._available).toBe(true);
    expect(syncOf(syncs, 'ja').changes).toEqual([]);
  });

  it('does not stamp a latch the guide would not earn, even though other fields are in sync', async () => {
    const grown = clone(content);
    grown.blocks.push({ type: 'markdown', id: 'brand-new', content: 'Added after translation.' });
    const syncs = await syncTranslations(grown, manifest, { ja: bare(ja) as never });
    expect(syncOf(syncs, 'ja').sidecar._available).toBeUndefined();
  });

  it('leaves an explicit false alone', async () => {
    const sidecars = { ja: { ...stamped().ja, _available: false } as TranslationSidecar };
    const sync = syncOf(await syncTranslations(content, manifest, sidecars), 'ja');
    expect(sync.sidecar._available).toBe(false);
  });

  it('layers a sparse sidecar over its parent when it decides availability', async () => {
    const sidecars = { ja: stamped().ja!, 'ja-JP': bare(jaJP) as never };
    const syncs = await syncTranslations(content, manifest, sidecars);
    expect(syncOf(syncs, 'ja-JP').sidecar._available).toBe(true);
  });
});

describe('baseRef', () => {
  it('advances to the given commit only when every entry is in sync, placed after language', async () => {
    const sync = syncOf(await syncTranslations(content, manifest, stamped(), { baseRef: BASE_REF }), 'ja');
    expect(sync.sidecar.baseRef).toEqual(BASE_REF);
    expect(Object.keys(sync.sidecar).slice(0, 3)).toEqual(['schemaVersion', 'language', 'baseRef']);
    expect(sync.changes.map((change) => change.kind)).toEqual(['base-ref']);
  });

  it('replaces an older baseRef in place', async () => {
    const { schemaVersion, language, ...rest } = stamped().ja!;
    const older = { commit: 'b'.repeat(40), path: 'old/content.json' };
    const sidecars = {
      ja: { schemaVersion, language, baseRef: older, ...rest } as TranslationSidecar,
    };
    const sync = syncOf(await syncTranslations(content, manifest, sidecars, { baseRef: BASE_REF }), 'ja');
    expect(sync.sidecar.baseRef).toEqual(BASE_REF);
    expect(Object.keys(sync.sidecar)).toEqual([
      'schemaVersion',
      'language',
      'baseRef',
      'guide',
      'manifest',
      'blocks',
      '_available',
    ]);
  });

  it('writes nothing when baseRef already holds the commit', async () => {
    const sidecars = { ja: { ...stamped().ja!, baseRef: BASE_REF } };
    const sync = syncOf(await syncTranslations(content, manifest, sidecars, { baseRef: BASE_REF }), 'ja');
    expect(sync.changes).toEqual([]);
  });

  it.each([
    ['a stale block', (edited: ContentJson) => void (blockById(edited, 'intro').content = 'Rewritten.')],
    ['a stale guide entry', (edited: ContentJson) => void (edited.title = 'A new title')],
  ])('leaves baseRef alone while %s remains', async (_label, edit) => {
    const edited = clone(content);
    edit(edited);
    const sync = syncOf(await syncTranslations(edited, manifest, stamped(), { baseRef: BASE_REF }), 'ja');
    expect(sync.sidecar.baseRef).toBeUndefined();
    expect(sync.inSync).toBe(false);
  });

  it('leaves baseRef alone while the manifest entry is stale', async () => {
    const sync = syncOf(
      await syncTranslations(content, { ...manifest, description: 'A new description' }, stamped(), {
        baseRef: BASE_REF,
      }),
      'ja'
    );
    expect(sync.sidecar.baseRef).toBeUndefined();
    expect(sync.stale).toEqual(['manifest']);
  });

  it('after a partial retranslation, stamps the fixed hash but not baseRef', async () => {
    const edited = clone(content);
    blockById(edited, 'intro').content = 'Rewritten.';
    blockById(edited, 'save-dashboard').content = 'Rewritten.';
    const first = syncOf(
      await syncTranslations(edited, manifest, stamped(), {
        tags: ['ja'],
        accept: [parseEntryRef('intro')],
        baseRef: BASE_REF,
      }),
      'ja'
    );
    expect(first.sidecar.blocks?.['intro']?._sourceHash).toBe(
      await hashBlockSource(blockById(edited, 'intro') as JsonBlock)
    );
    expect(first.sidecar.baseRef).toBeUndefined();
    const second = syncOf(
      await syncTranslations(
        edited,
        manifest,
        { ja: first.sidecar },
        { accept: [parseEntryRef('save-dashboard')], baseRef: BASE_REF }
      ),
      'ja'
    );
    expect(second.sidecar.baseRef).toEqual(BASE_REF);
  });

  it('is left absent when no commit is given', async () => {
    const sync = syncOf(await syncTranslations(content, manifest, stamped()), 'ja');
    expect(sync.sidecar.baseRef).toBeUndefined();
  });

  it('is left alone for an entry with no English source, which a baseRef could not repair', async () => {
    const sidecars = stamped() as Record<string, Mutable>;
    sidecars.ja!.blocks.ghost = { content: '幽霊', _sourceHash: OLD_HASH };
    const sync = syncOf(await syncTranslations(content, manifest, sidecars as never, { baseRef: BASE_REF }), 'ja');
    expect(sync.sidecar.baseRef).toBeUndefined();
  });

  it('is not advanced for a sidecar with no translated entries', async () => {
    const empty = { schemaVersion: '1.0.0', language: 'ja' } as TranslationSidecar;
    const sync = syncOf(await syncTranslations(content, manifest, { ja: empty }, { baseRef: BASE_REF }), 'ja');
    expect(sync.sidecar).toBe(empty);
  });
});

describe('a second run', () => {
  it('writes nothing, and hands back the very objects it was given', async () => {
    const sidecars = { ja: bare(ja) as TranslationSidecar, 'ja-JP': bare(jaJP) as TranslationSidecar };
    const first = await syncTranslations(content, manifest, sidecars, { baseRef: BASE_REF });
    expect(first.every((sync) => sync.changes.length > 0)).toBe(true);
    const next = Object.fromEntries(first.map((sync) => [sync.tag, sync.sidecar]));
    const second = await syncTranslations(content, manifest, next, { baseRef: BASE_REF });
    expect(second.map((sync) => sync.changes)).toEqual([[], []]);
    for (const sync of second) {
      expect(sync.sidecar).toBe(next[sync.tag]);
    }
  });

  it('keeps the file key order, appending new tooling fields last', async () => {
    const sidecars = { ja: bare(ja) as Mutable };
    sidecars.ja.blocks.intro = { reviewed: true, content: sidecars.ja.blocks.intro.content };
    const sync = syncOf(await syncTranslations(content, manifest, sidecars as never), 'ja');
    expect(Object.keys(sync.sidecar.blocks?.['intro'] ?? {})).toEqual([
      'reviewed',
      'content',
      '_sourceHash',
      '_reviewHash',
    ]);
    expect(Object.keys(sync.sidecar.blocks ?? {})).toEqual(Object.keys(ja.blocks ?? {}));
    expect(Object.keys(sync.sidecar).slice(-1)).toEqual(['_available']);
  });
});

describe('scope', () => {
  it('syncs only the named sidecars but lets the rest layer into availability', async () => {
    const sidecars = { ja: stamped().ja!, 'ja-JP': bare(jaJP) as never };
    const syncs = await syncTranslations(content, manifest, sidecars, { tags: ['ja-JP'] });
    expect(syncs.map((sync) => sync.tag)).toEqual(['ja-JP']);
    expect(syncs[0]?.sidecar._available).toBe(true);
  });

  it('has nothing to do for a package with no sidecars', async () => {
    expect(await syncTranslations(content, manifest, {})).toEqual([]);
  });
});

describe('malformed input', () => {
  it('does not throw on odd entries or odd content', async () => {
    const odd = {
      ja: { schemaVersion: '1.0.0', language: 'ja', blocks: { intro: null, x: 'nope', y: { content: 4 } }, guide: [] },
    } as never;
    await expect(syncTranslations(content, manifest, odd)).resolves.toBeDefined();
    const noBlocks = { id: 'x', title: 'X' } as unknown as ContentJson;
    await expect(syncTranslations(noBlocks, undefined, odd)).resolves.toBeDefined();
  });
});
