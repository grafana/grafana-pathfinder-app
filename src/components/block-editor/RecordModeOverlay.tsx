/**
 * Record Mode Overlay Component
 *
 * Shows recording UI with element highlighting and DOM path tooltip.
 * Unlike ElementPicker, clicks propagate to allow actual interaction recording.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Icon, useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css, keyframes } from '@emotion/css';
import { generateFullDomPath } from '../../utils/devtools';
import { DomPathTooltip } from '../DomPathTooltip';
import { testIds } from '../../constants/testIds';

const pulseKeyframe = keyframes({
  '0%, 100%': { opacity: 1 },
  '50%': { opacity: 0.3 },
});

const getStyles = (theme: GrafanaTheme2) => ({
  banner: css({
    position: 'fixed',
    top: 0,
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 99999,
    height: 36,
    padding: `0 ${theme.spacing(2)}`,
    backgroundColor: theme.colors.background.primary,
    border: `2px solid ${theme.colors.warning.main}`,
    borderTop: 'none',
    borderRadius: `0 0 ${theme.shape.radius.default} ${theme.shape.radius.default}`,
    boxShadow: theme.shadows.z3,
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    maxWidth: 'calc(100vw - 32px)',
  }),
  leftGroup: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    flexShrink: 0,
  }),
  centerGroup: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    flex: 1,
    justifyContent: 'center',
    minWidth: 0,
  }),
  rightGroup: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.75),
    flexShrink: 0,
  }),
  recordingDot: css({
    width: 8,
    height: 8,
    borderRadius: '50%',
    backgroundColor: theme.colors.error.main,
    flexShrink: 0,
    animation: `${pulseKeyframe} 1.2s ease-in-out infinite`,
  }),
  bannerText: css({
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  }),
  stepCount: css({
    backgroundColor: theme.colors.background.secondary,
    color: theme.colors.text.secondary,
    padding: `1px ${theme.spacing(0.75)}`,
    borderRadius: theme.shape.radius.default,
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    whiteSpace: 'nowrap',
  }),
  separator: css({
    width: 1,
    height: 16,
    backgroundColor: theme.colors.border.weak,
    flexShrink: 0,
  }),
  modeIndicator: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    padding: `1px ${theme.spacing(0.75)}`,
    borderRadius: theme.shape.radius.default,
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    whiteSpace: 'nowrap',
  }),
  hoverIndicator: css({
    backgroundColor: theme.colors.info.transparent,
    color: theme.colors.info.text,
    border: `1px solid ${theme.colors.info.border}`,
  }),
  formCaptureIndicator: css({
    backgroundColor: theme.colors.warning.transparent,
    color: theme.colors.warning.text,
    border: `1px solid ${theme.colors.warning.border}`,
  }),
  formCaptureActiveIndicator: css({
    backgroundColor: theme.colors.success.transparent,
    color: theme.colors.success.text,
    border: `1px solid ${theme.colors.success.border}`,
  }),
  multiStepIndicator: css({
    backgroundColor: theme.colors.warning.transparent,
    color: theme.colors.warning.text,
    border: `1px solid ${theme.colors.warning.border}`,
    padding: `1px ${theme.spacing(0.75)}`,
    borderRadius: theme.shape.radius.default,
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    whiteSpace: 'nowrap',
  }),
  bannerButton: css({
    padding: `2px ${theme.spacing(1)}`,
    backgroundColor: 'transparent',
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
    color: theme.colors.text.secondary,
    cursor: 'pointer',
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    transition: 'all 0.15s ease',
    whiteSpace: 'nowrap',

    '&:hover': {
      backgroundColor: theme.colors.action.hover,
      color: theme.colors.text.primary,
      borderColor: theme.colors.border.strong,
    },

    '&:disabled': {
      opacity: 0.4,
      cursor: 'not-allowed',
    },
  }),
  stopButton: css({
    padding: `2px ${theme.spacing(1)}`,
    backgroundColor: theme.colors.error.transparent,
    border: `1px solid ${theme.colors.error.border}`,
    borderRadius: theme.shape.radius.default,
    color: theme.colors.error.text,
    cursor: 'pointer',
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    transition: 'all 0.15s ease',
    whiteSpace: 'nowrap',

    '&:hover': {
      backgroundColor: theme.colors.error.main,
      color: theme.colors.error.contrastText,
    },
  }),
  toggleButton: css({
    padding: `2px ${theme.spacing(0.75)}`,
    backgroundColor: 'transparent',
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
    color: theme.colors.text.secondary,
    cursor: 'pointer',
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    transition: 'all 0.15s ease',
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    whiteSpace: 'nowrap',

    '&:hover': {
      backgroundColor: theme.colors.action.hover,
    },
  }),
  toggleButtonEnabled: css({
    backgroundColor: theme.colors.success.transparent,
    borderColor: theme.colors.success.border,
    color: theme.colors.success.text,

    '&:hover': {
      backgroundColor: theme.colors.success.transparent,
    },
  }),
  toggleButtonDisabled: css({
    opacity: 0.6,
  }),
  hintText: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.disabled,
    whiteSpace: 'nowrap',
    flexShrink: 0,
  }),
  hintKey: css({
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: '10px',
    backgroundColor: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: 3,
    padding: '0 3px',
    lineHeight: '16px',
  }),
  highlight: css({
    position: 'fixed',
    zIndex: 99997,
    border: `2px solid ${theme.colors.primary.main}`,
    backgroundColor: theme.colors.primary.transparent,
    pointerEvents: 'none',
    transition: 'all 0.1s ease',
  }),
  highlightHover: css({
    position: 'fixed',
    zIndex: 99997,
    border: `2px solid ${theme.colors.info.main}`,
    backgroundColor: theme.colors.info.transparent,
    pointerEvents: 'none',
    transition: 'all 0.1s ease',
  }),
  highlightFormCapture: css({
    position: 'fixed',
    zIndex: 99997,
    border: `2px solid ${theme.colors.warning.main}`,
    backgroundColor: theme.colors.warning.transparent,
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
  /** Element currently being form-captured (Alt+click), null when not active */
  formCaptureElement?: HTMLElement | null;
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
  formCaptureElement = null,
}: RecordModeOverlayProps) {
  const styles = useStyles2(getStyles);
  const [hoveredElement, setHoveredElement] = useState<HTMLElement | null>(null);
  const [cursorPosition, setCursorPosition] = useState<{ x: number; y: number } | null>(null);
  const [highlightRect, setHighlightRect] = useState<DOMRect | null>(null);
  const [isHoverMode, setIsHoverMode] = useState(false);
  const [isFormCaptureMode, setIsFormCaptureMode] = useState(false);

  // Track Shift/Alt key state for recording mode visual indicators
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setIsHoverMode(true);
      }
      if (e.key === 'Alt') {
        setIsFormCaptureMode(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setIsHoverMode(false);
      }
      if (e.key === 'Alt') {
        setIsFormCaptureMode(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

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

  // Determine active mode for center indicators
  const activeMode = formCaptureElement
    ? 'formCaptureActive'
    : isFormCaptureMode
      ? 'formCapture'
      : isHoverMode
        ? 'hover'
        : null;

  // Render directly to document.body to bypass any modal overlays
  return createPortal(
    <>
      {/* Element highlight */}
      {highlightRect && (
        <div
          className={
            isFormCaptureMode ? styles.highlightFormCapture : isHoverMode ? styles.highlightHover : styles.highlight
          }
          data-record-overlay="highlight"
          style={{
            left: highlightRect.left,
            top: highlightRect.top,
            width: highlightRect.width,
            height: highlightRect.height,
          }}
        />
      )}

      {/* Top bar */}
      <div className={styles.banner} data-record-overlay="banner">
        {/* Left: recording indicator + text + count */}
        <div className={styles.leftGroup}>
          <div className={styles.recordingDot} />
          <span className={styles.bannerText}>{sectionName ? `Recording "${sectionName}"` : 'Recording'}</span>
          <span className={styles.stepCount}>
            {stepCount} {sectionName ? 'block' : 'step'}
            {stepCount !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Center: mode indicators (only when active) */}
        <div className={styles.centerGroup}>
          {activeMode === 'hover' && (
            <span className={`${styles.modeIndicator} ${styles.hoverIndicator}`}>
              <Icon name="eye" size="sm" /> Hover capture
            </span>
          )}
          {activeMode === 'formCapture' && (
            <span className={`${styles.modeIndicator} ${styles.formCaptureIndicator}`}>
              <Icon name="pen" size="sm" /> Form capture
            </span>
          )}
          {activeMode === 'formCaptureActive' && (
            <span className={`${styles.modeIndicator} ${styles.formCaptureActiveIndicator}`}>
              <Icon name="pen" size="sm" /> Type your value, then click away
            </span>
          )}
          {isMultiStepGroupingEnabled && isGroupingMultiStep && (
            <span
              className={styles.multiStepIndicator}
              title="A dropdown or modal was detected - steps are being grouped"
            >
              Grouping: {pendingMultiStepCount} step{pendingMultiStepCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Right: actions */}
        <div className={styles.rightGroup}>
          <span className={styles.hintText}>
            <span className={styles.hintKey}>Shift</span>+click hover <span className={styles.hintKey}>Alt</span>+click
            fill <span className={styles.hintKey}>Esc</span> stop
          </span>
          <div className={styles.separator} />
          {onToggleMultiStepGrouping && (
            <button
              className={`${styles.toggleButton} ${isMultiStepGroupingEnabled ? styles.toggleButtonEnabled : styles.toggleButtonDisabled}`}
              onClick={handleToggleMultiStepGrouping}
              type="button"
              title={
                isMultiStepGroupingEnabled
                  ? 'Multi-step grouping is ON. Click to disable.'
                  : 'Multi-step grouping is OFF. Click to enable.'
              }
            >
              {isMultiStepGroupingEnabled ? 'Auto-group' : 'No grouping'}
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
          <button
            className={styles.stopButton}
            onClick={handleStopClick}
            type="button"
            data-testid={testIds.blockEditor.recordStopButton}
          >
            Stop
          </button>
        </div>
      </div>

      {/* DOM path tooltip - uses existing component with testid highlighting */}
      {cursorPosition && <DomPathTooltip domPath={domPath} position={cursorPosition} visible={!!domPath} />}
    </>,
    document.body
  );
}

RecordModeOverlay.displayName = 'RecordModeOverlay';
