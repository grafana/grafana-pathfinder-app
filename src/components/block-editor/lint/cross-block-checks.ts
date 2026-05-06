/**
 * Cross-block checks — editor-only Phase 3 lint rules.
 *
 * The canonical `validateGuide` is per-field (Zod schema + condition
 * grammar). It can't see relationships *between* blocks: a
 * `section-completed:setup` requirement that references a section that
 * doesn't exist, a destructive button without an objective, a first
 * step that assumes a page but never declares it. These editor-only
 * checks layer on top of the canonical pipeline to catch those.
 *
 * Each function takes the parsed `JsonGuide` and returns
 * `Diagnostic[]`. Diagnostics carry the same shape as canonical ones
 * (severity / code / message / path) so the Health panel and per-block
 * `forPath` lookup work uniformly.
 *
 * Rule of thumb: only the cheap, structural checks live here.
 * DOM-probing checks (e.g. selector-won't-match) belong with the
 * existing `SelectorHealthBadge` infrastructure since they need live
 * page context.
 */

import type {
  JsonBlock,
  JsonGuide,
  JsonInteractiveBlock,
  JsonMultistepBlock,
  JsonGuidedBlock,
  JsonSectionBlock,
} from '../../../types/json-guide.types';
import {
  isInteractiveBlock,
  isMultistepBlock,
  isGuidedBlock,
  isSectionBlock,
  isConditionalBlock,
} from '../../../types/json-guide.types';
import { ParameterizedRequirementPrefix } from '../../../types/requirements.types';
import type { Diagnostic } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ON_PAGE_PREFIX = ParameterizedRequirementPrefix.ON_PAGE; // 'on-page:'
const SECTION_COMPLETED_PREFIX = ParameterizedRequirementPrefix.SECTION_COMPLETED; // 'section-completed:'

const DESTRUCTIVE_REFTARGET_PATTERN = /\b(delete|destroy|remove)\b/i;

type GuidedOrMultistep = JsonMultistepBlock | JsonGuidedBlock;

/**
 * Walk every block in the guide depth-first, yielding `[block, path]`
 * pairs where `path` is the JSON path to that block.
 */
function* walkBlocks(
  blocks: JsonBlock[],
  base: Array<string | number>
): Generator<{
  block: JsonBlock;
  path: Array<string | number>;
}> {
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    const path = [...base, i];
    yield { block, path };

    if (isSectionBlock(block) && Array.isArray(block.blocks)) {
      yield* walkBlocks(block.blocks, [...path, 'blocks']);
    } else if (isConditionalBlock(block)) {
      if (Array.isArray(block.whenTrue)) {
        yield* walkBlocks(block.whenTrue, [...path, 'whenTrue']);
      }
      if (Array.isArray(block.whenFalse)) {
        yield* walkBlocks(block.whenFalse, [...path, 'whenFalse']);
      }
    }
  }
}

function hasOnPageRequirement(requirements?: string[]): boolean {
  if (!requirements) {
    return false;
  }
  return requirements.some((r) => r.startsWith(ON_PAGE_PREFIX));
}

/** True if the block represents one of the user-executable interactive types. */
function isExecutableBlock(block: JsonBlock): block is JsonInteractiveBlock | JsonMultistepBlock | JsonGuidedBlock {
  return isInteractiveBlock(block) || isMultistepBlock(block) || isGuidedBlock(block);
}

// ---------------------------------------------------------------------------
// Check codes (exported so the Health panel can look up doc links / labels)
// ---------------------------------------------------------------------------

export const CROSS_BLOCK_CHECK_CODES = Object.freeze({
  FIRST_STEP_MISSING_ON_PAGE: 'editor.firstStepMissingOnPage',
  ORPHAN_SECTION_REFERENCE: 'editor.orphanSectionReference',
  DESTRUCTIVE_ACTION_WITHOUT_OBJECTIVE: 'editor.destructiveActionWithoutObjective',
  UNUSED_SECTION: 'editor.unusedSection',
});

// ---------------------------------------------------------------------------
// firstStepMissingOnPage
// ---------------------------------------------------------------------------

/**
 * The first executable block in a guide should declare what page it
 * expects to run on, otherwise launching the guide from a non-contextual
 * surface (the home page, a URL param) leaves the user staring at a
 * step whose target isn't on the current page.
 *
 * Surfaced as a *warning* so the author can dismiss it on guides where
 * they've intentionally made the first step a navigation step (the
 * "self-navigating guide" pattern from the autorecovery design doc).
 */
export function firstStepMissingOnPage(guide: JsonGuide): Diagnostic[] {
  for (const { block, path } of walkBlocks(guide.blocks, ['blocks'])) {
    if (!isExecutableBlock(block)) {
      continue;
    }
    // Only the *first* executable block matters. A `navigate` action is
    // the canonical "self-navigating" step and doesn't need on-page:.
    if (isInteractiveBlock(block) && block.action === 'navigate') {
      return [];
    }
    if (hasOnPageRequirement(block.requirements)) {
      return [];
    }
    return [
      {
        severity: 'warning',
        code: CROSS_BLOCK_CHECK_CODES.FIRST_STEP_MISSING_ON_PAGE,
        message:
          "First step doesn't declare the page it expects. " +
          'Add an `on-page:/<path>` requirement, or make the first step a `navigate` action so the guide is self-navigating.',
        path: [...path, 'requirements'],
      },
    ];
  }
  return [];
}

// ---------------------------------------------------------------------------
// orphanSectionReference
// ---------------------------------------------------------------------------

/**
 * `section-completed:<X>` requires that a section block with id `X`
 * exists and was completed earlier. If the referenced section doesn't
 * exist anywhere in the guide, the requirement can never be satisfied
 * and the step will be permanently blocked.
 */
export function orphanSectionReference(guide: JsonGuide): Diagnostic[] {
  // Collect all section ids first.
  const sectionIds = new Set<string>();
  for (const { block } of walkBlocks(guide.blocks, ['blocks'])) {
    if (isSectionBlock(block) && typeof block.id === 'string' && block.id) {
      sectionIds.add(block.id);
    }
  }

  const issues: Diagnostic[] = [];
  for (const { block, path } of walkBlocks(guide.blocks, ['blocks'])) {
    const requirements = 'requirements' in block ? (block as { requirements?: string[] }).requirements : undefined;
    if (!requirements) {
      continue;
    }
    requirements.forEach((req, i) => {
      if (!req.startsWith(SECTION_COMPLETED_PREFIX)) {
        return;
      }
      const targetId = req.slice(SECTION_COMPLETED_PREFIX.length);
      if (!targetId) {
        // The condition validator already flags missing args as a warning;
        // skip here to avoid double reporting.
        return;
      }
      if (sectionIds.has(targetId)) {
        return;
      }
      issues.push({
        severity: 'warning',
        code: CROSS_BLOCK_CHECK_CODES.ORPHAN_SECTION_REFERENCE,
        message: `References section "${targetId}" but no section with that id exists in this guide`,
        path: [...path, 'requirements', i],
        tokenAtFault: req,
      });
    });
  }
  return issues;
}

// ---------------------------------------------------------------------------
// destructiveActionWithoutObjective
// ---------------------------------------------------------------------------

/**
 * Destructive actions (delete/remove/destroy) are inherently
 * non-idempotent. Without an objective declared, re-running the guide
 * will re-attempt the destructive action — there's no way for the
 * runtime to know the work has already been done.
 *
 * Surfaced as a warning, dismissible per-guide. False positives are
 * possible (e.g. a "Remove filter" button isn't really destructive),
 * so we keep the heuristic narrow: only `button` actions whose
 * reftarget contains the destructive keywords.
 */
export function destructiveActionWithoutObjective(guide: JsonGuide): Diagnostic[] {
  const issues: Diagnostic[] = [];
  for (const { block, path } of walkBlocks(guide.blocks, ['blocks'])) {
    if (!isExecutableBlock(block)) {
      continue;
    }
    let isDestructive = false;
    let actionLabel = '';

    if (isInteractiveBlock(block)) {
      if (block.action === 'button' && block.reftarget && DESTRUCTIVE_REFTARGET_PATTERN.test(block.reftarget)) {
        isDestructive = true;
        actionLabel = `button "${block.reftarget}"`;
      }
    } else {
      // multistep / guided — check if any step is destructive.
      const steps = (block as GuidedOrMultistep).steps;
      const destructiveStep = steps.find(
        (s) => s.action === 'button' && s.reftarget && DESTRUCTIVE_REFTARGET_PATTERN.test(s.reftarget)
      );
      if (destructiveStep) {
        isDestructive = true;
        actionLabel = `step "${destructiveStep.reftarget}"`;
      }
    }

    if (!isDestructive) {
      continue;
    }
    const objectives = (block as { objectives?: string[] }).objectives;
    if (objectives && objectives.length > 0) {
      continue;
    }
    issues.push({
      severity: 'warning',
      code: CROSS_BLOCK_CHECK_CODES.DESTRUCTIVE_ACTION_WITHOUT_OBJECTIVE,
      message: `Destructive ${actionLabel} has no objective. If the user re-runs this guide, the action will be attempted again — declare an objective so the step is skipped when its work is already done.`,
      path: [...path, 'objectives'],
    });
  }
  return issues;
}

// ---------------------------------------------------------------------------
// unusedSection
// ---------------------------------------------------------------------------

/**
 * A section with an `id` that no other block references via
 * `section-completed:<id>` is suspicious — either the author forgot to
 * gate a later block on it, or the id is stale.
 *
 * Severity: info, not warning. Sometimes sections are just for
 * organisation and don't gate anything.
 */
export function unusedSection(guide: JsonGuide): Diagnostic[] {
  // Collect all referenced section ids.
  const referenced = new Set<string>();
  for (const { block } of walkBlocks(guide.blocks, ['blocks'])) {
    const reqs = 'requirements' in block ? (block as { requirements?: string[] }).requirements : undefined;
    if (!reqs) {
      continue;
    }
    for (const r of reqs) {
      if (r.startsWith(SECTION_COMPLETED_PREFIX)) {
        const id = r.slice(SECTION_COMPLETED_PREFIX.length);
        if (id) {
          referenced.add(id);
        }
      }
    }
  }

  const issues: Diagnostic[] = [];
  for (const { block, path } of walkBlocks(guide.blocks, ['blocks'])) {
    if (!isSectionBlock(block)) {
      continue;
    }
    const section = block as JsonSectionBlock;
    if (typeof section.id !== 'string' || !section.id) {
      continue;
    }
    if (referenced.has(section.id)) {
      continue;
    }
    issues.push({
      severity: 'info',
      code: CROSS_BLOCK_CHECK_CODES.UNUSED_SECTION,
      message: `Section "${section.id}" is never referenced by any \`section-completed:\` requirement. Remove its id if it's purely organisational, or gate a later block on it.`,
      path,
    });
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Entry point — runs every cross-block check and returns the combined list.
// ---------------------------------------------------------------------------

export function runCrossBlockChecks(guide: JsonGuide): Diagnostic[] {
  return [
    ...firstStepMissingOnPage(guide),
    ...orphanSectionReference(guide),
    ...destructiveActionWithoutObjective(guide),
    ...unusedSection(guide),
  ];
}
