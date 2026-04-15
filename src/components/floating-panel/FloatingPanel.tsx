import React, { useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { IconButton, useStyles2 } from '@grafana/ui';
import { panelModeManager } from '../../global-state/panel-mode';
import { getFloatingPanelStyles } from './floating-panel.styles';
import { useDragResize } from './useDragResize';
import { useHighlightDodge } from './useHighlightDodge';
import { MinimizedPill } from './MinimizedPill';

export type FloatingPanelState = 'full' | 'compact' | 'minimized';

export interface FloatingPanelProps {
  /** Title of the currently active guide/tab */
  title: string;
  /** Whether an interactive guide is active (for pill pulse) */
  hasActiveGuide: boolean;
  /** Step progress info for the pill badge */
  stepProgress?: string;
  /** URL of the currently active guide (for workshop link) */
  guideUrl?: string;
  /** Called when user clicks dock-to-sidebar button */
  onSwitchToSidebar: () => void;
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
  stepProgress,
  onSwitchToSidebar,
  onClose,
  children,
}: FloatingPanelProps) {
  const styles = useStyles2(getFloatingPanelStyles);
  const [panelState, setPanelState] = useState<FloatingPanelState>('full');
  const [isDodging, setIsDodging] = useState(false);
  const { geometry, setPosition, drag, resize } = useDragResize();

  // Auto-reposition when interactive highlights overlap the panel
  useHighlightDodge(geometry, panelState === 'minimized');

  const handleMinimize = useCallback(() => {
    setPanelState('minimized');
  }, []);

  const handleRestore = useCallback(() => {
    setPanelState('full');
  }, []);

  const handleSwitchToSidebar = useCallback(() => {
    panelModeManager.setMode('sidebar');
    onSwitchToSidebar();
  }, [onSwitchToSidebar]);

  const handleCopyWorkshopLink = useCallback(() => {
    if (!guideUrl) {
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set('doc', guideUrl);
    url.searchParams.set('panelMode', 'floating');
    navigator.clipboard.writeText(url.toString()).catch(() => {
      // Fallback: silently fail — clipboard may be unavailable
    });
  }, [guideUrl]);

  // Keyboard: Escape minimizes
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && panelState !== 'minimized') {
        handleMinimize();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [panelState, handleMinimize]);

  // Expose setPosition and setIsDodging for the dodge hook
  // via a custom event interface on the panel element
  useEffect(() => {
    const handleDodge = (e: CustomEvent<{ x: number; y: number }>) => {
      setIsDodging(true);
      setPosition(e.detail.x, e.detail.y);
      // Clear dodging animation class after transition
      setTimeout(() => setIsDodging(false), 250);
    };

    const handleCompact = () => {
      setPanelState('compact');
    };

    const handleRestoreFull = () => {
      setPanelState('full');
    };

    document.addEventListener('pathfinder-floating-dodge', handleDodge as EventListener);
    document.addEventListener('pathfinder-floating-compact', handleCompact);
    document.addEventListener('pathfinder-floating-restore-full', handleRestoreFull);

    return () => {
      document.removeEventListener('pathfinder-floating-dodge', handleDodge as EventListener);
      document.removeEventListener('pathfinder-floating-compact', handleCompact);
      document.removeEventListener('pathfinder-floating-restore-full', handleRestoreFull);
    };
  }, [setPosition]);

  if (panelState === 'minimized') {
    return <MinimizedPill hasActiveGuide={hasActiveGuide} stepProgress={stepProgress} onRestore={handleRestore} />;
  }

  const panelContent = (
    <div
      className={`${styles.panel} ${isDodging ? styles.panelDodging : ''}`}
      style={{
        left: geometry.x,
        top: geometry.y,
        width: geometry.width,
        height: panelState === 'compact' ? 'auto' : geometry.height,
      }}
      data-pathfinder-content="true"
      data-panel-state={panelState}
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
              name="link"
              size="sm"
              tooltip="Copy workshop link"
              onClick={handleCopyWorkshopLink}
              aria-label="Copy workshop link"
            />
          )}
          <IconButton
            name="gf-layout-simple"
            size="sm"
            tooltip="Switch to sidebar"
            onClick={handleSwitchToSidebar}
            aria-label="Switch to sidebar"
          />
          <IconButton name="minus" size="sm" tooltip="Minimize" onClick={handleMinimize} aria-label="Minimize panel" />
          <IconButton name="times" size="sm" tooltip="Close" onClick={onClose} aria-label="Close panel" />
        </div>
      </div>

      {/* Content area */}
      {panelState === 'full' && <div className={styles.content}>{children}</div>}

      {/* Resize handle */}
      {panelState === 'full' && (
        <div
          className={styles.resizeHandle}
          onPointerDown={resize.onPointerDown}
          onPointerMove={resize.onPointerMove}
          onPointerUp={resize.onPointerUp}
        />
      )}
    </div>
  );

  return createPortal(panelContent, document.body);
}
