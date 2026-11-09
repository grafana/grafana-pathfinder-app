import type { ContextData } from '../types/context.types';

export const RECOMMENDATION_CONTEXT_FIELDS = [
  'currentPath',
  'tags',
  'platform',
  'dataSources',
] as const satisfies ReadonlyArray<keyof ContextData>;

export function recommendationsInputKey(data: ContextData): string {
  return JSON.stringify(
    RECOMMENDATION_CONTEXT_FIELDS.map((field) =>
      field === 'dataSources' ? [...new Set(data.dataSources.map((ds) => ds.type))].sort() : data[field]
    )
  );
}
