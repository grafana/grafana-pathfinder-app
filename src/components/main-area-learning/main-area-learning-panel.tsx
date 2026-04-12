/**
 * Main-Area Learning Panel
 *
 * SceneObjectBase wrapper + React composition root for the /learning route.
 * Renders interactive guides in Grafana's main app area (full-page, not sidebar).
 *
 * Content loading flow:
 * 1. Read ?doc= param from URL
 * 2. Validate format (package URLs only — no raw /docs/ paths)
 * 3. Resolve via findDocPage()
 * 4. Fetch via fetchContent()
 * 5. Render via ContentRenderer
 *
 * Falls back to MyLearningTab as a landing page when no ?doc= param is present.
 */

import React, { useReducer, useState, useEffect, useCallback, useRef } from 'react';
import { SceneObjectBase, type SceneObjectState } from '@grafana/scenes';
import { Alert, Button, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';

import { locationService } from '@grafana/runtime';

import { findDocPage } from '../../utils/find-doc-page';
import { isMainAreaSafe } from '../../utils/guide-safety';
import {
  isNavVisible,
  collapseNav,
  expandNav,
  closeExtensionSidebar,
  restoreSidebar,
} from '../../utils/chrome-control';
import { fetchUnifiedContent as fetchContent, ContentRenderer } from '../../docs-retrieval';
import { SkeletonLoader } from '../SkeletonLoader';
import { MyLearningTab } from '../LearningPaths';
import { MyLearningErrorBoundary } from '../docs-panel/components';
import { reportAppInteraction, UserInteraction } from '../../lib/analytics';
import { sidebarState } from '../../global-state/sidebar';
import { linkInterceptionState } from '../../global-state/link-interception';
import { mainAreaLearningState } from '../../global-state/main-area-learning-state';
import { testIds } from '../../constants/testIds';
import { GuideProgressHeader } from './guide-progress-header';
import type { RawContent } from '../../types/content.types';

// ============================================================================
// HELPERS
// ============================================================================

type LayoutWidth = 'default' | 'wide' | 'full';

/** Read the layout hint from a JSON guide's top-level properties. */
function getLayoutWidth(content: RawContent): LayoutWidth {
  try {
    const parsed = JSON.parse(content.content);
    if (parsed?.layout === 'wide') {
      return 'wide';
    }
    if (parsed?.layout === 'full') {
      return 'full';
    }
  } catch {
    // Non-JSON or malformed — default prose width
  }
  return 'default';
}

/**
 * Returns true if the URL scheme is unsupported in the main-area learning view.
 * Raw /docs/ paths and Grafana.com doc URLs require the sidebar for proper rendering.
 */
function isUnsupportedFormat(param: string): boolean {
  return (
    param.startsWith('/docs/') ||
    param.startsWith('/tutorials/') ||
    param.startsWith('https://grafana.com/') ||
    param.startsWith('https://docs.grafana.com/')
  );
}

/** Strip ephemeral chrome-control params from URL; preserve ?doc= for bookmarking. */
function cleanUrlParams(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete('source');
  url.searchParams.delete('nav');
  url.searchParams.delete('sidebar');
  url.searchParams.delete('fullscreen');
  window.history.replaceState({}, '', url.toString());
}

/**
 * Parse chrome control params from the URL at render time.
 * fullscreen=true is shorthand for nav=false&sidebar=false.
 */
function resolveChromeParams(): { hideNav: boolean; hideSidebar: boolean } {
  const params = new URLSearchParams(window.location.search);
  const fullscreen = params.get('fullscreen') === 'true';
  const hideNav = fullscreen || params.get('nav') === 'false';
  const hideSidebar = fullscreen || params.get('sidebar') === 'false';
  return { hideNav, hideSidebar };
}

// ============================================================================
// SCENE OBJECT
// ============================================================================

interface MainAreaLearningPanelState extends SceneObjectState {}

export class MainAreaLearningPanel extends SceneObjectBase<MainAreaLearningPanelState> {
  public static Component = MainAreaLearningPanelRenderer;
}

// ============================================================================
// CONTENT STATE MACHINE
// ============================================================================

type PanelStatus = 'landing' | 'loading' | 'content' | 'error' | 'unsupported' | 'unsafe';

interface PanelState {
  status: PanelStatus;
  content: RawContent | null;
  error: string | null;
  docUrl: string | null;
  originalParam: string | null;
}

type PanelAction =
  | { type: 'navigate_to_guide'; docUrl: string; originalParam: string }
  | { type: 'content_loaded'; content: RawContent }
  | { type: 'load_failed'; error: string }
  | { type: 'unsafe_detected' }
  | { type: 'start_loading' };

function panelReducer(state: PanelState, action: PanelAction): PanelState {
  switch (action.type) {
    case 'navigate_to_guide':
      return {
        status: 'loading',
        content: null,
        error: null,
        docUrl: action.docUrl,
        originalParam: action.originalParam,
      };
    case 'start_loading':
      return { ...state, status: 'loading', error: null };
    case 'content_loaded':
      return { ...state, status: 'content', content: action.content };
    case 'load_failed':
      return { ...state, status: 'error', error: action.error };
    case 'unsafe_detected':
      return { ...state, status: 'unsafe' };
    default:
      return state;
  }
}

/** Compute initial reducer state from URL params (synchronous, no side effects). */
function computeInitialState(): PanelState {
  const urlParams = new URLSearchParams(window.location.search);
  const docParam = urlParams.get('doc');

  if (!docParam) {
    return { status: 'landing', content: null, error: null, docUrl: null, originalParam: null };
  }

  // Format validation — MUST run before findDocPage() because findDocPage
  // resolves /docs/ paths (Case 4) which we explicitly don't support here
  if (isUnsupportedFormat(docParam)) {
    return { status: 'unsupported', content: null, error: null, docUrl: null, originalParam: docParam };
  }

  const docPage = findDocPage(docParam);
  if (!docPage) {
    return { status: 'landing', content: null, error: null, docUrl: null, originalParam: null };
  }

  return { status: 'loading', content: null, error: null, docUrl: docPage.url, originalParam: docParam };
}

// ============================================================================
// RENDERER
// ============================================================================

export function MainAreaLearningPanelRenderer() {
  const styles = useStyles2(getStyles);

  const [state, dispatch] = useReducer(panelReducer, undefined, computeInitialState);

  // Shadow state in a ref so callbacks can read current values without stale closures
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  // Abort controller for content fetches — replaced on each navigation to cancel stale requests
  const fetchControllerRef = useRef<AbortController | null>(null);

  // Chrome control params (captured before cleanUrlParams strips them)
  const [chromeParams] = useState(resolveChromeParams);
  const navCollapsedByUs = useRef(false);
  const sidebarClosedByUs = useRef(false);

  const loadContent = useCallback(async (url: string) => {
    // Cancel any in-flight fetch before starting a new one
    fetchControllerRef.current?.abort();
    const controller = new AbortController();
    fetchControllerRef.current = controller;

    dispatch({ type: 'start_loading' });

    const startTime = performance.now();
    const result = await fetchContent(url);

    if (controller.signal.aborted) {
      return;
    }

    const loadTimeMs = Math.round(performance.now() - startTime);

    if (result.content) {
      const safetyResult = isMainAreaSafe(result.content.content);
      if (!safetyResult.safe) {
        dispatch({ type: 'unsafe_detected' });
        reportAppInteraction(UserInteraction.MainAreaSafetyGateBlocked, {
          guide_url: url,
          unsafe_action_types: safetyResult.unsafeActionTypes.join(','),
        });
        return;
      }

      dispatch({ type: 'content_loaded', content: result.content });
      reportAppInteraction(UserInteraction.MainAreaGuideLoaded, {
        guide_url: url,
        guide_title: result.content.metadata?.title || '',
        is_safe: true,
        load_time_ms: loadTimeMs,
      });
    } else {
      const errorMessage = result.error || 'Failed to load content';
      dispatch({ type: 'load_failed', error: errorMessage });
      reportAppInteraction(UserInteraction.MainAreaGuideLoadFailed, {
        guide_url: url,
        error_message: errorMessage,
      });
    }
  }, []);

  // Mount-time: fire analytics, clean URL, set active state, and kick off async fetch
  useEffect(() => {
    const { docUrl, originalParam } = stateRef.current;

    mainAreaLearningState.setIsActive(true);

    reportAppInteraction(UserInteraction.MainAreaPageView, {
      has_doc_param: !!originalParam,
    });

    cleanUrlParams();

    if (docUrl) {
      loadContent(docUrl);
    }

    return () => {
      mainAreaLearningState.setIsActive(false);
      fetchControllerRef.current?.abort();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Chrome control: hide nav/sidebar on mount, restore on unmount
  useEffect(() => {
    const { hideNav, hideSidebar } = chromeParams;

    if (hideNav && isNavVisible()) {
      collapseNav();
      navCollapsedByUs.current = true;
    }

    if (hideSidebar && sidebarState.getIsSidebarMounted()) {
      closeExtensionSidebar();
      sidebarClosedByUs.current = true;
    }

    // Race condition: sidebar may mount after our page loads (experiment auto-open).
    // Listen and suppress if sidebar=false is active.
    let sidebarMountListener: (() => void) | null = null;
    if (hideSidebar) {
      sidebarMountListener = () => {
        closeExtensionSidebar();
        sidebarClosedByUs.current = true;
      };
      window.addEventListener('pathfinder-sidebar-mounted', sidebarMountListener);
    }

    return () => {
      if (sidebarMountListener) {
        window.removeEventListener('pathfinder-sidebar-mounted', sidebarMountListener);
      }

      // Restore only if we made the change AND the state still matches what we set.
      // If the user manually re-expanded the nav, we don't fight it.
      if (navCollapsedByUs.current && !isNavVisible()) {
        expandNav();
      }
      navCollapsedByUs.current = false;

      if (sidebarClosedByUs.current && !sidebarState.getIsSidebarMounted()) {
        restoreSidebar();
      }
      sidebarClosedByUs.current = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRetry = useCallback(() => {
    const { docUrl } = stateRef.current;
    if (docUrl) {
      loadContent(docUrl);
    }
  }, [loadContent]);

  const handleOpenInSidebar = useCallback((opts?: { navigateAway?: boolean }) => {
    const { originalParam } = stateRef.current;
    if (!originalParam) {
      return;
    }

    // For safety gate + bundled URLs, use the direct openWithGuide API
    if (opts?.navigateAway && originalParam.startsWith('bundled:')) {
      sidebarState.openWithGuide(originalParam.slice('bundled:'.length));
    } else {
      const detail = { url: originalParam, title: 'Learning content' };
      if (sidebarState.getIsSidebarMounted()) {
        document.dispatchEvent(new CustomEvent('pathfinder-auto-open-docs', { detail }));
      } else {
        sidebarState.setPendingOpenSource('main_area_learning');
        sidebarState.openSidebar('Interactive learning', {
          url: detail.url,
          title: detail.title,
          timestamp: Date.now(),
        });
        linkInterceptionState.addToQueue({ ...detail, timestamp: Date.now() });
      }
    }

    // Safety gate navigates away so the sidebar can render against the Grafana UI
    if (opts?.navigateAway) {
      locationService.push('/a/grafana-pathfinder-app');
    }
  }, []);

  // Load a guide in-place without page reload (SPA navigation)
  const handleOpenGuideInMainArea = useCallback(
    (url: string, _title: string) => {
      if (isUnsupportedFormat(url)) {
        return;
      }
      const docPage = findDocPage(url);
      if (!docPage) {
        return;
      }
      dispatch({ type: 'navigate_to_guide', docUrl: docPage.url, originalParam: url });
      loadContent(docPage.url);
    },
    [loadContent]
  );

  // Listen for pathfinder-open-in-main-area events (from link interception when main area is active)
  useEffect(() => {
    const handleOpenInMainArea = (event: Event) => {
      const { url, title } = (event as CustomEvent).detail;
      handleOpenGuideInMainArea(url, title);
    };

    document.addEventListener('pathfinder-open-in-main-area', handleOpenInMainArea);
    return () => {
      document.removeEventListener('pathfinder-open-in-main-area', handleOpenInMainArea);
    };
  }, [handleOpenGuideInMainArea]);

  return (
    <div className={styles.container} data-testid={testIds.mainAreaLearning.container}>
      {state.status === 'loading' && (
        <div data-testid={testIds.mainAreaLearning.loadingState}>
          <SkeletonLoader />
        </div>
      )}

      {state.status === 'unsupported' && (
        <Alert
          title="Unsupported content format"
          severity="error"
          data-testid={testIds.mainAreaLearning.unsupportedFormatError}
        >
          <p>This content format is not supported in the learning view. Open it in the Pathfinder sidebar instead.</p>
          <Button
            variant="secondary"
            onClick={() => handleOpenInSidebar()}
            data-testid={testIds.mainAreaLearning.openInSidebarButton}
          >
            Open in sidebar
          </Button>
        </Alert>
      )}

      {state.status === 'unsafe' && (
        <Alert
          title="This guide requires the sidebar"
          severity="warning"
          data-testid={testIds.mainAreaLearning.safetyGateWarning}
        >
          <p>
            This guide includes interactive steps that need access to the Grafana UI. Open it in the Pathfinder sidebar
            for the full experience.
          </p>
          <Button
            variant="secondary"
            onClick={() => handleOpenInSidebar({ navigateAway: true })}
            data-testid={testIds.mainAreaLearning.safetyGateOpenInSidebarButton}
          >
            Open in sidebar
          </Button>
        </Alert>
      )}

      {state.status === 'error' && (
        <Alert title="Failed to load content" severity="error" data-testid={testIds.mainAreaLearning.errorState}>
          <p>{state.error}</p>
          <Button variant="secondary" onClick={handleRetry} data-testid={testIds.mainAreaLearning.retryButton}>
            Try again
          </Button>
        </Alert>
      )}

      {state.status === 'content' &&
        state.content &&
        (() => {
          const layout = getLayoutWidth(state.content);
          const bodyClass =
            layout === 'full'
              ? styles.contentBodyFull
              : layout === 'wide'
                ? styles.contentBodyWide
                : styles.contentBody;
          return (
            <>
              <GuideProgressHeader
                title={state.content.metadata?.title || ''}
                contentKey={state.content.url || ''}
                onOpenInSidebar={() => handleOpenInSidebar()}
                layoutWidth={layout}
              />
              <div
                id="main-area-docs-content"
                className={bodyClass}
                data-testid={testIds.mainAreaLearning.contentContainer}
              >
                <ContentRenderer content={state.content} />
              </div>
            </>
          );
        })()}

      {state.status === 'landing' && (
        <div data-testid={testIds.mainAreaLearning.landingPage}>
          <MyLearningErrorBoundary>
            <MyLearningTab onOpenGuide={handleOpenGuideInMainArea} />
          </MyLearningErrorBoundary>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// STYLES
// ============================================================================

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'auto',
    padding: theme.spacing(2),
  }),
  contentBody: css({
    maxWidth: '48rem',
    marginLeft: 'auto',
    marginRight: 'auto',
    width: '100%',
    // Interactive components break out of prose width for better usability
    '& [data-testid^="interactive-terminal-"], & [data-testid^="code-block-step-"]': {
      maxWidth: 'none',
    },
  }),
  contentBodyWide: css({
    maxWidth: '72rem',
    marginLeft: 'auto',
    marginRight: 'auto',
    width: '100%',
    '& [data-testid^="interactive-terminal-"], & [data-testid^="code-block-step-"]': {
      maxWidth: 'none',
    },
  }),
  contentBodyFull: css({
    maxWidth: 'none',
    width: '100%',
    '& [data-testid^="interactive-terminal-"], & [data-testid^="code-block-step-"]': {
      maxWidth: 'none',
    },
  }),
});
