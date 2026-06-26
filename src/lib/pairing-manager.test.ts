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
  createPairingChallengeProof,
  getAcceptedSession,
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
