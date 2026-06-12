export const StorageEvents = {
  LearningProgressUpdated: 'learning-progress-updated',
  GuideResponseChanged: 'guide-response-changed',
} as const;

export type StorageEventName = (typeof StorageEvents)[keyof typeof StorageEvents];
