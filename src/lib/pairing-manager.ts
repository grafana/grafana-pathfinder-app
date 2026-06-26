import { signHmacPayload, signPayload, verifyHmacPayload, verifyPayload } from '../security/cross-tab-crypto';

export interface PendingChallenge {
  sessionId: string;
  publicKeyB64: string;
  senderTabId: string;
  pairingId?: string;
  pairingProof?: string;
  pairingCode?: string;
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

export interface ControllerPairingLaunch {
  pairingId: string;
  pairingSecret: string;
  pairingCode: string;
}

export const SIGNED_MESSAGE_STALE_MS = 30_000;
const STALE_THRESHOLD_MS = SIGNED_MESSAGE_STALE_MS;
const PAIRING_LAUNCH_TTL_MS = 5 * 60_000;
const PENDING_CHALLENGE_TTL_MS = 30_000;
const REJECTED_CHALLENGE_TTL_MS = 5 * 60_000;
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

function randomBase64url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function createPairingCode(): string {
  const bytes = new Uint32Array(1);
  globalThis.crypto.getRandomValues(bytes);
  return String(bytes[0]! % 1_000_000).padStart(6, '0');
}

export function createControllerPairingLaunch(): ControllerPairingLaunch {
  const launch = {
    pairingId: createSignatureNonce(),
    pairingSecret: randomBase64url(32),
    pairingCode: createPairingCode(),
  };
  registerExpectedPairingLaunch(launch);
  return launch;
}

export function canonicalPairingChallengePayload(
  challenge: Pick<PendingChallenge, 'pairingId' | 'sessionId' | 'publicKeyB64'>
): string {
  return stableJson({
    pairingId: challenge.pairingId,
    publicKeyB64: challenge.publicKeyB64,
    sessionId: challenge.sessionId,
  });
}

export async function createPairingChallengeProof(
  pairingSecret: string,
  challenge: Pick<PendingChallenge, 'pairingId' | 'sessionId' | 'publicKeyB64'>
): Promise<string> {
  return signHmacPayload(pairingSecret, canonicalPairingChallengePayload(challenge));
}

let pendingChallenge: PendingChallenge | null = null;
let pendingChallengeExpiresAt = 0;
let pendingChallengeTimer: ReturnType<typeof setTimeout> | null = null;
let acceptedSession: AcceptedSession | null = null;
let ownLiveTabId: string | null = null;
let seenSignedMessages = new Map<string, number>();
let rejectedChallenges = new Map<string, number>();
let expectedLaunches = new Map<string, ControllerPairingLaunch & { expiresAt: number }>();

const challengeListeners = new Set<(challenge: PendingChallenge | null) => void>();
const acceptedListeners = new Set<(liveTabId: string) => void>();

function challengeKey(challenge: PendingChallenge): string {
  return `${challenge.senderTabId}:${challenge.sessionId}`;
}

function sameChallenge(a: PendingChallenge, b: PendingChallenge): boolean {
  return (
    a.sessionId === b.sessionId &&
    a.publicKeyB64 === b.publicKeyB64 &&
    a.senderTabId === b.senderTabId &&
    a.pairingId === b.pairingId
  );
}

function notifyPendingChallenge(challenge: PendingChallenge | null): void {
  challengeListeners.forEach((l) => l(challenge));
}

function clearPendingChallenge(): void {
  if (pendingChallengeTimer) {
    clearTimeout(pendingChallengeTimer);
    pendingChallengeTimer = null;
  }
  pendingChallenge = null;
  pendingChallengeExpiresAt = 0;
  notifyPendingChallenge(null);
}

function expirePendingChallenge(): void {
  if (!pendingChallenge || Date.now() < pendingChallengeExpiresAt) {
    return;
  }
  clearPendingChallenge();
}

function pendingChallengeIsFresh(now: number): boolean {
  return pendingChallenge !== null && now < pendingChallengeExpiresAt;
}

function schedulePendingChallengeExpiration(): void {
  if (pendingChallengeTimer) {
    clearTimeout(pendingChallengeTimer);
  }
  pendingChallengeTimer = setTimeout(expirePendingChallenge, Math.max(0, pendingChallengeExpiresAt - Date.now()));
}

function pruneRejectedChallenges(now: number): void {
  rejectedChallenges.forEach((rejectedAt, key) => {
    if (now - rejectedAt > REJECTED_CHALLENGE_TTL_MS) {
      rejectedChallenges.delete(key);
    }
  });
}

function pruneExpectedLaunches(now: number): void {
  expectedLaunches.forEach((launch, pairingId) => {
    if (now > launch.expiresAt) {
      expectedLaunches.delete(pairingId);
    }
  });
}

function isRejectedChallenge(challenge: PendingChallenge, now: number): boolean {
  pruneRejectedChallenges(now);
  return rejectedChallenges.has(challengeKey(challenge));
}

export function registerExpectedPairingLaunch(launch: ControllerPairingLaunch): void {
  expectedLaunches.set(launch.pairingId, { ...launch, expiresAt: Date.now() + PAIRING_LAUNCH_TTL_MS });
}

async function verifiedLaunchForChallenge(
  challenge: PendingChallenge,
  now: number
): Promise<ControllerPairingLaunch | null> {
  pruneExpectedLaunches(now);
  if (!challenge.pairingId || !challenge.pairingProof) {
    return null;
  }
  const launch = expectedLaunches.get(challenge.pairingId);
  if (!launch) {
    return null;
  }
  const valid = await verifyHmacPayload(
    launch.pairingSecret,
    canonicalPairingChallengePayload(challenge),
    challenge.pairingProof
  );
  return valid ? launch : null;
}

export function setOwnLiveTabId(id: string): void {
  ownLiveTabId = id;
}

function reacceptSession(session: AcceptedSession): void {
  acceptedListeners.forEach((l) => l(session.liveTabId));
}

function denyCompetingChallenge(challenge: PendingChallenge): void {
  if (pendingChallenge?.pairingId) {
    expectedLaunches.delete(pendingChallenge.pairingId);
  }
  if (challenge.pairingId) {
    expectedLaunches.delete(challenge.pairingId);
  }
  clearPendingChallenge();
}

export async function setPendingChallenge(challenge: PendingChallenge): Promise<void> {
  const now = Date.now();
  if (acceptedSession && acceptedSession.sessionId === challenge.sessionId) {
    if (acceptedSession.publicKeyB64 === challenge.publicKeyB64) {
      reacceptSession(acceptedSession);
    }
    return;
  }
  const verifiedLaunch = await verifiedLaunchForChallenge(challenge, now);
  if (!verifiedLaunch) {
    return;
  }
  const verifiedChallenge = { ...challenge, pairingCode: verifiedLaunch.pairingCode };
  if (isRejectedChallenge(challenge, now)) {
    return;
  }
  if (pendingChallengeIsFresh(now)) {
    if (pendingChallenge && !sameChallenge(pendingChallenge, verifiedChallenge)) {
      denyCompetingChallenge(verifiedChallenge);
    }
    return;
  }
  if (pendingChallenge) {
    clearPendingChallenge();
  }
  pendingChallenge = verifiedChallenge;
  pendingChallengeExpiresAt = now + PENDING_CHALLENGE_TTL_MS;
  schedulePendingChallengeExpiration();
  notifyPendingChallenge(verifiedChallenge);
}

export function onPendingChallenge(listener: (challenge: PendingChallenge | null) => void): () => void {
  expirePendingChallenge();
  challengeListeners.add(listener);
  if (pendingChallenge) {
    listener(pendingChallenge);
  }
  return () => challengeListeners.delete(listener);
}

export function acceptSession(challenge: PendingChallenge, trustedGesture: boolean): void {
  const liveId = ownLiveTabId;
  const now = Date.now();
  const pendingFresh = pendingChallengeIsFresh(now);
  if (!trustedGesture || !pendingChallenge || !pendingFresh || !liveId || !sameChallenge(pendingChallenge, challenge)) {
    if (pendingChallenge && !pendingFresh) {
      clearPendingChallenge();
    }
    return;
  }
  acceptedSession = {
    sessionId: pendingChallenge.sessionId,
    publicKeyB64: pendingChallenge.publicKeyB64,
    liveTabId: liveId,
  };
  if (pendingChallenge.pairingId) {
    expectedLaunches.delete(pendingChallenge.pairingId);
  }
  seenSignedMessages.clear();
  clearPendingChallenge();
  acceptedListeners.forEach((l) => l(liveId));
}

export function rejectSession(challenge: PendingChallenge): void {
  const now = Date.now();
  const pendingFresh = pendingChallengeIsFresh(now);
  if (!pendingChallenge || !pendingFresh || !sameChallenge(pendingChallenge, challenge)) {
    if (pendingChallenge && !pendingFresh) {
      clearPendingChallenge();
    }
    return;
  }
  rejectedChallenges.set(challengeKey(pendingChallenge), Date.now());
  if (pendingChallenge.pairingId) {
    expectedLaunches.delete(pendingChallenge.pairingId);
  }
  clearPendingChallenge();
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
  if (pendingChallengeTimer) {
    clearTimeout(pendingChallengeTimer);
    pendingChallengeTimer = null;
  }
  pendingChallenge = null;
  pendingChallengeExpiresAt = 0;
  acceptedSession = null;
  ownLiveTabId = null;
  seenSignedMessages = new Map();
  rejectedChallenges = new Map();
  expectedLaunches = new Map();
  challengeListeners.clear();
  acceptedListeners.clear();
}
