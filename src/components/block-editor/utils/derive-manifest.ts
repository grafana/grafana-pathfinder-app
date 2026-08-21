/**
 * Derives the `spec.manifest` the block editor stamps onto a private guide, so
 * an editor-authored guide is a complete package rather than manifest-less
 * content.
 *
 * Two constraints shape every rule here.
 *
 * **The manifest is MERGED over what was read, never replaced.** An App Platform
 * PUT is a whole-object replace and `preservedSpec` layers editor-owned fields
 * over the spec last read (#1663). A derivation that replaced the inherited
 * manifest would delete a learning path's `milestones` on the first save of its
 * cover page — the #1599 regression. So the editor owns exactly the fields it
 * can compute from content it owns, and passes everything else through
 * untouched.
 *
 * **The CRD accepts eight keys and silently prunes the rest.** `#Manifest` in
 * grafana-pathfinder-backend's `kinds/interactiveguide.cue` declares `type`,
 * `repository`, `description`, `milestones`, `author`, `category`, `depends`
 * and `additionalFields`. An undeclared key is dropped with a 201 and a
 * `Warning:` header `getBackendSrv()` never surfaces — so `stats` and
 * `startingLocation` go under `additionalFields`, matching what
 * `scripts/upsert-learning-path.sh` already does and what
 * `docs/design/CONCERNS.md` records as the two-location contract.
 */

import { summarizeGuideBlocks, TRANSPARENT_CONTAINER_BLOCK_TYPES } from '../../../lib/guide-stats';
import type { JsonBlock, JsonGuide } from '../types';

/** Every App Platform guide is app-platform-sourced; see `repository-identity-authority`. */
const APP_PLATFORM_REPOSITORY = 'app-platform';

const ON_PAGE_PREFIX = 'on-page:';

/**
 * The only type whose stats the editor can compute. Checked positively rather
 * than excluding `path`/`journey`, so an unrecognised or legacy type gets NO
 * stamp instead of a wrong one — an absent denominator is recoverable, a
 * confidently wrong one is not.
 */
const PLAIN_GUIDE_TYPE = 'guide';

const TRANSPARENT_CONTAINERS: ReadonlySet<string> = new Set(TRANSPARENT_CONTAINER_BLOCK_TYPES);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * The `on-page:<path>` requirement of the first block that declares one, in
 * document order.
 *
 * This is the guide's starting location: the block editor already suggests
 * `on-page:<currentPath>` on the first DOM-targeting step precisely so a guide
 * self-declares where it begins (`forms/requirements-suggester.ts`), which makes
 * it authored data rather than a guess.
 *
 * Deliberately narrow. A `navigate` action's `reftarget` is NOT used as a
 * fallback: that is where the guide *takes* the reader, not where it expects
 * them to be, and a self-navigating guide correctly needs no alignment prompt
 * at all. Conditional branches are not descended into either — their contents
 * are mutually exclusive, so neither branch speaks for the guide.
 */
function deriveStartingLocation(blocks: readonly JsonBlock[] | undefined): string | undefined {
  for (const block of blocks ?? []) {
    const record = block as unknown as Record<string, unknown>;

    const own = firstOnPage(record.requirements);
    if (own) {
      return own;
    }

    // A multistep's or guided block's first step is where the suggester puts the
    // page declaration for that group.
    if (Array.isArray(record.steps)) {
      for (const step of record.steps) {
        const fromStep = firstOnPage(asRecord(step)?.requirements);
        if (fromStep) {
          return fromStep;
        }
      }
    }

    if (TRANSPARENT_CONTAINERS.has(String(record.type)) && Array.isArray(record.blocks)) {
      const nested = deriveStartingLocation(record.blocks as JsonBlock[]);
      if (nested) {
        return nested;
      }
    }
  }
  return undefined;
}

function firstOnPage(requirements: unknown): string | undefined {
  if (!Array.isArray(requirements)) {
    return undefined;
  }
  for (const requirement of requirements) {
    if (typeof requirement !== 'string' || !requirement.startsWith(ON_PAGE_PREFIX)) {
      continue;
    }
    const path = requirement.slice(ON_PAGE_PREFIX.length).trim();
    if (path.length > 0) {
      return path;
    }
  }
  return undefined;
}

/**
 * Builds the manifest to persist for `guide`, layered over `inherited` — the
 * `spec.manifest` last read off the resource, when there was one.
 *
 * Owned fields:
 * - `type` — `'guide'` only when nothing was inherited. An inherited `type` is
 *   never overwritten: that value is what makes a path a path, and the editor
 *   has no model for it.
 * - `repository` — `app-platform`, and only when minting a fresh manifest. An
 *   inherited value is left alone: it is not something the content determines,
 *   both read paths force `app-platform` regardless, and rewriting it would
 *   break the "a no-op save replays the resource byte-identically" invariant
 *   that #1663 established.
 * - `additionalFields.stats` — the canonical block count, only for a plain
 *   guide. A path or journey's stats are a rollup over every milestone's blocks
 *   (`rollUpGuideStats`), which the editor cannot see from a cover page.
 * - `additionalFields.startingLocation` — when the content declares one.
 *
 * Everything else in `inherited` survives byte-identical, including any
 * `additionalFields` key this function does not own. A field this function
 * cannot derive is left exactly as inherited rather than cleared — an absent
 * derivation is "no new information", not "delete what was there".
 */
export function deriveManifest(
  guide: JsonGuide,
  inherited?: Record<string, unknown> | null
): Record<string, unknown> {
  const base = inherited ? { ...inherited } : {};

  const inheritedType = typeof base.type === 'string' && base.type.length > 0 ? base.type : undefined;
  const type = inheritedType ?? 'guide';

  const inheritedAdditional = asRecord(base.additionalFields);
  const additionalFields: Record<string, unknown> = { ...(inheritedAdditional ?? {}) };

  if (type === PLAIN_GUIDE_TYPE) {
    additionalFields.stats = summarizeGuideBlocks(guide.blocks);
  }

  const startingLocation = deriveStartingLocation(guide.blocks);
  if (startingLocation !== undefined) {
    additionalFields.startingLocation = startingLocation;
  }

  const manifest: Record<string, unknown> = { ...base, type };

  if (typeof base.repository !== 'string' || base.repository.length === 0) {
    manifest.repository = APP_PLATFORM_REPOSITORY;
  }

  if (Object.keys(additionalFields).length > 0) {
    manifest.additionalFields = additionalFields;
  }

  return manifest;
}
