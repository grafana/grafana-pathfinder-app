import { verifyPayload } from '../security/cross-tab-crypto';

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
}

const STALE_THRESHOLD_MS = 30_000;

function canonicalPayload(sessionId: string, liveTabId: string, kind: string, sigTs: number): string {
  return `${sessionId}|${liveTabId}|${kind}|${sigTs}`;
}

let pendingChallenge: PendingChallenge | null = null;
let acceptedSession: AcceptedSession | null = null;
let ownLiveTabId: string | null = null;

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

export async function verifySignedMessage(message: SignedMessageFields, ownTabId: string): Promise<boolean> {
  const session = acceptedSession;
  if (!session) {
    return false;
  }
  const { sig, sessionId, liveTabId, sigTs } = message;
  if (!sig || !sessionId || !liveTabId || sigTs === undefined) {
    return false;
  }
  if (sessionId !== session.sessionId) {
    return false;
  }
  if (liveTabId !== ownTabId) {
    return false;
  }
  if (Math.abs(Date.now() - sigTs) > STALE_THRESHOLD_MS) {
    return false;
  }
  const canonical = canonicalPayload(sessionId, liveTabId, message.kind, sigTs);
  return verifyPayload(session.publicKeyB64, canonical, sig);
}

/** @internal Test-only reset of all pairing state. */
export function resetPairingManagerForTests(): void {
  pendingChallenge = null;
  acceptedSession = null;
  ownLiveTabId = null;
  challengeListeners.clear();
  acceptedListeners.clear();
}
