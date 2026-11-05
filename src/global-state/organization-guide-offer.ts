import type { PreparedRawContent } from '../types/content.types';

export interface OrganizationGuideOffer {
  url: string;
  title: string;
  content: PreparedRawContent;
  canLaunch: () => boolean;
  rendered: () => void;
}

let pending: OrganizationGuideOffer | null = null;
let active: { offer: OrganizationGuideOffer; tabId: string } | null = null;
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) {
    listener();
  }
};

export function offerOrganizationGuide(offer: OrganizationGuideOffer | null): void {
  pending = offer;
  notify();
}

export function takeOrganizationGuideOffer(): OrganizationGuideOffer | null {
  const offer = pending;
  pending = null;
  return offer;
}

export function subscribeOrganizationGuideOffer(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function activateOrganizationGuideOffer(offer: OrganizationGuideOffer, tabId: string): void {
  active = { offer, tabId };
}

export function organizationGuideRendered(tabId: string): void {
  if (active?.tabId === tabId && document.visibilityState === 'visible') {
    active.offer.rendered();
  }
}

export function isOrganizationGuideIntroduction(tabId: string): boolean {
  return active?.tabId === tabId;
}
