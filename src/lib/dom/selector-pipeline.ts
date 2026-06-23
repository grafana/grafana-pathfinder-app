/**
 * Selector Pipeline
 * Unified strategy escalation pipeline that chains all resolution strategies
 * with confidence scoring.
 *
 * Stage 1: Exact match (confidence 1.0)
 * Stage 2: Wait + retry with exponential backoff (confidence 0.95)
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
  reftarget: string | string[];
  action?: string;
  delays?: number[];
  relaxOnRetry?: boolean;
}

export interface PipelineResult {
  element: HTMLElement;
  elements: HTMLElement[];
  resolvedSelector: string;
  strategy: 'exact' | 'retry';
  confidence: number;
  retryCount: number;
  /** Index of the candidate that resolved; 0 is the primary (strongest) selector. */
  selectedIndex: number;
}

/**
 * Unified selector resolution pipeline with strategy escalation and an ordered
 * fallback chain.
 *
 * `reftarget` may be a single selector or an ordered array (strongest first).
 * Resolution is selector-major: each candidate runs the complete exact + retry
 * pipeline (its full retry budget) before the next candidate is tried, so the
 * primary is never skipped in favor of a weaker selector.
 *
 * Per candidate — Stage 1: exact match (confidence 1.0); Stage 2: wait + retry
 * with exponential backoff (confidence 0.95). Prefix matching and combinator
 * relaxation are handled internally by querySelectorAllEnhanced, so they fire
 * automatically during both stages.
 */
export async function resolveSelectorPipeline(config: PipelineConfig): Promise<PipelineResult | null> {
  const { reftarget, action, delays = [200, 600, 1800], relaxOnRetry = true } = config;
  const candidates = (Array.isArray(reftarget) ? reftarget : [reftarget]).map((s) => s.trim()).filter(Boolean);
  if (candidates.length === 0) {
    return null;
  }

  const effectiveAction = action ?? 'highlight';

  for (let index = 0; index < candidates.length; index++) {
    const result = await resolveSingleCandidate(candidates[index]!, effectiveAction, delays, relaxOnRetry);
    if (result) {
      if (index > 0) {
        console.log(`[SelectorFallback] resolved via fallback selector #${index}: ${candidates[index]}`);
      }
      return { ...result, selectedIndex: index };
    }
  }

  return null;
}

/**
 * Resolve a single selector through the full exact + retry pipeline.
 * Returns the result without a `selectedIndex` (the caller stamps it).
 */
async function resolveSingleCandidate(
  reftarget: string,
  effectiveAction: string,
  delays: number[],
  relaxOnRetry: boolean
): Promise<Omit<PipelineResult, 'selectedIndex'> | null> {
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

    // On retry 2+ (i >= 1), optionally relax child combinators
    const shouldRelax = relaxOnRetry && i >= 1 && !isButtonText && resolvedSelector.includes('>');

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

  // All strategies exhausted for this candidate
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
