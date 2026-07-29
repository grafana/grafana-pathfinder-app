/**
 * Triggers tab restoration from storage when the sidebar instance is
 * actually responsible for owning the tab surface — gated by `panelMode`
 * and by the "only non-content tabs" predicate so we don't overwrite
 * user-opened guide/docs tabs on a remount (editor chrome alone is OK).
 *
 * Why the dep array is `[panelMode]` only (preserved verbatim — Pattern J
 * boundary touching the `_hasRestoredTabs` instance guard, deferred to a
 * future refactor):
 *   - The effect should re-fire when the user returns to sidebar mode
 *     (auto-dock listener, explicit Exit, or the "Return to sidebar" CTA
 *     on FullScreenModeNotice). Adding `tabs` or `model` to deps would
 *     re-fire on every tab open/close — but the in-class `_hasRestoredTabs`
 *     guard makes those re-fires no-ops, so it'd be wasted work, not a
 *     bug.
 *   - The non-content check reads `tabs` via closure capture from
 *     the render that registered the effect. That's safe because the
 *     restoration trigger only matters at the boundary where `panelMode`
 *     flips away from `'fullscreen'`. The `tabs` snapshot at that moment
 *     is whatever the renderer last rendered.
 *
 * Full-screen mode skip (preserved verbatim):
 *   When the full-screen panel owns the session, the sidebar instance
 *   must NOT call restoreTabsAsync — otherwise both instances race on
 *   tabStorage and drift the saved tab content.
 *
 * Restore-once guard (preserved — Pattern I, deferred):
 *   `_hasRestoredTabs` lives on the model instance, not the hook. The
 *   hook intentionally calls `restoreTabsAsync()` on every qualifying
 *   re-fire because the model's guard handles idempotency. Moving the
 *   guard into a hook would change StrictMode and fullscreen-remount
 *   semantics — see the deferred-work note in the refactor plan.
 *
 * Contract surfaces preserved (Pattern J — pinned by
 * docs-panel.tab-restore-guard.test.ts and utils/tab-storage-restore.test.ts):
 *   - hasOnlyNonContentTabs predicate (does NOT touch tabStorage)
 *   - model.restoreTabsAsync() entry point (unchanged)
 *   - `_hasRestoredTabs` guard semantics (untouched on the class)
 */
import * as React from 'react';
import { hasOnlyNonContentTabs } from '../utils';
import type { LearningJourneyTab, CombinedPanelState } from '../../../types/content-panel.types';
import type { PanelMode } from '../../../global-state/panel-mode';

interface TabRestorationModel {
  state: CombinedPanelState;
  restoreTabsAsync(): Promise<void>;
}

export interface UseTabRestorationArgs {
  model: TabRestorationModel;
  panelMode: PanelMode;
  tabs: LearningJourneyTab[];
}

export function useTabRestoration({ model, panelMode, tabs }: UseTabRestorationArgs): void {
  // Restore tabs after storage is initialized (fixes race condition)
  React.useEffect(() => {
    // Restore when only chrome / editor are present. Content tabs mean live
    // user state we must not clobber; a lone Create Guide tab must not block
    // pulling guides written by fullscreen/floating into shared tabStorage.
    if (panelMode === 'fullscreen') {
      return;
    }

    if (hasOnlyNonContentTabs(tabs)) {
      model.restoreTabsAsync();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelMode]);
}
