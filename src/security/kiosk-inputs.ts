import type { KioskInput } from '../types/kiosk-page.schema';
import {
  isSafeResponseName,
  KioskFormError,
  MAX_INPUT_LENGTH,
  normalizeHttpOrigin,
  normalizeHttpUrl,
} from '../lib/input-value';

export function validateKioskValues(inputs: KioskInput[], values: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const input of inputs) {
    const value = Object.hasOwn(values, input.variableName) ? values[input.variableName]! : '';
    if (
      !isSafeResponseName(input.variableName) ||
      value.length > MAX_INPUT_LENGTH ||
      /[\x00-\x1f\x7f]/.test(input.format ? value.trim() : value)
    ) {
      throw new KioskFormError('An input contains unsupported characters or is too long');
    }
    if (input.required && !value.trim()) {
      throw new KioskFormError('Complete the required fields');
    }
    if (!value) {
      continue;
    }
    const normalized =
      input.format === 'http-origin'
        ? normalizeHttpOrigin(value)
        : input.format === 'http-url'
          ? normalizeHttpUrl(value)
          : value;
    if (normalized === null) {
      throw new KioskFormError(
        'Enter a website address, such as example.com or https://example.com/shop, without embedded credentials'
      );
    }
    result[input.variableName] = normalized;
  }
  return result;
}
