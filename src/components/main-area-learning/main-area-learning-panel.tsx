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

import React, { useState, useEffect, useCallback, useRef } from 'react';
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

/**
 * Returns true if the URL scheme is unsupported in the main-area learning view.
 * Raw /docs/ paths and Grafana.com doc URLs require the sidebar for proper rendering.
 */
function isUnsupportedFormat(param: string): boolean {
  return (
    param.startsWith('/docs/') ||
    param.startsWith('/tutorials/') ||
    param.startsWith('/docs/learning-journeys/') ||
    param.startsWith('/docs/learning-paths/') ||
    param.startsWith('https://grafana.com/') ||
    param.startsWith('https://docs.grafana.com/')
  );
}

/** Strip handled params from current URL without navigation. */
function cleanUrlParams(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete('doc');
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
// RENDERER
// ============================================================================

/**
 * Parse ?doc= param from the URL at render time.
 * Returns initial state synchronously so we avoid calling setState inside an effect.
 */
function resolveDocParam(): {
  docParam: string | null;
  isUnsupported: boolean;
  urlScheme: string;
  resolvedUrl: string | null;
  showLanding: boolean;
} {
  const urlParams = new URLSearchParams(window.location.search);
  const docParam = urlParams.get('doc');

  if (!docParam) {
    return { docParam: null, isUnsupported: false, urlScheme: '', resolvedUrl: null, showLanding: true };
  }

  // Format validation — MUST run before findDocPage() because findDocPage
  // resolves /docs/ paths (Case 4) which we explicitly don't support here
  if (isUnsupportedFormat(docParam)) {
    const urlScheme = docParam.startsWith('https://') ? 'grafana_docs_url' : 'raw_docs_path';
    return { docParam, isUnsupported: true, urlScheme, resolvedUrl: null, showLanding: false };
  }

  const docPage = findDocPage(docParam);
  if (!docPage) {
    return { docParam, isUnsupported: false, urlScheme: '', resolvedUrl: null, showLanding: true };
  }

  return { docParam, isUnsupported: false, urlScheme: '', resolvedUrl: docPage.url, showLanding: false };
}

export function MainAreaLearningPanelRenderer() {
  const styles = useStyles2(getStyles);

  // Compute initial state synchronously from URL params (avoids setState in effect).
  // Individual state variables are mutable so in-place navigation can update them.
  const [resolved] = useState(resolveDocParam);

  const [loading, setLoading] = useState(!!resolved.resolvedUrl);
  const [content, setContent] = useState<RawContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showLanding, setShowLanding] = useState(resolved.showLanding);
  const [unsupportedFormat, setUnsupportedFormat] = useState(resolved.isUnsupported);
  const [unsafeGuide, setUnsafeGuide] = useState(false);

  // Chrome control params (captured before cleanUrlParams strips them)
  const [chromeParams] = useState(resolveChromeParams);
  const navCollapsedByUs = useRef(false);
  const sidebarClosedByUs = useRef(false);

  // Store resolved URL for retry and analytics context
  const docUrlRef = useRef<string | null>(resolved.resolvedUrl);
  // Store original ?doc= param for sidebar handoff on unsupported format
  const originalParamRef = useRef<string | null>(resolved.docParam);

  const loadContent = useCallback(async (url: string, signal?: AbortSignal) => {
    setLoading(true);
    setError(null);

    const startTime = performance.now();
    const result = await fetchContent(url);

    if (signal?.aborted) {
      return;
    }

    const loadTimeMs = Math.round(performance.now() - startTime);

    if (result.content) {
      const safetyResult = isMainAreaSafe(result.content.content);
      if (!safetyResult.safe) {
        setUnsafeGuide(true);
        setLoading(false);
        reportAppInteraction(UserInteraction.MainAreaSafetyGateBlocked, {
          guide_url: url,
          unsafe_action_types: safetyResult.unsafeActionTypes.join(','),
        });
        return;
      }

      setContent(result.content);
      reportAppInteraction(UserInteraction.MainAreaGuideLoaded, {
        guide_url: url,
        guide_title: result.content.metadata?.title || '',
        is_safe: true,
        load_time_ms: loadTimeMs,
      });
    } else {
      const errorMessage = result.error || 'Failed to load content';
      setError(errorMessage);
      reportAppInteraction(UserInteraction.MainAreaGuideLoadFailed, {
        guide_url: url,
        error_message: errorMessage,
      });
    }

    setLoading(false);
  }, []);

  // Mount-time: fire analytics, clean URL, set active state, and kick off async fetch
  useEffect(() => {
    const abortController = new AbortController();

    mainAreaLearningState.setIsActive(true);

    reportAppInteraction(UserInteraction.MainAreaPageView, {
      has_doc_param: !!resolved.docParam,
    });

    cleanUrlParams();

    if (resolved.isUnsupported) {
      reportAppInteraction(UserInteraction.MainAreaUnsupportedFormat, {
        guide_url: resolved.docParam!,
        url_scheme: resolved.urlScheme,
      });
    }

    if (resolved.resolvedUrl) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional: loadContent is async; all setState calls happen after await fetchContent()
      loadContent(resolved.resolvedUrl, abortController.signal);
    }

    return () => {
      mainAreaLearningState.setIsActive(false);
      abortController.abort();
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

    if (hideNav || hideSidebar) {
      reportAppInteraction(UserInteraction.MainAreaChromeControlApplied, {
        nav_hidden: hideNav,
        sidebar_hidden: hideSidebar,
      });
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
    if (docUrlRef.current) {
      loadContent(docUrlRef.current);
    }
  }, [loadContent]);

  const handleOpenInSidebar = useCallback(() => {
    const param = originalParamRef.current;
    if (!param) {
      return;
    }

    const detail = { url: param, title: 'Learning content' };

    reportAppInteraction(UserInteraction.MainAreaOpenInSidebarClicked, {
      guide_url: param,
      trigger: 'unsupported_format' as const,
    });

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
  }, []);

  const handleSafetyGateOpenInSidebar = useCallback(() => {
    const param = originalParamRef.current;
    if (!param) {
      return;
    }

    reportAppInteraction(UserInteraction.MainAreaOpenInSidebarClicked, {
      guide_url: param,
      trigger: 'safety_gate' as const,
    });

    if (param.startsWith('bundled:')) {
      const guideId = param.slice('bundled:'.length);
      sidebarState.openWithGuide(guideId);
    } else {
      const detail = { url: param, title: 'Learning content' };
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

    locationService.push('/a/grafana-pathfinder-app');
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
      setShowLanding(false);
      setUnsupportedFormat(false);
      setUnsafeGuide(false);
      setError(null);
      setContent(null);
      docUrlRef.current = docPage.url;
      originalParamRef.current = url;
      loadContent(docPage.url);
    },
    [loadContent]
  );

  // Listen for pathfinder-open-in-main-area events (from link interception when main area is active)
  useEffect(() => {
    const handleOpenInMainArea = (event: Event) => {
      const { url, title } = (event as CustomEvent).detail;
      const previousUrl = docUrlRef.current || '';

      reportAppInteraction(UserInteraction.MainAreaGuideNavigatedInPlace, {
        new_url: url,
        previous_url: previousUrl,
      });

      handleOpenGuideInMainArea(url, title);
    };

    document.addEventListener('pathfinder-open-in-main-area', handleOpenInMainArea);
    return () => {
      document.removeEventListener('pathfinder-open-in-main-area', handleOpenInMainArea);
    };
  }, [handleOpenGuideInMainArea]);

  return (
    <div className={styles.container} data-testid={testIds.mainAreaLearning.container}>
      {loading && (
        <div data-testid={testIds.mainAreaLearning.loadingState}>
          <SkeletonLoader />
        </div>
      )}

      {unsupportedFormat && (
        <Alert
          title="Unsupported content format"
          severity="error"
          data-testid={testIds.mainAreaLearning.unsupportedFormatError}
        >
          <p>This content format is not supported in the learning view. Open it in the Pathfinder sidebar instead.</p>
          <Button
            variant="secondary"
            onClick={handleOpenInSidebar}
            data-testid={testIds.mainAreaLearning.openInSidebarButton}
          >
            Open in sidebar
          </Button>
        </Alert>
      )}

      {unsafeGuide && !loading && (
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
            onClick={handleSafetyGateOpenInSidebar}
            data-testid={testIds.mainAreaLearning.safetyGateOpenInSidebarButton}
          >
            Open in sidebar
          </Button>
        </Alert>
      )}

      {error && !loading && (
        <Alert title="Failed to load content" severity="error" data-testid={testIds.mainAreaLearning.errorState}>
          <p>{error}</p>
          <Button variant="secondary" onClick={handleRetry} data-testid={testIds.mainAreaLearning.retryButton}>
            Try again
          </Button>
        </Alert>
      )}

      {content && !loading && (
        <>
          <GuideProgressHeader
            title={content.metadata?.title || ''}
            contentKey={content.url || ''}
            onOpenInSidebar={handleOpenInSidebar}
          />
          <div
            id="main-area-docs-content"
            className={styles.contentBody}
            data-testid={testIds.mainAreaLearning.contentContainer}
          >
            <ContentRenderer content={content} />
          </div>
        </>
      )}

      {showLanding && !loading && (
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
});
