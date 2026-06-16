import { z } from 'zod';

import { StorageKeys } from '../storage-keys';
import { createUserStorage } from '../user-storage';

export interface ExperimentAutoOpenState {
  pagesAutoOpened: string[];
  globalAutoOpened: boolean;
}

const defaultState = (): ExperimentAutoOpenState => ({
  pagesAutoOpened: [],
  globalAutoOpened: false,
});

const ExperimentAutoOpenStateSchema = z.object({
  pagesAutoOpened: z.array(z.string()),
  globalAutoOpened: z.boolean(),
});

/**
 * Experiment auto-open storage operations
 *
 * Tracks whether the sidebar has been auto-opened for the experiment.
 * Persists across browsers via Grafana user storage (when available).
 *
 * This replaces sessionStorage-based tracking to ensure:
 * - State persists across browser sessions
 * - State syncs across devices (via Grafana user storage)
 * - State survives cookie/storage clears (if Grafana storage available)
 */
export const experimentAutoOpenStorage = {
  async get(): Promise<ExperimentAutoOpenState> {
    try {
      const storage = createUserStorage();
      const stored = await storage.getItem<unknown>(StorageKeys.EXPERIMENT_AUTO_OPEN);

      if (!stored) {
        return defaultState();
      }

      const parsed = ExperimentAutoOpenStateSchema.safeParse(stored);
      if (parsed.success) {
        return parsed.data;
      }

      console.warn('Experiment auto-open state validation failed, using defaults:', parsed.error.issues);
      return defaultState();
    } catch {
      return defaultState();
    }
  },

  async hasPageAutoOpened(pagePattern: string): Promise<boolean> {
    const state = await experimentAutoOpenStorage.get();
    return state.pagesAutoOpened.includes(pagePattern);
  },

  async markPageAutoOpened(pagePattern: string): Promise<void> {
    try {
      const storage = createUserStorage();
      const state = await experimentAutoOpenStorage.get();

      if (!state.pagesAutoOpened.includes(pagePattern)) {
        state.pagesAutoOpened.push(pagePattern);
        await storage.setItem(StorageKeys.EXPERIMENT_AUTO_OPEN, state);
      }
    } catch (error) {
      console.warn('Failed to mark page as auto-opened:', error);
    }
  },

  async hasGlobalAutoOpened(): Promise<boolean> {
    const state = await experimentAutoOpenStorage.get();
    return state.globalAutoOpened;
  },

  async markGlobalAutoOpened(): Promise<void> {
    try {
      const storage = createUserStorage();
      const state = await experimentAutoOpenStorage.get();
      state.globalAutoOpened = true;
      await storage.setItem(StorageKeys.EXPERIMENT_AUTO_OPEN, state);
    } catch (error) {
      console.warn('Failed to mark global auto-open:', error);
    }
  },

  /** Resets auto-open state (called when resetCache flag is toggled in GOFF) */
  async reset(): Promise<void> {
    try {
      const storage = createUserStorage();
      await storage.setItem(StorageKeys.EXPERIMENT_AUTO_OPEN, defaultState());
    } catch (error) {
      console.warn('Failed to reset experiment auto-open state:', error);
    }
  },

  async clear(): Promise<void> {
    try {
      const storage = createUserStorage();
      await storage.removeItem(StorageKeys.EXPERIMENT_AUTO_OPEN);
    } catch (error) {
      console.warn('Failed to clear experiment auto-open state:', error);
    }
  },
};
