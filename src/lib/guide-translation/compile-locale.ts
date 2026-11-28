/**
 * Compile a guide for one locale from its translation sidecars
 * (docs/design/I18N.md §6.2-§6.4, §6.7, §6.8, §7.2).
 *
 * Both functions are pure and environment-neutral: no disk, no globals beyond
 * the Web Crypto digest the source hash already needs. Malformed input never
 * throws. A piece that does not have the expected shape reads as absent, so
 * the canonical text renders in its place.
 */

import type { GuideTranslationAnnotation, JsonBlock } from '../../types/json-guide.types';
import type { ContentJson } from '../../types/package.types';
import type { TranslationBlockEntry, TranslationSidecar } from '../../types/translation-sidecar.schema';
import { isLocaleAvailable, type UnitResolution } from './availability';
import { localeChain } from './locale-chain';
import { getProjectionRow, readProjectedField, type ProjectionRow } from './projection-table';
import { isEntryReviewed } from './review';
import { hashBlockSource } from './source-hash';

export type SidecarSet = Readonly<Record<string, TranslationSidecar>>;

export interface CompileManifest {
  readonly language?: unknown;
  readonly description?: unknown;
  readonly category?: unknown;
}

export interface CompiledLocale {
  readonly locale: string;
  /** Whether the guide may be offered in this locale (§6.7). The content is compiled either way. */
  readonly available: boolean;
  readonly content: ContentJson;
}

const DEFAULT_CANONICAL_LANGUAGE = 'en';
const CHILD_BLOCK_KEYS = ['blocks', 'whenTrue', 'whenFalse'] as const;

type RawRecord = Record<string, unknown>;

function isRecord(value: unknown): value is RawRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function isBlockLike(value: unknown): value is JsonBlock {
  return isRecord(value) && typeof value.type === 'string';
}

function isBlank(text: string): boolean {
  return text.trim() === '';
}

function nonBlankString(value: unknown): string | undefined {
  return typeof value === 'string' && !isBlank(value) ? value : undefined;
}

function ownRecord(record: unknown, key: string): RawRecord | undefined {
  if (!isRecord(record) || !hasOwn(record, key)) {
    return undefined;
  }
  const value = record[key];
  return isRecord(value) ? value : undefined;
}

function ownText(record: unknown, key: string): string | undefined {
  return isRecord(record) && hasOwn(record, key) ? nonBlankString(record[key]) : undefined;
}

function idOf(source: unknown): string | undefined {
  return ownText(source, 'id');
}

function canonicalText(source: object, field: string): string | undefined {
  return nonBlankString(readProjectedField(source, field));
}

function withField(source: RawRecord, field: string, value: string): RawRecord {
  const [head = '', ...rest] = field.split('.');
  if (rest.length === 0) {
    return { ...source, [head]: value };
  }
  const child = source[head];
  return { ...source, [head]: withField(isRecord(child) ? child : {}, rest.join('.'), value) };
}

interface Layer {
  readonly entry: TranslationBlockEntry;
  readonly source: RawRecord;
}

/** The reviewed entries a sidecar chain holds for one slot, most specific sidecar first. */
async function reviewedLayers(
  chain: readonly TranslationSidecar[],
  pick: (sidecar: RawRecord) => RawRecord | undefined
): Promise<Layer[]> {
  const layers = await Promise.all(
    chain.map(async (sidecar): Promise<Layer[]> => {
      const source = pick(sidecar as unknown as RawRecord);
      const entry = source as TranslationBlockEntry | undefined;
      return source && entry && (await isEntryReviewed(entry)) ? [{ entry, source }] : [];
    })
  );
  return layers.flat();
}

function firstText(layers: readonly Layer[], read: (source: RawRecord) => string | undefined) {
  for (const layer of layers) {
    const value = read(layer.source);
    if (value !== undefined) {
      return { entry: layer.entry, value };
    }
  }
  return undefined;
}

/** Tracks which units still render canonical text and which entries supplied rendered text. */
interface Resolver {
  readonly resolve: (read: (source: RawRecord) => string | undefined) => string | undefined;
  readonly miss: () => undefined;
  readonly complete: () => boolean;
  readonly contributors: () => readonly TranslationBlockEntry[];
}

function createResolver(layers: readonly Layer[]): Resolver {
  let complete = true;
  const contributors = new Set<TranslationBlockEntry>();
  return {
    resolve: (read) => {
      const hit = firstText(layers, read);
      if (hit) {
        contributors.add(hit.entry);
        return hit.value;
      }
      complete = false;
      return undefined;
    },
    miss: () => {
      complete = false;
      return undefined;
    },
    complete: () => complete,
    contributors: () => [...contributors],
  };
}

interface BlockRecord {
  readonly id: string | undefined;
  readonly source: JsonBlock;
  readonly complete: boolean;
  readonly contributors: readonly TranslationBlockEntry[];
}

interface ProjectionContext {
  readonly chain: readonly TranslationSidecar[];
  readonly records: BlockRecord[];
}

function projectStep(step: unknown, stepFields: readonly string[], resolver: Resolver) {
  if (!isRecord(step)) {
    return step;
  }
  const stepId = idOf(step);
  let projected: RawRecord = step;
  for (const field of stepFields) {
    const canonical = canonicalText(step, field);
    if (canonical === undefined) {
      continue;
    }
    const value =
      stepId === undefined
        ? resolver.miss()
        : resolver.resolve((source) => ownText(ownRecord(ownRecord(source, 'steps'), stepId), field));
    projected = value === undefined ? projected : withField(projected, field, value);
  }
  return projected;
}

async function projectOwnText(block: JsonBlock, row: ProjectionRow, context: ProjectionContext): Promise<RawRecord> {
  const id = idOf(block);
  const layers =
    id === undefined
      ? []
      : await reviewedLayers(context.chain, (sidecar) => ownRecord(ownRecord(sidecar, 'blocks'), id));
  const resolver = createResolver(layers);
  let projected: RawRecord = { ...block };

  for (const field of row.fields) {
    if (canonicalText(block, field) === undefined) {
      continue;
    }
    const value = resolver.resolve((source) => ownText(source, field));
    projected = value === undefined ? projected : withField(projected, field, value);
  }

  const steps = projected.steps;
  if (row.stepFields && Array.isArray(steps)) {
    const stepFields = row.stepFields;
    projected = {
      ...projected,
      steps: steps.map((step: unknown) => projectStep(step, stepFields, resolver)),
    };
  }

  context.records.push({
    id,
    source: block,
    complete: resolver.complete(),
    contributors: resolver.contributors(),
  });
  return projected;
}

// Sequential, so `context.records` keeps document order.
async function projectBlocks(blocks: readonly unknown[], context: ProjectionContext): Promise<unknown[]> {
  const projected: unknown[] = [];
  for (const block of blocks) {
    projected.push(isBlockLike(block) ? await projectBlock(block, context) : block);
  }
  return projected;
}

async function projectBlock(block: JsonBlock, context: ProjectionContext): Promise<unknown> {
  const row = getProjectionRow(block.type);
  const projected: RawRecord = row ? await projectOwnText(block, row, context) : { ...block };
  for (const key of CHILD_BLOCK_KEYS) {
    const children = projected[key];
    if (Array.isArray(children)) {
      projected[key] = await projectBlocks(children, context);
    }
  }
  return projected;
}

interface MetadataResolution {
  readonly complete: boolean;
  readonly values: Readonly<Record<string, string>>;
}

async function resolveMetadata(
  source: object,
  fields: readonly string[],
  chain: readonly TranslationSidecar[],
  slot: 'guide' | 'manifest'
): Promise<MetadataResolution> {
  const resolver = createResolver(await reviewedLayers(chain, (sidecar) => ownRecord(sidecar, slot)));
  const values: Record<string, string> = {};
  for (const field of fields) {
    if (canonicalText(source, field) === undefined) {
      continue;
    }
    const value = resolver.resolve((entry) => ownText(entry, field));
    if (value !== undefined) {
      values[field] = value;
    }
  }
  return { complete: resolver.complete(), values };
}

interface LocaleResolution {
  readonly available: boolean;
  readonly title: string;
  readonly blocks: unknown;
  readonly records: readonly BlockRecord[];
}

function hasSidecar(sidecars: SidecarSet, locale: string): boolean {
  return isRecord(sidecars) && isRecord(sidecars[locale]);
}

function sidecarChain(sidecars: SidecarSet, locale: string): TranslationSidecar[] {
  return localeChain(locale).flatMap((tag) => (hasSidecar(sidecars, tag) ? [sidecars[tag] as TranslationSidecar] : []));
}

function asContent(content: unknown): ContentJson {
  return isRecord(content) ? (content as unknown as ContentJson) : ({} as ContentJson);
}

async function resolveLocale(
  guideContent: ContentJson,
  manifest: CompileManifest,
  sidecars: SidecarSet,
  locale: string
): Promise<LocaleResolution> {
  const content = asContent(guideContent);
  const chain = sidecarChain(sidecars, locale);
  const records: BlockRecord[] = [];
  const blocks = Array.isArray(content.blocks)
    ? await projectBlocks(content.blocks, { chain, records })
    : content.blocks;

  const titleSource = { title: content.title };
  const guide = await resolveMetadata(titleSource, ['title'], chain, 'guide');
  const metadata = await resolveMetadata(
    isRecord(manifest) ? manifest : {},
    ['description', 'category'],
    chain,
    'manifest'
  );

  const units: UnitResolution[] = [guide, metadata, ...records];
  const ownSidecar = hasSidecar(sidecars, locale) ? (sidecars[locale] as TranslationSidecar) : undefined;
  const latched = ownSidecar?._available === true;

  return {
    available: ownSidecar !== undefined && isLocaleAvailable(units, latched),
    title: guide.values.title ?? content.title,
    blocks,
    records,
  };
}

function canonicalLanguageOf(manifest: CompileManifest): string {
  return (isRecord(manifest) ? nonBlankString(manifest.language) : undefined) ?? DEFAULT_CANONICAL_LANGUAGE;
}

// Blocks only: stale guide title and manifest entries are reported by validate's source-hash check (#2388).
async function staleIdsOf(records: readonly BlockRecord[]): Promise<string[]> {
  const verdicts = await Promise.all(
    records.map(async (record) => {
      if (record.id === undefined || record.contributors.length === 0) {
        return undefined;
      }
      const current = await hashBlockSource(record.source);
      const stale = record.contributors.some((entry) => entry._sourceHash !== current);
      return stale ? record.id : undefined;
    })
  );
  return unique(verdicts.filter((id): id is string => id !== undefined));
}

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

/**
 * The locales the guide may be offered in: each locale with a sidecar of its
 * own whose translatable units all resolve to reviewed translations after
 * layering, or whose sidecar carries the `_available` latch (§6.7). Sorted.
 */
export async function availableLocales(
  content: ContentJson,
  manifest: CompileManifest,
  sidecars: SidecarSet
): Promise<string[]> {
  if (!isRecord(sidecars)) {
    return [];
  }
  const verdicts = await Promise.all(
    Object.keys(sidecars).map(async (locale) => ({
      locale,
      available: (await resolveLocale(content, manifest, sidecars, locale)).available,
    }))
  );
  return verdicts
    .filter(({ available }) => available)
    .map(({ locale }) => locale)
    .sort();
}

/**
 * The complete `content.<locale>.json` for one locale. Each translatable field
 * comes from the most specific reviewed sidecar in the locale's chain that
 * supplies it, otherwise from the canonical text. The result carries the root
 * `translation` annotation (§7.2); `staleBlockIds` lists blocks whose rendered
 * translation was made from older canonical text, and `fallbackBlockIds`
 * lists blocks that still render canonical text.
 */
export async function compileLocale(
  guideContent: ContentJson,
  manifest: CompileManifest,
  sidecars: SidecarSet,
  locale: string
): Promise<CompiledLocale> {
  const content = asContent(guideContent);
  const resolution = await resolveLocale(content, manifest, sidecars, locale);
  const translation: GuideTranslationAnnotation = {
    language: locale,
    canonicalLanguage: canonicalLanguageOf(manifest),
    canonicalTitle: content.title,
    staleBlockIds: await staleIdsOf(resolution.records),
    fallbackBlockIds: unique(
      resolution.records.flatMap((record) => (record.id !== undefined && !record.complete ? [record.id] : []))
    ),
  };
  return {
    locale,
    available: resolution.available,
    content: {
      ...content,
      title: resolution.title,
      blocks: resolution.blocks as ContentJson['blocks'],
      translation,
    },
  };
}
