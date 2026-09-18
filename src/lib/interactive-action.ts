import { INTERACTIVE_ACTION_TYPES, type InteractiveActionType } from '../types/interactive.types';

const INTERACTIVE_ACTION_TYPE_SET: ReadonlySet<string> = new Set(INTERACTIVE_ACTION_TYPES);

export function isInteractiveActionType(value: string): value is InteractiveActionType {
  return INTERACTIVE_ACTION_TYPE_SET.has(value);
}
