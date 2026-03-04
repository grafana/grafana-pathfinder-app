/**
 * Global state manager for external app suggestions.
 *
 * Persists suggestions in sessionStorage so they survive page navigation
 * but are cleared when the browser session ends. Dispatches a DOM event
 * when suggestions change so the context hook can react synchronously.
 */

import { StorageKeys } from '../lib/storage-keys';
import type { Recommendation } from '../types/context.types';

export const SUGGESTIONS_UPDATED_EVENT = 'pathfinder-suggestions-updated';

class GlobalSuggestionState {
  public setSuggestions(suggestions: Recommendation[]): void {
    try {
      sessionStorage.setItem(StorageKeys.SUGGESTIONS, JSON.stringify(suggestions));
    } catch {
      console.warn('[Pathfinder] Failed to persist suggestions to sessionStorage');
    }

    document.dispatchEvent(new CustomEvent(SUGGESTIONS_UPDATED_EVENT));
  }

  public getSuggestions(): Recommendation[] {
    try {
      const raw = sessionStorage.getItem(StorageKeys.SUGGESTIONS);
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  public clearSuggestions(): void {
    sessionStorage.removeItem(StorageKeys.SUGGESTIONS);
    document.dispatchEvent(new CustomEvent(SUGGESTIONS_UPDATED_EVENT));
  }
}

export const suggestionState = new GlobalSuggestionState();
