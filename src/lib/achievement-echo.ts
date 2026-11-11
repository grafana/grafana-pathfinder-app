import { onInteraction } from '@grafana/runtime';

import { logger } from './logging';
import { currentCompletionQueueOwnerKey } from './owner-key';
import { StorageKeys } from './storage-keys';

export type EchoScalar = string | number | boolean;

export interface EchoCondition {
  property: string;
  op: string;
  value: unknown;
}

export interface EchoSource {
  interaction: string;
  properties: string[];
  when?: EchoCondition[];
}

export interface EchoEvent {
  source: string;
  properties: Record<string, EchoScalar>;
  occurredAt: number;
}

type Subscribe = (name: string, callback: (properties: Record<string, unknown>) => void) => () => void;

export interface EchoDeps {
  subscribe: Subscribe | undefined;
  ownerKey: () => string | null;
  now: () => number;
}

// RFC §5.6: events wait here until the achievements flag resolves.
export const MAX_BUFFERED_ECHO_EVENTS = 50;

let active: { subscribe: Subscribe; now: () => number; cacheKey: string } | null = null;
let closed = false;
let buffer: EchoEvent[] = [];
let sink: ((event: EchoEvent) => void) | null = null;
const subscriptions = new Map<string, { source: EchoSource; unsubscribe: () => void }>();

/** Below Grafana 13.2 there is no `onInteraction`: nothing subscribes, buffers or throws. */
export function installEchoSubscriptions(overrides?: Partial<EchoDeps>): void {
  if (active || closed) {
    return;
  }
  const { subscribe, ownerKey, now }: EchoDeps = {
    subscribe: onInteraction,
    ownerKey: currentCompletionQueueOwnerKey,
    now: Date.now,
    ...overrides,
  };
  const owner = typeof subscribe === 'function' ? ownerKey() : null;
  if (!subscribe || !owner) {
    return;
  }
  active = { subscribe, now, cacheKey: `${StorageKeys.ACHIEVEMENT_SOURCES_PREFIX}${owner}` };
  subscribeTo(active, readCachedSources(active.cacheKey));
}

export function applyEchoSources(sources: readonly unknown[]): void {
  if (!active || closed) {
    return;
  }
  const valid = sources.filter(isEchoSource);
  try {
    localStorage.setItem(active.cacheKey, JSON.stringify(valid));
  } catch {}
  subscribeTo(active, valid);
}

export function attachEchoSink(next: (event: EchoEvent) => void): void {
  if (!active || closed) {
    return;
  }
  sink = next;
  const drained = buffer;
  buffer = [];
  for (const event of drained) {
    next(event);
  }
}

/** Also forgets the cached list, so the next page load subscribes to nothing. */
export function closeEchoSubscriptions(): void {
  closed = true;
  buffer = [];
  sink = null;
  for (const subscription of subscriptions.values()) {
    subscription.unsubscribe();
  }
  subscriptions.clear();
  if (active) {
    try {
      localStorage.removeItem(active.cacheKey);
    } catch {}
  }
}

export function subscribedEchoNames(): string[] {
  return [...subscriptions.keys()];
}

export function pickEchoProperties(source: EchoSource, raw: Record<string, unknown>): Record<string, EchoScalar> {
  const picked: Record<string, EchoScalar> = {};
  for (const name of source.properties) {
    const value: unknown = Object.prototype.hasOwnProperty.call(raw, name) ? raw[name] : undefined;
    if (
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))
    ) {
      picked[name] = value;
    }
  }
  return picked;
}

/** An op this build does not know is left to the backend, so a newer registry never drops events here. */
export function echoWhenHolds(source: EchoSource, properties: Record<string, EchoScalar>): boolean {
  return (source.when ?? []).every((condition) => {
    const present = Object.prototype.hasOwnProperty.call(properties, condition.property);
    const value = properties[condition.property];
    switch (condition.op) {
      case 'eq':
        return present && condition.value === value;
      case 'in':
        return present && Array.isArray(condition.value) && condition.value.includes(value);
      default:
        return true;
    }
  });
}

function subscribeTo(target: { subscribe: Subscribe }, sources: readonly EchoSource[]): void {
  const wanted = new Map(sources.map((source) => [source.interaction, source]));
  for (const [name, subscription] of subscriptions) {
    if (!wanted.has(name)) {
      subscription.unsubscribe();
      subscriptions.delete(name);
    }
  }
  for (const [name, source] of wanted) {
    const existing = subscriptions.get(name);
    if (existing) {
      existing.source = source;
      continue;
    }
    try {
      const unsubscribe = target.subscribe(name, (raw) => receive(name, raw));
      subscriptions.set(name, { source, unsubscribe });
    } catch (error) {
      logger.warn('achievement events: could not subscribe to an interaction', { error: String(error) });
    }
  }
}

// Runs inside the host's reportInteraction, so it must never throw into it.
function receive(name: string, raw: Record<string, unknown>): void {
  try {
    const subscription = subscriptions.get(name);
    if (closed || !active || !subscription) {
      return;
    }
    const properties = pickEchoProperties(subscription.source, raw);
    if (!echoWhenHolds(subscription.source, properties)) {
      return;
    }
    const event: EchoEvent = { source: name, properties, occurredAt: active.now() };
    if (sink) {
      sink(event);
      return;
    }
    buffer.push(event);
    if (buffer.length > MAX_BUFFERED_ECHO_EVENTS) {
      buffer.shift();
    }
  } catch (error) {
    logger.warn('achievement events: dropped an interaction it could not read', { error: String(error) });
  }
}

function readCachedSources(key: string): EchoSource[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isEchoSource) : [];
  } catch {
    return [];
  }
}

function isEchoSource(value: unknown): value is EchoSource {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const source = value as Partial<EchoSource>;
  return (
    typeof source.interaction === 'string' &&
    source.interaction !== '' &&
    Array.isArray(source.properties) &&
    source.properties.every((p) => typeof p === 'string') &&
    (source.when === undefined || (Array.isArray(source.when) && source.when.every(isCondition)))
  );
}

function isCondition(value: unknown): value is EchoCondition {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as EchoCondition).property === 'string' &&
    typeof (value as EchoCondition).op === 'string'
  );
}

export function __resetEchoSourcesForTests(): void {
  for (const subscription of subscriptions.values()) {
    subscription.unsubscribe();
  }
  subscriptions.clear();
  active = null;
  closed = false;
  buffer = [];
  sink = null;
}
