/**
 * Launch-surface classifier: does this guide contain an action that drives the
 * live Grafana UI?
 *
 * A guide "requires the Grafana UI" when any reachable step performs one of the
 * five Grafana-driving actions — `highlight`, `button`, `formfill`, `navigate`,
 * `hover` — or is a `code-block`, whose required `reftarget` points at a live
 * Monaco editor that "Show me" highlights and "Insert" mutates. Those blocks
 * manipulate or point at the real Grafana page, so the guide must render
 * beside Grafana (sidebar / floating), not full screen.
 *
 * Deliberately NARROWER than `ParsedContent.hasInteractiveElements`: `noop`,
 * `popout`, quizzes, inputs, terminals, challenges, and grot guides are
 * interactive inside Pathfinder but do not need the Grafana main area, so
 * they do not force the sidebar.
 *
 * Operates on the snippet-EXPANDED guide so actions hidden inside snippets are
 * counted. A surviving `snippet-ref` (should not happen after expansion) is
 * treated as Grafana-driving — fail safe, never hide an action. Snippet refs
 * that failed to resolve become markdown placeholders and are invisible here;
 * `prepareGuideLaunch` handles that case separately via the inliner's status.
 */

import { isInteractiveBlockType, type InteractiveBlockType } from '../../../constants/json-guide-classification';
import { GRAFANA_DRIVING_ACTIONS } from '../../../constants/interactive-actions';
import type { JsonBlock, JsonGuide, JsonInteractiveAction, JsonStep } from '../../../types/json-guide.types';

type InteractiveBlock = Extract<JsonBlock, { type: InteractiveBlockType }>;

function isInteractiveBlock(block: JsonBlock): block is InteractiveBlock {
  return isInteractiveBlockType(block.type);
}

function isGrafanaDrivingAction(action: JsonInteractiveAction | undefined): boolean {
  return action !== undefined && GRAFANA_DRIVING_ACTIONS.has(action);
}

/** A single interactive block or step carries the action in `action` (canonical) or `targetAction` (alias). */
function stepDrivesGrafana(step: Pick<JsonStep, 'action' | 'targetAction'>): boolean {
  return isGrafanaDrivingAction(step.action) || isGrafanaDrivingAction(step.targetAction);
}

function blocksRequireGrafanaUi(blocks: JsonBlock[]): boolean {
  return blocks.some(blockRequiresGrafanaUi);
}
function interactiveBlockRequiresGrafanaUi(block: InteractiveBlock): boolean {
  switch (block.type) {
    case 'interactive':
      return stepDrivesGrafana(block);
    case 'multistep':
    case 'guided':
      return block.steps.some(stepDrivesGrafana);
    case 'code-block':
      // `reftarget` is schema-required and targets a live Grafana Monaco
      // editor; without the Grafana UI both "Show me" and "Insert" are dead.
      return true;
    // Interactive inside Pathfinder, but self-contained; none drive the live Grafana page.
    case 'quiz':
    case 'input':
    case 'terminal':
    case 'terminal-connect':
    case 'challenge':
    case 'grot-guide':
      return false;
  }
}

function blockRequiresGrafanaUi(block: JsonBlock): boolean {
  if (isInteractiveBlock(block)) {
    return interactiveBlockRequiresGrafanaUi(block);
  }
  switch (block.type) {
    case 'section':
    case 'assistant':
    case 'collapsible':
      return blocksRequireGrafanaUi(block.blocks);
    case 'conditional':
      return blocksRequireGrafanaUi(block.whenTrue) || blocksRequireGrafanaUi(block.whenFalse);
    case 'snippet-ref':
      return true;
    case 'markdown':
    case 'html':
    case 'image':
    case 'video':
    case 'callout':
      return false;
    default: {
      // Exhaustiveness: adding a JsonBlock member without classifying it here
      // is a compile error. At runtime (untyped CDN JSON can still carry an
      // unknown block type) fail safe in the never-hide-an-action direction:
      // an unknown container may nest Grafana-driving steps, so keep the
      // guide beside Grafana rather than full screen with dead buttons.
      const unhandled: never = block;
      void unhandled;
      return true;
    }
  }
}

/**
 * True when the guide contains any reachable Grafana-driving action, recursing
 * through sections, assistants, collapsibles, multistep/guided steps, and BOTH
 * conditional branches.
 */
export function requiresGrafanaUi(guide: JsonGuide): boolean {
  return blocksRequireGrafanaUi(guide.blocks);
}
