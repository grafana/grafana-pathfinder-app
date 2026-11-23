/**
 * `pathfinder-cli sync-translations <dir>` — stamp the tooling-owned fields of a
 * package's translation sidecars (docs/design/I18N.md §6.8, §7.1, §9).
 *
 * The only writer of `_sourceHash`, `_reviewHash`, `_available` and `baseRef`.
 * It stamps what is missing and never re-stamps a value that no longer matches,
 * since that would hide a stale or changed translation; `--accept` is the
 * deliberate act that re-stamps `_sourceHash`, and never `_reviewHash`.
 * `validate` stays read-only.
 *
 * The rules live in `src/lib/guide-translation/sync-translations.ts`. This
 * file reads the package, asks git for `baseRef`, and writes.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';

import { z } from 'zod';

import {
  formatEntryRef,
  parseEntryRef,
  syncTranslations,
  type SidecarSync,
  type SyncChange,
} from '../../lib/guide-translation/sync-translations';
import type { TranslationBaseRef, TranslationSidecar } from '../../types/translation-sidecar.schema';
import { defineCommand } from '../contracts';
import { resolveCliPath } from '../utils/file-loader';
import { PackageIOError, readPackage, readPackageSidecars, writePackageSidecar } from '../utils/package-io';
import { issueToOutcome, renderError, type CommandOutcome } from '../utils/output';

const CONTENT_FILE = 'content.json';
const GIT_TIMEOUT_MS = 10_000;

export const SyncTranslationsCommand = z.object({
  dir: z.string().describe('package directory').meta({ role: 'io' }),
  locale: z
    .string()
    .min(1)
    .optional()
    .describe('Sync only this sidecar (a language tag such as ja); required with --accept')
    .meta({ role: 'addressing' }),
  accept: z
    .array(z.string().min(1))
    .default([])
    .describe(
      'Re-stamp the source hash of these entries of --locale: the translation now matches the current English. Never restores a lapsed review. Name `guide`, `manifest`, a block id, or `block:<id>` for a block called guide or manifest'
    )
    .meta({ role: 'addressing' }),
  check: z
    .boolean()
    .default(false)
    .describe('Print what would be written and exit non-zero if anything would be; write nothing')
    .meta({ role: 'control' }),
});

export type SyncTranslationsInput = z.output<typeof SyncTranslationsCommand>;

type BaseRefLookup = { ok: true; ref: TranslationBaseRef } | { ok: false; note: string };

function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', [...args], {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: GIT_TIMEOUT_MS,
  }).trim();
}

/**
 * The commit that last changed `content.json`, with its repository-relative
 * path. Never an error: a package outside a git repository, a shallow clone, or
 * a `content.json` with uncommitted edits has no commit to record, and the hash
 * comparison is the source of truth either way (§9.1).
 */
function lookupBaseRef(packageDir: string): BaseRefLookup {
  try {
    const prefix = git(packageDir, ['rev-parse', '--show-prefix']);
    if (git(packageDir, ['rev-parse', '--is-shallow-repository']) === 'true') {
      return { ok: false, note: 'baseRef not advanced: the git history is shallow' };
    }
    if (git(packageDir, ['status', '--porcelain', '--', CONTENT_FILE]) !== '') {
      return { ok: false, note: `baseRef not advanced: ${CONTENT_FILE} has uncommitted changes` };
    }
    const commit = git(packageDir, ['log', '-1', '--format=%H', '--', CONTENT_FILE]);
    if (commit === '') {
      return { ok: false, note: `baseRef not advanced: no commit has changed ${CONTENT_FILE}` };
    }
    return { ok: true, ref: { commit, path: `${prefix}${CONTENT_FILE}` } };
  } catch {
    return { ok: false, note: 'baseRef not advanced: the package is not in a usable git repository' };
  }
}

const CHANGE_LABEL: Record<SyncChange['kind'], string> = {
  'source-hash': '_sourceHash',
  'review-hash': '_reviewHash',
  available: '_available: true',
  'base-ref': 'baseRef',
};

function describeChange(change: SyncChange): string {
  const label = CHANGE_LABEL[change.kind];
  const where = change.entry === undefined ? '' : ` ${change.entry}`;
  const how = change.accepted ? ' (re-stamped, accepted)' : '';
  return `i18n/${change.tag}.json: ${label}${where}${how}`;
}

function describeFindings(syncs: readonly SidecarSync[]): string[] {
  return syncs.flatMap(({ tag, stale, reviewLapsed, unmatched }) => [
    ...(stale.length > 0
      ? [`i18n/${tag}.json: stale, English changed since translated (left as is): ${stale.join(', ')}`]
      : []),
    ...(reviewLapsed.length > 0
      ? [
          `i18n/${tag}.json: review lapsed, text changed since reviewed (not counted as reviewed): ${reviewLapsed.join(', ')}`,
        ]
      : []),
    ...(unmatched.length > 0 ? [`i18n/${tag}.json: no English source to hash: ${unmatched.join(', ')}`] : []),
  ]);
}

function failure(code: string, message: string, data?: Record<string, unknown>): CommandOutcome {
  return { status: 'error', code, message, ...(data ? { data } : {}) };
}

export async function runSyncTranslations(args: SyncTranslationsInput): Promise<CommandOutcome> {
  const dir = resolveCliPath(args.dir);
  if (!fs.existsSync(dir)) {
    return failure('NOT_FOUND', `Package directory not found: ${dir}`);
  }
  if (args.accept.length > 0 && args.locale === undefined) {
    return failure('INVALID_OPTIONS', '--accept re-stamps entries of one translation; name it with --locale <tag>', {
      param: 'accept',
    });
  }

  let reads;
  let state;
  try {
    state = readPackage(dir);
    reads = readPackageSidecars(dir);
  } catch (err) {
    if (err instanceof PackageIOError) {
      return issueToOutcome(err.issues[0] ?? { code: err.code, message: err.message });
    }
    return failure('SCHEMA_VALIDATION', renderError(err));
  }

  const unreadable = reads.flatMap((read) => (read.ok ? [] : [`${read.filePath}: ${read.message}`]));
  if (unreadable.length > 0) {
    return failure(
      'SIDECAR_UNREADABLE',
      `Cannot sync: ${unreadable.length} sidecar(s) could not be read; nothing written. Run validate for details.\n${unreadable.map((line) => `  - ${line}`).join('\n')}`,
      { files: unreadable }
    );
  }

  const sidecars: Record<string, TranslationSidecar> = {};
  for (const read of reads) {
    if (read.ok) {
      sidecars[read.tag] = read.sidecar;
    }
  }
  if (args.locale !== undefined && sidecars[args.locale] === undefined) {
    return failure('NOT_FOUND', `No sidecar for locale "${args.locale}" in ${dir}/i18n`, {
      locales: Object.keys(sidecars),
    });
  }
  if (Object.keys(sidecars).length === 0) {
    return {
      status: 'ok',
      summary: 'No translation sidecars (nothing to sync)',
      data: { changes: [], written: [] },
    };
  }

  const baseRef = lookupBaseRef(dir);
  const syncs = await syncTranslations(state.content, state.manifest, sidecars, {
    ...(args.locale === undefined ? {} : { tags: [args.locale] }),
    accept: args.accept.map(parseEntryRef),
    ...(baseRef.ok ? { baseRef: baseRef.ref } : {}),
  });

  const acceptNames = new Set(args.accept.map((token) => formatEntryRef(parseEntryRef(token))));
  const unknown = syncs.flatMap(({ tag, unknownAccepts }) => unknownAccepts.map((id) => `${tag}: ${id}`));
  const orphaned = syncs.flatMap(({ tag, unmatched }) =>
    unmatched.filter((id) => acceptNames.has(id)).map((id) => `${tag}: ${id}`)
  );
  if (unknown.length > 0 || orphaned.length > 0) {
    const problems = [
      ...unknown.map((line) => `${line} is not an entry of the sidecar`),
      ...orphaned.map((line) => `${line} has no English source to accept against`),
    ];
    return failure(
      'INVALID_OPTIONS',
      `Cannot accept; nothing written.\n${problems.map((p) => `  - ${p}`).join('\n')}`,
      {
        param: 'accept',
      }
    );
  }

  const changes = syncs.flatMap((sync) => sync.changes);
  const lines = changes.map(describeChange);
  const findings = describeFindings(syncs);
  const notes = [...(baseRef.ok ? [] : [baseRef.note]), ...findings];
  const pending = syncs.filter((sync) => sync.changes.length > 0);

  const data = {
    changes: changes.map((change) => ({ ...change })),
    stale: Object.fromEntries(syncs.map((sync) => [sync.tag, sync.stale])),
    reviewLapsed: Object.fromEntries(syncs.map((sync) => [sync.tag, sync.reviewLapsed])),
    unmatched: Object.fromEntries(syncs.map((sync) => [sync.tag, sync.unmatched])),
    notes,
  };

  if (args.check) {
    if (pending.length === 0) {
      return { status: 'ok', summary: 'Translation sidecars are in sync (nothing to write)', hints: notes, data };
    }
    return failure(
      'TRANSLATIONS_OUT_OF_SYNC',
      `${changes.length} change(s) to ${pending.length} sidecar(s) would be written; run sync-translations to apply them.\n${lines.map((line) => `  - ${line}`).join('\n')}`,
      data
    );
  }

  try {
    for (const sync of pending) {
      writePackageSidecar(dir, sync.tag, sync.sidecar);
    }
  } catch (err) {
    if (err instanceof PackageIOError) {
      return issueToOutcome(err.issues[0] ?? { code: err.code, message: err.message });
    }
    return failure('WRITE_FAILED', renderError(err));
  }

  if (pending.length === 0) {
    return { status: 'ok', summary: 'Translation sidecars already in sync (nothing written)', hints: notes, data };
  }
  return {
    status: 'ok',
    summary: `Wrote ${changes.length} change(s) to ${pending.length} sidecar(s)`,
    text: lines.map((line) => `  ${line}`).join('\n'),
    hints: notes,
    data: { ...data, written: pending.map((sync) => sync.tag) },
  };
}

export const syncTranslationsSpec = defineCommand({
  name: 'sync-translations',
  summary: "Stamp a package's translation sidecars with source hashes, review hashes, availability and baseRef",
  schema: SyncTranslationsCommand,
  run: runSyncTranslations,
});
