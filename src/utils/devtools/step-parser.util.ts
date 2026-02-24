/**
 * Step parsing utilities for dev tools
 * Handles conversion between string format and StepDefinition objects
 */

import type { StepDefinition } from './dev-tools.types';

/**
 * Parse step string format (action|selector|value) into StepDefinition array
 *
 * @param input - Multi-line string with steps in format: action|selector|value
 * @returns Array of parsed step definitions
 *
 * @example
 * ```typescript
 * const steps = parseStepString('highlight|button[data-testid="save"]|\nformfill|input[name="query"]|prometheus');
 * // Returns: [
 * //   { action: 'highlight', selector: 'button[data-testid="save"]', value: undefined },
 * //   { action: 'formfill', selector: 'input[name="query"]', value: 'prometheus' }
 * // ]
 * ```
 */
export function parseStepString(input: string): StepDefinition[] {
  const lines = input.split('\n').filter((line) => line.trim());
  const steps: StepDefinition[] = [];

  for (const line of lines) {
    const parts = line.split('|').map((p) => p.trim());
    if (parts.length >= 2) {
      steps.push({
        action: parts[0]!,
        selector: parts[1]!,
        value: parts[2] || undefined,
      });
    }
  }

  return steps;
}

/**
 * Format StepDefinition array back to string format
 *
 * @param steps - Array of step definitions
 * @returns Multi-line string in format: action|selector|value
 *
 * @example
 * ```typescript
 * const steps = [
 *   { action: 'highlight', selector: 'button[data-testid="save"]' },
 *   { action: 'formfill', selector: 'input[name="query"]', value: 'prometheus' }
 * ];
 * const str = formatStepsToString(steps);
 * // Returns: 'highlight|button[data-testid="save"]|\nformfill|input[name="query"]|prometheus'
 * ```
 */
export function formatStepsToString(steps: StepDefinition[]): string {
  return steps
    .map((step) => {
      const valuePart = step.value ? `|${step.value}` : '|';
      return `${step.action}|${step.selector}${valuePart}`;
    })
    .join('\n');
}

/**
 * Extract CSS selector from step format or plain selector
 *
 * Intelligently extracts the selector portion from either:
 * - Step format: `action|selector|value` → returns `selector`
 * - Plain selector: `button[data-testid="save"]` → returns as-is
 *
 * This allows Simple Selector Tester to accept copy/pasted step sequences
 * from Multistep Debug without requiring manual reformatting.
 *
 * @param input - Either a step format string or plain CSS selector
 * @returns The extracted CSS selector
 *
 * @example
 * ```typescript
 * // Step format - extracts selector
 * extractSelector('highlight|a[href="/alerting"]|');
 * // Returns: 'a[href="/alerting"]'
 *
 * // Plain selector - returns as-is
 * extractSelector('button[data-testid="save"]');
 * // Returns: 'button[data-testid="save"]'
 *
 * // Empty or whitespace - returns empty string
 * extractSelector('   ');
 * // Returns: ''
 *
 * // Malformed step (missing selector) - returns empty string
 * extractSelector('highlight|');
 * // Returns: ''
 * ```
 */
export function extractSelector(input: string): string {
  const trimmed = input.trim();

  if (!trimmed) {
    return '';
  }

  // Check if input contains pipe character (step format)
  if (trimmed.includes('|')) {
    const parts = trimmed.split('|').map((p) => p.trim());

    // Step format requires at least 2 parts: action|selector
    // parts[0] = action, parts[1] = selector, parts[2] = optional value
    if (parts.length >= 2 && parts[1]) {
      return parts[1];
    }

    // Malformed step format (e.g., "highlight|" with no selector)
    return '';
  }

  // Plain selector - return as-is
  return trimmed;
}
