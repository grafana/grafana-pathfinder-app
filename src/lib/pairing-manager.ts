import { signPayload, verifyPayload } from '../security/cross-tab-crypto';

export interface PendingChallenge {
  sessionId: string;
  publicKeyB64: string;
  senderTabId: string;
}

export interface AcceptedSession {
  sessionId: string;
  publicKeyB64: string;
  liveTabId: string;
}

export interface SignedMessageFields {
  kind: string;
  sig?: string;
  sessionId?: string;
  liveTabId?: string;
  sigTs?: number;
  sigNonce?: string;
}

const STALE_THRESHOLD_MS = 30_000;
const UNSIGNED_FIELDS = new Set(['source', 'senderId', 'timestamp', 'sig']);

function stableJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => (item === undefined ? 'null' : stableJson(item))).join(',')}]`;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .filter((key) => obj[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(obj[key])}`)
      .join(',')}}`;
  }
  return 'null';
}

function signedPayloadFields(message: SignedMessageFields): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  Object.entries(message as unknown as Record<string, unknown>).forEach(([key, value]) => {
    if (!UNSIGNED_FIELDS.has(key) && value !== undefined) {
      fields[key] = value;
    }
  });
  return fields;
}

export function canonicalSignedPayload(message: SignedMessageFields): string {
  return stableJson(signedPayloadFields(message));
}

export function createSignatureNonce(): string {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `sig-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function signSignedMessage(privateKey: CryptoKey, message: SignedMessageFields): Promise<string> {
  return signPayload(privateKey, canonicalSignedPayload(message));
}

let pendingChallenge: PendingChallenge | null = null;
let acceptedSession: AcceptedSession | null = null;
let ownLiveTabId: string | null = null;
let seenSignedMessages = new Map<string, number>();

const challengeListeners = new Set<(challenge: PendingChallenge | null) => void>();
const acceptedListeners = new Set<(liveTabId: string) => void>();

export function setOwnLiveTabId(id: string): void {
  ownLiveTabId = id;
}

export function getOwnLiveTabId(): string | null {
  return ownLiveTabId;
}

export function setPendingChallenge(challenge: PendingChallenge): void {
  if (acceptedSession && acceptedSession.sessionId === challenge.sessionId) {
    return;
  }
  pendingChallenge = challenge;
  challengeListeners.forEach((l) => l(challenge));
}

export function onPendingChallenge(listener: (challenge: PendingChallenge | null) => void): () => void {
  challengeListeners.add(listener);
  if (pendingChallenge) {
    listener(pendingChallenge);
  }
  return () => challengeListeners.delete(listener);
}

export function acceptSession(): void {
  const liveId = ownLiveTabId;
  if (!pendingChallenge || !liveId) {
    return;
  }
  acceptedSession = {
    sessionId: pendingChallenge.sessionId,
    publicKeyB64: pendingChallenge.publicKeyB64,
    liveTabId: liveId,
  };
  seenSignedMessages.clear();
  pendingChallenge = null;
  challengeListeners.forEach((l) => l(null));
  acceptedListeners.forEach((l) => l(liveId));
}

export function rejectSession(): void {
  pendingChallenge = null;
  challengeListeners.forEach((l) => l(null));
}

export function getAcceptedSession(): AcceptedSession | null {
  return acceptedSession;
}

export function onSessionAccepted(listener: (liveTabId: string) => void): () => void {
  acceptedListeners.add(listener);
  return () => acceptedListeners.delete(listener);
}

function pruneSeenMessages(now: number): void {
  seenSignedMessages.forEach((seenAt, key) => {
    if (now - seenAt > STALE_THRESHOLD_MS) {
      seenSignedMessages.delete(key);
    }
  });
}

export async function verifySignedMessage(message: SignedMessageFields, ownTabId: string): Promise<boolean> {
  const session = acceptedSession;
  if (!session) {
    return false;
  }
  const { sig, sessionId, liveTabId, sigTs, sigNonce } = message;
  if (!sig || !sessionId || !liveTabId || sigTs === undefined || !sigNonce) {
    return false;
  }
  if (sessionId !== session.sessionId) {
    return false;
  }
  if (liveTabId !== ownTabId) {
    return false;
  }
  const now = Date.now();
  if (Math.abs(now - sigTs) > STALE_THRESHOLD_MS) {
    return false;
  }
  const canonical = canonicalSignedPayload(message);
  const valid = await verifyPayload(session.publicKeyB64, canonical, sig);
  if (!valid) {
    return false;
  }
  pruneSeenMessages(now);
  const replayKey = `${sessionId}:${sigNonce}`;
  if (seenSignedMessages.has(replayKey)) {
    return false;
  }
  seenSignedMessages.set(replayKey, now);
  return true;
}

/** @internal Test-only reset of all pairing state. */
export function resetPairingManagerForTests(): void {
  pendingChallenge = null;
  acceptedSession = null;
  ownLiveTabId = null;
  seenSignedMessages = new Map();
  challengeListeners.clear();
  acceptedListeners.clear();
}
