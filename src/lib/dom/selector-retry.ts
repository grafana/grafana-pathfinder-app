/**
 * Selector Retry Utility
 * Wraps selector resolution with exponential backoff retry for resilience
 * against timing issues (lazy rendering, async React updates, animations).
 *
 * Now delegates to the unified resolveSelectorPipeline for all resolution logic.
 */

import { resolveSelectorPipeline } from './selector-pipeline';

export interface RetryConfig {
  delays: number[];
  relaxOnRetry: boolean;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  delays: [200, 600, 1800],
  relaxOnRetry: true,
};

export interface ResolvedElement {
  element: HTMLElement;
  elements: HTMLElement[];
  resolvedSelector: string;
  usedFallback: boolean;
  retryCount: number;
}

/**
 * Resolve a selector with exponential backoff retry.
 *
 * 1. Resolves `grafana:` and `panel:` prefixes via `resolveSelector()`
 * 2. For 'button' action with plain text (not CSS): uses `findButtonByText()`
 * 3. For everything else: uses `querySelectorAllEnhanced()`
 * 4. If zero matches, sleeps for `delays[i]` then retries
 * 5. On retry 2+ with `relaxOnRetry`: relaxes child combinators (`>` -> space)
 * 6. After all strategies exhausted, returns null
 *
 * @param reftarget - The selector or button text to resolve
 * @param action - The action type (e.g. 'button', 'highlight', 'formfill'). Defaults to 'highlight'.
 * @param config - Retry configuration. Defaults to DEFAULT_RETRY_CONFIG.
 * @returns ResolvedElement on success, null if element not found after all retries
 */
export async function resolveWithRetry(
  reftarget: string,
  action?: string,
  config?: Partial<RetryConfig>
): Promise<ResolvedElement | null> {
  const mergedConfig = { ...DEFAULT_RETRY_CONFIG, ...config };

  const pipelineResult = await resolveSelectorPipeline({
    reftarget,
    action,
    delays: mergedConfig.delays,
    relaxOnRetry: mergedConfig.relaxOnRetry,
  });

  if (!pipelineResult) {
    return null;
  }

  return {
    element: pipelineResult.element,
    elements: pipelineResult.elements,
    resolvedSelector: pipelineResult.resolvedSelector,
    usedFallback: pipelineResult.strategy !== 'exact',
    retryCount: pipelineResult.retryCount,
  };
}
