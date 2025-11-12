/**
 * Hook for capturing CSS selectors from user clicks (Watch Mode)
 */

import { useState, useCallback, useEffect } from 'react';
import { generateSelectorFromEvent } from './selector-generator.util';
import type { SelectorInfo } from './dev-tools.types';

export interface UseSelectorCaptureOptions {
  excludeSelectors?: string[];
  onCapture?: (selector: string, info: SelectorInfo) => void;
  autoDisable?: boolean;
}

export interface UseSelectorCaptureReturn {
  isActive: boolean;
  capturedSelector: string | null;
  selectorInfo: SelectorInfo | null;
  startCapture: () => void;
  stopCapture: () => void;
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
export function useSelectorCapture(options: UseSelectorCaptureOptions = {}): UseSelectorCaptureReturn {
  const { excludeSelectors = ['[class*="debug"]', '.context-container'], onCapture, autoDisable = true } = options;

  const [isActive, setIsActive] = useState(false);
  const [capturedSelector, setCapturedSelector] = useState<string | null>(null);
  const [selectorInfo, setSelectorInfo] = useState<SelectorInfo | null>(null);

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
  };
}
