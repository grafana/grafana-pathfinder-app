/**
 * Element Picker Component
 *
 * A full-screen overlay that captures element clicks for selector generation.
 * Shows DOM path tooltip on hover and returns the selector when clicked.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';
import { generateSelectorFromEvent, generateFullDomPath } from '../../utils/devtools';
import { DomPathTooltip } from '../DomPathTooltip';

const getStyles = (theme: GrafanaTheme2) => ({
  overlay: css({
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 99998,
    cursor: 'crosshair',
    backgroundColor: 'transparent',
  }),
  banner: css({
    position: 'fixed',
    top: theme.spacing(1),
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 99999,
    padding: `${theme.spacing(0.75)} ${theme.spacing(2)}`,
    backgroundColor: theme.colors.primary.main,
    color: theme.colors.primary.contrastText,
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
  bannerIcon: css({
    fontSize: '14px',
  }),
  stopButton: css({
    padding: `${theme.spacing(0.25)} ${theme.spacing(1.5)}`,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    border: '1px solid rgba(255, 255, 255, 0.4)',
    borderRadius: theme.shape.radius.default,
    color: theme.colors.primary.contrastText,
    cursor: 'pointer',
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    transition: 'all 0.15s ease',

    '&:hover': {
      backgroundColor: 'rgba(255, 255, 255, 0.3)',
    },
  }),
  highlight: css({
    position: 'fixed',
    zIndex: 99997,
    border: `2px solid ${theme.colors.primary.main}`,
    backgroundColor: theme.colors.primary.transparent,
    pointerEvents: 'none',
    transition: 'all 0.1s ease',
  }),
});

export interface ElementPickerProps {
  /** Called when an element is selected */
  onSelect: (selector: string) => void;
  /** Called when picker is cancelled */
  onCancel: () => void;
}

/**
 * Element Picker - full screen overlay for selecting elements
 */
export function ElementPicker({ onSelect, onCancel }: ElementPickerProps) {
  const styles = useStyles2(getStyles);
  const [hoveredElement, setHoveredElement] = useState<HTMLElement | null>(null);
  const [cursorPosition, setCursorPosition] = useState<{ x: number; y: number } | null>(null);
  const [highlightRect, setHighlightRect] = useState<DOMRect | null>(null);

  // Get the element under the cursor, ignoring our picker UI and modal elements
  const getElementUnderCursor = useCallback((x: number, y: number): HTMLElement | null => {
    // Selectors for elements to temporarily hide
    const hideSelectors = [
      '[data-element-picker]',
      '#grafana-portal-container > *', // Modal portals
      '.ReactModal__Overlay',
      '.modal-backdrop',
      '[class*="ReactModal"]',
    ];

    const originalStyles: Array<{ el: HTMLElement; pointerEvents: string; visibility: string }> = [];

    // Hide all interfering elements
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

    // Filter out any portal container elements that might still be detected
    if (elementUnder) {
      const isPortalElement = elementUnder.closest('#grafana-portal-container') !== null;
      if (isPortalElement) {
        return null;
      }
    }

    return elementUnder;
  }, []);

  // Handle mouse move to track hovered element
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

  // Handle click to select element
  const handleClick = useCallback(
    (event: MouseEvent) => {
      const clickedElement = event.target as HTMLElement;

      // If clicking on picker banner or button, let the event through normally
      // (but NOT the overlay - that should trigger a pick)
      const pickerAttr = clickedElement.closest('[data-element-picker]')?.getAttribute('data-element-picker');
      if (pickerAttr && pickerAttr !== 'overlay') {
        return;
      }

      const { clientX, clientY } = event;

      // Prevent ALL default behavior
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      // Get the actual element under the cursor
      const target = getElementUnderCursor(clientX, clientY);

      if (!target) {
        console.warn('[pathfinder]', '[ElementPicker] No element found under cursor');
        return;
      }

      // Generate selector
      const result = generateSelectorFromEvent(target, event);

      if (result.warnings.length > 0) {
        console.warn('[pathfinder]', '[ElementPicker] Selector warnings:', result.warnings);
      }

      console.log('[pathfinder]', '[ElementPicker] Selected:', result.selector);

      // Return the selector
      onSelect(result.selector);
    },
    [onSelect, getElementUnderCursor]
  );

  // Handle escape key
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCancel();
      }
    },
    [onCancel]
  );

  // Set up event listeners
  useEffect(() => {
    // Use capture phase for click to intercept before anything else
    document.addEventListener('click', handleClick, { capture: true });
    document.addEventListener('mousemove', handleMouseMove, { capture: true });
    document.addEventListener('keydown', handleKeyDown);

    // Prevent scrolling while picking
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('click', handleClick, { capture: true });
      document.removeEventListener('mousemove', handleMouseMove, { capture: true });
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [handleClick, handleMouseMove, handleKeyDown]);

  // Generate full DOM path with data-testid highlighting
  const domPath = hoveredElement ? generateFullDomPath(hoveredElement) : '';

  // Render directly to document.body to bypass any modal overlays
  return createPortal(
    <>
      {/* Invisible overlay to capture all interactions */}
      <div className={styles.overlay} data-element-picker="overlay" />

      {/* Element highlight */}
      {highlightRect && (
        <div
          className={styles.highlight}
          data-element-picker="highlight"
          style={{
            left: highlightRect.left,
            top: highlightRect.top,
            width: highlightRect.width,
            height: highlightRect.height,
          }}
        />
      )}

      {/* Top banner */}
      <div className={styles.banner} data-element-picker="banner">
        <span className={styles.bannerIcon}>🎯</span>
        <span className={styles.bannerText}>Click any element to capture its selector</span>
        <button className={styles.stopButton} onClick={onCancel} type="button">
          Cancel (Esc)
        </button>
      </div>

      {/* DOM path tooltip - uses existing component with testid highlighting */}
      {cursorPosition && <DomPathTooltip domPath={domPath} position={cursorPosition} visible={!!domPath} />}
    </>,
    document.body
  );
}

ElementPicker.displayName = 'ElementPicker';
