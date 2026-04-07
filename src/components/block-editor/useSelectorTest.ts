/**
 * useSelectorTest hook
 *
 * Resolves a selector string against the current page and returns matched elements.
 */

import { useState, useCallback } from 'react';
import { querySelectorAllEnhanced } from '../../lib/dom/enhanced-selector';
import { resolveSelector } from '../../lib/dom/selector-resolver';
import { isCssSelector } from '../../lib/dom/selector-detector';
import { findButtonByText } from '../../lib/dom/dom-utils';

export interface SelectorTestResult {
  elements: HTMLElement[];
  matchCount: number;
}

export function useSelectorTest() {
  const [testResult, setTestResult] = useState<SelectorTestResult | null>(null);

  const testSelector = useCallback((selector: string, action: string) => {
    if (!selector.trim()) {
      setTestResult({ elements: [], matchCount: 0 });
      return;
    }

    try {
      const resolved = resolveSelector(selector);

      // For button actions on non-CSS strings, try button text matching first
      if (action === 'button' && !isCssSelector(resolved)) {
        const buttons = findButtonByText(resolved);
        if (buttons.length > 0) {
          setTestResult({ elements: buttons, matchCount: buttons.length });
          return;
        }
      }

      const result = querySelectorAllEnhanced(resolved);
      setTestResult({ elements: result.elements, matchCount: result.elements.length });
    } catch {
      setTestResult({ elements: [], matchCount: 0 });
    }
  }, []);

  const clearTest = useCallback(() => setTestResult(null), []);

  return { testSelector, testResult, clearTest };
}
