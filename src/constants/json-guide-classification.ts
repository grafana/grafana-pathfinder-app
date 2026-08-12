import type { JsonBlock } from '../types/json-guide.types';

export const INTERACTIVE_BLOCK_TYPES = [
  'interactive',
  'multistep',
  'guided',
  'quiz',
  'input',
  'terminal',
  'terminal-connect',
  'code-block',
  'challenge',
  'data-check',
  'grot-guide',
] as const satisfies ReadonlyArray<JsonBlock['type']>;

export type InteractiveBlockType = (typeof INTERACTIVE_BLOCK_TYPES)[number];

const INTERACTIVE_BLOCK_TYPE_SET: ReadonlySet<string> = new Set(INTERACTIVE_BLOCK_TYPES);

export function isInteractiveBlockType(type: unknown): type is InteractiveBlockType {
  return typeof type === 'string' && INTERACTIVE_BLOCK_TYPE_SET.has(type);
}
