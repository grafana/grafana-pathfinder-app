// Fast unit smoke tests for the pairing state machine. The full protocol-level
// acceptance — launch binding, consent / prompt-capture defense, session
// binding, replay & staleness, reconnect, shutdown hand-back, and rejection
// suppression — is the canonical centralized suite:
//   src/integrations/cross-tab/cross-tab-protocol.acceptance.test.tsx
// That suite exercises these same pairing-manager functions with real WebCrypto,
// so the behaviors below are intentionally covered there too. Add new
// protocol-behavioral assertions to the acceptance suite, not here; keep this
// file to a couple of fast smoke checks that localize a gross regression.

import {
  acceptSession,
  createPairingAcceptForSession,
  createPairingAcceptProof,
  createPairingChallengeProof,
  getAcceptedSession,
  registerExpectedPairingLaunch,
  resetPairingManagerForTests,
  setOwnLiveTabId,
  setPendingChallenge,
  signSignedMessage,
  verifyPairingAcceptProof,
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

describe('pairing-manager signed message verification (smoke)', () => {
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

  it('verifies a command signed by the accepted key and rejects a signature reused over a mutated payload', async () => {
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
});

describe('pairing-manager challenge acceptance (smoke)', () => {
  beforeEach(() => {
    resetPairingManagerForTests();
    setOwnLiveTabId('live-1');
  });

  afterEach(() => {
    resetPairingManagerForTests();
  });

  it('opens the command gate only after a trusted-gesture accept', async () => {
    const challenge = await trustedChallenge();
    await setPendingChallenge(challenge);

    acceptSession(challenge, false);
    expect(getAcceptedSession()).toBeNull();

    acceptSession(challenge, true);
    expect(getAcceptedSession()).not.toBeNull();
  });
});

describe('pairing-manager launch TTL race (smoke)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    resetPairingManagerForTests();
    setOwnLiveTabId('live-1');
  });

  afterEach(() => {
    resetPairingManagerForTests();
    jest.useRealTimers();
  });

  it('still posts an authenticated accept when the launch is pruned while the prompt is fresh', async () => {
    const FIVE_MIN = 5 * 60_000;
    const challenge = await trustedChallenge(); // launch registered at t=0, expires at +5min

    // Prompt armed just before the launch TTL → fresh for ~30s past it.
    jest.setSystemTime(FIVE_MIN - 10_000);
    await setPendingChallenge(challenge);

    // A rebroadcast after the TTL prunes the expired launch; the prompt is still fresh.
    jest.setSystemTime(FIVE_MIN + 1_000);
    await setPendingChallenge(challenge);

    acceptSession(challenge, true);
    expect(getAcceptedSession()).not.toBeNull();

    // The secret captured at verify time means an authenticated accept is still produced.
    const accept = await createPairingAcceptForSession();
    expect(accept).not.toBeNull();
    expect(
      await verifyPairingAcceptProof(
        'secret-1',
        { pairingId: 'pairing-1', sessionId: 'session-1', liveTabId: 'live-1' },
        accept!.acceptProof
      )
    ).toBe(true);
  });

  it('rejects a challenge proof presented as an accept proof (cross-protocol domain separation)', async () => {
    const launch = pairingLaunch();
    const challenge = pendingChallenge({ pairingId: launch.pairingId });
    const acceptBinding = { pairingId: launch.pairingId, sessionId: challenge.sessionId, liveTabId: 'live-1' };

    // Challenge proof binds {pairingId, publicKeyB64, sessionId}; accept binds
    // {pairingId, sessionId, liveTabId}. Same secret + shared pairingId/sessionId,
    // but the distinct field sets must keep the two proofs non-interchangeable.
    const challengeProof = await createPairingChallengeProof(launch.pairingSecret, challenge);
    expect(await verifyPairingAcceptProof(launch.pairingSecret, acceptBinding, challengeProof)).toBe(false);

    // Positive control: a genuine accept proof over the same binding still validates,
    // so the rejection above is domain separation, not a blanket failure.
    const acceptProof = await createPairingAcceptProof(launch.pairingSecret, acceptBinding);
    expect(await verifyPairingAcceptProof(launch.pairingSecret, acceptBinding, acceptProof)).toBe(true);
  });
});
