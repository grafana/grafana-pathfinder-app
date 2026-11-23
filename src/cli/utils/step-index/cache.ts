/**
 * Builds the verified procedure index from the catalog, the e2e health report
 * and each passing guide's content.
 *
 * Only the fetched guide JSON is persisted, one file per guide under a directory named for the repository
 * and the health revision; the index is rebuilt in memory in every process, which is cheap next to fetching.
 * Eligibility is always computed from the live health report and catalog, so nothing on disk can keep a guide
 * eligible, and the cache is safe to delete.
 */

import { createHash } from 'crypto';
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import { homedir, platform } from 'os';
import { dirname, join } from 'path';

import type { JsonBlock } from '../../../types/json-guide.types';
import {
  fetchPackageContent,
  fetchPackageHealth,
  fetchRepositoryIndex,
  type RepositoryClientError,
  type RepositoryPackage,
} from '../repository-client';
import { buildStepIndex, type StepSearchIndex } from './index';
import { segmentGuide } from './segment';

const RECHECK_INTERVAL_MS = 10 * 60_000;
const CONTENT_CONCURRENCY = 8;
const LEGACY_CACHE_FILE = /^step-index-.+\.json$/;

export interface BuildStats {
  healthRevision: number;
  healthGeneratedAt?: string;
  eligibleGuides: number;
  indexedGuides: number;
  /** Eligible guides whose content is permanently missing or unreadable (404, malformed). */
  unavailableGuides?: number;
  /** Eligible guides whose content fetch failed transiently, twice. */
  fetchFailedGuides?: number;
  procedures: number;
  builtAt: string;
}

export interface CatalogPath {
  id: string;
  title: string;
  milestones: string[];
}

export interface StepIndexSnapshot extends StepSearchIndex {
  baseUrl: string;
  guidePaths: Record<string, string>;
  paths: CatalogPath[];
  stats: BuildStats;
}

export type StepIndexResult =
  | { ok: true; snapshot: StepIndexSnapshot }
  | RepositoryClientError
  | { ok: false; code: 'EMPTY_INDEX'; message: string };

type Health = Extract<Awaited<ReturnType<typeof fetchPackageHealth>>, { ok: true }>;
type Catalog = Extract<Awaited<ReturnType<typeof fetchRepositoryIndex>>, { ok: true }>;
type Guide = Record<string, unknown>;
type Loaded = { guide: Guide } | 'unavailable' | 'failed';

interface Held {
  revision: number;
  catalogHash: string;
  checkedAt: number;
  snapshot: StepIndexSnapshot;
}

let held: Held | undefined;
let inFlight: Promise<StepIndexResult> | undefined;
let failed: { at: number; result: Exclude<StepIndexResult, { ok: true }> } | undefined;

export function cacheDirectory(): string {
  const base = process.env.XDG_CACHE_HOME || join(homedir(), platform() === 'darwin' ? 'Library/Caches' : '.cache');
  return join(base, 'pathfinder-cli');
}

export function getStepIndex(): Promise<StepIndexResult> {
  if (held && Date.now() - held.checkedAt < RECHECK_INTERVAL_MS) {
    return Promise.resolve({ ok: true, snapshot: held.snapshot });
  }
  if (!held && failed && Date.now() - failed.at < RECHECK_INTERVAL_MS) {
    return Promise.resolve(failed.result);
  }
  inFlight ??= resolveIndex().finally(() => {
    inFlight = undefined;
  });
  return inFlight;
}

export function __resetStepIndexForTests(): void {
  held = undefined;
  inFlight = undefined;
  failed = undefined;
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

async function resolveIndex(): Promise<StepIndexResult> {
  const [health, catalog] = await Promise.all([fetchPackageHealth(), fetchRepositoryIndex()]);
  const previous = held;
  // A failed recheck (fetch failure or an empty rebuild) keeps serving the last good index until the next interval.
  const keepHeld = (): StepIndexResult => {
    held = { ...previous!, checkedAt: Date.now() };
    return { ok: true, snapshot: previous!.snapshot };
  };
  // With nothing held, remember the failure so repeated calls do not refetch every guide from a failing origin.
  const fail = (result: Exclude<StepIndexResult, { ok: true }>, source?: string): StepIndexResult => {
    if (previous) {
      return keepHeld();
    }
    const at = Date.now();
    const retryAt = new Date(at + RECHECK_INTERVAL_MS).toISOString();
    const message = `${source ? `${source}: ` : ''}${result.message} Not retried before ${retryAt}.`;
    failed = { at, result: { ...result, message } };
    return failed.result;
  };
  if (!health.ok) {
    return fail(health, 'health report');
  }
  if (!catalog.ok) {
    return fail(catalog, 'catalog');
  }
  const catalogHash = sha256(JSON.stringify(catalog.rawIndex) + catalog.baseUrl);
  const unchanged = previous?.revision === health.revision && previous.catalogHash === catalogHash;
  if (previous && unchanged && !previous.snapshot.stats.fetchFailedGuides) {
    return keepHeld();
  }

  const built = await build(health, catalog);
  if (!built.ok) {
    return fail(built);
  }
  // A changed revision or catalog changes which guides are eligible, so even a partial build (some content fetches
  // failed) replaces the held index. For the same guides, keep whichever indexed more procedures.
  const partial = (built.snapshot.stats.fetchFailedGuides ?? 0) > 0;
  const useBuilt =
    !previous || !unchanged || !partial || built.snapshot.stats.procedures >= previous.snapshot.stats.procedures;
  const snapshot = useBuilt ? built.snapshot : previous.snapshot;
  held = { revision: health.revision, catalogHash, checkedAt: Date.now(), snapshot };
  failed = undefined;
  return { ok: true, snapshot };
}

function readGuide(file: string): Guide | undefined {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
  try {
    const data: unknown = JSON.parse(text);
    if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
      return data as Guide;
    }
  } catch {
    // Falls through to removal.
  }
  try {
    rmSync(file, { force: true });
  } catch {
    // An unwritable cache directory keeps the bad file; the guide is refetched either way.
  }
  return undefined;
}

function writeGuide(file: string, data: Guide): void {
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(temporary, JSON.stringify(data));
    renameSync(temporary, file);
  } catch {
    // The disk copy only saves a fetch; serving without it is correct.
  }
}

function pruneCache(revisionDirectory: string): void {
  const attempt = (remove: () => void) => {
    try {
      remove();
    } catch {
      // Pruning is housekeeping; a leftover file is harmless.
    }
  };
  const parent = dirname(revisionDirectory);
  attempt(() => {
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      const path = join(parent, entry.name);
      if (entry.isDirectory() && path !== revisionDirectory) {
        attempt(() => rmSync(path, { recursive: true, force: true }));
      }
    }
  });
  attempt(() => {
    for (const name of readdirSync(cacheDirectory())) {
      if (LEGACY_CACHE_FILE.test(name)) {
        attempt(() => rmSync(join(cacheDirectory(), name), { force: true }));
      }
    }
  });
}

async function build(health: Health, catalog: Catalog): Promise<StepIndexResult> {
  const eligible = catalog.packages.filter((entry) => {
    const report = health.packages[entry.id];
    return entry.type === 'guide' && report?.health === 'healthy' && report.blockedBy.length === 0;
  });
  const pathTitles = new Map<string, string[]>();
  const paths: CatalogPath[] = [];
  for (const entry of catalog.packages) {
    if (entry.milestones?.length) {
      paths.push({ id: entry.id, title: entry.title ?? entry.id, milestones: entry.milestones });
    }
    for (const milestone of entry.milestones ?? []) {
      pathTitles.set(milestone, [...(pathTitles.get(milestone) ?? []), entry.title ?? entry.id]);
    }
  }

  const revisionDirectory = join(
    cacheDirectory(),
    'step-index',
    sha256(catalog.baseUrl).slice(0, 12),
    String(health.revision)
  );
  const load = async (entry: RepositoryPackage): Promise<Loaded> => {
    const file = join(revisionDirectory, `${encodeURIComponent(entry.id)}.json`);
    const cached = readGuide(file);
    if (cached) {
      return { guide: cached };
    }
    const content = await fetchPackageContent(entry.id);
    if (content.ok) {
      if (!content.parsed) {
        return 'unavailable';
      }
      writeGuide(file, content.parsed);
      return { guide: content.parsed };
    }
    const transient = content.code === 'NETWORK_ERROR' || (content.code === 'HTTP_ERROR' && content.status !== 404);
    return transient ? 'failed' : 'unavailable';
  };

  const loaded = await mapConcurrently(eligible, load);
  const retry = loaded.flatMap((result, i) => (result === 'failed' ? [i] : []));
  const retried = await mapConcurrently(retry, (i) => load(eligible[i]!));
  retry.forEach((i, j) => {
    loaded[i] = retried[j]!;
  });

  const procedures = eligible.flatMap((entry, i) => {
    const result = loaded[i]!;
    const blocks = typeof result === 'object' ? result.guide.blocks : undefined;
    return Array.isArray(blocks)
      ? segmentGuide({
          id: entry.id,
          title: entry.title ?? entry.id,
          pathTitles: pathTitles.get(entry.id) ?? [],
          blocks: blocks as JsonBlock[],
        })
      : [];
  });
  const count = (state: Loaded) => loaded.filter((result) => result === state).length;
  const unavailableGuides = count('unavailable');
  const fetchFailedGuides = count('failed');
  const indexedGuides = eligible.length - unavailableGuides - fetchFailedGuides;

  if (procedures.length === 0 && catalog.packages.some((entry) => entry.type === 'guide')) {
    return {
      ok: false,
      code: 'EMPTY_INDEX',
      message: `No procedures could be built (eligibleGuides: ${eligible.length}, indexedGuides: ${indexedGuides}, unavailableGuides: ${unavailableGuides}, fetchFailedGuides: ${fetchFailedGuides}).`,
    };
  }
  pruneCache(revisionDirectory);

  return {
    ok: true,
    snapshot: {
      ...buildStepIndex(procedures),
      baseUrl: catalog.baseUrl,
      guidePaths: Object.fromEntries(eligible.map((entry) => [entry.id, entry.path])),
      paths,
      stats: {
        healthRevision: health.revision,
        ...(health.generatedAt ? { healthGeneratedAt: health.generatedAt } : {}),
        eligibleGuides: eligible.length,
        indexedGuides,
        ...(unavailableGuides > 0 ? { unavailableGuides } : {}),
        ...(fetchFailedGuides > 0 ? { fetchFailedGuides } : {}),
        procedures: procedures.length,
        builtAt: new Date().toISOString(),
      },
    },
  };
}

async function mapConcurrently<T, R>(items: T[], run: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONTENT_CONCURRENCY, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await run(items[i]!);
      }
    })
  );
  return results;
}
