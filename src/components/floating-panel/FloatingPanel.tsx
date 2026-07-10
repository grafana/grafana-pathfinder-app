import React, { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { IconButton, useStyles2, getPortalContainer } from '@grafana/ui';
import { reportAppInteraction, UserInteraction } from '../../lib/analytics';
import { buildPathfinderShareUrl } from '../../utils/pathfinder-search-params';
import { startModalWatch, stopModalWatch } from '../../interactive-engine';
import { getFloatingPanelStyles } from './floating-panel.styles';
import { useDragResize } from './useDragResize';
import { useDodgeSession } from './useDodgeSession';
import { useHighlightDodge } from './useHighlightDodge';
import { MinimizedPill } from './MinimizedPill';

export interface FloatingPanelProps {
  /** Title of the currently active guide/tab */
  title: string;
  /** Whether an interactive guide is active (for pill pulse) */
  hasActiveGuide: boolean;
  /** Step progress info for the pill badge */
  stepProgress?: string;
  /** URL of the currently active guide (for workshop link) */
  guideUrl?: string;
  /**
   * Tab type for the active guide. When 'learning-journey', the share URL
   * appends `&type=learning-journey` so a recipient hitting the link cold
   * gets the milestone toolbar (otherwise findDocPage may misclassify
   * package URLs as 'interactive').
   */
  guideType?: 'learning-journey' | 'docs';
  /** Called when user clicks dock-to-sidebar button */
  onSwitchToSidebar: () => void;
  /** Called when user clicks open-in-full-screen button. Hidden when omitted. */
  onSwitchToFullScreen?: () => void;
  /** Called when user closes the floating panel entirely */
  onClose: () => void;
  /** Content to render inside the panel */
  children: React.ReactNode;
}

/**
 * The floating panel container — a draggable, resizable overlay that
 * renders guide content outside the Grafana extension sidebar.
 *
 * Supports three states:
 * - full: shows header + content + footer
 * - compact: shows header + minimal content (for highlight dodge)
 * - minimized: collapses to a small pill
 */
export function FloatingPanel({
  title,
  hasActiveGuide,
  guideUrl,
  guideType,
  stepProgress,
  onSwitchToSidebar,
  onSwitchToFullScreen,
  onClose,
  children,
}: FloatingPanelProps) {
  const styles = useStyles2(getFloatingPanelStyles);
  const { geometry, setPosition, drag, resize } = useDragResize();
  const { view, isDodging, contentRef, minimize, restoreFromPill } = useDodgeSession(setPosition);

  // Auto-reposition to dodge interactive highlights and any open native modal
  useHighlightDodge(geometry, view === 'minimized', true);

  useEffect(() => {
    startModalWatch();
    return () => stopModalWatch();
  }, []);

  const handleSwitchToSidebar = useCallback(() => {
    // Don't call setMode here — the manager (onSwitchToSidebar) handles
    // the full teardown: restore tab snapshot, reset guard, THEN set mode.
    onSwitchToSidebar();
  }, [onSwitchToSidebar]);

  const [linkCopied, setLinkCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const handleCopyWorkshopLink = useCallback(() => {
    if (!guideUrl) {
      return;
    }
    const shareUrl = buildPathfinderShareUrl({ doc: guideUrl, panelMode: 'floating', guideType });
    navigator.clipboard
      .writeText(shareUrl)
      .then(() => {
        setLinkCopied(true);
        clearTimeout(copyTimerRef.current);
        copyTimerRef.current = setTimeout(() => setLinkCopied(false), 2000);
        reportAppInteraction(UserInteraction.FloatingPanelCopyLink, {
          guide_url: guideUrl,
        });
      })
      .catch(() => {
        // Clipboard may be unavailable
      });
  }, [guideUrl, guideType]);

  // Keyboard: Escape minimizes — only when the panel itself or document.body
  // has focus. Skip if another component already handled the event (modals,
  // dropdowns, select menus) or if focus is inside an unrelated overlay.
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || view === 'minimized' || e.defaultPrevented) {
        return;
      }
      const target = e.target as Element | null;
      const isInsidePanel = target && panelRef.current?.contains(target);
      const isBodyOrDocument = target === document.body || target === document.documentElement;
      if (isInsidePanel || isBodyOrDocument) {
        minimize();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [view, minimize]);

  useEffect(() => () => clearTimeout(copyTimerRef.current), []);

  const isMinimized = view === 'minimized';

  const panelContent = (
    <>
      {isMinimized && (
        <MinimizedPill hasActiveGuide={hasActiveGuide} stepProgress={stepProgress} onRestore={restoreFromPill} />
      )}
      <div
        ref={panelRef}
        className={`${styles.panel} ${isDodging ? styles.panelDodging : ''}`}
        style={{
          left: geometry.x,
          top: geometry.y,
          width: geometry.width,
          height: view === 'compact' ? 'auto' : geometry.height,
          // Keep mounted but hidden when minimized so ContentRenderer
          // and the interactive engine continue tracking progress
          display: isMinimized ? 'none' : undefined,
        }}
        data-pathfinder-content="true"
        data-panel-state={view}
        role="dialog"
        aria-label="Pathfinder floating panel"
      >
        {/* Header — drag handle */}
        <div
          className={styles.header}
          onPointerDown={drag.onPointerDown}
          onPointerMove={drag.onPointerMove}
          onPointerUp={drag.onPointerUp}
        >
          <span className={styles.headerTitle} title={title}>
            {title}
          </span>
          {stepProgress && <span className={styles.stepCounter}>{stepProgress}</span>}
          <div className={styles.headerActions}>
            {guideUrl && (
              <IconButton
                name={linkCopied ? 'check' : 'link'}
                size="sm"
                tooltip={linkCopied ? 'Copied!' : 'Copy workshop link'}
                onClick={handleCopyWorkshopLink}
                aria-label="Copy workshop link"
              />
            )}
            <IconButton
              name="angle-double-right"
              size="sm"
              tooltip="Dock to sidebar"
              onClick={handleSwitchToSidebar}
              aria-label="Dock to sidebar"
            />
            {onSwitchToFullScreen && (
              <IconButton
                name="expand-arrows"
                size="sm"
                tooltip="Open in full screen"
                onClick={onSwitchToFullScreen}
                aria-label="Open in full screen"
              />
            )}
            <IconButton name="minus" size="sm" tooltip="Minimize" onClick={minimize} aria-label="Minimize panel" />
            <IconButton name="times" size="sm" tooltip="Close" onClick={onClose} aria-label="Close panel" />
          </div>
        </div>

        {/* Content area — always mounted for progress tracking */}
        <div ref={contentRef} className={styles.content}>
          {children}
        </div>

        {/* Resize handle */}
        {view === 'full' && (
          <div
            className={styles.resizeHandle}
            onPointerDown={resize.onPointerDown}
            onPointerMove={resize.onPointerMove}
            onPointerUp={resize.onPointerUp}
          />
        )}
      </div>
    </>
  );

  return createPortal(panelContent, getPortalContainer());
}
