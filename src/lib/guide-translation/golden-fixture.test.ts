/**
 * @jest-environment node
 */

/**
 * Self-consistency of the golden translation fixture, the oracle later guide
 * i18n work tests against (docs/design/I18N.md). The fixture package is
 * `fixtures/packages/translation-golden/`; `fixtures/expected/` holds what
 * compiling and indexing it must produce. Compiled files are compared as
 * parsed JSON, because committed JSON is prettier-formatted.
 */

import * as fs from 'fs';
import * as path from 'path';

import { JsonGuideSchemaStrict } from '../../types/json-guide.schema';
import type { JsonBlock, JsonStep } from '../../types/json-guide.types';
import { ContentJsonSchema, ManifestJsonSchema } from '../../types/package.schema';
import type { ContentJson } from '../../types/package.types';
import { TranslationSidecarSchema, type TranslationSidecar } from '../../types/translation-sidecar.schema';
import { getProjectionRow, PROJECTION_TABLE, readProjectedField } from './projection-table';
import { isEntryReviewed } from './review';
import { hashBlockSource, hashGuideTitleSource, hashManifestSource } from './source-hash';

const FIXTURES = path.join(__dirname, 'fixtures');
const PACKAGE_DIR = path.join(FIXTURES, 'packages', 'translation-golden');

function readJson(...segments: string[]): unknown {
  return JSON.parse(fs.readFileSync(path.join(...segments), 'utf-8'));
}

const content = ContentJsonSchema.parse(readJson(PACKAGE_DIR, 'content.json')) as ContentJson;
const manifest = ManifestJsonSchema.parse(readJson(PACKAGE_DIR, 'manifest.json'));
const ja = TranslationSidecarSchema.parse(readJson(PACKAGE_DIR, 'i18n', 'ja.json'));
const jaJP = TranslationSidecarSchema.parse(readJson(PACKAGE_DIR, 'i18n', 'ja-JP.json'));

function childBlocks(block: JsonBlock): JsonBlock[] {
  const children: JsonBlock[] = [];
  for (const key of ['blocks', 'whenTrue', 'whenFalse'] as const) {
    const value = (block as Partial<Record<typeof key, JsonBlock[]>>)[key];
    if (Array.isArray(value)) {
      children.push(...value);
    }
  }
  return children;
}

function flatten(blocks: JsonBlock[]): JsonBlock[] {
  return blocks.flatMap((block) => [block, ...flatten(childBlocks(block))]);
}

function stepsOf(block: JsonBlock): JsonStep[] {
  return 'steps' in block && Array.isArray(block.steps) ? block.steps : [];
}

interface TranslatableSite {
  blockId: string;
  stepId?: string;
  field: string;
  value: string;
}

/** Every translatable field present in a guide, in document order. */
function translatableSites(guide: ContentJson): TranslatableSite[] {
  return flatten(guide.blocks).flatMap((block) => {
    const row = getProjectionRow(block.type);
    if (!row || !block.id) {
      return [];
    }
    const blockId = block.id;
    const sites: TranslatableSite[] = row.fields.flatMap((field) => {
      const value = readProjectedField(block, field);
      return value === undefined ? [] : [{ blockId, field, value }];
    });
    for (const step of stepsOf(block)) {
      for (const field of row.stepFields ?? []) {
        const value = readProjectedField(step, field);
        if (value !== undefined) {
          sites.push({ blockId, stepId: step.id, field, value });
        }
      }
    }
    return sites;
  });
}

function sidecarValue(sidecar: TranslationSidecar, site: TranslatableSite): string | undefined {
  const entry = sidecar.blocks?.[site.blockId];
  if (!entry || !isEntryReviewed(entry)) {
    return undefined;
  }
  const value = site.stepId === undefined ? entry[site.field] : entry.steps?.[site.stepId]?.[site.field];
  return typeof value === 'string' ? value : undefined;
}

/** A guide with every translatable field blanked, to compare structure only. */
function structureOf(guide: ContentJson): unknown {
  const copy = JSON.parse(JSON.stringify({ blocks: guide.blocks })) as { blocks: JsonBlock[] };
  for (const block of flatten(copy.blocks)) {
    const row = getProjectionRow(block.type);
    for (const field of row?.fields ?? []) {
      const segments = field.split('.');
      const parent = segments
        .slice(0, -1)
        .reduce<Record<string, unknown> | undefined>(
          (node, key) => node?.[key] as Record<string, unknown> | undefined,
          block as unknown as Record<string, unknown>
        );
      if (parent && segments.length > 0) {
        delete parent[segments[segments.length - 1]!];
      }
    }
    for (const step of stepsOf(block)) {
      for (const field of row?.stepFields ?? []) {
        delete (step as unknown as Record<string, unknown>)[field];
      }
    }
  }
  return copy;
}

describe('golden fixture package', () => {
  const blocks = flatten(content.blocks);

  it('covers every projection-table type', () => {
    const types = new Set(blocks.map((block) => block.type));
    for (const type of Object.keys(PROJECTION_TABLE)) {
      expect(types).toContain(type);
    }
  });

  it('nests a conditional with blocks in both branches inside a section', () => {
    const section = content.blocks.find((block) => block.type === 'section');
    const conditional = section ? childBlocks(section).find((block) => block.type === 'conditional') : undefined;
    expect(conditional).toBeDefined();
    expect(conditional && 'whenTrue' in conditional && conditional.whenTrue.length).toBeGreaterThan(0);
    expect(conditional && 'whenFalse' in conditional && conditional.whenFalse.length).toBeGreaterThan(0);
  });

  it('gives every translatable block and every step an id', () => {
    for (const block of blocks.filter((candidate) => getProjectionRow(candidate.type))) {
      expect(block.id).toEqual(expect.any(String));
      for (const step of stepsOf(block)) {
        expect(step.id).toEqual(expect.any(String));
      }
    }
  });

  it('keeps one block type outside the table, which no sidecar addresses', () => {
    const untranslated = blocks.filter((block) => !getProjectionRow(block.type));
    expect(untranslated.length).toBeGreaterThan(0);
    for (const block of untranslated) {
      expect(ja.blocks?.[block.id ?? '']).toBeUndefined();
      expect(jaJP.blocks?.[block.id ?? '']).toBeUndefined();
    }
  });

  it('names each sidecar after its language', () => {
    expect(ja.language).toBe('ja');
    expect(jaJP.language).toBe('ja-JP');
  });

  it('stamps every entry with the hash of the current canonical text', async () => {
    for (const sidecar of [ja, jaJP]) {
      for (const [blockId, entry] of Object.entries(sidecar.blocks ?? {})) {
        const block = blocks.find((candidate) => candidate.id === blockId);
        expect(block).toBeDefined();
        expect(entry._sourceHash).toBe(await hashBlockSource(block!));
      }
    }
    expect(ja.guide?._sourceHash).toBe(await hashGuideTitleSource(content.title));
    expect(ja.manifest?._sourceHash).toBe(await hashManifestSource(manifest));
  });

  it('has a complete, reviewed ja sidecar', () => {
    for (const site of translatableSites(content)) {
      expect(sidecarValue(ja, site)).toEqual(expect.any(String));
    }
    expect(isEntryReviewed(ja.guide)).toBe(true);
    expect(ja.guide?.title).toEqual(expect.any(String));
    expect(isEntryReviewed(ja.manifest)).toBe(true);
    expect(ja.manifest?.description).toEqual(expect.any(String));
    expect(ja.manifest?.category).toEqual(expect.any(String));
  });

  it('has a sparse ja-JP sidecar that overrides two fields', () => {
    const overrides = translatableSites(content).filter((site) => sidecarValue(jaJP, site) !== undefined);
    expect(overrides).toHaveLength(2);
    expect(jaJP.guide).toBeUndefined();
    expect(jaJP.manifest).toBeUndefined();
  });

  it('declares its sidecar locales in the manifest', () => {
    expect(manifest.translations).toEqual(['ja', 'ja-JP']);
  });
});

describe.each([
  ['content.ja.json', 'ja', [ja]],
  ['content.ja-JP.json', 'ja-JP', [jaJP, ja]],
])('expected %s', (fileName, language, chain) => {
  const raw = readJson(FIXTURES, 'expected', fileName);
  const compiled = ContentJsonSchema.parse(raw) as ContentJson;

  it('passes the same schemas as a canonical guide', () => {
    expect(JsonGuideSchemaStrict.safeParse(raw).success).toBe(true);
  });

  it('keeps the canonical structure exactly', () => {
    expect(compiled.id).toBe(content.id);
    expect(compiled.schemaVersion).toBe(content.schemaVersion);
    expect(structureOf(compiled)).toEqual(structureOf(content));
  });

  it('takes each field from the most specific reviewed sidecar', () => {
    const canonicalSites = translatableSites(content);
    const compiledSites = translatableSites(compiled);
    expect(compiledSites.map(({ value: _value, ...site }) => site)).toEqual(
      canonicalSites.map(({ value: _value, ...site }) => site)
    );
    canonicalSites.forEach((site, index) => {
      const expected = chain.map((sidecar) => sidecarValue(sidecar, site)).find((value) => value !== undefined);
      expect(compiledSites[index]?.value).toBe(expected ?? site.value);
    });
  });

  it('carries the translated title and the root annotation', () => {
    expect(compiled.title).toBe(ja.guide?.title);
    expect(compiled.translation).toEqual({
      language,
      canonicalLanguage: 'en',
      canonicalTitle: content.title,
      staleBlockIds: [],
      fallbackBlockIds: [],
    });
  });
});
