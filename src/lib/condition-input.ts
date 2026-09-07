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
