/**
 * The `sync-translations` plan (docs/design/I18N.md §6.8, §7.1, §9): given a
 * guide's canonical files and its parsed sidecars, compute the next state of
 * every sidecar's tooling-owned fields. Pure and environment-neutral: no disk,
 * no git. The command reads, asks git for the `baseRef`, and writes.
 *
 * Two rules keep staleness honest. A present `_sourceHash` or `_reviewHash`
 * that no longer matches is never re-stamped, because that would hide a stale
 * or changed translation; `accept` re-stamps only `_sourceHash`, so it never
 * restores a lapsed review. And nothing here removes a field: the `_available`
 * latch is cleared only by a human.
 */

import type { JsonBlock } from '../../types/json-guide.types';
import type { ContentJson } from '../../types/package.types';
import type { TranslationBaseRef, TranslationEntry, TranslationSidecar } from '../../types/translation-sidecar.schema';
import { availableLocales, type CompileManifest, type SidecarSet } from './compile-locale';
import { hasTranslatedText, hashEntryText } from './review';
import { hashBlockSource, hashGuideTitleSource, hashManifestSource } from './source-hash';

const GUIDE_REF = 'guide';
const MANIFEST_REF = 'manifest';
const BLOCK_PREFIX = 'block:';
const CHILD_BLOCK_KEYS = ['blocks', 'whenTrue', 'whenFalse'] as const;

export type EntryRef = { kind: 'guide' } | { kind: 'manifest' } | { kind: 'block'; id: string };

/**
 * An entry as a user names it. `guide` and `manifest` name those entries; a
 * block is its id, or `block:<id>` when the id would read as one of the other
 * forms (a block may be called `guide`, `manifest` or `block:x`).
 */
export function parseEntryRef(token: string): EntryRef {
  if (token === GUIDE_REF) {
    return { kind: 'guide' };
  }
  if (token === MANIFEST_REF) {
    return { kind: 'manifest' };
  }
  return { kind: 'block', id: token.startsWith(BLOCK_PREFIX) ? token.slice(BLOCK_PREFIX.length) : token };
}

export function formatEntryRef(ref: EntryRef): string {
  if (ref.kind !== 'block') {
    return ref.kind;
  }
  const needsPrefix = ref.id === GUIDE_REF || ref.id === MANIFEST_REF || ref.id.startsWith(BLOCK_PREFIX);
  return needsPrefix ? `${BLOCK_PREFIX}${ref.id}` : ref.id;
}

export type SyncChangeKind = 'source-hash' | 'review-hash' | 'available' | 'base-ref';

export interface SyncChange {
  readonly tag: string;
  readonly kind: SyncChangeKind;
  /** The entry, in `formatEntryRef` spelling. Absent for `available` and `base-ref`. */
  readonly entry?: string;
  /** The entry was named in `accept`, so an existing `_sourceHash` was replaced. */
  readonly accepted?: boolean;
}

export interface SidecarSync {
  readonly tag: string;
  readonly sidecar: TranslationSidecar;
  readonly changes: readonly SyncChange[];
  /** Entries whose `_sourceHash` still differs from the current English: left as they are. */
  readonly stale: readonly string[];
  /** Reviewed entries whose text changed since the review was stamped: no longer count as reviewed. */
  readonly reviewLapsed: readonly string[];
  /** Entries with nothing in the English to hash against: an unknown block id, or no manifest. */
  readonly unmatched: readonly string[];
  /** Entries named in `accept` that the sidecar does not have. */
  readonly unknownAccepts: readonly string[];
  /** Every entry's `_sourceHash` matches the current English. */
  readonly inSync: boolean;
}

export interface SyncOptions {
  /** Sidecars to bring up to date; the rest only layer into availability. Default: all. */
  readonly tags?: readonly string[];
  readonly accept?: readonly EntryRef[];
  /** Where `baseRef` advances to for a sidecar that is in sync. Absent: leave `baseRef` alone. */
  readonly baseRef?: TranslationBaseRef;
}

type RawRecord = Record<string, unknown>;

function isRecord(value: unknown): value is RawRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function blocksById(blocks: readonly unknown[], found = new Map<string, JsonBlock>()): Map<string, JsonBlock> {
  for (const block of blocks) {
    if (!isRecord(block) || typeof block.type !== 'string') {
      continue;
    }
    if (typeof block.id === 'string' && !found.has(block.id)) {
      found.set(block.id, block as unknown as JsonBlock);
    }
    for (const key of CHILD_BLOCK_KEYS) {
      const children = block[key];
      if (Array.isArray(children)) {
        blocksById(children, found);
      }
    }
  }
  return found;
}

interface Source {
  readonly blocks: ReadonlyMap<string, JsonBlock>;
  readonly content: ContentJson;
  readonly manifest: CompileManifest | undefined;
}

/** The hash of the English an entry translates, or `undefined` when there is none to hash. */
async function currentSourceHash(ref: EntryRef, source: Source): Promise<string | undefined> {
  switch (ref.kind) {
    case 'guide':
      return typeof source.content.title === 'string' ? hashGuideTitleSource(source.content.title) : undefined;
    case 'manifest':
      return source.manifest === undefined ? undefined : hashManifestSource(source.manifest);
    case 'block': {
      const block = source.blocks.get(ref.id);
      return block === undefined ? undefined : hashBlockSource(block);
    }
  }
}

interface Slot {
  readonly ref: EntryRef;
  readonly entry: TranslationEntry;
}

function slotsOf(sidecar: TranslationSidecar): Slot[] {
  const slots: Slot[] = [];
  if (isRecord(sidecar.guide)) {
    slots.push({ ref: { kind: 'guide' }, entry: sidecar.guide });
  }
  if (isRecord(sidecar.manifest)) {
    slots.push({ ref: { kind: 'manifest' }, entry: sidecar.manifest });
  }
  for (const [id, entry] of Object.entries(isRecord(sidecar.blocks) ? sidecar.blocks : {})) {
    if (isRecord(entry)) {
      slots.push({ ref: { kind: 'block', id }, entry });
    }
  }
  return slots;
}

function withEntry(sidecar: TranslationSidecar, ref: EntryRef, entry: TranslationEntry): TranslationSidecar {
  switch (ref.kind) {
    case 'guide':
      return { ...sidecar, guide: entry };
    case 'manifest':
      return { ...sidecar, manifest: entry };
    case 'block':
      return { ...sidecar, blocks: { ...sidecar.blocks, [ref.id]: entry } };
  }
}

function sameRef(a: EntryRef, b: EntryRef): boolean {
  return formatEntryRef(a) === formatEntryRef(b);
}

/** `baseRef` sits right after `language`, where the schema declares it. */
function withBaseRef(sidecar: TranslationSidecar, baseRef: TranslationBaseRef): TranslationSidecar {
  if (sidecar.baseRef !== undefined) {
    return { ...sidecar, baseRef };
  }
  const entries = Object.entries(sidecar);
  const at = entries.findIndex(([key]) => key === 'language') + 1;
  return Object.fromEntries([
    ...entries.slice(0, at),
    ['baseRef', baseRef],
    ...entries.slice(at),
  ]) as TranslationSidecar;
}

async function syncOneSidecar(
  tag: string,
  original: TranslationSidecar,
  source: Source,
  options: SyncOptions
): Promise<SidecarSync> {
  const accept = options.accept ?? [];
  const changes: SyncChange[] = [];
  const stale: string[] = [];
  const reviewLapsed: string[] = [];
  const unmatched: string[] = [];
  let sidecar = original;
  let inSync = true;
  let counted = 0;

  for (const { ref, entry } of slotsOf(original)) {
    const name = formatEntryRef(ref);
    const accepted = accept.some((candidate) => sameRef(candidate, ref));
    const translated = hasTranslatedText(entry);
    const current = await currentSourceHash(ref, source);
    let next = entry;

    if (translated && current !== undefined && (entry._sourceHash === undefined || accepted)) {
      if (entry._sourceHash !== current) {
        next = { ...next, _sourceHash: current };
        changes.push({
          tag,
          kind: 'source-hash',
          entry: name,
          ...(entry._sourceHash === undefined ? {} : { accepted: true }),
        });
      }
    }

    if (translated && entry.reviewed === true && entry._reviewHash === undefined) {
      next = { ...next, _reviewHash: await hashEntryText(entry) };
      changes.push({ tag, kind: 'review-hash', entry: name });
    }

    if (translated && entry.reviewed === true && next._reviewHash !== (await hashEntryText(next))) {
      reviewLapsed.push(name);
    }

    if (translated || next._sourceHash !== undefined) {
      counted += 1;
      if (current === undefined) {
        unmatched.push(name);
        inSync = false;
      } else if (next._sourceHash !== current) {
        stale.push(name);
        inSync = false;
      }
    }

    if (next !== entry) {
      sidecar = withEntry(sidecar, ref, next);
    }
  }

  const unknownAccepts = accept
    .filter((ref) => !slotsOf(original).some((slot) => sameRef(slot.ref, ref)))
    .map(formatEntryRef);

  const allInSync = inSync && counted > 0;
  if (allInSync && options.baseRef !== undefined) {
    const held = sidecar.baseRef;
    if (held?.commit !== options.baseRef.commit || held?.path !== options.baseRef.path) {
      sidecar = withBaseRef(sidecar, options.baseRef);
      changes.push({ tag, kind: 'base-ref' });
    }
  }

  return { tag, sidecar, changes, stale, reviewLapsed, unmatched, unknownAccepts, inSync: allInSync };
}

/**
 * Bring each sidecar's tooling fields up to date and report what changed.
 * The result keeps every sidecar's key order; a sidecar with no `changes` is
 * returned as the same object, so a caller can tell what to write.
 */
export async function syncTranslations(
  content: ContentJson,
  manifest: CompileManifest | undefined,
  sidecars: Readonly<Record<string, TranslationSidecar>>,
  options: SyncOptions = {}
): Promise<SidecarSync[]> {
  const source: Source = { blocks: blocksById(content.blocks ?? []), content, manifest };
  const scope = new Set(options.tags ?? Object.keys(sidecars));
  const tags = Object.keys(sidecars).filter((tag) => scope.has(tag));

  const stamped: SidecarSync[] = [];
  for (const tag of tags) {
    stamped.push(await syncOneSidecar(tag, sidecars[tag]!, source, options));
  }

  const layered: SidecarSet = { ...sidecars, ...Object.fromEntries(stamped.map((sync) => [sync.tag, sync.sidecar])) };
  const available = new Set(await availableLocales(content, manifest ?? {}, layered));

  return stamped.map((sync) => {
    // An explicit `false` is a human's call; only an absent latch is stamped.
    if (sync.sidecar._available !== undefined || !available.has(sync.tag)) {
      return sync;
    }
    return {
      ...sync,
      sidecar: { ...sync.sidecar, _available: true },
      changes: [...sync.changes, { tag: sync.tag, kind: 'available' }],
    };
  });
}
