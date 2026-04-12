/**
 * Guide Safety Classification
 *
 * Determines whether a JSON guide is safe to render in the main-area learning
 * view. Guides with interactive steps that target external Grafana DOM elements
 * (highlight, button, formfill, hover) are unsafe — those selectors point to
 * UI elements that are not visible when the guide occupies the main area.
 *
 * Safe actions: 'noop' (no DOM interaction) and 'navigate' (page navigation;
 * openGuide loads into sidebar, which is acceptable).
 */

import type { JsonInteractiveAction } from '../types/json-guide.types';

const UNSAFE_ACTIONS: ReadonlySet<JsonInteractiveAction> = new Set(['highlight', 'button', 'formfill', 'hover']);

interface SafetyResult {
  safe: boolean;
  unsafeActionTypes: string[];
}

/**
 * Check whether a guide's content string is safe for main-area rendering.
 *
 * Parses the raw JSON string and walks the blocks tree looking for interactive
 * actions that target external DOM. Returns early as soon as all unsafe action
 * types have been found, but collects unique types for analytics.
 *
 * Non-JSON or unparseable content is treated as safe (no interactive elements).
 */
export function isMainAreaSafe(contentString: string): SafetyResult {
  try {
    const guide = JSON.parse(contentString);
    if (!Array.isArray(guide.blocks)) {
      return { safe: true, unsafeActionTypes: [] };
    }

    const unsafeActions = new Set<string>();
    collectUnsafeActions(guide.blocks, unsafeActions);

    return {
      safe: unsafeActions.size === 0,
      unsafeActionTypes: [...unsafeActions],
    };
  } catch {
    // Non-JSON content (HTML, markdown, future media formats) has no interactive
    // blocks by definition — always safe for main-area rendering.
    return { safe: true, unsafeActionTypes: [] };
  }
}

function checkAction(action: string, unsafeActions: Set<string>): void {
  if (UNSAFE_ACTIONS.has(action as JsonInteractiveAction)) {
    unsafeActions.add(action);
  }
}

function collectUnsafeActions(blocks: any[], unsafeActions: Set<string>): void {
  for (const block of blocks) {
    switch (block.type) {
      case 'interactive':
        checkAction(block.action, unsafeActions);
        break;

      case 'multistep':
      case 'guided':
        if (Array.isArray(block.steps)) {
          for (const step of block.steps) {
            checkAction(step.action, unsafeActions);
          }
        }
        break;

      case 'section':
        if (Array.isArray(block.blocks)) {
          collectUnsafeActions(block.blocks, unsafeActions);
        }
        break;

      case 'conditional':
        if (Array.isArray(block.passBlocks)) {
          collectUnsafeActions(block.passBlocks, unsafeActions);
        }
        if (Array.isArray(block.failBlocks)) {
          collectUnsafeActions(block.failBlocks, unsafeActions);
        }
        break;
    }
  }
}
