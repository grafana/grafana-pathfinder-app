/**
 * Window CustomEvent names dispatched by storage helpers and consumed by hooks.
 *
 * Centralized here so producers and listeners reference the same constant and
 * TypeScript catches typos in either direction. Kept separate from `storage-keys.ts`
 * so it can be imported by code paths that don't otherwise depend on storage.
 */
export const StorageEvents = {
  /** Dispatched by `learningProgressStorage` whenever progress, badges, or completed guides change. */
  LearningProgressUpdated: 'learning-progress-updated',
  /** Dispatched by `guideResponseStorage` when an input-block response is set/cleared. */
  GuideResponseChanged: 'guide-response-changed',
} as const;

export type StorageEventName = (typeof StorageEvents)[keyof typeof StorageEvents];
