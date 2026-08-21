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
import { ParameterizedRequirementPrefix } from '../../../types/requirements.types';
import type { JsonBlock, JsonGuide } from '../types';

/** Every App Platform guide is app-platform-sourced; see `repository-identity-authority`. */
const APP_PLATFORM_REPOSITORY = 'app-platform';

const ON_PAGE_PREFIX = ParameterizedRequirementPrefix.ON_PAGE;

/**
 * The only type whose stats the editor can compute. Checked positively rather
 * than excluding `path`/`journey`, so an unrecognised or legacy type gets NO
 * stamp instead of a wrong one — an absent denominator is recoverable, a
 * confidently wrong one is not.
 */
const PLAIN_GUIDE_TYPE = 'guide';

const TRANSPARENT_CONTAINERS: ReadonlySet<string> = new Set(TRANSPARENT_CONTAINER_BLOCK_TYPES);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

const NAVIGATE_ACTION = 'navigate';

/** Requirement carrier — a block or a step both expose `action` and `requirements`. */
type RequirementCarrier = Record<string, unknown>;

/**
 * `undefined` means "keep looking"; `STOP` means the walk hit navigation and no
 * later declaration can speak for where the guide STARTS.
 */
const STOP = Symbol('navigation-reached');
type Scan = string | undefined | typeof STOP;

/**
 * The `on-page:<path>` requirement of the first block that declares one, in
 * document order, stopping at the first navigation.
 *
 * This is the guide's starting location: the block editor already suggests
 * `on-page:<currentPath>` on the first DOM-targeting step precisely so a guide
 * self-declares where it begins (`forms/requirements-suggester.ts`), which makes
 * it authored data rather than a guess.
 *
 * Three deliberate narrowings, each of which exists to avoid stamping a page the
 * guide navigates TO rather than the page it starts ON.
 *
 * 1. A `navigate` action's `reftarget` is not a fallback, and the walk STOPS at
 *    the first navigation. Past that point the reader's location is whatever the
 *    guide put them at, so a later `on-page:` describes the guide's interior, not
 *    its entry. A requirement carried BY the navigate block still counts — that
 *    is a precondition evaluated before the navigation happens. A self-navigating
 *    guide therefore yields nothing and correctly gets no alignment prompt.
 * 2. An `on-page:` on a `formfill` is ignored. `suggestRequirementsFromContext`
 *    adds `on-page:<currentPath>` to EVERY formfill regardless of position, so
 *    the requirement is evidence that a form is page-bound, not evidence about
 *    where the guide begins.
 * 3. Conditional branches are not descended into — their contents are mutually
 *    exclusive, so neither branch speaks for the guide.
 *
 * Only an absolute `on-page:` value qualifies. `onPageCheck` passes on a
 * substring match, so a relative `on-page:dashboards` works as a requirement,
 * but `pathMatchesStartingLocation` compares segments and `confirmAlignment`
 * pushes the value as a route — so a relative one would both mis-prompt an
 * already-aligned reader and navigate to a nested path.
 */
function deriveStartingLocation(blocks: readonly JsonBlock[] | undefined): string | undefined {
  const found = scanBlocks(blocks);
  return typeof found === 'string' ? found : undefined;
}

function scanBlocks(blocks: readonly JsonBlock[] | undefined): Scan {
  for (const block of blocks ?? []) {
    const record = block as unknown as RequirementCarrier;

    const own = declaredOnPage(record);
    if (own) {
      return own;
    }

    // A multistep's or guided block's first step is where the suggester puts the
    // page declaration for that group.
    if (Array.isArray(record.steps)) {
      for (const step of record.steps) {
        const stepRecord = asRecord(step);
        if (!stepRecord) {
          continue;
        }
        const fromStep = declaredOnPage(stepRecord);
        if (fromStep) {
          return fromStep;
        }
        if (stepRecord.action === NAVIGATE_ACTION) {
          return STOP;
        }
      }
    }

    if (TRANSPARENT_CONTAINERS.has(String(record.type)) && Array.isArray(record.blocks)) {
      const nested = scanBlocks(record.blocks as JsonBlock[]);
      if (nested !== undefined) {
        return nested;
      }
    }

    if (record.action === NAVIGATE_ACTION) {
      return STOP;
    }
  }
  return undefined;
}

/**
 * The absolute `on-page:` this carrier declares, ignoring a `formfill`'s — see
 * narrowing 2 above.
 */
function declaredOnPage(carrier: RequirementCarrier): string | undefined {
  if (carrier.action === 'formfill') {
    return undefined;
  }
  return firstOnPage(carrier.requirements);
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
    if (path.startsWith('/')) {
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
 * - `additionalFields.startingLocation` — set when the content declares one and
 *   CLEARED when it does not, so an author who removes the requirement removes
 *   the prompt with it.
 *
 * Everything else in `inherited` survives byte-identical, including any
 * `additionalFields` key this function does not own. The one exception is
 * `startingLocation`, which the content fully determines: there, an absent
 * derivation IS the information, so it clears rather than preserves. `stats` keeps
 * the preserve semantics, because a metapackage's rollup is computed elsewhere and
 * the editor's silence about it means "I cannot see this", not "it is gone".
 */
export function deriveManifest(guide: JsonGuide, inherited?: unknown): Record<string, unknown> {
  const base = { ...(asRecord(inherited) ?? {}) };

  const inheritedType = typeof base.type === 'string' && base.type.length > 0 ? base.type : undefined;
  const type = inheritedType ?? 'guide';

  const inheritedAdditional = asRecord(base.additionalFields);
  const additionalFields: Record<string, unknown> = { ...(inheritedAdditional ?? {}) };

  if (type === PLAIN_GUIDE_TYPE) {
    additionalFields.stats = summarizeGuideBlocks(guide.blocks);
  }

  // Written unconditionally, so removing the requirement removes the prompt. A
  // skipped write would leave a stale value outliving the content that justified
  // it, with no in-product way to clear it.
  const startingLocation = deriveStartingLocation(guide.blocks);
  if (startingLocation !== undefined) {
    additionalFields.startingLocation = startingLocation;
  } else {
    delete additionalFields.startingLocation;
  }

  const manifest: Record<string, unknown> = { ...base, type };

  if (typeof base.repository !== 'string' || base.repository.length === 0) {
    manifest.repository = APP_PLATFORM_REPOSITORY;
  }

  // Assigned or removed, never left to the `...base` spread: the spread carries the
  // INHERITED additionalFields, so skipping the write here would resurrect the very
  // key the clear above just removed.
  if (Object.keys(additionalFields).length > 0) {
    manifest.additionalFields = additionalFields;
  } else {
    delete manifest.additionalFields;
  }

  return manifest;
}
