/**
 * Maintains the permanent-tabs surface area as user role + dev-mode flags
 * change. Three jobs, merged into one effect so they all read from the same
 * up-to-date `tabs` array (preventing a stale-closure overwrite when both
 * gates flip simultaneously):
 *
 *   1. Add the `devtools` tab when dev mode is on and it's missing.
 *   2. Add the `editor` tab when the user has editor/admin role and it's
 *      missing.
 *   3. Remove the `editor` tab if a stale one is persisted but the current
 *      user is no longer an editor (role downgrade, account switch). If
 *      the user was on the editor tab when removed, redirect to
 *      `recommendations`.
 *
 * The new-tab payload shapes are preserved verbatim — they used to live
 * inline in CombinedPanelRendererInner and feed into model.setState() in a
 * single batched patch. Tab IDs (`devtools`, `editor`, `recommendations`)
 * are contract surfaces and must not be renamed (see Pattern J in the
 * refactor plan).
 *
 * Persistence: `saveTabsToStorage()` is called *only* when removing a stale
 * editor tab. Additions do not trigger a save here because (a) restoration
 * happens elsewhere (`useTabRestoration` will land in step 2.5), and
 * (b) appending these permanent tabs on every mount would write the same
 * value back to storage on every page load.
 */
import * as React from 'react';
import type { LearningJourneyTab, CombinedPanelState } from '../../../types/content-panel.types';

/**
 * Structural type for the hook's model parameter. The real model is
 * `CombinedLearningJourneyPanel`. Defined inline to avoid a
 * `hooks/ → docs-panel.tsx → hooks/` import cycle.
 */
interface PermanentTabsModel {
  state: CombinedPanelState;
  setState(patch: Partial<CombinedPanelState>): void;
  saveTabsToStorage(): Promise<void>;
}

export interface UsePermanentTabsArgs {
  model: PermanentTabsModel;
  isDevMode: boolean;
  isEditorUser: boolean;
  tabs: LearningJourneyTab[];
}

export function usePermanentTabs({ model, isDevMode, isEditorUser, tabs }: UsePermanentTabsArgs): void {
  React.useEffect(() => {
    const missing: LearningJourneyTab[] = [];

    if (isDevMode && !tabs.some((t) => t.id === 'devtools')) {
      missing.push({
        id: 'devtools',
        title: 'Dev Tools',
        baseUrl: '',
        currentUrl: '',
        content: null,
        isLoading: false,
        error: null,
        type: 'devtools',
      });
    }

    if (isEditorUser && !tabs.some((t) => t.id === 'editor')) {
      missing.push({
        id: 'editor',
        title: 'Guide editor',
        baseUrl: '',
        currentUrl: '',
        content: null,
        isLoading: false,
        error: null,
        type: 'editor',
      });
    }

    // Remove editor tab if the current user is not an editor/admin (e.g. role
    // downgrade or different user logged in with a persisted editor tab).
    const hasStaleEditorTab = !isEditorUser && tabs.some((t) => t.id === 'editor');

    if (missing.length > 0 || hasStaleEditorTab) {
      let updatedTabs = hasStaleEditorTab ? tabs.filter((t) => t.id !== 'editor') : tabs;
      updatedTabs = [...updatedTabs, ...missing];

      const patch: Partial<CombinedPanelState> = { tabs: updatedTabs };
      if (hasStaleEditorTab && model.state.activeTabId === 'editor') {
        patch.activeTabId = 'recommendations';
      }
      model.setState(patch);

      if (hasStaleEditorTab) {
        model.saveTabsToStorage();
      }
    }
  }, [isDevMode, isEditorUser, tabs, model]);
}
