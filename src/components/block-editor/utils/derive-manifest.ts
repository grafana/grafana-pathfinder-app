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
import { readAliasedField } from '../../../validation/normalize-guide-aliases';
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
const FORMFILL_ACTION = 'formfill';

/** Requirement carrier — a block or a step both expose `action` and `requirements`. */
type RequirementCarrier = Record<string, unknown>;

/**
 * Guides reach the editor unnormalized — `GuideLibraryModal` loads `spec.blocks`
 * straight into editor state without `validateGuide` — so the camelCase
 * `targetAction` alias has to be read here or a self-navigating guide looks like
 * one with no navigation at all.
 */
function actionOf(carrier: RequirementCarrier): string | undefined {
  const action = readAliasedField(carrier, 'action');
  return typeof action === 'string' ? action : undefined;
}

/**
 * `undefined` means "keep looking"; `STOP` means the walk hit navigation and no
 * later declaration can speak for where the guide STARTS.
 */
const STOP = Symbol('navigation-reached');
type Scan = string | undefined | typeof STOP;

/** Blocks a reader executes. Mirrors `isExecutableBlock` in the cross-block lint. */
const EXECUTABLE_BLOCK_TYPES: ReadonlySet<string> = new Set(['interactive', 'multistep', 'guided']);

const CONDITIONAL_BLOCK_TYPE = 'conditional';

/** Threaded through the walk so "first executable block" means first in document order. */
interface ScanState {
  sawExecutable: boolean;
}

/**
 * The `on-page:<path>` requirement of the first block that declares one, in
 * document order, stopping at the first navigation.
 *
 * This is the guide's starting location: the block editor already suggests
 * `on-page:<currentPath>` on the first DOM-targeting step precisely so a guide
 * self-declares where it begins (`forms/requirements-suggester.ts`), which makes
 * it authored data rather than a guess.
 *
 * The walk follows the same order as `walkBlocks` in
 * `lint/cross-block-checks.ts`, and "first executable block" means the same
 * thing here as it does there. The lint is what tells an author their entry
 * declaration is accepted; a derivation that traversed differently would stamp a
 * manifest disagreeing with the advice the author acted on.
 *
 * Two narrowings, each of which exists to avoid stamping a page the guide
 * navigates TO rather than the page it starts ON.
 *
 * 1. A `navigate` action's `reftarget` is not a fallback, and the walk STOPS at
 *    the first navigation — including one inside a conditional branch, since a
 *    branch that may have run may have moved the reader. Past that point the
 *    reader's location is whatever the guide put them at, so a later `on-page:`
 *    describes the guide's interior, not its entry. A requirement carried BY the
 *    navigate block still counts — that is a precondition evaluated before the
 *    navigation happens. A self-navigating guide therefore yields nothing and
 *    correctly gets no alignment prompt.
 * 2. A `formfill`'s `on-page:` counts only on the FIRST executable block.
 *    `suggestRequirementsFromContext` adds `on-page:<currentPath>` to every
 *    formfill regardless of position, so a later one is evidence that a form is
 *    page-bound, not evidence about where the guide begins. In first position it
 *    is both, and `firstStepMissingOnPage` accepts it as the entry declaration —
 *    so discarding it would leave a guide the lint calls complete with no
 *    alignment prompt and a first requirement it can fail on arrival. Inside a
 *    `multistep` or `guided` block that means the FIRST step only: the lint's
 *    `walkBlocks` never descends into `steps`, so a later step's formfill is not
 *    something it ever accepted, and honouring one here would stamp the form's
 *    page over the page the group actually starts on.
 *
 * Only an absolute `on-page:` value qualifies. `onPageCheck` passes on a
 * substring match, so a relative `on-page:dashboards` works as a requirement,
 * but `pathMatchesStartingLocation` compares segments and `confirmAlignment`
 * pushes the value as a route — so a relative one would both mis-prompt an
 * already-aligned reader and navigate to a nested path. A comma-packed entry such
 * as `on-page:/explore, navmenu-open` — which `isValidRequirement` accepts on its
 * prefix alone, and which the parser round-trips by joining the array with `,` —
 * contributes only its leading token, never the joined string.
 */
function deriveStartingLocation(blocks: readonly JsonBlock[] | undefined): string | undefined {
  const found = scanBlocks(blocks, { sawExecutable: false });
  return typeof found === 'string' ? found : undefined;
}

function scanBlocks(blocks: readonly JsonBlock[] | undefined, state: ScanState): Scan {
  for (const block of blocks ?? []) {
    const record = block as unknown as RequirementCarrier;
    const type = String(record.type);

    const isFirstExecutable = EXECUTABLE_BLOCK_TYPES.has(type) && !state.sawExecutable;
    if (isFirstExecutable) {
      state.sawExecutable = true;
    }

    const own = declaredOnPage(record, isFirstExecutable);
    if (own) {
      return own;
    }

    // A hand-authored multistep or guided block can declare the page on one of
    // its steps rather than on the container. Only the FIRST step of the first
    // executable block inherits its first-executable standing: a formfill in a
    // later step runs after something else already has, so its `on-page:` is the
    // same "this form is page-bound" evidence it is at root level, not a
    // statement about where the guide begins.
    if (Array.isArray(record.steps)) {
      for (const [stepIndex, step] of record.steps.entries()) {
        const stepRecord = asRecord(step);
        if (!stepRecord) {
          continue;
        }
        const fromStep = declaredOnPage(stepRecord, isFirstExecutable && stepIndex === 0);
        if (fromStep) {
          return fromStep;
        }
        if (actionOf(stepRecord) === NAVIGATE_ACTION) {
          return STOP;
        }
      }
    }

    if (TRANSPARENT_CONTAINERS.has(type) && Array.isArray(record.blocks)) {
      const nested = scanBlocks(record.blocks as JsonBlock[], state);
      if (nested !== undefined) {
        return nested;
      }
    }

    if (type === CONDITIONAL_BLOCK_TYPE) {
      for (const branch of [record.whenTrue, record.whenFalse]) {
        if (!Array.isArray(branch)) {
          continue;
        }
        const nested = scanBlocks(branch as JsonBlock[], state);
        if (nested !== undefined) {
          return nested;
        }
      }
    }

    if (actionOf(record) === NAVIGATE_ACTION) {
      return STOP;
    }
  }
  return undefined;
}

/**
 * The absolute `on-page:` this carrier declares. A `formfill`'s counts only when
 * it sits on the first executable block — see narrowing 2 above.
 */
function declaredOnPage(carrier: RequirementCarrier, isFirstExecutable: boolean): string | undefined {
  if (actionOf(carrier) === FORMFILL_ACTION && !isFirstExecutable) {
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
    const [leading = ''] = requirement.slice(ON_PAGE_PREFIX.length).split(',');
    const path = leading.trim();
    if (path.startsWith('/') && !/\s/.test(path)) {
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
 * - `additionalFields.startingLocation` — owned CONDITIONALLY; see below.
 *
 * Everything else in `inherited` survives byte-identical, including any
 * `additionalFields` key this function does not own.
 *
 * ## Who owns `startingLocation`
 *
 * The field has two possible authors. The editor derives it from block content.
 * An uploaded or externally scripted package writes it directly — it is untyped
 * under `additionalFields`, so anything may be there and the editor cannot read
 * intent off the value itself.
 *
 * Both of the obvious rules lose data. Always writing it means a title-only edit
 * erases a value the editor never authored. Never clearing it means an author who
 * deletes the `on-page:` requirement is left with a stale prompt and no
 * in-product way to remove it.
 *
 * So ownership is decided per save, from provenance rather than from the value:
 * the editor owns the field when there is nothing inherited to lose, or when the
 * inherited value is exactly what this derivation produces from
 * `inheritedBlocks` — the content read alongside that manifest. That is the
 * strongest available proof the editor put it there, and it needs no extra
 * persisted marker that could itself drift from the value it describes.
 *
 * When the editor owns the field it writes the newly derived value, or CLEARS it
 * when the content declares none — so removing the requirement removes the
 * prompt. When it does not, the inherited value passes through untouched like
 * every other unowned key, and a save never silently rewrites metadata the
 * editor did not author.
 *
 * A value that diverges once stays the external author's: reclaiming it belongs
 * to an explicit manifest control, not to a silent overwrite.
 *
 * `stats` keeps unconditional preserve semantics for the non-guide case, because
 * a metapackage's rollup is computed elsewhere and the editor's silence about it
 * means "I cannot see this", not "it is gone".
 *
 * @param inherited - `spec.manifest` last read off the resource.
 * @param inheritedBlocks - `spec.blocks` last read off the SAME resource. Omitted
 *   means no prior content is known, which leaves any inherited
 *   `startingLocation` unowned and therefore preserved.
 */
export function deriveManifest(
  guide: JsonGuide,
  inherited?: unknown,
  inheritedBlocks?: unknown
): Record<string, unknown> {
  const base = { ...(asRecord(inherited) ?? {}) };

  const inheritedType = typeof base.type === 'string' && base.type.length > 0 ? base.type : undefined;
  const type = inheritedType ?? 'guide';

  const inheritedAdditional = asRecord(base.additionalFields);
  const additionalFields: Record<string, unknown> = { ...(inheritedAdditional ?? {}) };

  if (type === PLAIN_GUIDE_TYPE) {
    additionalFields.stats = summarizeGuideBlocks(guide.blocks);
  }

  const inheritedStartingLocation = inheritedAdditional?.startingLocation;
  const editorOwnsStartingLocation =
    inheritedStartingLocation === undefined ||
    inheritedStartingLocation === deriveStartingLocation(asBlocks(inheritedBlocks));

  if (editorOwnsStartingLocation) {
    const startingLocation = deriveStartingLocation(guide.blocks);
    if (startingLocation !== undefined) {
      additionalFields.startingLocation = startingLocation;
    } else {
      delete additionalFields.startingLocation;
    }
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

/** `spec.blocks` arrives off the wire, so anything but an array is "no content". */
function asBlocks(value: unknown): readonly JsonBlock[] | undefined {
  return Array.isArray(value) ? (value as JsonBlock[]) : undefined;
}
