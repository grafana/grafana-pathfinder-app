import content from '../bundled-interactives/create-your-first-guide/content.json';
import manifest from '../bundled-interactives/create-your-first-guide/manifest.json';
import { COMPANION_GUIDE_CHANGE_EVENT } from '../lib/event-names';
import type { LearningJourneyTab } from '../types/content-panel.types';

let guide: LearningJourneyTab | null = null;

export function openAuthoringGuide(): void {
  const url = 'bundled:create-your-first-guide/content.json';
  guide = {
    id: 'authoring-instructions',
    type: 'interactive',
    title: content.title,
    baseUrl: url,
    currentUrl: url,
    isLoading: false,
    error: null,
    content: {
      content: JSON.stringify(content),
      type: 'interactive',
      url,
      metadata: { title: content.title, packageManifest: manifest },
      lastFetched: new Date().toISOString(),
      isNativeJson: true,
    },
  };
  document.dispatchEvent(new CustomEvent(COMPANION_GUIDE_CHANGE_EVENT, { detail: { open: true } }));
}

export function closeCompanionGuide(): void {
  if (!guide) {
    return;
  }
  guide = null;
  document.dispatchEvent(new CustomEvent(COMPANION_GUIDE_CHANGE_EVENT, { detail: { open: false } }));
}

export function getCompanionGuide(): LearningJourneyTab | null {
  return guide;
}

export function subscribeCompanionGuide(listener: () => void): () => void {
  document.addEventListener(COMPANION_GUIDE_CHANGE_EVENT, listener);
  return () => document.removeEventListener(COMPANION_GUIDE_CHANGE_EVENT, listener);
}
