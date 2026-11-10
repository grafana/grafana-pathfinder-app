import { logger } from '../../lib/logging';
import { isInteractiveLearningUrl, parseUrlSafely } from '../../security/url-validator';
import type { AchievementEventsResponseWire } from '../../types/backend-api.schema';

import {
  selectAnnouncements,
  type AchievementAnnouncement,
  type HeldTier,
  type AchievementDefinitions,
} from './achievement-announcements';
import { fetchAchievementDefinitions, fetchMyAchievements, type MyAchievementsResult } from './achievements-client';

export interface DisplayDeps {
  fetchDefinitions: typeof fetchAchievementDefinitions;
  fetchMy: typeof fetchMyAchievements;
}

const defaultDeps: DisplayDeps = { fetchDefinitions: fetchAchievementDefinitions, fetchMy: fetchMyAchievements };
let deps = defaultDeps;

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

export function onAchievementAnnounced(listener: (announcement: AchievementAnnouncement) => void): () => void {
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
        const key = `${announcement.achievementId}:${announcement.tierId}`;
        if (announced.has(key)) {
          continue;
        }
        announced.add(key);
        held = [...held, { achievementId: announcement.achievementId, tierId: announcement.tierId }];
        notify(announcementListeners, announcement);
      }
    } else {
      logger.info('achievements: definitions unavailable, award not announced');
    }
  }
  if (changed) {
    notify(changeListeners, undefined);
  }
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
