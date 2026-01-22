/**
 * Record Mode Overlay Component
 *
 * Shows recording UI with element highlighting and DOM path tooltip.
 * Unlike ElementPicker, clicks propagate to allow actual interaction recording.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';
import { generateFullDomPath } from '../../utils/devtools';
import { DomPathTooltip } from '../DomPathTooltip';

const getStyles = (theme: GrafanaTheme2) => ({
  banner: css({
    position: 'fixed',
    top: theme.spacing(1),
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 99999,
    padding: `${theme.spacing(0.75)} ${theme.spacing(2)}`,
    backgroundColor: theme.colors.error.main,
    color: theme.colors.error.contrastText,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing(1.5),
    boxShadow: theme.shadows.z3,
    borderRadius: theme.shape.radius.default,
  }),
  bannerText: css({
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
  }),
  recordingDot: css({
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    backgroundColor: theme.colors.error.contrastText,
    animation: 'blink-dot 1s ease-in-out infinite',
    '@keyframes blink-dot': {
      '0%, 100%': { opacity: 1 },
      '50%': { opacity: 0.3 },
    },
  }),
  stepCount: css({
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    padding: `${theme.spacing(0.25)} ${theme.spacing(1)}`,
    borderRadius: theme.shape.radius.default,
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
  }),
  multiStepIndicator: css({
    backgroundColor: theme.colors.warning.main,
    color: theme.colors.warning.contrastText,
    padding: `${theme.spacing(0.25)} ${theme.spacing(1)}`,
    borderRadius: theme.shape.radius.default,
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    animation: 'pulse-indicator 1.5s ease-in-out infinite',
    '@keyframes pulse-indicator': {
      '0%, 100%': { opacity: 1 },
      '50%': { opacity: 0.7 },
    },
  }),
  multiStepIcon: css({
    fontSize: '12px',
  }),
  toggleButton: css({
    padding: `${theme.spacing(0.25)} ${theme.spacing(1)}`,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    border: '1px solid rgba(255, 255, 255, 0.3)',
    borderRadius: theme.shape.radius.default,
    color: theme.colors.error.contrastText,
    cursor: 'pointer',
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    transition: 'all 0.15s ease',
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),

    '&:hover': {
      backgroundColor: 'rgba(255, 255, 255, 0.25)',
    },
  }),
  toggleButtonEnabled: css({
    backgroundColor: theme.colors.success.main,
    borderColor: theme.colors.success.border,
    color: theme.colors.success.contrastText,

    '&:hover': {
      backgroundColor: theme.colors.success.shade,
    },
  }),
  toggleButtonDisabled: css({
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderColor: 'rgba(255, 255, 255, 0.2)',
    opacity: 0.8,
  }),
  bannerButton: css({
    padding: `${theme.spacing(0.25)} ${theme.spacing(1.5)}`,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    border: '1px solid rgba(255, 255, 255, 0.4)',
    borderRadius: theme.shape.radius.default,
    color: theme.colors.error.contrastText,
    cursor: 'pointer',
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    transition: 'all 0.15s ease',

    '&:hover': {
      backgroundColor: 'rgba(255, 255, 255, 0.3)',
    },

    '&:disabled': {
      opacity: 0.5,
      cursor: 'not-allowed',
    },
  }),
  highlight: css({
    position: 'fixed',
    zIndex: 99997,
    border: `2px solid ${theme.colors.error.main}`,
    backgroundColor: theme.colors.error.transparent,
    pointerEvents: 'none',
    transition: 'all 0.1s ease',
  }),
});

export interface RecordModeOverlayProps {
  /** Called when recording should stop */
  onStop: () => void;
  /** Number of steps recorded so far */
  stepCount: number;
  /** Whether recording is currently active */
  isRecording?: boolean;
  /** Name of section being recorded into (for section recording) */
  sectionName?: string;
  /** URL where recording started - used for "Return to start" button */
  startingUrl?: string;
  /** Number of steps pending in a multi-step group (modal/dropdown detected) */
  pendingMultiStepCount?: number;
  /** Whether currently grouping steps into a multi-step */
  isGroupingMultiStep?: boolean;
  /** Whether multi-step grouping is enabled */
  isMultiStepGroupingEnabled?: boolean;
  /** Called when user toggles multi-step grouping */
  onToggleMultiStepGrouping?: () => void;
}

/**
 * Record Mode Overlay - shows recording UI without blocking clicks
 */
export function RecordModeOverlay({
  onStop,
  stepCount,
  isRecording = true,
  sectionName,
  startingUrl,
  pendingMultiStepCount = 0,
  isGroupingMultiStep = false,
  isMultiStepGroupingEnabled = true,
  onToggleMultiStepGrouping,
}: RecordModeOverlayProps) {
  const styles = useStyles2(getStyles);
  const [hoveredElement, setHoveredElement] = useState<HTMLElement | null>(null);
  const [cursorPosition, setCursorPosition] = useState<{ x: number; y: number } | null>(null);
  const [highlightRect, setHighlightRect] = useState<DOMRect | null>(null);

  // Check if we're already at the starting URL
  const isAtStartingUrl = startingUrl ? window.location.href === startingUrl : true;

  // Get the element under the cursor, ignoring our overlay UI and modal backdrop elements
  // BUT allowing dropdown menus and other legitimate portal content
  const getElementUnderCursor = useCallback((x: number, y: number): HTMLElement | null => {
    // Selectors for elements to temporarily hide - only modal backdrops, not all portal content
    const hideSelectors = [
      '[data-record-overlay]', // Our overlay UI
      '.ReactModal__Overlay', // React modal backdrop
      '.modal-backdrop', // Generic modal backdrop
    ];

    const originalStyles: Array<{ el: HTMLElement; pointerEvents: string; visibility: string }> = [];

    // Hide interfering elements (modal backdrops only)
    hideSelectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((el) => {
        const htmlEl = el as HTMLElement;
        originalStyles.push({
          el: htmlEl,
          pointerEvents: htmlEl.style.pointerEvents,
          visibility: htmlEl.style.visibility,
        });
        htmlEl.style.pointerEvents = 'none';
        htmlEl.style.visibility = 'hidden';
      });
    });

    // Find the element at the cursor position
    const elementUnder = document.elementFromPoint(x, y) as HTMLElement | null;

    // Restore all elements
    originalStyles.forEach(({ el, pointerEvents, visibility }) => {
      el.style.pointerEvents = pointerEvents;
      el.style.visibility = visibility;
    });

    // Only filter out our own overlay elements, allow everything else including portal dropdowns
    if (elementUnder) {
      if (elementUnder.closest('[data-record-overlay]')) {
        return null;
      }
    }

    return elementUnder;
  }, []);

  // Handle mouse move to track hovered element (for highlighting and tooltip)
  const handleMouseMove = useCallback(
    (event: MouseEvent) => {
      const { clientX, clientY } = event;
      const target = getElementUnderCursor(clientX, clientY);

      if (!target) {
        setHoveredElement(null);
        setHighlightRect(null);
        return;
      }

      setHoveredElement(target);
      setCursorPosition({ x: clientX, y: clientY });
      setHighlightRect(target.getBoundingClientRect());
    },
    [getElementUnderCursor]
  );

  // Handle escape key to stop recording
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onStop();
      }
    },
    [onStop]
  );

  // Handle stop button click - prevent propagation so it doesn't get recorded as a step
  const handleStopClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      onStop();
    },
    [onStop]
  );

  // Handle return to start button click
  const handleReturnToStart = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (startingUrl) {
        window.location.href = startingUrl;
      }
    },
    [startingUrl]
  );

  // Handle toggle multi-step grouping button click
  const handleToggleMultiStepGrouping = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      onToggleMultiStepGrouping?.();
    },
    [onToggleMultiStepGrouping]
  );

  // Set up event listeners - NOTE: we do NOT capture clicks, they propagate naturally
  useEffect(() => {
    document.addEventListener('mousemove', handleMouseMove, { passive: true });
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleMouseMove, handleKeyDown]);

  // Generate full DOM path with data-testid highlighting
  const domPath = hoveredElement ? generateFullDomPath(hoveredElement) : '';

  // Render directly to document.body to bypass any modal overlays
  return createPortal(
    <>
      {/* Element highlight - red border */}
      {highlightRect && (
        <div
          className={styles.highlight}
          data-record-overlay="highlight"
          style={{
            left: highlightRect.left,
            top: highlightRect.top,
            width: highlightRect.width,
            height: highlightRect.height,
          }}
        />
      )}

      {/* Top banner - red with recording indicator */}
      <div className={styles.banner} data-record-overlay="banner">
        <div className={styles.recordingDot} />
        <span className={styles.bannerText}>
          {sectionName
            ? `Recording into "${sectionName}"... Click elements to capture blocks`
            : 'Recording... Click elements to capture steps'}
        </span>
        <span className={styles.stepCount}>
          {stepCount} {sectionName ? 'block' : 'step'}
          {stepCount !== 1 ? 's' : ''}
        </span>
        {/* Multi-step grouping indicator - only show when enabled and actively grouping */}
        {isMultiStepGroupingEnabled && isGroupingMultiStep && (
          <span
            className={styles.multiStepIndicator}
            title="A dropdown or modal was detected - steps are being grouped"
          >
            <span className={styles.multiStepIcon}>📦</span>
            Grouping: {pendingMultiStepCount} step{pendingMultiStepCount !== 1 ? 's' : ''}
          </span>
        )}
        {/* Multi-step grouping toggle button */}
        {onToggleMultiStepGrouping && (
          <button
            className={`${styles.toggleButton} ${isMultiStepGroupingEnabled ? styles.toggleButtonEnabled : styles.toggleButtonDisabled}`}
            onClick={handleToggleMultiStepGrouping}
            type="button"
            title={
              isMultiStepGroupingEnabled
                ? 'Multi-step grouping is ON: Dropdown/modal clicks will be grouped together. Click to disable.'
                : 'Multi-step grouping is OFF: All clicks recorded individually. Click to enable.'
            }
          >
            {isMultiStepGroupingEnabled ? '📦 Auto-group' : '📦 No grouping'}
          </button>
        )}
        {startingUrl && (
          <button
            className={styles.bannerButton}
            onClick={handleReturnToStart}
            disabled={isAtStartingUrl}
            type="button"
            title={isAtStartingUrl ? 'Already at starting page' : 'Return to the page where recording started'}
          >
            Return to start
          </button>
        )}
        <button className={styles.bannerButton} onClick={handleStopClick} type="button">
          Stop (Esc)
        </button>
      </div>

      {/* DOM path tooltip - uses existing component with testid highlighting */}
      {cursorPosition && <DomPathTooltip domPath={domPath} position={cursorPosition} visible={!!domPath} />}
    </>,
    document.body
  );
}

RecordModeOverlay.displayName = 'RecordModeOverlay';
