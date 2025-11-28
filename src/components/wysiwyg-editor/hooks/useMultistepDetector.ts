/**
 * Hook for auto-detecting dropdown/modal opens after a click
 *
 * Uses MutationObserver to watch for new elements with specific roles or classes
 * that indicate a dropdown, menu, modal, or popover has appeared.
 * When detected, it enables bundling mode to collect subsequent clicks into a multistep.
 */

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';

/**
 * Detected overlay types
 */
export type OverlayType = 'dropdown' | 'menu' | 'modal' | 'popover' | 'tooltip' | 'listbox' | 'none';

/**
 * Detection result
 */
export interface DetectionResult {
  detected: boolean;
  type: OverlayType;
  element: HTMLElement | null;
}

/**
 * Options for the useMultistepDetector hook
 */
export interface UseMultistepDetectorOptions {
  /** Whether detection is active */
  isActive: boolean;
  /** Time window (ms) after a click to detect overlays */
  detectionWindowMs?: number;
  /** Callback when an overlay is detected */
  onOverlayDetected?: (result: DetectionResult) => void;
  /** Callback when overlay is dismissed */
  onOverlayDismissed?: () => void;
}

/**
 * Return type for the useMultistepDetector hook
 */
export interface UseMultistepDetectorReturn {
  /** Whether an overlay is currently detected */
  hasOverlay: boolean;
  /** Type of the detected overlay */
  overlayType: OverlayType;
  /** The detected overlay element */
  overlayElement: HTMLElement | null;
  /** Trigger detection after a click */
  triggerDetection: () => void;
  /** Reset detection state */
  resetDetection: () => void;
  /** Check if a click is inside the current overlay */
  isClickInsideOverlay: (element: HTMLElement) => boolean;
}

// ARIA roles that indicate overlay elements
const OVERLAY_ROLES = ['menu', 'listbox', 'dialog', 'alertdialog', 'tooltip', 'combobox'] as const;

// Class patterns that indicate overlay elements
const OVERLAY_CLASS_PATTERNS = [
  'dropdown',
  'menu',
  'modal',
  'popover',
  'tooltip',
  'overlay',
  'popup',
  'select-menu',
  'cascader',
  'picker',
] as const;

// Grafana-specific overlay selectors
const GRAFANA_OVERLAY_SELECTORS = [
  '[class*="grafana-portal"]',
  '[class*="dropdown-menu"]',
  '[class*="menu-dropdown"]',
  '[class*="select__menu"]',
  '[class*="cascader-menu"]',
  '[class*="react-select__menu"]',
  '[data-testid*="dropdown"]',
  '[data-testid*="menu"]',
  '[data-testid*="modal"]',
  '[role="presentation"]', // React portals often use this
];

/**
 * Check if an element is an overlay based on role and class
 */
function isOverlayElement(element: HTMLElement): { isOverlay: boolean; type: OverlayType } {
  const role = element.getAttribute('role');
  const className = element.className || '';
  const classString = typeof className === 'string' ? className.toLowerCase() : '';

  // Check ARIA roles
  if (role) {
    const roleLower = role.toLowerCase();
    if (OVERLAY_ROLES.includes(roleLower as any)) {
      if (roleLower === 'dialog' || roleLower === 'alertdialog') {
        return { isOverlay: true, type: 'modal' };
      }
      if (roleLower === 'menu') {
        return { isOverlay: true, type: 'menu' };
      }
      if (roleLower === 'listbox' || roleLower === 'combobox') {
        return { isOverlay: true, type: 'dropdown' };
      }
      if (roleLower === 'tooltip') {
        return { isOverlay: true, type: 'tooltip' };
      }
    }
  }

  // Check class patterns
  for (const pattern of OVERLAY_CLASS_PATTERNS) {
    if (classString.includes(pattern)) {
      if (pattern === 'modal') {
        return { isOverlay: true, type: 'modal' };
      }
      if (pattern === 'tooltip') {
        return { isOverlay: true, type: 'tooltip' };
      }
      if (pattern === 'popover') {
        return { isOverlay: true, type: 'popover' };
      }
      if (pattern === 'dropdown' || pattern === 'select-menu' || pattern === 'cascader' || pattern === 'picker') {
        return { isOverlay: true, type: 'dropdown' };
      }
      if (pattern === 'menu') {
        return { isOverlay: true, type: 'menu' };
      }
      return { isOverlay: true, type: 'dropdown' };
    }
  }

  // Check Grafana-specific selectors
  for (const selector of GRAFANA_OVERLAY_SELECTORS) {
    try {
      if (element.matches(selector)) {
        if (selector.includes('modal')) {
          return { isOverlay: true, type: 'modal' };
        }
        if (selector.includes('menu')) {
          return { isOverlay: true, type: 'menu' };
        }
        return { isOverlay: true, type: 'dropdown' };
      }
    } catch {
      // Invalid selector, skip
    }
  }

  return { isOverlay: false, type: 'none' };
}

/**
 * Hook for auto-detecting dropdown/modal opens
 *
 * @example
 * ```typescript
 * const {
 *   hasOverlay,
 *   overlayType,
 *   triggerDetection,
 *   isClickInsideOverlay,
 * } = useMultistepDetector({
 *   isActive: fullScreenState === 'active',
 *   onOverlayDetected: (result) => {
 *     if (result.detected) {
 *       enterBundlingMode();
 *     }
 *   },
 *   onOverlayDismissed: () => {
 *     finishBundling();
 *   },
 * });
 * ```
 */
export function useMultistepDetector(options: UseMultistepDetectorOptions): UseMultistepDetectorReturn {
  const { isActive, detectionWindowMs = 500, onOverlayDetected, onOverlayDismissed } = options;

  const [hasOverlay, setHasOverlay] = useState(false);
  const [overlayType, setOverlayType] = useState<OverlayType>('none');
  const [overlayElement, setOverlayElement] = useState<HTMLElement | null>(null);

  const observerRef = useRef<MutationObserver | null>(null);
  const detectionTimeoutRef = useRef<number | null>(null);
  const isDetectingRef = useRef(false);

  // Refs for callbacks
  const onOverlayDetectedRef = useRef(onOverlayDetected);
  const onOverlayDismissedRef = useRef(onOverlayDismissed);

  useEffect(() => {
    onOverlayDetectedRef.current = onOverlayDetected;
  }, [onOverlayDetected]);

  useEffect(() => {
    onOverlayDismissedRef.current = onOverlayDismissed;
  }, [onOverlayDismissed]);

  // Check if a click is inside the current overlay
  const isClickInsideOverlay = useCallback(
    (element: HTMLElement): boolean => {
      if (!overlayElement) {
        return false;
      }
      return overlayElement.contains(element) || element === overlayElement;
    },
    [overlayElement]
  );

  // Reset detection state
  const resetDetection = useCallback(() => {
    setHasOverlay(false);
    setOverlayType('none');
    setOverlayElement(null);
    isDetectingRef.current = false;

    if (detectionTimeoutRef.current) {
      clearTimeout(detectionTimeoutRef.current);
      detectionTimeoutRef.current = null;
    }

    if (observerRef.current) {
      observerRef.current.disconnect();
    }
  }, []);

  // Trigger detection after a click
  const triggerDetection = useCallback(() => {
    if (!isActive) {
      return;
    }

    // Reset any previous detection
    resetDetection();
    isDetectingRef.current = true;

    // Set up MutationObserver to watch for new elements
    const observer = new MutationObserver((mutations) => {
      if (!isDetectingRef.current) {
        return;
      }

      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          for (const node of Array.from(mutation.addedNodes)) {
            if (!(node instanceof HTMLElement)) {
              continue;
            }

            // Check the node itself and its children
            const elementsToCheck = [node, ...Array.from(node.querySelectorAll('*'))];

            for (const element of elementsToCheck) {
              if (!(element instanceof HTMLElement)) {
                continue;
              }

              const result = isOverlayElement(element);
              if (result.isOverlay) {
                setHasOverlay(true);
                setOverlayType(result.type);
                setOverlayElement(element);
                isDetectingRef.current = false;

                // Notify callback
                if (onOverlayDetectedRef.current) {
                  onOverlayDetectedRef.current({
                    detected: true,
                    type: result.type,
                    element,
                  });
                }

                // Stop detection timeout
                if (detectionTimeoutRef.current) {
                  clearTimeout(detectionTimeoutRef.current);
                  detectionTimeoutRef.current = null;
                }

                return;
              }
            }
          }
        }
      }
    });

    // Observe the entire document for new elements
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    observerRef.current = observer;

    // Set timeout to stop detection after window
    detectionTimeoutRef.current = window.setTimeout(() => {
      isDetectingRef.current = false;
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    }, detectionWindowMs);
  }, [isActive, detectionWindowMs, resetDetection]);

  // Watch for overlay dismissal (element removed from DOM)
  useEffect(() => {
    if (!hasOverlay || !overlayElement) {
      return;
    }

    const dismissObserver = new MutationObserver(() => {
      // Check if overlay element is still in the DOM
      if (!document.body.contains(overlayElement)) {
        setHasOverlay(false);
        setOverlayType('none');
        setOverlayElement(null);

        if (onOverlayDismissedRef.current) {
          onOverlayDismissedRef.current();
        }

        dismissObserver.disconnect();
      }
    });

    dismissObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return () => {
      dismissObserver.disconnect();
    };
  }, [hasOverlay, overlayElement]);

  // Cleanup on unmount or when inactive
  useEffect(() => {
    if (!isActive) {
      // Defer reset to avoid synchronous setState in effect
      queueMicrotask(() => {
        resetDetection();
      });
    }

    return () => {
      resetDetection();
    };
  }, [isActive, resetDetection]);

  return useMemo(
    () => ({
      hasOverlay,
      overlayType,
      overlayElement,
      triggerDetection,
      resetDetection,
      isClickInsideOverlay,
    }),
    [hasOverlay, overlayType, overlayElement, triggerDetection, resetDetection, isClickInsideOverlay]
  );
}
