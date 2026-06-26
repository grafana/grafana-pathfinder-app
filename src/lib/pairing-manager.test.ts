import {
  acceptSession,
  createPairingChallengeProof,
  getAcceptedSession,
  onPendingChallenge,
  onSessionAccepted,
  rejectSession,
  registerExpectedPairingLaunch,
  resetPairingManagerForTests,
  setOwnLiveTabId,
  setPendingChallenge,
  signSignedMessage,
  verifySignedMessage,
  type ControllerPairingLaunch,
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

function pairingLaunch(overrides: Partial<ControllerPairingLaunch> = {}): ControllerPairingLaunch {
  return {
    pairingId: 'pairing-1',
    pairingSecret: 'secret-1',
    pairingCode: '123456',
    ...overrides,
  };
}

async function trustedChallenge(
  challengeOverrides: Partial<PendingChallenge> = {},
  launchOverrides: Partial<ControllerPairingLaunch> = {}
): Promise<PendingChallenge> {
  const launch = pairingLaunch(launchOverrides);
  const challenge = pendingChallenge({ pairingId: launch.pairingId, ...challengeOverrides });
  const pairingProof = await createPairingChallengeProof(launch.pairingSecret, challenge);
  registerExpectedPairingLaunch(launch);
  return { ...challenge, pairingProof };
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
    const challenge = await trustedChallenge({ publicKeyB64 });
    setOwnLiveTabId('live-1');
    await setPendingChallenge(challenge);
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

  it('requires a trusted gesture before accepting a challenge', async () => {
    const challenge = await trustedChallenge();

    await setPendingChallenge(challenge);
    acceptSession(challenge, false);

    expect(getAcceptedSession()).toBeNull();
  });

  it('accepts only the challenge currently visible to the user', async () => {
    const first = await trustedChallenge();
    const second = await trustedChallenge(
      {
        sessionId: 'session-2',
        publicKeyB64: 'public-key-2',
        senderTabId: 'controller-2',
      },
      {
        pairingId: 'pairing-2',
        pairingSecret: 'secret-2',
        pairingCode: '234567',
      }
    );

    await setPendingChallenge(first);
    await setPendingChallenge(second);
    acceptSession(second, true);

    expect(getAcceptedSession()).toBeNull();

    acceptSession(first, true);

    expect(getAcceptedSession()).toBeNull();
  });

  it('drops unproved challenges without blocking a valid controller', async () => {
    const attacker = pendingChallenge({
      sessionId: 'session-2',
      publicKeyB64: 'public-key-2',
      senderTabId: 'controller-2',
    });
    const valid = await trustedChallenge();
    const seen: Array<PendingChallenge | null> = [];

    const unsubscribe = onPendingChallenge((challenge) => seen.push(challenge));
    await setPendingChallenge(attacker);
    await setPendingChallenge(valid);
    unsubscribe();

    expect(seen).toEqual([{ ...valid, pairingCode: '123456' }]);
  });

  it('denies competing valid challenges while a prompt is visible', async () => {
    const first = await trustedChallenge();
    const second = await trustedChallenge(
      {
        sessionId: 'session-2',
        publicKeyB64: 'public-key-2',
        senderTabId: 'controller-2',
      },
      {
        pairingId: 'pairing-2',
        pairingSecret: 'secret-2',
        pairingCode: '234567',
      }
    );
    const seen: Array<PendingChallenge | null> = [];

    const unsubscribe = onPendingChallenge((challenge) => seen.push(challenge));
    await setPendingChallenge(first);
    await setPendingChallenge(second);
    unsubscribe();

    expect(seen).toEqual([{ ...first, pairingCode: '123456' }, null]);
  });

  it('allows a new challenge after the pending challenge expires', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    try {
      const first = await trustedChallenge();
      const second = await trustedChallenge(
        {
          sessionId: 'session-2',
          publicKeyB64: 'public-key-2',
          senderTabId: 'controller-2',
        },
        {
          pairingId: 'pairing-2',
          pairingSecret: 'secret-2',
          pairingCode: '234567',
        }
      );
      const seen: Array<PendingChallenge | null> = [];

      const unsubscribe = onPendingChallenge((challenge) => seen.push(challenge));
      await setPendingChallenge(first);
      jest.setSystemTime(30_001);
      jest.advanceTimersByTime(30_001);
      await setPendingChallenge(second);
      unsubscribe();

      expect(seen).toEqual([{ ...first, pairingCode: '123456' }, null, { ...second, pairingCode: '234567' }]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('suppresses a rejected controller session', async () => {
    const rejected = await trustedChallenge();
    const otherSession = await trustedChallenge(
      { sessionId: 'session-2', publicKeyB64: 'public-key-2' },
      { pairingId: 'pairing-2', pairingSecret: 'secret-2', pairingCode: '234567' }
    );
    const seen: Array<PendingChallenge | null> = [];

    const unsubscribe = onPendingChallenge((challenge) => seen.push(challenge));
    await setPendingChallenge(rejected);
    rejectSession(rejected);
    await setPendingChallenge(rejected);
    await setPendingChallenge(otherSession);
    unsubscribe();

    expect(seen).toEqual([{ ...rejected, pairingCode: '123456' }, null, { ...otherSession, pairingCode: '234567' }]);
  });

  it('re-accepts an already accepted same-session challenge after reconnect', async () => {
    const challenge = await trustedChallenge();
    const accepted: string[] = [];
    const unsubscribeAccepted = onSessionAccepted((liveTabId: string) => {
      accepted.push(liveTabId);
    });

    await setPendingChallenge(challenge);
    acceptSession(challenge, true);
    await setPendingChallenge(challenge);

    unsubscribeAccepted();
    expect(accepted).toEqual(['live-1', 'live-1']);
  });
});
