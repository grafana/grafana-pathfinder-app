import type { CheckResultError } from '../../types/requirements.types';
import { getContentKey, sanitizeContentKey } from '../../global-state/content-key';
import { sectionDoneStorage } from '../../lib/user-storage';
import { logger } from '../../lib/logging';

export async function sectionCompletedCheck(check: string, contentKey?: string): Promise<CheckResultError> {
  try {
    const rawId = check.replace('section-completed:', '');
    const sectionId = rawId.startsWith('section-') ? rawId : `section-${rawId}`;

    const localContentKey = getContentKey();
    const scopedContentKey = contentKey === undefined ? localContentKey : sanitizeContentKey(contentKey);
    const persistedDone = await sectionDoneStorage.get(scopedContentKey, sectionId);
    if (persistedDone === true) {
      return {
        requirement: check,
        pass: true,
        context: { sectionId, source: 'storage' },
      };
    }

    // A remote guide cannot borrow completion from a section in the live tab.
    const sectionElement = scopedContentKey === localContentKey ? document.getElementById(sectionId) : null;
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
    logger.error('Section completion check error', { error });
    return {
      verdict: 'unavailable',
      requirement: check,
      pass: false,
      error: `Section completion check failed: ${error}`,
      context: { error },
    };
  }
}
