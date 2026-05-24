/**
 * Section completion check — `section-completed:<sectionId>` requirement.
 *
 * Moved out of `lib/dom` because the check is domain-aware (knows about
 * content keys + the completion-store persistence namespace) and does
 * not belong in the DOM-utility layer. The previous home required a
 * dynamic `await import('../user-storage')` to dodge JSDOM/Prism test
 * flake when `lib/dom` was partially mocked; living in the engines
 * tier means we can import `user-storage` statically.
 *
 * Use cases:
 * - Sequential tutorials: ensure users complete steps in order.
 * - Prerequisites: verify setup steps before advanced features.
 * - Learning paths: enforce completion of foundational concepts.
 *
 * How it works:
 *  1. Read `sectionDoneStorage` first — works for sections that are NOT
 *     currently mounted (other milestones, virtualized regions,
 *     conditional branches that haven't rendered yet).
 *  2. Fall back to the DOM check (`#sectionId.completed`). Covers the
 *     transitional window between the section reaching `isCompleted`
 *     and the async storage write resolving, and any legacy guides
 *     that complete via paths that bypass the section component.
 */

import { getContentKey } from '../../global-state/content-key';
import { sectionDoneStorage } from '../../lib/user-storage';

export async function sectionCompletedCheck(check: string): Promise<{
  requirement: string;
  pass: boolean;
  error?: string;
  context?: Record<string, unknown> | null;
}> {
  try {
    const rawId = check.replace('section-completed:', '');
    const sectionId = rawId.startsWith('section-') ? rawId : `section-${rawId}`;

    const contentKey = getContentKey();
    const persistedDone = await sectionDoneStorage.get(contentKey, sectionId);
    if (persistedDone === true) {
      return {
        requirement: check,
        pass: true,
        context: { sectionId, source: 'storage' },
      };
    }

    const sectionElement = document.getElementById(sectionId);
    const isCompleted = sectionElement?.classList.contains('completed') || false;

    return {
      requirement: check,
      pass: isCompleted,
      error: isCompleted ? undefined : `Section '${sectionId}' must be completed first`,
      context: {
        sectionId,
        source: isCompleted ? 'dom' : 'none',
        found: !!sectionElement,
        hasCompletedClass: isCompleted,
      },
    };
  } catch (error) {
    console.error('Section completion check error:', error);
    return {
      requirement: check,
      pass: false,
      error: `Section completion check failed: ${error}`,
      context: { error },
    };
  }
}
