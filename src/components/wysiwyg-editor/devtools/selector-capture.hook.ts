/**
 * Hook for capturing CSS selectors from user clicks (Watch Mode)
 */

import { useState, useCallback, useEffect } from 'react';
import { generateSelectorFromEvent } from './selector-generator.util';
import type { SelectorInfo } from './dev-tools.types';
import { useElementInspector } from './element-inspector.hook';

export interface UseSelectorCaptureOptions {
  excludeSelectors?: string[];
  onCapture?: (selector: string, info: SelectorInfo) => void;
  autoDisable?: boolean;
  enableInspector?: boolean;
}

export interface UseSelectorCaptureReturn {
  isActive: boolean;
  capturedSelector: string | null;
  selectorInfo: SelectorInfo | null;
  startCapture: () => void;
  stopCapture: () => void;
  // Inspector data for tooltip rendering
  hoveredElement: HTMLElement | null;
  domPath: string | null;
  cursorPosition: { x: number; y: number } | null;
}

/**
 * Hook for capturing selectors from clicks (Watch Mode)
 *
 * @param options - Configuration options
 * @param options.excludeSelectors - CSS selectors for elements to ignore (default: debug panel selectors)
 * @param options.onCapture - Callback when selector is captured
 * @param options.autoDisable - Whether to auto-disable after capture (default: true)
 * @returns Object with capture state and control functions
 *
 * @example
 * ```typescript
 * const { isActive, capturedSelector, startCapture, stopCapture } = useSelectorCapture({
 *   excludeSelectors: ['.my-container'],
 *   onCapture: (selector, info) => console.log('Captured:', selector),
 *   autoDisable: true
 * });
 *
 * // Start capturing
 * startCapture();
 * ```
 */
// Default exclude selectors - defined outside to prevent recreation
const DEFAULT_EXCLUDE_SELECTORS = ['[class*="debug"]', '.context-container', '[data-devtools-panel]'];

export function useSelectorCapture(options: UseSelectorCaptureOptions = {}): UseSelectorCaptureReturn {
  const {
    excludeSelectors = DEFAULT_EXCLUDE_SELECTORS,
    onCapture,
    autoDisable = true,
    enableInspector = true,
  } = options;

  const [isActive, setIsActive] = useState(false);
  const [capturedSelector, setCapturedSelector] = useState<string | null>(null);
  const [selectorInfo, setSelectorInfo] = useState<SelectorInfo | null>(null);

  // Element inspector for hover highlighting and DOM path display
  const { hoveredElement, domPath, cursorPosition } = useElementInspector({
    isActive: isActive && enableInspector,
    excludeSelectors,
  });

  const stopCapture = useCallback(() => {
    setIsActive(false);
    setCapturedSelector(null);
    setSelectorInfo(null);
  }, []);

  const startCapture = useCallback(() => {
    setIsActive(true);
    setCapturedSelector(null);
    setSelectorInfo(null);
  }, []);

  // Watch Mode click listener
  useEffect(() => {
    if (!isActive) {
      return;
    }

    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;

      // Don't capture clicks within excluded selectors
      const shouldExclude = excludeSelectors.some((selector) => target.closest(selector));
      if (shouldExclude) {
        return;
      }

      // DON'T preventDefault - let the click proceed normally!
      // Just capture the selector and let navigation/actions happen
      //
      // ⚠️ LIMITATION: Clicking navigation links or submit buttons during capture
      // will cause page navigation. The captured selector is stored in React state
      // only and will be lost on navigation. Users should copy/use the selector
      // immediately after capture, or avoid navigating while capturing.

      // Generate selector using shared utility
      const result = generateSelectorFromEvent(target, event);

      if (result.warnings.length > 0) {
        console.warn('Watch mode selector validation warnings:', result.warnings);
      }

      const selectorInfoData: SelectorInfo = result.selectorInfo;
      const selector = result.selector;

      setCapturedSelector(selector);
      setSelectorInfo(selectorInfoData);

      // Call callback if provided
      if (onCapture) {
        onCapture(selector, selectorInfoData);
      }

      // Auto-disable watch mode after capturing to preserve the selector
      if (autoDisable) {
        setIsActive(false);
      }
    };

    // Use capture phase but don't prevent default
    document.addEventListener('click', handleClick, true);
    return () => {
      document.removeEventListener('click', handleClick, true);
    };
  }, [isActive, excludeSelectors, onCapture, autoDisable]);

  return {
    isActive,
    capturedSelector,
    selectorInfo,
    startCapture,
    stopCapture,
    // Inspector data
    hoveredElement,
    domPath,
    cursorPosition,
  };
}
