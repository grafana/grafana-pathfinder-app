/**
 * @jest-environment node
 */

import * as fs from 'fs';
import * as path from 'path';

import { JsonGuideSchemaStrict } from '../../types/json-guide.schema';
import type { JsonBlock } from '../../types/json-guide.types';
import { ContentJsonSchema, ManifestJsonSchema } from '../../types/package.schema';
import type { ContentJson } from '../../types/package.types';
import { TranslationSidecarSchema } from '../../types/translation-sidecar.schema';
import { availableLocales, compileLocale, type SidecarSet } from './compile-locale';
import { localeChain } from './locale-chain';
import { hashEntryText } from './review';
import { hashBlockSource } from './source-hash';

const FIXTURES = path.join(__dirname, 'fixtures');
const PACKAGE_DIR = path.join(FIXTURES, 'packages', 'translation-golden');

function readJson(...segments: string[]): unknown {
  return JSON.parse(fs.readFileSync(path.join(...segments), 'utf-8'));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

const content = ContentJsonSchema.parse(readJson(PACKAGE_DIR, 'content.json')) as ContentJson;
const manifest = ManifestJsonSchema.parse(readJson(PACKAGE_DIR, 'manifest.json'));
const ja = TranslationSidecarSchema.parse(readJson(PACKAGE_DIR, 'i18n', 'ja.json'));
const jaJP = TranslationSidecarSchema.parse(readJson(PACKAGE_DIR, 'i18n', 'ja-JP.json'));
const sidecars: SidecarSet = { ja, 'ja-JP': jaJP };

type Mutable = Record<string, any>;

function flatten(blocks: JsonBlock[]): JsonBlock[] {
  return blocks.flatMap((block) => {
    const children = (['blocks', 'whenTrue', 'whenFalse'] as const).flatMap(
      (key) => (block as Partial<Record<typeof key, JsonBlock[]>>)[key] ?? []
    );
    return [block, ...flatten(children)];
  });
}

function blockById(guide: ContentJson, id: string): Mutable {
  const block = flatten(guide.blocks).find((candidate) => candidate.id === id);
  if (!block) {
    throw new Error(`no block ${id}`);
  }
  return block as unknown as Mutable;
}

function withSidecars(edit: (copy: Record<'ja' | 'ja-JP', Mutable>) => void): SidecarSet {
  const copy = { ja: clone(ja) as Mutable, 'ja-JP': clone(jaJP) as Mutable };
  edit(copy);
  return copy as unknown as SidecarSet;
}

/** Re-stamp each reviewed entry's review hash, as `sync-translations --accept` would. */
async function restamped(set: SidecarSet): Promise<SidecarSet> {
  for (const sidecar of Object.values(set) as Mutable[]) {
    for (const entry of [sidecar.guide, sidecar.manifest, ...Object.values(sidecar.blocks ?? {})] as Mutable[]) {
      if (entry?.reviewed === true) {
        entry._reviewHash = await hashEntryText(entry);
      }
    }
  }
  return set;
}

function expectedFile(name: string): ContentJson {
  return ContentJsonSchema.parse(readJson(FIXTURES, 'expected', name)) as ContentJson;
}

describe('compileLocale on the golden fixture package', () => {
  it.each([
    ['ja', 'content.ja.json'],
    ['ja-JP', 'content.ja-JP.json'],
  ])('compiles %s to the committed %s', async (locale, fileName) => {
    const compiled = await compileLocale(content, manifest, sidecars, locale);
    expect(compiled.available).toBe(true);
    expect(compiled.content).toEqual(expectedFile(fileName));
    expect(JSON.stringify(compiled.content)).toBe(JSON.stringify(expectedFile(fileName)));
  });

  it('is deterministic and leaves its inputs untouched', async () => {
    const frozen = {
      content: deepFreeze(clone(content)),
      manifest: deepFreeze(clone(manifest)),
      sidecars: deepFreeze(clone(sidecars)),
    };
    const first = await compileLocale(frozen.content, frozen.manifest, frozen.sidecars, 'ja-JP');
    const second = await compileLocale(frozen.content, frozen.manifest, frozen.sidecars, 'ja-JP');
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(frozen.content).toEqual(content);
  });

  it('passes the schemas a canonical guide passes', async () => {
    for (const locale of ['ja', 'ja-JP']) {
      const { content: compiled } = await compileLocale(content, manifest, sidecars, locale);
      expect(ContentJsonSchema.safeParse(compiled).success).toBe(true);
      expect(JsonGuideSchemaStrict.safeParse(compiled).success).toBe(true);
    }
  });

  it('keeps block and key order from the canonical file', async () => {
    const { content: compiled } = await compileLocale(content, manifest, sidecars, 'ja-JP');
    const keyOrder = (guide: ContentJson) => flatten(guide.blocks).map((block) => Object.keys(block).join(','));
    expect(keyOrder(compiled)).toEqual(keyOrder(content));
    expect(Object.keys(compiled)).toEqual([...Object.keys(content), 'translation']);
  });

  it('lists the locales that have a sidecar and qualify', async () => {
    expect(await availableLocales(content, manifest, sidecars)).toEqual(['ja', 'ja-JP']);
  });
});

describe('per-field layering', () => {
  it('takes two fields from ja-JP and every other field from ja', async () => {
    const { content: compiled } = await compileLocale(content, manifest, sidecars, 'ja-JP');
    const tooltip = blockById(compiled, 'open-dashboards');
    expect(tooltip.tooltip).toBe(jaJP.blocks?.['open-dashboards']?.tooltip);
    expect(tooltip.content).toBe(ja.blocks?.['open-dashboards']?.content);
    const step = blockById(compiled, 'add-panel').steps[0];
    expect(step.description).toBe(jaJP.blocks?.['add-panel']?.steps?.['open-add-menu']?.description);
    expect(step.tooltip).toBe(ja.blocks?.['add-panel']?.steps?.['open-add-menu']?.tooltip);
  });

  it('does not let a ja-JP entry change ja output', async () => {
    const { content: compiled } = await compileLocale(content, manifest, sidecars, 'ja');
    expect(blockById(compiled, 'open-dashboards').tooltip).toBe(ja.blocks?.['open-dashboards']?.tooltip);
  });

  it('chains a longer tag through every prefix', async () => {
    const chained: SidecarSet = {
      ja: ja,
      'ja-JP': jaJP,
      'ja-JP-kansai': { ...clone(jaJP), language: 'ja-JP-kansai', blocks: {} },
    };
    const { content: compiled } = await compileLocale(content, manifest, chained, 'ja-JP-kansai');
    expect(compiled).toEqual({
      ...expectedFile('content.ja-JP.json'),
      translation: { ...expectedFile('content.ja-JP.json').translation, language: 'ja-JP-kansai' },
    });
  });
});

describe('reviewed gate', () => {
  it('lets an unreviewed entry contribute nothing', async () => {
    const edited = withSidecars((copy) => {
      copy.ja.blocks['intro'].reviewed = false;
    });
    const { content: compiled } = await compileLocale(content, manifest, edited, 'ja');
    expect(blockById(compiled, 'intro').content).toBe(blockById(content, 'intro').content);
    expect(compiled.translation?.fallbackBlockIds).toEqual(['intro']);
  });

  it('falls through an unreviewed ja-JP entry to the ja value', async () => {
    const edited = withSidecars((copy) => {
      copy['ja-JP'].blocks['open-dashboards'].reviewed = false;
    });
    const { content: compiled } = await compileLocale(content, manifest, edited, 'ja-JP');
    expect(blockById(compiled, 'open-dashboards').tooltip).toBe(ja.blocks?.['open-dashboards']?.tooltip);
    expect(compiled.translation?.fallbackBlockIds).toEqual([]);
  });

  it('keeps the canonical title when the guide entry is unreviewed', async () => {
    const edited = withSidecars((copy) => {
      copy.ja.guide.reviewed = false;
    });
    const { content: compiled } = await compileLocale(content, manifest, edited, 'ja');
    expect(compiled.title).toBe(content.title);
  });
});

describe('review validity', () => {
  it('stops counting a reviewed entry once its translated text changes', async () => {
    const edited = withSidecars((copy) => {
      copy.ja.blocks['intro'].content = '書き換えた本文。';
    });
    const { content: compiled } = await compileLocale(content, manifest, edited, 'ja');
    expect(blockById(compiled, 'intro').content).toBe(blockById(content, 'intro').content);
    expect(compiled.translation?.fallbackBlockIds).toEqual(['intro']);
  });

  it('counts the entry again once its review hash is re-stamped', async () => {
    const edited = await restamped(
      withSidecars((copy) => {
        copy.ja.blocks['intro'].content = '書き換えた本文。';
      })
    );
    const { content: compiled } = await compileLocale(content, manifest, edited, 'ja');
    expect(blockById(compiled, 'intro').content).toBe('書き換えた本文。');
    expect(compiled.translation?.fallbackBlockIds).toEqual([]);
  });

  it('does not count a reviewed entry that carries no review hash', async () => {
    const edited = withSidecars((copy) => {
      delete copy.ja.blocks['intro']._reviewHash;
    });
    const { content: compiled } = await compileLocale(content, manifest, edited, 'ja');
    expect(compiled.translation?.fallbackBlockIds).toEqual(['intro']);
  });

  it('withdraws derived availability when a reviewed entry is edited', async () => {
    const edited = withSidecars((copy) => {
      delete copy.ja['_available'];
      copy.ja.guide.title = '書き換えたタイトル';
    });
    expect(await availableLocales(content, manifest, edited)).toEqual(['ja-JP']);
  });

  it('keeps a latched locale available after a reviewed entry is edited', async () => {
    const edited = withSidecars((copy) => {
      copy.ja.guide.title = '書き換えたタイトル';
    });
    expect(await availableLocales(content, manifest, edited)).toEqual(['ja', 'ja-JP']);
    const { content: compiled } = await compileLocale(content, manifest, edited, 'ja');
    expect(compiled.title).toBe(content.title);
  });
});

describe('projection', () => {
  it('replaces only the fields the table lists and copies structure unchanged', async () => {
    const { content: compiled } = await compileLocale(content, manifest, sidecars, 'ja');
    const form = blockById(compiled, 'name-dashboard');
    const canonicalForm = blockById(content, 'name-dashboard');
    expect(form.targetvalue).toBe(canonicalForm.targetvalue);
    expect(form.reftarget).toBe(canonicalForm.reftarget);
    expect(form.action).toBe(canonicalForm.action);
    const canonicalStep = blockById(content, 'add-panel').steps[0];
    const step = blockById(compiled, 'add-panel').steps[0];
    expect(step.reftarget).toBe(canonicalStep.reftarget);
    expect(step.action).toBe(canonicalStep.action);
  });

  it('matches nested blocks, in both conditional branches, by their own id', async () => {
    const { content: compiled } = await compileLocale(content, manifest, sidecars, 'ja');
    expect(blockById(compiled, 'query-tip').content).toBe(ja.blocks?.['query-tip']?.content);
    expect(blockById(compiled, 'connect-tip').content).toBe(ja.blocks?.['connect-tip']?.content);
    expect(blockById(compiled, 'has-prometheus').whenFalseSectionConfig.title).toBe(
      ja.blocks?.['has-prometheus']?.['whenFalseSectionConfig.title']
    );
  });

  it('ignores structural keys, fields the table does not list, and block types outside the table', async () => {
    const edited = await restamped(
      withSidecars((copy) => {
        copy.ja.blocks['name-dashboard'].reftarget = 'hijacked';
        copy.ja.blocks['name-dashboard'].action = 'button';
        copy.ja.blocks['example-dashboard'].src = 'https://example.invalid/x.png';
        copy.ja.blocks['example-dashboard'].content = 'not an image field';
        copy.ja.blocks['next-steps'] = { content: '翻訳', title: '次へ', reviewed: true };
        copy.ja.blocks['add-panel'].steps['open-add-menu'].reftarget = 'hijacked';
      })
    );
    const { content: compiled } = await compileLocale(content, manifest, edited, 'ja');
    expect(compiled).toEqual(expectedFile('content.ja.json'));
  });

  it('matches steps by step id under their own parent only', async () => {
    const edited = await restamped(
      withSidecars((copy) => {
        copy.ja.blocks['save-dashboard'].steps['open-add-menu'] = { description: 'wrong parent' };
        delete copy.ja.blocks['add-panel'].steps['open-add-menu'];
      })
    );
    const { content: compiled } = await compileLocale(content, manifest, edited, 'ja');
    expect(blockById(compiled, 'add-panel').steps[0].description).toBe(
      blockById(content, 'add-panel').steps[0].description
    );
    expect(blockById(compiled, 'save-dashboard').steps[0].description).toBe(
      ja.blocks?.['save-dashboard']?.steps?.['open-save']?.description
    );
    expect(compiled.translation?.fallbackBlockIds).toEqual(['add-panel']);
  });
});

describe('availability', () => {
  it('derives availability from complete reviewed translations without the latch', async () => {
    const unlatched = withSidecars((copy) => {
      delete copy.ja['_available'];
      delete copy['ja-JP']['_available'];
    });
    expect(await availableLocales(content, manifest, unlatched)).toEqual(['ja', 'ja-JP']);
  });

  it('withholds a locale whose translation is incomplete', async () => {
    const edited = withSidecars((copy) => {
      delete copy.ja['_available'];
      delete copy.ja.blocks['intro'];
    });
    expect(await availableLocales(content, manifest, edited)).toEqual(['ja-JP']);
  });

  it('withholds a locale whose guide or manifest entry is missing', async () => {
    for (const slot of ['guide', 'manifest']) {
      const edited = withSidecars((copy) => {
        delete copy.ja['_available'];
        delete copy.ja[slot];
      });
      expect(await availableLocales(content, manifest, edited)).not.toContain('ja');
    }
  });

  it('keeps a latched locale available after the English guide adds a block', async () => {
    const grown = clone(content);
    grown.blocks.push({ type: 'markdown', id: 'brand-new', content: 'A block added after translation.' });
    expect(await availableLocales(grown, manifest, sidecars)).toEqual(['ja', 'ja-JP']);
    const { content: compiled, available } = await compileLocale(grown, manifest, sidecars, 'ja');
    expect(available).toBe(true);
    expect(blockById(compiled, 'brand-new').content).toBe('A block added after translation.');
    expect(compiled.translation?.fallbackBlockIds).toEqual(['brand-new']);
  });

  it('withdraws the same guide once the latch is gone', async () => {
    const grown = clone(content);
    grown.blocks.push({ type: 'markdown', id: 'brand-new', content: 'A block added after translation.' });
    const edited = withSidecars((copy) => {
      delete copy.ja['_available'];
      delete copy['ja-JP']['_available'];
    });
    expect(await availableLocales(grown, manifest, edited)).toEqual([]);
  });

  it('does not offer a locale that has no sidecar of its own', async () => {
    const compiled = await compileLocale(content, manifest, { ja }, 'ja-JP');
    expect(compiled.available).toBe(false);
    expect(compiled.content.title).toBe(ja.guide?.title);
  });

  it('withholds a locale when a translatable block has no id to address it by', async () => {
    const anonymous = clone(content);
    delete blockById(anonymous, 'intro').id;
    const edited = withSidecars((copy) => {
      delete copy.ja['_available'];
    });
    expect(await availableLocales(anonymous, manifest, edited)).not.toContain('ja');
  });
});

describe('staleness', () => {
  it('lists a block whose canonical text changed and still renders its translation', async () => {
    const edited = clone(content);
    blockById(edited, 'intro').content = 'Rewritten English.';
    const { content: compiled } = await compileLocale(edited, manifest, sidecars, 'ja');
    expect(compiled.translation?.staleBlockIds).toEqual(['intro']);
    expect(blockById(compiled, 'intro').content).toBe(ja.blocks?.['intro']?.content);
    expect(compiled.translation?.fallbackBlockIds).toEqual([]);
  });

  it('is not tripped by an edit to structural fields or ids', async () => {
    const edited = clone(content);
    blockById(edited, 'name-dashboard').reftarget = 'input#changed';
    blockById(edited, 'add-panel').steps[0].id = 'renamed-step';
    const { content: compiled } = await compileLocale(edited, manifest, sidecars, 'ja');
    expect(compiled.translation?.staleBlockIds).toEqual([]);
    expect(compiled.translation?.fallbackBlockIds).toEqual(['add-panel']);
  });

  it('treats an entry without a source hash as stale', async () => {
    const edited = withSidecars((copy) => {
      delete copy.ja.blocks['query-tip']._sourceHash;
    });
    const { content: compiled } = await compileLocale(content, manifest, edited, 'ja');
    expect(compiled.translation?.staleBlockIds).toEqual(['query-tip']);
    expect(blockById(compiled, 'query-tip').content).toBe(ja.blocks?.['query-tip']?.content);
  });

  it('counts a stale entry only when its text renders', async () => {
    const edited = withSidecars((copy) => {
      copy.ja.blocks['intro']._sourceHash = `sha256:${'0'.repeat(64)}`;
      copy.ja.blocks['intro'].reviewed = false;
    });
    const { content: compiled } = await compileLocale(content, manifest, edited, 'ja');
    expect(compiled.translation?.staleBlockIds).toEqual([]);
    expect(compiled.translation?.fallbackBlockIds).toEqual(['intro']);
  });

  it('flags a block when the entry that supplies one of its fields is stale', async () => {
    const edited = withSidecars((copy) => {
      copy['ja-JP'].blocks['open-dashboards']._sourceHash = `sha256:${'0'.repeat(64)}`;
    });
    const { content: compiled } = await compileLocale(content, manifest, edited, 'ja-JP');
    expect(compiled.translation?.staleBlockIds).toEqual(['open-dashboards']);
    const hashed = await hashBlockSource(blockById(content, 'open-dashboards') as unknown as JsonBlock);
    expect(ja.blocks?.['open-dashboards']?._sourceHash).toBe(hashed);
  });

  it('lists stale blocks in document order', async () => {
    const edited = clone(content);
    blockById(edited, 'connect-tip').content = 'Changed.';
    blockById(edited, 'intro').content = 'Changed.';
    blockById(edited, 'save-dashboard').content = 'Changed.';
    const { content: compiled } = await compileLocale(edited, manifest, sidecars, 'ja');
    expect(compiled.translation?.staleBlockIds).toEqual(['intro', 'connect-tip', 'save-dashboard']);
  });
});

describe('annotation and title', () => {
  it('names the canonical language from the manifest and defaults it to en', async () => {
    const french = await compileLocale(content, { ...manifest, language: 'fr' }, sidecars, 'ja');
    expect(french.content.translation?.canonicalLanguage).toBe('fr');
    const bare = await compileLocale(content, { description: 'x' }, sidecars, 'ja');
    expect(bare.content.translation?.canonicalLanguage).toBe('en');
  });

  it('carries the canonical title and the translated title', async () => {
    const { content: compiled } = await compileLocale(content, manifest, sidecars, 'ja');
    expect(compiled.title).toBe(ja.guide?.title);
    expect(compiled.translation?.canonicalTitle).toBe(content.title);
  });
});

describe('monotonic degradation (I18N.md §8, property 3)', () => {
  function stringsOf(value: unknown): string[] {
    if (typeof value === 'string') {
      return [value];
    }
    if (typeof value === 'object' && value !== null) {
      return Object.values(value).flatMap(stringsOf);
    }
    return [];
  }

  function leaves(value: unknown, at = ''): Array<[string, string]> {
    if (typeof value === 'string') {
      return [[at, value]];
    }
    if (typeof value === 'object' && value !== null) {
      return Object.entries(value).flatMap(([key, child]) => leaves(child, `${at}/${key}`));
    }
    return [];
  }

  const baselines = new Map<string, Promise<ContentJson>>();
  function baselineFor(locale: string): Promise<ContentJson> {
    if (!baselines.has(locale)) {
      baselines.set(
        locale,
        compileLocale(content, manifest, sidecars, locale).then((compiled) => compiled.content)
      );
    }
    return baselines.get(locale)!;
  }

  async function expectGraceful(edited: SidecarSet, locale: string) {
    const compiled = await compileLocale(content, manifest, edited, locale);
    expect(ContentJsonSchema.safeParse(compiled.content).success).toBe(true);
    expect(stringsOf(compiled.content).every((text) => text.trim() !== '')).toBe(true);
    expect(compiled.content.blocks.length).toBe(content.blocks.length);

    const layers = await Promise.all(localeChain(locale).map(baselineFor));
    const own = layers[layers.length - 1] ?? content;
    const baseline = leaves({ title: own.title, blocks: own.blocks });
    const allowed = [...layers, content].map((layer) => new Map(leaves({ title: layer.title, blocks: layer.blocks })));
    const rendered = leaves({ title: compiled.content.title, blocks: compiled.content.blocks });
    expect(rendered.map(([at]) => at)).toEqual(baseline.map(([at]) => at));
    for (const [at, text] of rendered) {
      expect(allowed.map((layer) => layer.get(at))).toContain(text);
    }

    expect((await availableLocales(content, manifest, edited)).includes(locale)).toBe(compiled.available);
  }

  const locales = ['ja', 'ja-JP'] as const;

  it.each(locales)('survives removing any sidecar from %s onward', async (locale) => {
    await expectGraceful({}, locale);
    await expectGraceful({ ja }, locale);
    await expectGraceful({ 'ja-JP': jaJP }, locale);
  });

  it.each(locales)('survives removing each entry from each sidecar when compiling %s', async (locale) => {
    for (const tag of ['ja', 'ja-JP'] as const) {
      const sidecar = (tag === 'ja' ? ja : jaJP) as Mutable;
      for (const slot of ['guide', 'manifest', '_available', 'blocks']) {
        if (slot in sidecar) {
          await expectGraceful(
            withSidecars((copy) => {
              delete copy[tag][slot];
            }),
            locale
          );
        }
      }
      for (const blockId of Object.keys(sidecar.blocks ?? {})) {
        await expectGraceful(
          withSidecars((copy) => {
            delete copy[tag].blocks[blockId];
          }),
          locale
        );
      }
    }
  });

  it.each(locales)('survives removing each field from each entry when compiling %s', async (locale) => {
    for (const tag of ['ja', 'ja-JP'] as const) {
      const sidecar = (tag === 'ja' ? ja : jaJP) as Mutable;
      for (const [blockId, entry] of Object.entries<Mutable>(sidecar.blocks ?? {})) {
        for (const field of Object.keys(entry)) {
          await expectGraceful(
            withSidecars((copy) => {
              delete copy[tag].blocks[blockId][field];
            }),
            locale
          );
        }
        for (const [stepId, step] of Object.entries<Mutable>(entry.steps ?? {})) {
          for (const field of Object.keys(step)) {
            await expectGraceful(
              withSidecars((copy) => {
                delete copy[tag].blocks[blockId].steps[stepId][field];
              }),
              locale
            );
          }
          await expectGraceful(
            withSidecars((copy) => {
              delete copy[tag].blocks[blockId].steps[stepId];
            }),
            locale
          );
        }
      }
    }
  });

  it('renders no empty string when a translation is blank', async () => {
    const blanked = withSidecars((copy) => {
      copy.ja.blocks['intro'].content = '';
      copy.ja.blocks['example-dashboard'].alt = '   ';
      copy.ja.guide.title = '';
    });
    await expectGraceful(blanked, 'ja');
    const { content: compiled } = await compileLocale(content, manifest, blanked, 'ja');
    expect(compiled.title).toBe(content.title);
    expect(blockById(compiled, 'intro').content).toBe(blockById(content, 'intro').content);
  });
});

describe('malformed input', () => {
  it('never throws and renders the canonical text', async () => {
    const malformed = {
      ja: {
        blocks: { intro: 'nope', 'add-panel': { reviewed: true, steps: 'nope', content: 7 }, 'open-dashboards': null },
        guide: 'nope',
        manifest: [],
        _available: 'yes',
      },
      'ja-JP': null,
      nonsense: 4,
    } as unknown as SidecarSet;
    const compiled = await compileLocale(content, manifest, malformed, 'ja-JP');
    expect(compiled.available).toBe(false);
    expect(compiled.content.blocks).toEqual(content.blocks);
    await expect(availableLocales(content, manifest, malformed)).resolves.toEqual([]);
  });

  it('never throws when the guide content is not an object', async () => {
    for (const bad of [null, undefined, 'nope', 4, []]) {
      const compiled = await compileLocale(bad as never, manifest, sidecars, 'ja');
      expect(compiled.locale).toBe('ja');
      await expect(availableLocales(bad as never, manifest, sidecars)).resolves.toBeDefined();
      expect(await availableLocales(bad as never, manifest, { ja: {} } as never)).toEqual([]);
    }
  });

  it('tolerates a guide with odd blocks and missing arrays', async () => {
    const odd = {
      id: 'odd',
      title: 'Odd',
      blocks: [
        null,
        3,
        { type: 'section', id: 's', title: 'T', blocks: 'nope' },
        { type: 'multistep', id: 'm', steps: [null, 4] },
      ],
    } as unknown as ContentJson;
    await expect(compileLocale(odd, manifest, sidecars, 'ja')).resolves.toBeDefined();
    const noBlocks = { id: 'x', title: 'X' } as unknown as ContentJson;
    await expect(compileLocale(noBlocks, undefined as never, sidecars, 'ja')).resolves.toBeDefined();
    expect(await availableLocales(odd, null as never, undefined as never)).toEqual([]);
  });
});
