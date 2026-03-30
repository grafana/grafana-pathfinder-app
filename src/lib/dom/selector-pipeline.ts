/**
 * Selector Pipeline
 * Unified strategy escalation pipeline that chains all resolution strategies
 * with confidence scoring.
 *
 * Stage 1: Exact match (confidence 1.0)
 * Stage 2: Wait + retry with exponential backoff (confidence 0.95)
 * Stage 3: Try each fallback selector from reftargetFallbacks (confidence 0.6)
 *
 * Note: prefix matching and combinator relaxation are already handled internally
 * by querySelectorAllEnhanced/handleTestIdSelector, so they fire automatically
 * during Stage 1 and Stage 2.
 */

import { resolveSelector } from './selector-resolver';
import { querySelectorAllEnhanced, type SelectorResult } from './enhanced-selector';
import { findButtonByText } from './dom-utils';
import { isCssSelector } from './selector-detector';

export interface PipelineConfig {
  reftarget: string;
  action?: string;
  fallbacks?: string[];
  delays?: number[];
}

export interface PipelineResult {
  element: HTMLElement;
  elements: HTMLElement[];
  resolvedSelector: string;
  strategy: 'exact' | 'retry' | 'fallback';
  confidence: number;
  retryCount: number;
}

/**
 * Unified selector resolution pipeline with strategy escalation.
 *
 * Stage 1: Exact match (confidence 1.0)
 * Stage 2: Wait + retry with exponential backoff (confidence 0.95)
 * Stage 3: Try each fallback selector from reftargetFallbacks (confidence 0.6)
 *
 * Note: prefix matching and combinator relaxation are already handled internally
 * by querySelectorAllEnhanced/handleTestIdSelector, so they fire automatically
 * during Stage 1 and Stage 2.
 */
export async function resolveSelectorPipeline(config: PipelineConfig): Promise<PipelineResult | null> {
  const { reftarget, action, fallbacks, delays = [200, 600, 1800] } = config;
  const effectiveAction = action ?? 'highlight';

  // Resolve any prefixes (grafana:, panel:, etc.)
  const resolvedSelector = resolveSelector(reftarget);

  // Determine if this is a button-text lookup (plain text, not CSS selector, not prefixed)
  const isButtonText =
    effectiveAction === 'button' &&
    !isCssSelector(reftarget) &&
    !reftarget.startsWith('grafana:') &&
    !reftarget.startsWith('panel:');

  // Stage 1: Exact match (confidence 1.0)
  const exactResult = attemptResolve(resolvedSelector, isButtonText);
  if (exactResult) {
    return {
      element: exactResult.element,
      elements: exactResult.elements,
      resolvedSelector: exactResult.resolvedSelector,
      strategy: 'exact',
      confidence: 1.0,
      retryCount: 0,
    };
  }

  // Stage 2: Retry with exponential backoff (confidence 0.95)
  for (let i = 0; i < delays.length; i++) {
    await sleep(delays[i]!);

    // On retry 2+ (i >= 1), also try relaxing child combinators
    const shouldRelax = i >= 1 && !isButtonText && resolvedSelector.includes('>');

    // Try original selector
    const result = attemptResolve(resolvedSelector, isButtonText);
    if (result) {
      return {
        element: result.element,
        elements: result.elements,
        resolvedSelector: result.resolvedSelector,
        strategy: 'retry',
        confidence: 0.95,
        retryCount: i + 1,
      };
    }

    // Try relaxed selector (replace child combinators with descendant)
    if (shouldRelax) {
      const relaxedSelector = resolvedSelector.replace(/\s*>\s*/g, ' ');
      const relaxedResult = attemptResolve(relaxedSelector, false);
      if (relaxedResult) {
        return {
          element: relaxedResult.element,
          elements: relaxedResult.elements,
          resolvedSelector: relaxedResult.resolvedSelector,
          strategy: 'retry',
          confidence: 0.95,
          retryCount: i + 1,
        };
      }
    }
  }

  // Stage 3: Fallback selectors (confidence 0.6)
  if (fallbacks && fallbacks.length > 0) {
    for (const fallback of fallbacks) {
      const fallbackResolved = resolveSelector(fallback);
      const fallbackResult = attemptResolve(fallbackResolved, false);
      if (fallbackResult) {
        console.warn('[Pathfinder] Primary selector failed, used fallback', {
          original: reftarget,
          fallback,
          strategy: 'fallback',
        });
        return {
          element: fallbackResult.element,
          elements: fallbackResult.elements,
          resolvedSelector: fallbackResult.resolvedSelector,
          strategy: 'fallback',
          confidence: 0.6,
          retryCount: delays.length,
        };
      }
    }
  }

  // All strategies exhausted
  return null;
}

interface AttemptResult {
  element: HTMLElement;
  elements: HTMLElement[];
  resolvedSelector: string;
}

/**
 * Single attempt to resolve elements from a selector or button text.
 */
function attemptResolve(selector: string, isButtonText: boolean): AttemptResult | null {
  if (isButtonText) {
    const buttons = findButtonByText(selector);
    if (buttons.length > 0) {
      return {
        element: buttons[0]!,
        elements: buttons,
        resolvedSelector: selector,
      };
    }
    return null;
  }

  const result: SelectorResult = querySelectorAllEnhanced(selector);
  if (result.elements.length > 0) {
    return {
      element: result.elements[0]!,
      elements: result.elements,
      resolvedSelector: result.effectiveSelector ?? selector,
    };
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
