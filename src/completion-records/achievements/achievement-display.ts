import { logger } from '../../lib/logging';
import { isInteractiveLearningUrl, parseUrlSafely } from '../../security/url-validator';
import type { AchievementEventsResponseWire } from '../../types/backend-api.schema';
import { currentCompletionQueueOwnerKey } from '../completion-write-storage';

import {
  selectAnnouncements,
  type AchievementAnnouncement,
  type HeldTier,
  type AchievementDefinitions,
} from './achievement-announcements';
import { fetchAchievementDefinitions, fetchMyAchievements, type MyAchievementsResult } from './achievements-client';

export interface AnnouncementChannel {
  post(announcement: AchievementAnnouncement): void;
  subscribe(listener: (message: unknown) => void): () => void;
}

export interface DisplayDeps {
  fetchDefinitions: typeof fetchAchievementDefinitions;
  fetchMy: typeof fetchMyAchievements;
  isVisible: () => boolean;
  openChannel: () => AnnouncementChannel | null;
}

function openBroadcastChannel(): AnnouncementChannel | null {
  const owner = currentCompletionQueueOwnerKey();
  if (!owner || typeof BroadcastChannel !== 'function') {
    return null;
  }
  const channel = new BroadcastChannel(`pathfinder-achievements:${owner}`);
  return {
    post: (announcement) => channel.postMessage(announcement),
    subscribe: (listener) => {
      const onMessage = (event: MessageEvent) => listener(event.data);
      channel.addEventListener('message', onMessage);
      return () => channel.removeEventListener('message', onMessage);
    },
  };
}

const defaultDeps: DisplayDeps = {
  fetchDefinitions: fetchAchievementDefinitions,
  fetchMy: fetchMyAchievements,
  isVisible: () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  openChannel: openBroadcastChannel,
};
let deps = defaultDeps;
let channel: AnnouncementChannel | null | undefined;
let unsubscribeChannel: (() => void) | null = null;

let definitions: AchievementDefinitions | null = null;
let definitionsInflight: Promise<AchievementDefinitions | null> | null = null;
let held: HeldTier[] = [];
const announced = new Set<string>();
const announcementListeners = new Set<(announcement: AchievementAnnouncement) => void>();
const changeListeners = new Set<() => void>();

export type AchievementsAvailability = 'unknown' | 'available' | 'unavailable';
let availability: AchievementsAvailability = 'unknown';
let availabilityProbe: Promise<unknown> | null = null;
const availabilityListeners = new Set<() => void>();

/** `/definitions` is cached in memory per page and refetched when a caller knows of a different version. */
export function loadAchievementDefinitions(wantedVersion?: string): Promise<AchievementDefinitions | null> {
  if (definitions && (wantedVersion === undefined || definitions.version === wantedVersion)) {
    return Promise.resolve(definitions);
  }
  if (!definitionsInflight) {
    const request = deps
      .fetchDefinitions()
      .then((fetched) => {
        if (fetched) {
          definitions = fetched;
        }
        return definitions;
      })
      .finally(() => {
        if (definitionsInflight === request) {
          definitionsInflight = null;
        }
      });
    definitionsInflight = request;
  }
  return definitionsInflight;
}

export async function loadMyAchievements(): Promise<MyAchievementsResult> {
  const result = await deps.fetchMy();
  if (result.kind === 'ok') {
    held = result.data.awards;
  }
  // Available is kept for the page once seen, so a later transient failure does not bring the legacy badges back.
  const next = result.kind === 'ok' ? 'available' : 'unavailable';
  if (availability === 'unknown' || next === 'available') {
    setAvailability(next);
  }
  return result;
}

function setAvailability(next: AchievementsAvailability): void {
  if (next !== availability) {
    availability = next;
    notify(availabilityListeners, undefined);
  }
}

export function achievementsAvailability(): AchievementsAvailability {
  return availability;
}

/** Reads `/my` once per page when nothing has yet. */
export function probeAchievementsAvailability(): void {
  if (availability === 'unknown' && !availabilityProbe) {
    availabilityProbe = loadMyAchievements().catch(() => setAvailability('unavailable'));
  }
}

export function onAchievementsAvailabilityChanged(listener: () => void): () => void {
  availabilityListeners.add(listener);
  return () => {
    availabilityListeners.delete(listener);
  };
}

function announcementChannel(): AnnouncementChannel | null {
  if (channel === undefined) {
    try {
      channel = deps.openChannel();
    } catch {
      channel = null;
    }
  }
  return channel;
}

export function onAchievementAnnounced(listener: (announcement: AchievementAnnouncement) => void): () => void {
  unsubscribeChannel ??= announcementChannel()?.subscribe(receiveRelayed) ?? null;
  announcementListeners.add(listener);
  return () => {
    announcementListeners.delete(listener);
  };
}

/** Fires after an evaluated event that may have changed the person's awards or progress. */
export function onAchievementsChanged(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}

function notify<T>(listeners: Set<(value: T) => void>, value: T): void {
  for (const listener of listeners) {
    try {
      listener(value);
    } catch (error) {
      logger.warn('achievements: display listener threw', { error: String(error) });
    }
  }
}

export async function announceEvaluated(response: AchievementEventsResponseWire): Promise<void> {
  const changed = response.decisions.some((d) => d.decision !== 'ignored');
  const gained = response.decisions.some((d) => d.awarded.length > 0);
  if (gained) {
    const loaded = await loadAchievementDefinitions();
    if (loaded) {
      for (const announcement of selectAnnouncements(response.decisions, loaded, held)) {
        if (!markAnnounced(announcement)) {
          continue;
        }
        // Whichever tab drains the shared queue sends the event, so a hidden one hands the award to a visible one.
        if (deps.isVisible()) {
          notify(announcementListeners, announcement);
        } else {
          announcementChannel()?.post(announcement);
        }
      }
    } else {
      logger.info('achievements: definitions unavailable, award not announced');
    }
  }
  if (changed) {
    notify(changeListeners, undefined);
  }
}

function markAnnounced(announcement: AchievementAnnouncement): boolean {
  const key = `${announcement.achievementId}:${announcement.tierId}`;
  if (announced.has(key)) {
    return false;
  }
  announced.add(key);
  held = [...held, { achievementId: announcement.achievementId, tierId: announcement.tierId }];
  return true;
}

function receiveRelayed(message: unknown): void {
  if (!isAnnouncement(message) || !deps.isVisible() || !markAnnounced(message)) {
    return;
  }
  notify(announcementListeners, message);
  notify(changeListeners, undefined);
}

function isAnnouncement(value: unknown): value is AchievementAnnouncement {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const a = value as Partial<AchievementAnnouncement>;
  return (
    typeof a.achievementId === 'string' &&
    typeof a.tierId === 'string' &&
    (a.kind === 'award' || a.kind === 'tier_up') &&
    typeof a.final === 'boolean'
  );
}

const ART_KEY = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** `artBase + key + '.svg'` (RFC §6.5), or null when either part is not a trusted CDN location. */
export function achievementArtUrl(artBase: string, key: string | undefined): string | null {
  if (!key || !ART_KEY.test(key) || !isInteractiveLearningUrl(artBase)) {
    return null;
  }
  const base = parseUrlSafely(artBase);
  if (!base || base.search || base.hash || !base.pathname.endsWith('/')) {
    return null;
  }
  return new URL(`${key}.svg`, base).toString();
}

export function __setAchievementDisplayDepsForTests(overrides: Partial<DisplayDeps>): void {
  deps = { ...defaultDeps, ...overrides };
}

export function __resetAchievementDisplayForTests(): void {
  deps = defaultDeps;
  unsubscribeChannel?.();
  unsubscribeChannel = null;
  channel = undefined;
  definitions = null;
  definitionsInflight = null;
  held = [];
  announced.clear();
  announcementListeners.clear();
  changeListeners.clear();
  availability = 'unknown';
  availabilityProbe = null;
  availabilityListeners.clear();
}
