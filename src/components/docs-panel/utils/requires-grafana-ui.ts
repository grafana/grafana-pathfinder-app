/**
 * Launch-surface classifier: does this guide contain an action that drives the
 * live Grafana UI?
 *
 * A guide "requires the Grafana UI" when any reachable step performs one of the
 * five Grafana-driving actions — `highlight`, `button`, `formfill`, `navigate`,
 * `hover`. Those actions manipulate or point at the real Grafana page, so the
 * guide must render beside Grafana (sidebar / floating), not full screen.
 *
 * Deliberately NARROWER than `ParsedContent.hasInteractiveElements`: `noop`,
 * `popout`, quizzes, inputs, terminals, challenges, code blocks, and grot guides
 * are interactive inside Pathfinder but do not need the Grafana main area, so
 * they do not force the sidebar.
 *
 * Operates on the snippet-EXPANDED guide so actions hidden inside snippets are
 * counted. A surviving `snippet-ref` (should not happen after expansion) is
 * treated as Grafana-driving — fail safe, never hide an action. Snippet refs
 * that failed to resolve become markdown placeholders and are invisible here;
 * `prepareGuideLaunch` handles that case separately via the inliner's status.
 */

import type { JsonBlock, JsonGuide, JsonInteractiveAction, JsonStep } from '../../../types/json-guide.types';

/** The action values that require the live Grafana UI. */
const GRAFANA_DRIVING_ACTIONS: ReadonlySet<JsonInteractiveAction> = new Set<JsonInteractiveAction>([
  'highlight',
  'button',
  'formfill',
  'navigate',
  'hover',
]);

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

function blockRequiresGrafanaUi(block: JsonBlock): boolean {
  switch (block.type) {
    case 'interactive':
      return stepDrivesGrafana(block);
    case 'multistep':
    case 'guided':
      return block.steps.some(stepDrivesGrafana);
    case 'section':
    case 'assistant':
    case 'collapsible':
      return blocksRequireGrafanaUi(block.blocks);
    case 'conditional':
      return blocksRequireGrafanaUi(block.whenTrue) || blocksRequireGrafanaUi(block.whenFalse);
    case 'snippet-ref':
      return true;
    default:
      return false;
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
