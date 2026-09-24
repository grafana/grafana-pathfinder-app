import { useEffect, useRef, useState } from 'react';
import type { LearningJourneyTab } from '../../../types/content-panel.types';
import type { JsonGuide } from '../../../types/json-guide.types';
import { currentUserIsAdmin } from '../../../utils/current-user-role';
import { hasEditorDraft, replaceEditorDraft } from '../../block-editor/editor-draft';
import { notify } from '../../block-editor/notify';
import { canCopyPublicGuide } from '../utils/private-guide-eligibility';

export function usePrivateGuideCopy(tab: LearningJourneyTab | null | undefined, openEditor?: () => void) {
  const [operation, setOperation] = useState<{
    tab: LearningJourneyTab;
    isPreparing: boolean;
    pending: JsonGuide | null;
  } | null>(null);
  const lifecycle = useRef({ active: true, busy: false });

  useEffect(() => {
    const current = { active: true, busy: false };
    lifecycle.current = current;
    return () => {
      current.active = false;
    };
  }, [tab]);

  const pending = operation?.tab === tab ? operation?.pending : null;
  const reportError = (error: unknown) => {
    notify('error', 'Could not copy guide', error instanceof Error ? error.message : 'Please try again.');
  };

  const openCopy = (guide: JsonGuide) => {
    if (!canCopyPublicGuide(tab, currentUserIsAdmin()) || !openEditor) {
      setOperation(null);
      return;
    }
    replaceEditorDraft(guide);
    setOperation(null);
    openEditor();
  };

  const prepare = async () => {
    if (lifecycle.current.busy || !canCopyPublicGuide(tab, currentUserIsAdmin()) || !tab || !openEditor) {
      return;
    }
    const current = lifecycle.current;
    current.busy = true;
    setOperation({ tab, isPreparing: true, pending: null });
    try {
      const { preparePrivateGuideCopy } = await import('../utils/private-guide-copy');
      const guide = await preparePrivateGuideCopy(tab);
      if (!current.active || !currentUserIsAdmin()) {
        return;
      }
      if (hasEditorDraft()) {
        setOperation({ tab, isPreparing: false, pending: guide });
      } else {
        openCopy(guide);
      }
    } catch (error) {
      if (current.active) {
        reportError(error);
      }
    } finally {
      if (current.active) {
        current.busy = false;
        setOperation((value) => (value ? { ...value, isPreparing: false } : null));
      }
    }
  };

  return {
    available: Boolean(openEditor) && canCopyPublicGuide(tab, currentUserIsAdmin()),
    isPreparing: operation?.tab === tab && operation?.isPreparing === true,
    needsConfirmation: Boolean(pending),
    prepare,
    cancel: () => setOperation(null),
    confirm: () => {
      if (pending) {
        try {
          openCopy(pending);
        } catch (error) {
          reportError(error);
        }
      }
    },
  };
}
