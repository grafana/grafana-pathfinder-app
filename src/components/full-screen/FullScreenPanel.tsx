import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SceneObjectBase, type SceneComponentProps, type SceneObjectState } from '@grafana/scenes';
import { getAppEvents, locationService } from '@grafana/runtime';
import { useStyles2 } from '@grafana/ui';

import { CombinedLearningJourneyPanel } from '../docs-panel/docs-panel';
import { useContentReset } from '../docs-panel/hooks';
import { openPendingGuide } from '../docs-panel/pendingGuideRouter';
import { LearningJourneyMilestoneToolbar } from '../docs-panel/components';
import { PERMANENT_TAB_IDS } from '../docs-panel/utils';
import { FloatingPanelContent } from '../floating-panel/FloatingPanelContent';
import { SkeletonLoader } from '../SkeletonLoader';
import { useGuideProgressState, useAutoLaunchTutorial, useStepProgressFromEvents } from '../../hooks';
import { panelModeManager } from '../../global-state/panel-mode';
import { sidebarState } from '../../global-state/sidebar';
import { getConfigWithDefaults, PLUGIN_BASE_URL, ROUTES } from '../../constants';
import { reportAppInteraction, UserInteraction } from '../../lib/analytics';
import { findDocPage } from '../../utils/find-doc-page';
import { parsePathfinderDeepLink, shouldOpenAsLearningJourney } from '../../utils/pathfinder-search-params';
import pluginJson from '../../plugin.json';
import { FullScreenLayout } from './FullScreenLayout';
import { getFullScreenStyles } from './full-screen.styles';
import { dockOnLeavingFullScreen } from './full-screen-autodock';

// Lazy-loaded so the editor only ships when the user actually opens it full screen.
const BlockEditor = lazy(() =>
  import('../block-editor').then((module) => ({
    default: module.BlockEditor,
  }))
);

const EDITOR_FULL_SCREEN_TITLE = 'Guide editor';

interface FullScreenPanelState extends SceneObjectState {}

/**
 * Scene-rooted full screen presentation of the active guide / editor.
 *
 * Sibling of the sidebar and floating panel: it owns its own
 * CombinedLearningJourneyPanel instance, restores tabs from storage on mount,
 * and consumes any handoff `pendingGuide` set by the surface that navigated
 * here. Sidebar is closed on mount so the two model instances cannot collide
 * on the __DocsPluginActiveTabId window global or on tab storage writes.
 */
export class FullScreenPanel extends SceneObjectBase<FullScreenPanelState> {
  public static Component = FullScreenPanelRenderer;
}

function FullScreenPanelRenderer(_props: SceneComponentProps<FullScreenPanel>) {
  const fullScreenStyles = useStyles2(getFullScreenStyles);

  const panel = useMemo(() => {
    const globalConfig = (window as any).__pathfinderPluginConfig;
    const config = getConfigWithDefaults(globalConfig || {});
    return new CombinedLearningJourneyPanel(config);
  }, []);

  // Mode + sidebar coordination: ensure mode reflects the current page and
  // the extension sidebar is closed. Idempotent — safe on refresh of
  // /fullscreen where mode may already be 'fullscreen' but a stale Grafana
  // dock could otherwise re-mount the sidebar in parallel.
  useEffect(() => {
    if (panelModeManager.getMode() !== 'fullscreen') {
      panelModeManager.setMode('fullscreen');
    } else {
      getAppEvents().publish({ type: 'close-extension-sidebar', payload: {} });
    }
  }, []);

  // Track whether a guide open is in-flight so the empty-state fallback
  // doesn't fire before the handoff or auto-launch has resolved.
  const guideOpenInFlightRef = useRef(false);

  // Handoff from sidebar/floating: open the pending guide if one was set.
  useEffect(() => {
    const handlePending = () => {
      guideOpenInFlightRef.current = true;
    };
    document.addEventListener('pathfinder-auto-launch-pending', handlePending, { once: true });

    document.dispatchEvent(new CustomEvent('pathfinder-panel-mounted', { detail: { timestamp: Date.now() } }));
    // Mirror the floating panel: tell `sidebarState` that a Pathfinder
    // surface is mounted. Without this, the link-interception auto-open
    // path and `HomePanel`'s open-guide flow gate on
    // `getIsSidebarMounted()` and silently fall through (or try to call
    // `openSidebar`, which now no-ops in fullscreen mode).
    sidebarState.setIsSidebarMounted(true);

    const pendingGuide = panelModeManager.consumePendingGuide();
    if (pendingGuide) {
      guideOpenInFlightRef.current = true;
      openPendingGuide(panel, pendingGuide, 'fullscreen_handoff');
    }

    return () => {
      document.removeEventListener('pathfinder-auto-launch-pending', handlePending);
      // Only clear the mounted flag if we're truly going away. When the user
      // transitions to sidebar or floating, those surfaces' mount effects
      // already set the flag to true (sometimes before our cleanup runs in
      // React StrictMode); clobbering it here would leave downstream gates
      // (link-interception, HomePanel open-guide) thinking no Pathfinder
      // surface is up. Mirrors `FloatingPanelManager`.
      const mode = panelModeManager.getMode();
      if (mode !== 'sidebar' && mode !== 'floating') {
        sidebarState.setIsSidebarMounted(false);
      }
    };
  }, [panel]);

  // Tab restoration from storage. Mirror of the floating panel pattern:
  // restore once on mount, gated on the model still showing only the
  // default recommendations tab.
  const { tabs, activeTabId } = panel.useState();
  const [restorationDone, setRestorationDone] = useState(false);

  useEffect(() => {
    // Read live model state instead of closure'd `tabs`. The pending-guide
    // useEffect above runs BEFORE this one and synchronously calls
    // `panel.openDocsPage`, which mutates `panel.state.tabs` immediately
    // but doesn't update the closure'd snapshot from `panel.useState()`
    // for this render. Using the live state stops us from restoring on
    // top of a tab the handoff just opened — that would await tabStorage
    // and overwrite the new tab if storage was empty or stale.
    // Permanent system tabs (`recommendations`, `devtools`, `editor`) don't
    // count as user content — restoring on top of them is safe. Mirrors the
    // sidebar's gate at `docs-panel.tsx` so all three surfaces agree on
    // when "the panel is empty".
    const liveTabs = panel.state.tabs;
    const hasOnlyDefaultTabs = liveTabs.every((t) => PERMANENT_TAB_IDS.has(t.id));
    if (hasOnlyDefaultTabs) {
      panel.restoreTabsAsync().then(() => setRestorationDone(true));
    } else {
      setRestorationDone(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ?doc=<url> URL fallback for direct navigation / refresh / shareable
  // links. Skipped if the handoff already opened a guide.
  //
  // The optional ?type= param overrides findDocPage's URL-based classification.
  // Some package URLs (e.g. interactive-learning.grafana.net/packages/<id>/content.json)
  // classify as 'interactive' even though they back a learning journey. The
  // sidebar / floating handoff always appends ?type= so reload + share preserves
  // the journey kind (and thus the milestone toolbar).
  useEffect(() => {
    if (!restorationDone || guideOpenInFlightRef.current) {
      return;
    }
    const { doc: docParam, type: typeParam } = parsePathfinderDeepLink(window.location.search);
    if (!docParam) {
      return;
    }
    const docsPage = findDocPage(docParam);
    if (!docsPage) {
      return;
    }
    // The shared rule: explicit ?type=learning-journey wins over findDocPage's
    // URL classification (which can mis-tag package URLs as 'interactive').
    const isJourney = shouldOpenAsLearningJourney(typeParam, undefined) || docsPage.type === 'learning-journey';
    guideOpenInFlightRef.current = true;
    if (isJourney) {
      panel.openLearningJourney(docsPage.url, docsPage.title, { source: 'url_param' });
    } else {
      panel.openDocsPage(docsPage.url, docsPage.title, { source: 'url_param' });
    }
  }, [restorationDone, panel]);

  // Listen for auto-launch-tutorial events (shared across all panel surfaces).
  // The hook owns the routing; we just flip the in-flight flag synchronously
  // so the empty-state fallback doesn't fire on top of an incoming guide.
  useAutoLaunchTutorial(panel, {
    onIncoming: () => {
      guideOpenInFlightRef.current = true;
    },
  });

  // Active tab projection.
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const isEditorTab = activeTab?.type === 'editor';
  const content = activeTab?.content ?? null;
  const title = isEditorTab ? EDITOR_FULL_SCREEN_TITLE : activeTab?.title || 'Interactive learning';
  const hasActiveGuide = activeTab != null && activeTab.id !== 'recommendations' && !isEditorTab;
  // Prefer `currentUrl` (the milestone the user is reading) so when the user
  // goes fullscreen → floating via `handleSwitchToFloating`, auto-docks via
  // navigation away, or copies a shareable link, the milestone position
  // carries through. `baseUrl` is the cover URL; for non-journey tabs the
  // two fields are equal.
  const guideUrl = isEditorTab ? undefined : activeTab?.currentUrl || activeTab?.baseUrl;

  // Auto-dock when something navigates the user off the fullscreen route.
  // Without this the user lands on (e.g.) /dashboards with mode still stuck
  // on 'fullscreen', no panel rendered, and no way to complete the step
  // that took them there. Decision logic (sidebar vs floating fallback) is
  // factored out into `dockOnLeavingFullScreen` for unit testability.
  //
  // Latest tab/title/url are read through a ref so the listener subscribes
  // exactly once on mount. Without the ref the effect re-subscribes on
  // every milestone navigation (`activeTab` is a fresh `find()` reference
  // per render), which churns the history subscription and risks dropping
  // the very location event that triggered the navigation.
  const dockInputsRef = useRef({ guideUrl, title, activeTab });
  dockInputsRef.current = { guideUrl, title, activeTab };
  useEffect(() => {
    const fullScreenPathname = `${PLUGIN_BASE_URL}/${ROUTES.FullScreen}`;
    const history = locationService.getHistory();
    const unlisten = history.listen((location: { pathname: string }) => {
      const { guideUrl: latestGuideUrl, title: latestTitle, activeTab: latestActiveTab } = dockInputsRef.current;
      dockOnLeavingFullScreen({
        pathname: location.pathname,
        fullScreenPathname,
        myPluginId: pluginJson.id,
        guideUrl: latestGuideUrl,
        title: latestTitle,
        activeTab: latestActiveTab,
      });
    });
    return unlisten;
  }, []);

  // Step progress for the header counter. Shared subscription with the
  // floating panel — see `useStepProgressFromEvents` for the rationale.
  const stepProgress = useStepProgressFromEvents(hasActiveGuide);

  const { hasInteractiveProgress, progressKey } = useGuideProgressState(activeTab);

  const handleResetGuide = useContentReset({ model: panel });

  const handleExitToSidebar = useCallback(() => {
    reportAppInteraction(UserInteraction.FullScreenExit, {
      destination: 'sidebar',
      guide_url: guideUrl || '',
      guide_title: title,
    });
    panelModeManager.setMode('sidebar');
    sidebarState.setPendingOpenSource('fullscreen_handoff', 'open');
    sidebarState.openSidebar('Interactive learning');
    // Land the user back on the page they were on before they entered full
    // screen. Falls back to the plugin home for cold-loaded `/fullscreen`
    // URLs (no captured prior path).
    const priorPath = panelModeManager.consumePriorPath();
    locationService.push(priorPath ?? PLUGIN_BASE_URL);
  }, [guideUrl, title]);

  /**
   * Hand off to the floating panel — works for both guides and the editor.
   *
   * Editor branch sets a pending editor handoff so the floating panel
   * picks the editor as its active tab on mount, instead of relying on
   * whatever tabStorage happens to hold (mirrors the inbound direction
   * `FloatingPanelManager.handleSwitchToFullScreen`).
   */
  const handleSwitchToFloating = useCallback(() => {
    if (isEditorTab) {
      reportAppInteraction(UserInteraction.FullScreenExit, {
        destination: 'floating',
        guide_url: '',
        guide_title: title,
      });
      panelModeManager.setPendingGuide({ title, type: 'editor' });
      panelModeManager.setMode('floating');
      locationService.push(PLUGIN_BASE_URL);
      return;
    }
    if (!guideUrl) {
      return;
    }
    reportAppInteraction(UserInteraction.FullScreenExit, {
      destination: 'floating',
      guide_url: guideUrl,
      guide_title: title,
    });
    // Preserve the journey tab type through the handoff so the floating
    // panel reopens it as a learning journey (with milestone navigation)
    // rather than a flat docs tab.
    const tabType = activeTab?.type === 'learning-journey' ? 'learning-journey' : 'docs';
    panelModeManager.setPendingGuide({
      url: guideUrl,
      title,
      type: tabType,
      // Preserve synthetic packageInfo (PR-tester journeys) across the
      // fullscreen → floating handoff for the same reason as the inbound
      // direction: raw GitHub URLs aren't recognised package URLs.
      packageInfo: activeTab?.packageInfo,
    });
    panelModeManager.setMode('floating');
    locationService.push(PLUGIN_BASE_URL);
  }, [isEditorTab, guideUrl, title, activeTab?.type, activeTab?.packageInfo]);

  // Stable ref to the latest exit-to-sidebar callback. Without it, the
  // empty-state fallback effect below would re-subscribe whenever
  // `handleExitToSidebar` is recreated (i.e. whenever `guideUrl` or `title`
  // changes — which is on every milestone navigation / content reload). If
  // any of those updates lands in the same render where `hasActiveGuide`
  // is transiently false (e.g. activeTabId pointing at a tab still being
  // swapped in), the effect would spuriously fire and kick the user out
  // of full screen.
  const handleExitToSidebarRef = useRef(handleExitToSidebar);
  handleExitToSidebarRef.current = handleExitToSidebar;

  // Empty-state fallback: if restoration completes with nothing to show
  // and no guide is being loaded, route the user back to the sidebar so
  // they don't land on a dead full screen page. Deps are intentionally
  // limited to the actual trigger booleans — the callback is read from
  // the ref above so identity changes don't re-fire this effect.
  useEffect(() => {
    if (restorationDone && !hasActiveGuide && !isEditorTab && !guideOpenInFlightRef.current) {
      handleExitToSidebarRef.current();
    }
  }, [restorationDone, hasActiveGuide, isEditorTab]);

  // Symmetric counterparts to the sidebar/floating event handlers — these
  // let surface-aware components (notably the BlockEditor toolbar) ask
  // fullscreen to hand off without knowing about FullScreenPanel internals.
  useEffect(() => {
    const handleDockRequest = () => {
      handleExitToSidebar();
    };
    document.addEventListener('pathfinder-request-dock', handleDockRequest);
    return () => {
      document.removeEventListener('pathfinder-request-dock', handleDockRequest);
    };
  }, [handleExitToSidebar]);

  useEffect(() => {
    // `handleSwitchToFloating` already covers both editor and guide cases
    // (with proper pending-guide handoff for both), so the event handler
    // just delegates. Without this single source of truth the event path
    // and the FullScreenLayout button could drift — the editor branch
    // previously skipped `setPendingGuide` and the layout button was
    // hidden for editor users (gated on `hasActiveGuide`, which excludes
    // the editor tab).
    document.addEventListener('pathfinder-request-pop-out', handleSwitchToFloating);
    return () => {
      document.removeEventListener('pathfinder-request-pop-out', handleSwitchToFloating);
    };
  }, [handleSwitchToFloating]);

  // In-fullscreen swap: when something dispatches `pathfinder-request-full-screen`
  // while we're already on the fullscreen route (e.g. the BlockEditor toolbar
  // in a sidebar that's still mounted alongside fullscreen, see Issue 3), the
  // host-side handler's `setMode('fullscreen')` is a no-op and the route push
  // doesn't remount us. Consume any pending guide here too so the swap still
  // happens — typically used to replace a journey with the editor or vice versa.
  useEffect(() => {
    const handleFullScreenRequest = () => {
      const pendingGuide = panelModeManager.consumePendingGuide();
      if (!pendingGuide) {
        return;
      }
      guideOpenInFlightRef.current = true;
      openPendingGuide(panel, pendingGuide, 'fullscreen_handoff');
    };
    document.addEventListener('pathfinder-request-full-screen', handleFullScreenRequest);
    return () => {
      document.removeEventListener('pathfinder-request-full-screen', handleFullScreenRequest);
    };
  }, [panel]);

  // Learning-journey milestone toolbar — shared with the sidebar via the
  // `LearningJourneyMilestoneToolbar` component. Renders as a sub-header
  // beneath the layout's main header. Returns null for non-journey tabs
  // (editor and bundled docs render without it, mirroring sidebar behavior).
  const journeyToolbar = activeTab ? (
    <LearningJourneyMilestoneToolbar
      panel={panel}
      activeTab={activeTab}
      surface="fullscreen"
      actionButtonClassName={fullScreenStyles.secondaryActionButton}
      hasInteractiveProgress={hasInteractiveProgress}
      progressKey={progressKey}
      onResetGuide={handleResetGuide}
    />
  ) : null;

  const guideType: 'learning-journey' | 'docs' | undefined = hasActiveGuide
    ? activeTab?.type === 'learning-journey'
      ? 'learning-journey'
      : 'docs'
    : undefined;

  return (
    <FullScreenLayout
      title={title}
      stepProgress={stepProgress}
      guideUrl={guideUrl}
      guideType={guideType}
      hasActiveGuide={hasActiveGuide}
      onExit={handleExitToSidebar}
      // Show the pop-out button for both guides AND the editor — the editor
      // is poppable to floating via the same event/handler, and hiding the
      // button would create an inconsistency with the BlockEditor toolbar's
      // own "Pop out" button which dispatches the equivalent event.
      onGoFloating={hasActiveGuide || isEditorTab ? handleSwitchToFloating : undefined}
      subHeader={journeyToolbar}
    >
      {isEditorTab ? (
        <Suspense fallback={<SkeletonLoader type="documentation" />}>
          <BlockEditor />
        </Suspense>
      ) : (
        <FloatingPanelContent
          content={content}
          pendingAlignment={activeTab?.pendingAlignment}
          onAlignmentConfirm={activeTab ? () => void panel.confirmAlignment(activeTab.id) : undefined}
          onAlignmentCancel={activeTab ? () => panel.dismissAlignment(activeTab.id) : undefined}
          activeTab={activeTab ?? null}
          model={panel}
        />
      )}
    </FullScreenLayout>
  );
}
