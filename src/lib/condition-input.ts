import type { ConditionInput } from '../types/requirements.types';

export function conditionTokens(input: ConditionInput | undefined): string[] {
  return (typeof input === 'string' ? input.split(',') : (input ?? [])).map((token) => token.trim()).filter(Boolean);
}

export function conditionLabel(input: ConditionInput | undefined): string {
  return conditionTokens(input).join(',');
}

export function isConditionInput(value: unknown): value is ConditionInput {
  return typeof value === 'string' || (Array.isArray(value) && value.every((token) => typeof token === 'string'));
}

// Match per token, never by substring: `includes` on the array form is an
// exact-element test, so `['on-page:/x'].includes('on-page:')` is false.
export function hasConditionToken(input: ConditionInput | undefined, token: string): boolean {
  return conditionTokens(input).includes(token);
}

export function hasConditionPrefix(input: ConditionInput | undefined, prefix: string): boolean {
  return conditionTokens(input).some((token) => token.startsWith(prefix));
}
