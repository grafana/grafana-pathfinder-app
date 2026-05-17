/**
 * Triggers tab restoration from storage when the sidebar instance is
 * actually responsible for owning the tab surface — gated by `panelMode`
 * and by the "only permanent system tabs exist" predicate so we don't
 * overwrite user-opened guide tabs on a remount.
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
 *   - The `hasOnlyDefaultTabs` check reads `tabs` via closure capture from
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
 *   - PERMANENT_TAB_IDS predicate (does NOT touch tabStorage)
 *   - model.restoreTabsAsync() entry point (unchanged)
 *   - `_hasRestoredTabs` guard semantics (untouched on the class)
 */
import * as React from 'react';
import { PERMANENT_TAB_IDS } from '../utils';
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
    // Only restore if no user-opened guide tabs exist — permanent system
    // tabs (`recommendations`, `devtools`, `editor`) don't count, otherwise
    // the gate fails on a remount where the permanent-tabs effect (below)
    // has already appended `devtools`/`editor` before this effect re-runs.
    // The previous `tabs.length === 1` check worked for the initial mount
    // (where restoration is declared first and runs against [recommendations]
    // only) but not for the "Return to sidebar" CTA on FullScreenModeNotice,
    // which fires after permanent tabs are present.
    const hasOnlyDefaultTabs = tabs.every((t) => PERMANENT_TAB_IDS.has(t.id));

    // Skip restoration when full screen owns the session — otherwise this
    // sidebar instance would auto-load tab content in parallel with the
    // FullScreenPanel instance (drift on tabStorage). The `panelMode`
    // dep makes this re-run when the user returns to sidebar mode
    // (auto-dock listener, explicit Exit, or the "Return to sidebar"
    // CTA on `FullScreenModeNotice`). The model's `_hasRestoredTabs`
    // guard makes a second invocation a no-op when restoration already
    // succeeded, so re-running here is safe in the happy path.
    if (panelMode === 'fullscreen') {
      return;
    }

    if (hasOnlyDefaultTabs) {
      model.restoreTabsAsync();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelMode]);
}
