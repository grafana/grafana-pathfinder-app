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
        action: parts[0],
        selector: parts[1],
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
