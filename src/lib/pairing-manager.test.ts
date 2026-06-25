import {
  acceptSession,
  resetPairingManagerForTests,
  setOwnLiveTabId,
  setPendingChallenge,
  signSignedMessage,
  verifySignedMessage,
  type SignedMessageFields,
} from './pairing-manager';
import { generateSessionKeyPair } from '../security/cross-tab-crypto';

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
    setOwnLiveTabId('live-1');
    setPendingChallenge({ sessionId: 'session-1', publicKeyB64, senderTabId: 'controller-1' });
    acceptSession();
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
