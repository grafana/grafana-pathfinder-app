import {
  acceptSession,
  getAcceptedSession,
  onPendingChallenge,
  rejectSession,
  resetPairingManagerForTests,
  setOwnLiveTabId,
  setPendingChallenge,
  signSignedMessage,
  verifySignedMessage,
  type PendingChallenge,
  type SignedMessageFields,
} from './pairing-manager';
import { generateSessionKeyPair } from '../security/cross-tab-crypto';

function pendingChallenge(overrides: Partial<PendingChallenge> = {}): PendingChallenge {
  return {
    sessionId: 'session-1',
    publicKeyB64: 'public-key-1',
    senderTabId: 'controller-1',
    ...overrides,
  };
}

function stepCommand(overrides: Partial<SignedMessageFields> = {}): SignedMessageFields {
  return {
    kind: 'step-command',
    phase: 'do',
    stepId: 's1',
    runId: 'run-1',
    action: { targetAction: 'button', refTarget: '#safe' },
    sessionId: 'session-1',
    liveTabId: 'live-1',
    sigTs: Date.now(),
    sigNonce: 'nonce-1',
    ...overrides,
  } as SignedMessageFields;
}

describe('pairing-manager signed message verification', () => {
  beforeEach(() => {
    resetPairingManagerForTests();
  });

  afterEach(() => {
    resetPairingManagerForTests();
  });

  async function pairController() {
    const { publicKeyB64, privateKey } = await generateSessionKeyPair();
    const challenge = pendingChallenge({ publicKeyB64 });
    setOwnLiveTabId('live-1');
    setPendingChallenge(challenge);
    acceptSession(challenge, true);
    return privateKey;
  }

  it('rejects a signature reused with a mutated side-effecting payload', async () => {
    const privateKey = await pairController();
    const signed = stepCommand();
    const sig = await signSignedMessage(privateKey, signed);

    const mutated = {
      ...signed,
      sig,
      action: { targetAction: 'button', refTarget: '#attacker' },
    } as SignedMessageFields;

    expect(await verifySignedMessage(mutated, 'live-1')).toBe(false);
    expect(await verifySignedMessage({ ...signed, sig }, 'live-1')).toBe(true);
  });

  it('rejects replay of an already accepted signed message', async () => {
    const privateKey = await pairController();
    const signed = stepCommand();
    const sig = await signSignedMessage(privateKey, signed);
    const message = { ...signed, sig };

    expect(await verifySignedMessage(message, 'live-1')).toBe(true);
    expect(await verifySignedMessage(message, 'live-1')).toBe(false);
  });
});

describe('pairing-manager challenge acceptance', () => {
  beforeEach(() => {
    resetPairingManagerForTests();
    setOwnLiveTabId('live-1');
  });

  afterEach(() => {
    resetPairingManagerForTests();
  });

  it('requires a trusted gesture before accepting a challenge', () => {
    const challenge = pendingChallenge();

    setPendingChallenge(challenge);
    acceptSession(challenge, false);

    expect(getAcceptedSession()).toBeNull();
  });

  it('accepts only the challenge currently visible to the user', () => {
    const first = pendingChallenge();
    const second = pendingChallenge({
      sessionId: 'session-2',
      publicKeyB64: 'public-key-2',
      senderTabId: 'controller-2',
    });

    setPendingChallenge(first);
    setPendingChallenge(second);
    acceptSession(second, true);

    expect(getAcceptedSession()).toBeNull();

    acceptSession(first, true);

    expect(getAcceptedSession()).toEqual({
      sessionId: 'session-1',
      publicKeyB64: 'public-key-1',
      liveTabId: 'live-1',
    });
  });

  it('keeps the first pending challenge while it is fresh', () => {
    const first = pendingChallenge();
    const second = pendingChallenge({
      sessionId: 'session-2',
      publicKeyB64: 'public-key-2',
      senderTabId: 'controller-2',
    });
    const seen: Array<PendingChallenge | null> = [];

    const unsubscribe = onPendingChallenge((challenge) => seen.push(challenge));
    setPendingChallenge(first);
    setPendingChallenge(second);
    unsubscribe();

    expect(seen).toEqual([first]);
  });

  it('allows a new challenge after the pending challenge expires', () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    const first = pendingChallenge();
    const second = pendingChallenge({
      sessionId: 'session-2',
      publicKeyB64: 'public-key-2',
      senderTabId: 'controller-2',
    });
    const seen: Array<PendingChallenge | null> = [];

    const unsubscribe = onPendingChallenge((challenge) => seen.push(challenge));
    setPendingChallenge(first);
    jest.setSystemTime(30_001);
    jest.advanceTimersByTime(30_001);
    setPendingChallenge(second);
    unsubscribe();
    jest.useRealTimers();

    expect(seen).toEqual([first, null, second]);
  });

  it('suppresses a rejected controller session', () => {
    const rejected = pendingChallenge();
    const otherSession = pendingChallenge({ sessionId: 'session-2', publicKeyB64: 'public-key-2' });
    const seen: Array<PendingChallenge | null> = [];

    const unsubscribe = onPendingChallenge((challenge) => seen.push(challenge));
    setPendingChallenge(rejected);
    rejectSession(rejected);
    setPendingChallenge(rejected);
    setPendingChallenge(otherSession);
    unsubscribe();

    expect(seen).toEqual([rejected, null, otherSession]);
  });
});
