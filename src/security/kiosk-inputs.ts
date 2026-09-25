import type { KioskInput } from '../types/kiosk-page.schema';
import { isSafeResponseName, MAX_INPUT_LENGTH, normalizeHttpOrigin } from '../lib/input-value';

export function validateKioskValues(inputs: KioskInput[], values: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const input of inputs) {
    const value = Object.hasOwn(values, input.variableName) ? values[input.variableName]! : '';
    if (!isSafeResponseName(input.variableName) || value.length > MAX_INPUT_LENGTH || /[\x00-\x1f\x7f]/.test(value)) {
      throw new Error('An input contains unsupported characters or is too long');
    }
    if (input.required && !value.trim()) {
      throw new Error('Complete the required fields');
    }
    if (!value) {
      continue;
    }
    const normalized = input.format === 'http-origin' ? normalizeHttpOrigin(value) : value;
    if (normalized === null) {
      throw new Error('Enter an HTTP(S) origin without a path, credentials, query, or fragment');
    }
    result[input.variableName] = normalized;
  }
  return result;
}
