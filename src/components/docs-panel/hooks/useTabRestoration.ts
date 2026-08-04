/**
 * Keeps the sidebar model aligned with the shared tab workspace.
 *
 * Initial mount restores only an empty strip. Returning from floating or
 * fullscreen force-refreshes even a populated strip because those surfaces
 * own separate models and may have changed editor titles or tab state.
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
 *   - The strip-empty check reads `tabs` via closure capture from
 *     the render that registered the effect. That's safe because the
 *     restoration trigger only matters at the boundary where `panelMode`
 *     flips away from `'fullscreen'`. The `tabs` snapshot at that moment
 *     is whatever the renderer last rendered.
 *
 * Non-sidebar modes are skipped while they own the workspace; their outbound
 * transitions flush storage before changing modes.
 *
 * Restore-once guard (preserved — Pattern I, deferred):
 *   `_hasRestoredTabs` lives on the model instance, not the hook. The
 *   hook intentionally calls `restoreTabsAsync()` on every qualifying
 *   re-fire because the model's guard handles idempotency. Moving the
 *   guard into a hook would change StrictMode and fullscreen-remount
 *   semantics — see the deferred-work note in the refactor plan.
 *
 * The model's restore-once guard still protects initial StrictMode replay;
 * `{ force: true }` is reserved for a surface ownership transition.
 */
import * as React from 'react';
import { getGuideStripTabs } from '../utils';
import type { LearningJourneyTab, CombinedPanelState } from '../../../types/content-panel.types';
import type { PanelMode } from '../../../global-state/panel-mode';

interface TabRestorationModel {
  state: CombinedPanelState;
  restoreTabsAsync(options?: { force?: boolean }): Promise<void>;
  recoverLegacyEditorTab(): void;
}

export interface UseTabRestorationArgs {
  model: TabRestorationModel;
  panelMode: PanelMode;
  tabs: LearningJourneyTab[];
}

export function useTabRestoration({ model, panelMode, tabs }: UseTabRestorationArgs): void {
  const previousModeRef = React.useRef(panelMode);

  // Restore tabs after storage is initialized (fixes race condition)
  React.useEffect(() => {
    const previousMode = previousModeRef.current;
    previousModeRef.current = panelMode;

    // Empty strip → hydrate from tabStorage. Any strip tab is live state.
    if (panelMode !== 'sidebar') {
      return;
    }

    // Floating/fullscreen own separate models. Reconcile their saved strip
    // when this long-lived sidebar model becomes the owner again.
    if (previousMode !== 'sidebar') {
      void model.restoreTabsAsync({ force: true }).then(() => model.recoverLegacyEditorTab());
      return;
    }

    if (getGuideStripTabs(tabs).length === 0) {
      void model.restoreTabsAsync().then(() => model.recoverLegacyEditorTab());
    } else {
      model.recoverLegacyEditorTab();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelMode]);
}
