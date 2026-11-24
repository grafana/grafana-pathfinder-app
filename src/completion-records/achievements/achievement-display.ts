import { logger } from '../../lib/logging';
import { StorageKeys } from '../../lib/storage-keys';
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
import { applyEchoSources } from '../../lib/achievement-echo';

/** `displayed` is true when the sending tab already showed the award, so receivers only record it. */
export type RelayedAnnouncement = AchievementAnnouncement & { displayed: boolean };

export interface AnnouncementChannel {
  post(message: RelayedAnnouncement): void;
  subscribe(listener: (message: unknown) => void): () => void;
}

export interface DisplayDeps {
  fetchDefinitions: typeof fetchAchievementDefinitions;
  fetchMy: typeof fetchMyAchievements;
  isVisible: () => boolean;
  onVisible: (listener: () => void) => () => void;
  /** `true` for the first tab to claim an award, so each award is displayed in one tab only. */
  claim: (key: string) => boolean;
  openChannel: () => AnnouncementChannel | null;
  applySources: (sources: AchievementDefinitions['sources']) => void;
}

function openBroadcastChannel(): AnnouncementChannel | null {
  const owner = currentCompletionQueueOwnerKey();
  if (!owner || typeof BroadcastChannel !== 'function') {
    return null;
  }
  const channel = new BroadcastChannel(`pathfinder-achievements:${owner}`);
  return {
    post: (message) => channel.postMessage(message),
    subscribe: (listener) => {
      const onMessage = (event: MessageEvent) => listener(event.data);
      channel.addEventListener('message', onMessage);
      return () => channel.removeEventListener('message', onMessage);
    },
  };
}

function watchVisibility(listener: () => void): () => void {
  if (typeof document === 'undefined') {
    return () => undefined;
  }
  const onChange = () => document.visibilityState !== 'hidden' && listener();
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}

function claimInLocalStorage(key: string): boolean {
  const owner = currentCompletionQueueOwnerKey();
  if (!owner) {
    return true;
  }
  const storageKey = `${StorageKeys.ACHIEVEMENT_ANNOUNCED_PREFIX}${owner}:${key}`;
  try {
    if (localStorage.getItem(storageKey) !== null) {
      return false;
    }
    localStorage.setItem(storageKey, String(Date.now()));
  } catch {}
  return true;
}

const defaultDeps: DisplayDeps = {
  fetchDefinitions: fetchAchievementDefinitions,
  fetchMy: fetchMyAchievements,
  isVisible: () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  onVisible: watchVisibility,
  claim: claimInLocalStorage,
  openChannel: openBroadcastChannel,
  applySources: applyEchoSources,
};
let deps = defaultDeps;
let channel: AnnouncementChannel | null | undefined;
let unsubscribeChannel: (() => void) | null = null;
let stopWatchingVisibility: (() => void) | null = null;
const pending = new Map<string, AchievementAnnouncement>();

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
          deps.applySources(fetched.sources);
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
  stopWatchingVisibility ??= deps.onVisible(flushPending);
  announcementListeners.add(listener);
  flushPending();
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
  const gained = response.decisions.some((d) => d.awarded.length > 0 || d.decision === 'increment');
  if (gained) {
    const loaded = await loadAchievementDefinitions();
    if (loaded) {
      for (const announcement of selectAnnouncements(response.decisions, loaded, held)) {
        if (!markAnnounced(announcement)) {
          continue;
        }
        // The tab that drains the shared queue may be hidden, so an award it cannot show waits for a visible tab.
        const displayed = canDisplay() && deps.claim(keyOf(announcement));
        if (displayed) {
          notify(announcementListeners, announcement);
        } else if (announcement.kind !== 'progress') {
          pending.set(keyOf(announcement), announcement);
        }
        announcementChannel()?.post({ ...announcement, displayed });
      }
    } else {
      logger.info('achievements: definitions unavailable, award not announced');
    }
  }
  if (changed) {
    notify(changeListeners, undefined);
  }
}

function keyOf(announcement: AchievementAnnouncement): string {
  return announcement.kind === 'progress'
    ? `${announcement.achievementId}:progress:${announcement.units}`
    : `${announcement.achievementId}:${announcement.tierId}`;
}

function queueForDisplay(announcement: AchievementAnnouncement): void {
  pending.set(keyOf(announcement), announcement);
  flushPending();
}

function canDisplay(): boolean {
  return announcementListeners.size > 0 && deps.isVisible();
}

function flushPending(): void {
  if (!canDisplay()) {
    return;
  }
  for (const [key, announcement] of [...pending]) {
    pending.delete(key);
    if (deps.claim(key)) {
      notify(announcementListeners, announcement);
    }
  }
}

function markAnnounced(announcement: AchievementAnnouncement): boolean {
  const key = keyOf(announcement);
  if (announced.has(key)) {
    return false;
  }
  announced.add(key);
  if (announcement.kind !== 'progress') {
    held = [...held, { achievementId: announcement.achievementId, tierId: announcement.tierId }];
  }
  return true;
}

function receiveRelayed(message: unknown): void {
  if (!isRelayedAnnouncement(message)) {
    return;
  }
  const announcement: AchievementAnnouncement =
    message.kind === 'progress'
      ? { achievementId: message.achievementId, kind: 'progress', units: message.units, next: message.next }
      : { achievementId: message.achievementId, tierId: message.tierId, kind: message.kind, final: message.final };
  if (!markAnnounced(announcement)) {
    return;
  }
  if (!message.displayed) {
    // Progress is only worth showing now; a count held until later would be stale.
    if (announcement.kind !== 'progress') {
      queueForDisplay(announcement);
    } else if (canDisplay() && deps.claim(keyOf(announcement))) {
      notify(announcementListeners, announcement);
    }
  }
  notify(changeListeners, undefined);
}

function isRelayedAnnouncement(value: unknown): value is RelayedAnnouncement {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const a = value as Record<string, unknown>;
  if (typeof a.achievementId !== 'string' || typeof a.displayed !== 'boolean') {
    return false;
  }
  if (a.kind === 'progress') {
    return Number.isInteger(a.units) && Number.isInteger(a.next);
  }
  return (a.kind === 'award' || a.kind === 'tier_up') && typeof a.tierId === 'string' && typeof a.final === 'boolean';
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
  stopWatchingVisibility?.();
  stopWatchingVisibility = null;
  pending.clear();
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
