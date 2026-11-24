import { COMPANION_GUIDE_CHANGE_EVENT } from '../lib/event-names';
import type { LearningJourneyTab } from '../types/content-panel.types';

let guide: LearningJourneyTab | null = null;

export function canOpenCompanionGuide(tab: LearningJourneyTab | null | undefined): tab is LearningJourneyTab {
  return Boolean(
    tab &&
    (tab.type === 'docs' || tab.type === 'interactive' || tab.type === 'learning-journey') &&
    tab.content &&
    !tab.isLoading &&
    !tab.error
  );
}

export function openCompanionGuide(tab: LearningJourneyTab): void {
  if (!canOpenCompanionGuide(tab)) {
    return;
  }
  guide = { ...tab };
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
