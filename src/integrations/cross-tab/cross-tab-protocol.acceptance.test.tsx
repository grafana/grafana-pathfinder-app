/**
 * Cross-tab pairing protocol — acceptance suite.
 *
 * This is the canonical, integration-style description of "what good looks
 * like" for the trust boundary between a popped-out controller tab and the
 * live Grafana tab. Each top-level describe maps to one acceptance criterion
 * (launch binding, prompt capture, consent, session binding, replay/staleness,
 * reconnect, shutdown hand-back, revocation).
 *
 * Two test styles are used deliberately:
 *
 *  - End-to-end flows (launch binding, consent gate, command execution,
 *    reconnect, hand-back) drive the REAL `ControllerChannelProvider`, the REAL
 *    `installLiveTabExecutor`, and the REAL `pairing-manager` authgate over a
 *    shared in-process message bus. The crypto path is never mocked.
 *  - Field-level protocol assertions (session binding, replay, staleness) call
 *    the REAL `pairing-manager` verify path directly with a real controller
 *    keypair. These prove the signature/nonce/timestamp checks without standing
 *    up the full React harness.
 *
 * Only the live tab's DOM-touching dependencies (action handlers, requirements
 * manager, sidebar, Grafana runtime) are mocked — they are not part of the
 * trust boundary under test.
 */

import React from 'react';
import { render, act, waitFor } from '@testing-library/react';
import { getAppEvents } from '@grafana/runtime';

import { installLiveTabExecutor, resetLiveTabExecutorForTests } from './live-tab-executor';
import { ButtonHandler, FocusHandler } from '../../interactive-engine/action-handlers';
import { checkRequirements, dispatchFix } from '../../requirements-manager';
import { sidebarState } from '../../global-state/sidebar';
import { isExtensionSidebarOwnedByOther } from '../../utils/experiments/experiment-utils';
import { ControllerChannelProvider, useControllerChannel } from '../../global-state/controller-channel';
import {
  acceptSession,
  createControllerPairingLaunch,
  createPairingChallengeProof,
  createSignatureNonce,
  getAcceptedSession,
  onPendingChallenge,
  registerExpectedPairingLaunch,
  rejectSession,
  resetPairingManagerForTests,
  setOwnLiveTabId,
  setPendingChallenge,
  signSignedMessage,
  verifySignedMessage,
  type ControllerPairingLaunch,
  type PendingChallenge,
  type SignedMessageFields,
} from '../../lib/pairing-manager';
import { generateSessionKeyPair } from '../../security/cross-tab-crypto';
import { buildControllerPairingHash, parseControllerPairingHash } from '../../utils/pathfinder-search-params';
import type { CrossTabMessage, CrossTabPayload } from '../../types/cross-tab.types';

jest.mock('../../requirements-manager', () => {
  const actual = jest.requireActual('../../requirements-manager');
  return { ...actual, checkRequirements: jest.fn(), dispatchFix: jest.fn() };
});

jest.mock('../../interactive-engine/action-handlers', () => {
  const makeHandler = () => ({ execute: jest.fn().mockResolvedValue(undefined) });
  const makeGuided = () => ({
    resetProgress: jest.fn(),
    executeGuidedStep: jest.fn().mockResolvedValue('completed'),
  });
  return {
    FocusHandler: jest.fn(makeHandler),
    ButtonHandler: jest.fn(makeHandler),
    FormFillHandler: jest.fn(makeHandler),
    HoverHandler: jest.fn(makeHandler),
    NavigateHandler: jest.fn(makeHandler),
    GuidedHandler: jest.fn(makeGuided),
  };
});

jest.mock('@grafana/runtime', () => {
  const actual = jest.requireActual('@grafana/runtime');
  const publish = jest.fn();
  return { ...actual, getAppEvents: jest.fn(() => ({ publish })) };
});

jest.mock('../../global-state/sidebar', () => ({
  sidebarState: { getIsSidebarMounted: jest.fn(() => true), openSidebar: jest.fn() },
}));

jest.mock('../../utils/experiments/experiment-utils', () => {
  const actual = jest.requireActual('../../utils/experiments/experiment-utils');
  return { ...actual, isExtensionSidebarOwnedByOther: jest.fn(() => false) };
});

const FAST_PACING = { showToDoMs: 0, settleMs: 0, interStepMs: 0 };

// --- shared in-process bus -------------------------------------------------
// Mirrors BroadcastChannel semantics: a message posted by one endpoint is
// delivered to every OTHER endpoint on the same channel, never back to the
// sender. The endpoint wraps the bare payload in the cross-tab envelope the
// real CrossTabTransport adds, so validateCrossTabMessage sees a well-formed
// message on the receiving side.
class BusEndpoint {
  started = false;
  stopped = false;
  postedPayloads: CrossTabPayload[] = [];
  private listener: ((message: CrossTabMessage) => void) | null = null;

  constructor(
    private readonly bus: TestBus,
    readonly senderId: string
  ) {}

  start(): void {
    this.started = true;
  }

  stop(): void {
    this.stopped = true;
  }

  post(payload: CrossTabPayload): void {
    this.postedPayloads.push(payload);
    const message = {
      source: 'pathfinder',
      senderId: this.senderId,
      timestamp: 0,
      ...payload,
    } as unknown as CrossTabMessage;
    this.bus.deliver(this, message);
  }

  onMessage(listener: (message: CrossTabMessage) => void): () => void {
    this.listener = listener;
    return () => {
      this.listener = null;
    };
  }

  receive(message: CrossTabMessage): void {
    this.listener?.(message);
  }

  getSenderId(): string {
    return this.senderId;
  }
}

class TestBus {
  private readonly endpoints = new Set<BusEndpoint>();

  endpoint(senderId: string): BusEndpoint {
    const e = new BusEndpoint(this, senderId);
    this.endpoints.add(e);
    return e;
  }

  deliver(from: BusEndpoint, message: CrossTabMessage): void {
    [...this.endpoints].forEach((e) => {
      if (e !== from) {
        e.receive(message);
      }
    });
  }
}

function executeOf(handler: unknown): jest.Mock {
  const ctor = handler as jest.Mock;
  return (ctor.mock.results[0]?.value as { execute: jest.Mock }).execute;
}

function CaptureChannel({ sink }: { sink: (channel: ReturnType<typeof useControllerChannel>) => void }) {
  const channel = useControllerChannel();
  React.useEffect(() => {
    sink(channel);
  }, [channel, sink]);
  return null;
}

interface PairedHarness {
  bus: TestBus;
  controller: BusEndpoint;
  live: BusEndpoint;
  acceptedChallenge: PendingChallenge;
  channel: NonNullable<ReturnType<typeof useControllerChannel>>;
  cleanup: () => void;
}

// Stand up a real controller + real live executor over the bus, run the launch
// challenge through to a user-accepted session, and return live handles. The
// returned harness is fully paired: channel.post commands are signed and the
// executor will verify them.
async function pairOverBus(): Promise<PairedHarness> {
  const bus = new TestBus();
  const controller = bus.endpoint('controller-tab');
  const live = bus.endpoint('live-tab');

  // The live tab mints the launch (it builds the controller URL), so the
  // expected-launch registry lives on the live side.
  const launch = createControllerPairingLaunch();

  // pairing-manager is unmocked here, so the executor's default authgate is the
  // real trust state machine — no auth path is stubbed.
  const uninstall = installLiveTabExecutor(live, FAST_PACING);

  let channel: ReturnType<typeof useControllerChannel> = null;
  const result = render(
    <ControllerChannelProvider transport={controller} pairing={launch}>
      <CaptureChannel sink={(c) => (channel = c)} />
    </ControllerChannelProvider>
  );

  let captured: PendingChallenge | null = null;
  const unsubChallenge = onPendingChallenge((c) => {
    if (c) {
      captured = c;
    }
  });

  await waitFor(() => expect(captured).not.toBeNull());

  await act(async () => {
    acceptSession(captured!, true);
    await Promise.resolve();
  });
  unsubChallenge();

  await waitFor(() => expect(getAcceptedSession()).not.toBeNull());
  await waitFor(() => expect(channel).not.toBeNull());

  return {
    bus,
    controller,
    live,
    acceptedChallenge: captured!,
    channel: channel!,
    cleanup: () => {
      result.unmount();
      uninstall();
    },
  };
}

// --- direct-manager helpers (field-level protocol assertions) --------------

const LIVE_TAB_ID = 'live-1';

interface AcceptedController {
  privateKey: CryptoKey;
  publicKeyB64: string;
  sessionId: string;
}

async function acceptControllerInManager(): Promise<AcceptedController> {
  const sessionId = 'session-1';
  const { publicKeyB64, privateKey } = await generateSessionKeyPair();
  const launch = createControllerPairingLaunch();
  const challenge: PendingChallenge = {
    sessionId,
    publicKeyB64,
    senderTabId: 'controller-1',
    pairingId: launch.pairingId,
  };
  const pairingProof = await createPairingChallengeProof(launch.pairingSecret, challenge);
  const proven = { ...challenge, pairingProof };
  setOwnLiveTabId(LIVE_TAB_ID);
  await setPendingChallenge(proven);
  acceptSession(proven, true);
  expect(getAcceptedSession()).not.toBeNull();
  return { privateKey, publicKeyB64, sessionId };
}

async function sign(
  privateKey: CryptoKey,
  body: Record<string, unknown>,
  overrides: Partial<SignedMessageFields> = {}
): Promise<SignedMessageFields & Record<string, unknown>> {
  const fields = {
    ...body,
    sessionId: 'session-1',
    liveTabId: LIVE_TAB_ID,
    sigTs: Date.now(),
    sigNonce: createSignatureNonce(),
    ...overrides,
  } as SignedMessageFields;
  const sig = await signSignedMessage(privateKey, fields);
  return { ...fields, sig } as SignedMessageFields & Record<string, unknown>;
}

// The four side-effecting command families that cross the trust boundary.
const COMMAND_FAMILIES: Array<{
  kind: string;
  body: Record<string, unknown>;
  mutate: (b: Record<string, unknown>) => Record<string, unknown>;
}> = [
  {
    kind: 'step-command',
    body: {
      kind: 'step-command',
      phase: 'do',
      stepId: 's1',
      runId: 'run-1',
      action: { targetAction: 'button', refTarget: '#safe' },
    },
    mutate: (b) => ({ ...b, action: { targetAction: 'button', refTarget: '#attacker' } }),
  },
  {
    kind: 'check-requirements',
    body: { kind: 'check-requirements', requestId: 'r1', stepId: 's1', requirements: 'navmenu-open' },
    mutate: (b) => ({ ...b, requirements: 'is-admin' }),
  },
  {
    kind: 'fix-requirement',
    body: {
      kind: 'fix-requirement',
      requestId: 'f1',
      stepId: 's1',
      requirements: 'navmenu-open',
      fixType: 'navigation',
    },
    mutate: (b) => ({ ...b, targetHref: '/attacker' }),
  },
  {
    kind: 'sidebar-handoff',
    body: { kind: 'sidebar-handoff', action: 'reopen' },
    mutate: (b) => ({ ...b, action: 'close' }),
  },
];

beforeEach(() => {
  resetPairingManagerForTests();
  resetLiveTabExecutorForTests();
  jest.clearAllMocks();
  (sidebarState.getIsSidebarMounted as jest.Mock).mockReturnValue(true);
  (isExtensionSidebarOwnedByOther as jest.Mock).mockReturnValue(false);
  (checkRequirements as jest.Mock).mockResolvedValue({ requirements: '', pass: true, error: [] });
  (dispatchFix as jest.Mock).mockResolvedValue({ ok: true });
});

afterEach(async () => {
  // Drain any executor dispatch still in flight (the sidebar-handoff path runs
  // an async crypto verify before touching the DOM). Without this, a prior
  // test's fire-and-forget hand-back can resolve and call into the next test's
  // freshly-cleared mocks, manifesting as a flaky failure under parallel load.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  resetPairingManagerForTests();
  resetLiveTabExecutorForTests();
});

describe('cross-tab pairing protocol acceptance', () => {
  // ========================================================================
  describe('1. launch binding', () => {
    it('round-trips URL-fragment launch material into a verifiable controller challenge', async () => {
      // The live tab mints the launch and registers the expected secret.
      const launch = createControllerPairingLaunch();
      // Material crosses to the controller tab only through the URL fragment.
      const parsed = parseControllerPairingHash(`#${buildControllerPairingHash(launch)}`);
      expect(parsed).toEqual(launch);

      const bus = new TestBus();
      const controller = bus.endpoint('controller-tab');
      const live = bus.endpoint('live-tab');
      let captured: PendingChallenge | null = null;
      const unsub = onPendingChallenge((c) => {
        if (c) {
          captured = c;
        }
      });
      // The live tab feeds inbound challenges through its real authgate.
      live.onMessage((m) => {
        if (m.kind === 'pairing-challenge') {
          void setPendingChallenge({
            sessionId: m.sessionId,
            publicKeyB64: m.publicKeyB64,
            senderTabId: m.senderId,
            pairingId: m.pairingId,
            pairingProof: m.pairingProof,
          });
        }
      });

      const result = render(
        <ControllerChannelProvider transport={controller} pairing={parsed!}>
          <CaptureChannel sink={() => undefined} />
        </ControllerChannelProvider>
      );

      await waitFor(() => expect(captured).not.toBeNull());
      expect(captured!.pairingId).toBe(launch.pairingId);
      unsub();
      result.unmount();
    });

    it('accepts a challenge only when its proof matches a registered launch', async () => {
      const launch: ControllerPairingLaunch = { pairingId: 'p1', pairingSecret: 'secret-1', pairingCode: '111111' };
      registerExpectedPairingLaunch(launch);
      const challenge: PendingChallenge = {
        sessionId: 'session-1',
        publicKeyB64: 'pk-1',
        senderTabId: 'ctrl-1',
        pairingId: 'p1',
      };
      const proof = await createPairingChallengeProof(launch.pairingSecret, challenge);

      const seen: Array<PendingChallenge | null> = [];
      const unsub = onPendingChallenge((c) => seen.push(c));
      await setPendingChallenge({ ...challenge, pairingProof: proof });
      unsub();

      expect(seen).toEqual([expect.objectContaining({ sessionId: 'session-1', pairingId: 'p1' })]);
    });

    it.each([
      ['wrong HMAC secret', { secret: 'attacker-secret' } as const],
      ['mutated sessionId', { mutate: (c: PendingChallenge) => ({ ...c, sessionId: 'session-evil' }) } as const],
      ['mutated publicKeyB64', { mutate: (c: PendingChallenge) => ({ ...c, publicKeyB64: 'pk-evil' }) } as const],
      ['unregistered pairingId', { mutate: (c: PendingChallenge) => ({ ...c, pairingId: 'p-unknown' }) } as const],
    ])(
      'rejects a challenge with %s',
      async (_label, opts: { secret?: string; mutate?: (c: PendingChallenge) => PendingChallenge }) => {
        const launch: ControllerPairingLaunch = { pairingId: 'p1', pairingSecret: 'secret-1', pairingCode: '111111' };
        registerExpectedPairingLaunch(launch);
        const challenge: PendingChallenge = {
          sessionId: 'session-1',
          publicKeyB64: 'pk-1',
          senderTabId: 'ctrl-1',
          pairingId: 'p1',
        };

        const proof = await createPairingChallengeProof(opts.secret ?? launch.pairingSecret, challenge);
        const tampered = opts.mutate ? opts.mutate(challenge) : challenge;

        const seen: Array<PendingChallenge | null> = [];
        const unsub = onPendingChallenge((c) => seen.push(c));
        await setPendingChallenge({ ...tampered, pairingProof: proof });
        unsub();

        expect(seen).toEqual([]);
        expect(getAcceptedSession()).toBeNull();
      }
    );
  });

  // ========================================================================
  describe('2. no prompt capture', () => {
    it('drops an unproved hostile challenge without taking the pending prompt slot', async () => {
      const launch = createControllerPairingLaunch();
      const valid: PendingChallenge = {
        sessionId: 'session-1',
        publicKeyB64: 'pk-1',
        senderTabId: 'ctrl-1',
        pairingId: launch.pairingId,
      };
      const validProof = await createPairingChallengeProof(launch.pairingSecret, valid);
      const hostile: PendingChallenge = {
        sessionId: 'session-evil',
        publicKeyB64: 'pk-evil',
        senderTabId: 'attacker',
        pairingId: 'p-none',
      };

      const seen: Array<PendingChallenge | null> = [];
      const unsub = onPendingChallenge((c) => seen.push(c));
      await setPendingChallenge(hostile); // no proof -> dropped
      await setPendingChallenge({ ...valid, pairingProof: validProof });
      unsub();

      expect(seen).toEqual([expect.objectContaining({ sessionId: 'session-1' })]);
    });

    it('fails closed on two competing valid challenges and leaves neither acceptable', async () => {
      const launchA = createControllerPairingLaunch();
      const launchB = createControllerPairingLaunch();
      const a: PendingChallenge = {
        sessionId: 'session-a',
        publicKeyB64: 'pk-a',
        senderTabId: 'ctrl-a',
        pairingId: launchA.pairingId,
      };
      const b: PendingChallenge = {
        sessionId: 'session-b',
        publicKeyB64: 'pk-b',
        senderTabId: 'ctrl-b',
        pairingId: launchB.pairingId,
      };
      const proofA = await createPairingChallengeProof(launchA.pairingSecret, a);
      const proofB = await createPairingChallengeProof(launchB.pairingSecret, b);
      setOwnLiveTabId(LIVE_TAB_ID);

      const seen: Array<PendingChallenge | null> = [];
      const unsub = onPendingChallenge((c) => seen.push(c));
      await setPendingChallenge({ ...a, pairingProof: proofA });
      await setPendingChallenge({ ...b, pairingProof: proofB });
      unsub();

      // First prompts, the competing second clears it.
      expect(seen).toEqual([expect.objectContaining({ sessionId: 'session-a' }), null]);

      // Re-presenting either is now un-promptable (both launches were revoked).
      const after: Array<PendingChallenge | null> = [];
      const unsub2 = onPendingChallenge((c) => after.push(c));
      await setPendingChallenge({ ...a, pairingProof: proofA });
      await setPendingChallenge({ ...b, pairingProof: proofB });
      unsub2();
      expect(after).toEqual([]);

      // And neither can be accepted.
      acceptSession({ ...a, pairingProof: proofA }, true);
      acceptSession({ ...b, pairingProof: proofB }, true);
      expect(getAcceptedSession()).toBeNull();
    });
  });

  // ========================================================================
  describe('3. user consent', () => {
    it('does not accept without a trusted user gesture', async () => {
      const ctrl = await acceptControllerInManager();
      // acceptControllerInManager already accepted; re-run the gate with an
      // untrusted gesture on a fresh manager to isolate the rule.
      resetPairingManagerForTests();
      const launch = createControllerPairingLaunch();
      const challenge: PendingChallenge = {
        sessionId: 'session-1',
        publicKeyB64: ctrl.publicKeyB64,
        senderTabId: 'ctrl-1',
        pairingId: launch.pairingId,
      };
      const proof = await createPairingChallengeProof(launch.pairingSecret, challenge);
      setOwnLiveTabId(LIVE_TAB_ID);
      await setPendingChallenge({ ...challenge, pairingProof: proof });

      acceptSession({ ...challenge, pairingProof: proof }, false);
      expect(getAcceptedSession()).toBeNull();

      acceptSession({ ...challenge, pairingProof: proof }, true);
      expect(getAcceptedSession()).not.toBeNull();
    });

    it('does not run side-effecting commands before consent is accepted', async () => {
      const bus = new TestBus();
      const attacker = bus.endpoint('attacker-tab');
      const live = bus.endpoint('live-tab');
      const uninstall = installLiveTabExecutor(live, FAST_PACING);

      // No accepted session yet — forge a fully-shaped step-command.
      attacker.post({
        kind: 'step-command',
        phase: 'do',
        stepId: 's1',
        runId: 'run-1',
        action: { targetAction: 'button', refTarget: '#x' },
      });
      await Promise.resolve();
      await Promise.resolve();

      expect(executeOf(ButtonHandler)).not.toHaveBeenCalled();
      uninstall();
    });

    it('suppresses a session the user rejected', async () => {
      const launch = createControllerPairingLaunch();
      const challenge: PendingChallenge = {
        sessionId: 'session-1',
        publicKeyB64: 'pk-1',
        senderTabId: 'ctrl-1',
        pairingId: launch.pairingId,
      };
      const proof = await createPairingChallengeProof(launch.pairingSecret, challenge);
      setOwnLiveTabId(LIVE_TAB_ID);

      const seen: Array<PendingChallenge | null> = [];
      const unsub = onPendingChallenge((c) => seen.push(c));
      await setPendingChallenge({ ...challenge, pairingProof: proof });
      rejectSession({ ...challenge, pairingProof: proof });
      await setPendingChallenge({ ...challenge, pairingProof: proof });
      unsub();

      expect(seen).toEqual([expect.objectContaining({ sessionId: 'session-1' }), null]);
      expect(getAcceptedSession()).toBeNull();
    });

    it('runs a signed command end-to-end once the user accepts', async () => {
      const harness = await pairOverBus();
      act(() => {
        harness.channel.post({
          kind: 'step-command',
          phase: 'do',
          stepId: 's1',
          runId: 'run-1',
          action: { targetAction: 'button', refTarget: '#go' },
        });
      });

      await waitFor(() => expect(executeOf(ButtonHandler)).toHaveBeenCalled());
      expect(executeOf(ButtonHandler)).toHaveBeenCalledWith(
        expect.objectContaining({ refTarget: '#go', targetAction: 'button' }),
        true
      );
      harness.cleanup();
    });
  });

  // ========================================================================
  describe('4. session binding', () => {
    it.each(COMMAND_FAMILIES.map((f) => [f.kind, f] as const))(
      'accepts a correctly signed %s and rejects a body-mutated replay of its signature',
      async (_kind, family) => {
        const ctrl = await acceptControllerInManager();
        const signed = await sign(ctrl.privateKey, family.body, { sigNonce: `nonce-${family.kind}` });

        // Reusing the signature over a mutated body must fail.
        const mutated = { ...family.mutate(signed), sig: signed.sig } as SignedMessageFields;
        expect(await verifySignedMessage(mutated, LIVE_TAB_ID)).toBe(false);

        // The untouched message verifies.
        expect(await verifySignedMessage(signed, LIVE_TAB_ID)).toBe(true);
      }
    );

    it('rejects a message bound to the wrong sessionId', async () => {
      const ctrl = await acceptControllerInManager();
      const signed = await sign(ctrl.privateKey, COMMAND_FAMILIES[0]!.body, { sessionId: 'session-evil' });
      expect(await verifySignedMessage(signed, LIVE_TAB_ID)).toBe(false);
    });

    it('rejects a message bound to the wrong liveTabId', async () => {
      const ctrl = await acceptControllerInManager();
      const signed = await sign(ctrl.privateKey, COMMAND_FAMILIES[0]!.body, { liveTabId: 'live-evil' });
      expect(await verifySignedMessage(signed, LIVE_TAB_ID)).toBe(false);
    });

    it('rejects a message signed by a key other than the accepted controller key', async () => {
      await acceptControllerInManager();
      const { privateKey: foreignKey } = await generateSessionKeyPair();
      const signed = await sign(foreignKey, COMMAND_FAMILIES[0]!.body);
      expect(await verifySignedMessage(signed, LIVE_TAB_ID)).toBe(false);
    });
  });

  // ========================================================================
  describe('5. replay and staleness', () => {
    it('rejects an exact replay of an already accepted signed message', async () => {
      const ctrl = await acceptControllerInManager();
      const signed = await sign(ctrl.privateKey, COMMAND_FAMILIES[0]!.body, { sigNonce: 'replay-nonce' });
      expect(await verifySignedMessage(signed, LIVE_TAB_ID)).toBe(true);
      expect(await verifySignedMessage(signed, LIVE_TAB_ID)).toBe(false);
    });

    it('rejects reuse of a nonce across a different valid payload (session-wide nonce uniqueness)', async () => {
      const ctrl = await acceptControllerInManager();
      const first = await sign(
        ctrl.privateKey,
        {
          kind: 'step-command',
          phase: 'do',
          stepId: 's1',
          runId: 'run-1',
          action: { targetAction: 'button', refTarget: '#a' },
        },
        { sigNonce: 'shared-nonce' }
      );
      const second = await sign(
        ctrl.privateKey,
        {
          kind: 'step-command',
          phase: 'do',
          stepId: 's1',
          runId: 'run-1',
          action: { targetAction: 'button', refTarget: '#b' },
        },
        { sigNonce: 'shared-nonce' }
      );

      expect(await verifySignedMessage(first, LIVE_TAB_ID)).toBe(true);
      expect(await verifySignedMessage(second, LIVE_TAB_ID)).toBe(false);
    });

    it('rejects a stale sigTs', async () => {
      const ctrl = await acceptControllerInManager();
      const signed = await sign(ctrl.privateKey, COMMAND_FAMILIES[0]!.body, { sigTs: Date.now() - 60_000 });
      expect(await verifySignedMessage(signed, LIVE_TAB_ID)).toBe(false);
    });

    it('rejects a future-dated sigTs beyond the allowed skew', async () => {
      const ctrl = await acceptControllerInManager();
      const signed = await sign(ctrl.privateKey, COMMAND_FAMILIES[0]!.body, { sigTs: Date.now() + 60_000 });
      expect(await verifySignedMessage(signed, LIVE_TAB_ID)).toBe(false);
    });
  });

  // ========================================================================
  describe('6. reconnect', () => {
    it('re-emits pairing-accept when an already-accepted same-session challenge re-arrives', async () => {
      const harness = await pairOverBus();
      const before = harness.live.postedPayloads.filter((p) => p.kind === 'pairing-accept').length;

      // Simulate the controller re-sending its challenge after a heartbeat-loss
      // re-pair (same session, same key). The live side should re-confirm.
      await act(async () => {
        await setPendingChallenge(harness.acceptedChallenge);
        await Promise.resolve();
      });

      await waitFor(() =>
        expect(harness.live.postedPayloads.filter((p) => p.kind === 'pairing-accept').length).toBeGreaterThan(before)
      );
      harness.cleanup();
    });

    it('keeps verifying signed commands after a re-pair (accepted session persists)', async () => {
      const harness = await pairOverBus();
      await act(async () => {
        await setPendingChallenge(harness.acceptedChallenge);
        await Promise.resolve();
      });

      act(() => {
        harness.channel.post({
          kind: 'step-command',
          phase: 'do',
          stepId: 's2',
          runId: 'run-2',
          action: { targetAction: 'highlight', refTarget: '#after-reconnect' },
        });
      });

      await waitFor(() => expect(executeOf(FocusHandler)).toHaveBeenCalled());
      harness.cleanup();
    });
  });

  // ========================================================================
  describe('7. shutdown hand-back', () => {
    it('posts a signed sidebar-handoff:reopen synchronously on pagehide (no awaited WebCrypto)', async () => {
      const harness = await pairOverBus();
      // Wait until the controller has bound the live tab and prepared a hand-back.
      await waitFor(() =>
        expect(
          harness.controller.postedPayloads.some(
            (p) => p.kind === 'sidebar-handoff' && (p as { action?: string }).action === 'close'
          )
        ).toBe(true)
      );
      // Let a heartbeat-driven refresh stamp a prepared hand-back.
      await waitFor(() =>
        expect(harness.controller.postedPayloads.some((p) => p.kind === 'sidebar-handoff')).toBe(true)
      );

      const before = harness.controller.postedPayloads.length;
      act(() => {
        window.dispatchEvent(new Event('pagehide'));
      });

      const posted = harness.controller.postedPayloads.slice(before);
      expect(posted).toContainEqual(
        expect.objectContaining({
          kind: 'sidebar-handoff',
          action: 'reopen',
          sig: expect.any(String),
          sigTs: expect.any(Number),
          sigNonce: expect.any(String),
        })
      );
      harness.cleanup();
    });

    it('reopens the live sidebar for a signed close→reopen handoff from the paired controller', async () => {
      const harness = await pairOverBus();

      await act(async () => {
        harness.channel.post({ kind: 'sidebar-handoff', action: 'close' });
        await Promise.resolve();
      });
      await waitFor(() =>
        expect(getAppEvents().publish).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'close-extension-sidebar' })
        )
      );

      await act(async () => {
        harness.channel.post({ kind: 'sidebar-handoff', action: 'reopen' });
        await Promise.resolve();
      });
      await waitFor(() => expect(sidebarState.openSidebar).toHaveBeenCalled());
      harness.cleanup();
    });

    it('rejects an unsigned handoff message at the live executor', async () => {
      const bus = new TestBus();
      const attacker = bus.endpoint('attacker-tab');
      const live = bus.endpoint('live-tab');
      const uninstall = installLiveTabExecutor(live, FAST_PACING);

      attacker.post({ kind: 'sidebar-handoff', action: 'reopen' });
      await Promise.resolve();
      await Promise.resolve();

      expect(sidebarState.openSidebar).not.toHaveBeenCalled();
      uninstall();
    });

    it('rejects a stale signed handoff message at the live executor', async () => {
      const ctrl = await acceptControllerInManager();
      const bus = new TestBus();
      const attacker = bus.endpoint('attacker-tab');
      const live = bus.endpoint('live-tab');
      // Re-point the executor's authgate to the manager state we just accepted.
      const uninstall = installLiveTabExecutor(live, FAST_PACING, {
        verifySignedMessage: (m) => verifySignedMessage(m, LIVE_TAB_ID),
        setPendingChallenge,
        setOwnLiveTabId: () => undefined,
        onSessionAccepted: () => () => undefined,
      });
      const stale = await sign(
        ctrl.privateKey,
        { kind: 'sidebar-handoff', action: 'reopen' },
        { sigTs: Date.now() - 60_000 }
      );
      attacker.post(stale as unknown as CrossTabPayload);
      await Promise.resolve();
      await Promise.resolve();

      expect(sidebarState.openSidebar).not.toHaveBeenCalled();
      uninstall();
    });

    it('does not reopen when another plugin owns the sidebar', async () => {
      (isExtensionSidebarOwnedByOther as jest.Mock).mockReturnValue(true);
      const harness = await pairOverBus();

      await act(async () => {
        harness.channel.post({ kind: 'sidebar-handoff', action: 'close' });
        await Promise.resolve();
      });
      await act(async () => {
        harness.channel.post({ kind: 'sidebar-handoff', action: 'reopen' });
        await Promise.resolve();
      });
      await Promise.resolve();
      expect(sidebarState.openSidebar).not.toHaveBeenCalled();
      harness.cleanup();
    });
  });

  // ========================================================================
  describe('8. revocation semantics', () => {
    it('keeps a rejected session suppressed across re-challenges', async () => {
      const launch = createControllerPairingLaunch();
      const challenge: PendingChallenge = {
        sessionId: 'session-1',
        publicKeyB64: 'pk-1',
        senderTabId: 'ctrl-1',
        pairingId: launch.pairingId,
      };
      const proof = await createPairingChallengeProof(launch.pairingSecret, challenge);
      setOwnLiveTabId(LIVE_TAB_ID);
      await setPendingChallenge({ ...challenge, pairingProof: proof });
      rejectSession({ ...challenge, pairingProof: proof });

      const seen: Array<PendingChallenge | null> = [];
      const unsub = onPendingChallenge((c) => seen.push(c));
      await setPendingChallenge({ ...challenge, pairingProof: proof });
      unsub();
      expect(seen).toEqual([]);
    });

    it('allows a new challenge after a pending challenge expires', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(0);
      try {
        const launchA = createControllerPairingLaunch();
        const launchB = createControllerPairingLaunch();
        const a: PendingChallenge = {
          sessionId: 'session-a',
          publicKeyB64: 'pk-a',
          senderTabId: 'ctrl-a',
          pairingId: launchA.pairingId,
        };
        const b: PendingChallenge = {
          sessionId: 'session-b',
          publicKeyB64: 'pk-b',
          senderTabId: 'ctrl-b',
          pairingId: launchB.pairingId,
        };
        const proofA = await createPairingChallengeProof(launchA.pairingSecret, a);
        const proofB = await createPairingChallengeProof(launchB.pairingSecret, b);

        const seen: Array<PendingChallenge | null> = [];
        const unsub = onPendingChallenge((c) => seen.push(c));
        await setPendingChallenge({ ...a, pairingProof: proofA });
        jest.setSystemTime(30_001);
        jest.advanceTimersByTime(30_001);
        await setPendingChallenge({ ...b, pairingProof: proofB });
        unsub();

        expect(seen).toEqual([
          expect.objectContaining({ sessionId: 'session-a' }),
          null,
          expect.objectContaining({ sessionId: 'session-b' }),
        ]);
      } finally {
        jest.useRealTimers();
      }
    });

    // GAP PROBE: the protocol has no post-accept revocation affordance. Once a
    // session is accepted, rejectSession is a no-op (it only acts on a pending
    // challenge) and there is no disconnect/revoke API. This encodes the DESIRED
    // behavior — a user-initiated disconnect should stop later commands — as a
    // known-failing test: it.failing keeps the gate green today and flips to a
    // hard failure the moment a revocation affordance lands, forcing this to be
    // promoted to a normal assertion. See the acceptance report's gap matrix.
    it.failing('GAP: a user-initiated disconnect prevents later signed commands from being accepted', async () => {
      const ctrl = await acceptControllerInManager();
      const liveChallenge: PendingChallenge = {
        sessionId: ctrl.sessionId,
        publicKeyB64: ctrl.publicKeyB64,
        senderTabId: 'controller-1',
        pairingId: 'p-x',
      };

      // The only revocation-like primitive available today.
      rejectSession(liveChallenge);

      const signed = await sign(ctrl.privateKey, COMMAND_FAMILIES[0]!.body, { sigNonce: 'post-revoke' });
      expect(await verifySignedMessage(signed, LIVE_TAB_ID)).toBe(false);
    });
  });
});
