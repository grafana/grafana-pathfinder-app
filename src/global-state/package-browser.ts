import { EMPTY_CATALOG_VIEW, type CatalogViewState } from '../types/package-catalog.types';

let activeScope = '';
let view = EMPTY_CATALOG_VIEW;
const listeners = new Set<() => void>();
let pendingActivation: { scope: string; id: number } | null = null;
let activationSequence = 0;

export function requestCatalogActivation(scope: string): void {
  pendingActivation = { scope, id: ++activationSequence };
}

export function getCatalogActivation(scope: string): number | null {
  if (pendingActivation && pendingActivation.scope !== scope) {
    pendingActivation = null;
  }
  return pendingActivation?.id ?? null;
}

export function consumeCatalogActivation(scope: string, id: number): boolean {
  if (getCatalogActivation(scope) !== id) {
    return false;
  }
  pendingActivation = null;
  return true;
}

export function cancelCatalogActivation(): void {
  pendingActivation = null;
}

export function getCatalogView(scope: string): CatalogViewState {
  return scope === activeScope ? view : EMPTY_CATALOG_VIEW;
}

export function updateCatalogView(scope: string, patch: Partial<CatalogViewState>, notify = true): void {
  view = { ...getCatalogView(scope), ...patch };
  activeScope = scope;
  if (notify) {
    listeners.forEach((listener) => listener());
  }
}

export function subscribeCatalogView(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
