import { validateCrossTabMessage, type RemoteRequirementError } from './cross-tab.types';
import type { CheckResultError } from './requirements.types';

function envelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { source: 'pathfinder', senderId: 'sender-1', timestamp: 1, ...overrides };
}

describe('validateCrossTabMessage', () => {
  it('accepts a well-formed step-command', () => {
    const message = envelope({
      kind: 'step-command',
      phase: 'do',
      stepId: 's1',
      runId: 'run-1',
      action: { targetAction: 'button', refTarget: 'Save' },
    });
    expect(validateCrossTabMessage(message)).toBe(message);
  });

  it('accepts a well-formed heartbeat', () => {
    const message = envelope({ kind: 'heartbeat', role: 'live' });
    expect(validateCrossTabMessage(message)).toBe(message);
  });

  it('accepts a launch-bound pairing challenge', () => {
    const message = envelope({
      kind: 'pairing-challenge',
      sessionId: 'session-1',
      publicKeyB64: 'public-key',
      pairingId: 'pairing-1',
      pairingProof: 'proof',
    });
    expect(validateCrossTabMessage(message)).toBe(message);
  });

  it.each([
    ['non-object', 42],
    ['null', null],
    ['foreign source', { source: 'evil', senderId: 'x', timestamp: 1, kind: 'heartbeat', role: 'live' }],
    ['missing senderId', envelope({ senderId: undefined, kind: 'heartbeat', role: 'live' })],
    ['missing timestamp', { source: 'pathfinder', senderId: 'x', kind: 'heartbeat', role: 'live' }],
    ['unknown kind', envelope({ kind: 'exec-arbitrary' })],
    ['envelope only, no kind', envelope()],
  ])('rejects %s', (_label, message) => {
    expect(validateCrossTabMessage(message)).toBeNull();
  });

  it('rejects a step-command with an unrecognized targetAction', () => {
    const message = envelope({
      kind: 'step-command',
      phase: 'do',
      stepId: 's1',
      runId: 'run-1',
      action: { targetAction: 'exec', refTarget: '#x' },
    });
    expect(validateCrossTabMessage(message)).toBeNull();
  });

  it.each([
    [
      'bad phase',
      {
        kind: 'step-command',
        phase: 'destroy',
        stepId: 's1',
        runId: 'r1',
        action: { targetAction: 'button', refTarget: 'x' },
      },
    ],
    [
      'missing stepId',
      { kind: 'step-command', phase: 'do', runId: 'r1', action: { targetAction: 'button', refTarget: 'x' } },
    ],
    [
      'missing runId',
      { kind: 'step-command', phase: 'do', stepId: 's1', action: { targetAction: 'button', refTarget: 'x' } },
    ],
    ['non-object action', { kind: 'step-command', phase: 'do', stepId: 's1', runId: 'r1', action: 'button' }],
    [
      'missing refTarget',
      { kind: 'step-command', phase: 'do', stepId: 's1', runId: 'r1', action: { targetAction: 'button' } },
    ],
  ])('rejects a malformed step-command (%s)', (_label, partial) => {
    expect(validateCrossTabMessage(envelope(partial))).toBeNull();
  });

  it('accepts a composite step-command whose internalActions are all recognized', () => {
    const message = envelope({
      kind: 'step-command',
      phase: 'do',
      stepId: 's1',
      runId: 'run-1',
      action: {
        targetAction: 'guided',
        refTarget: '',
        internalActions: [
          { targetAction: 'highlight', refTarget: '#a' },
          { targetAction: 'button', refTarget: 'Save' },
        ],
      },
    });
    expect(validateCrossTabMessage(message)).toBe(message);
  });

  it.each([
    [
      'an internal action with an unrecognized verb',
      {
        targetAction: 'multistep',
        refTarget: '',
        internalActions: [
          { targetAction: 'highlight', refTarget: '#a' },
          { targetAction: 'exec', refTarget: '#x' },
        ],
      },
    ],
    ['a non-array internalActions', { targetAction: 'guided', refTarget: '', internalActions: 'highlight' }],
    ['a non-object internal action', { targetAction: 'guided', refTarget: '', internalActions: ['highlight'] }],
    [
      'an internal action with a non-string refTarget',
      { targetAction: 'guided', refTarget: '', internalActions: [{ targetAction: 'highlight', refTarget: 123 }] },
    ],
    [
      'an internal action with a non-string targetValue',
      {
        targetAction: 'multistep',
        refTarget: '',
        internalActions: [{ targetAction: 'formfill', refTarget: '#a', targetValue: 5 }],
      },
    ],
  ])('rejects a composite step-command with %s', (_label, action) => {
    expect(
      validateCrossTabMessage(envelope({ kind: 'step-command', phase: 'do', stepId: 's1', runId: 'run-1', action }))
    ).toBeNull();
  });

  it('rejects a heartbeat with an invalid role', () => {
    expect(validateCrossTabMessage(envelope({ kind: 'heartbeat', role: 'admin' }))).toBeNull();
  });

  it('rejects a pairing challenge without a launch proof', () => {
    expect(
      validateCrossTabMessage(envelope({ kind: 'pairing-challenge', sessionId: 'session-1', publicKeyB64: 'public' }))
    ).toBeNull();
  });

  it('accepts a sidebar-handoff with a known action and rejects others', () => {
    expect(validateCrossTabMessage(envelope({ kind: 'sidebar-handoff', action: 'close' }))).not.toBeNull();
    expect(validateCrossTabMessage(envelope({ kind: 'sidebar-handoff', action: 'reopen' }))).not.toBeNull();
    expect(validateCrossTabMessage(envelope({ kind: 'sidebar-handoff', action: 'detonate' }))).toBeNull();
    expect(validateCrossTabMessage(envelope({ kind: 'sidebar-handoff' }))).toBeNull();
  });

  it('accepts a well-formed step-complete', () => {
    const message = envelope({ kind: 'step-complete', stepId: 's1', runId: 'run-1', ok: true });
    expect(validateCrossTabMessage(message)).toBe(message);
  });

  it('rejects a step-complete missing runId', () => {
    expect(validateCrossTabMessage(envelope({ kind: 'step-complete', stepId: 's1', ok: true }))).toBeNull();
  });

  it('accepts a well-formed step-progress', () => {
    const message = envelope({ kind: 'step-progress', stepId: 's1', runId: 'run-1', index: 0, total: 3 });
    expect(validateCrossTabMessage(message)).toBe(message);
  });

  it('rejects a step-progress missing runId', () => {
    expect(validateCrossTabMessage(envelope({ kind: 'step-progress', stepId: 's1', index: 0, total: 3 }))).toBeNull();
  });

  it.each([
    ['index below zero', { index: -1, total: 3 }],
    ['total below one', { index: 0, total: 0 }],
    ['index past total', { index: 4, total: 3 }],
  ])('rejects a step-progress with %s', (_label, bounds) => {
    expect(
      validateCrossTabMessage(envelope({ kind: 'step-progress', stepId: 's1', runId: 'run-1', ...bounds }))
    ).toBeNull();
  });

  it('accepts a well-formed requirement-result', () => {
    const message = envelope({
      kind: 'requirement-result',
      requestId: 'req-1',
      stepId: 's1',
      result: { requirements: 'navmenu-open', pass: false, error: [{ requirement: 'navmenu-open', pass: false }] },
    });
    expect(validateCrossTabMessage(message)).toBe(message);
  });

  it.each([
    ['a non-object error element', { requirements: 'x', pass: false, error: ['boom'] }],
    ['an error element missing pass', { requirements: 'x', pass: false, error: [{ requirement: 'x' }] }],
    [
      'an error element with a non-string fixType',
      { requirements: 'x', pass: false, error: [{ requirement: 'x', pass: false, fixType: 7 }] },
    ],
  ])('rejects a requirement-result with %s', (_label, result) => {
    expect(
      validateCrossTabMessage(envelope({ kind: 'requirement-result', requestId: 'req-1', stepId: 's1', result }))
    ).toBeNull();
  });
});

describe('RemoteRequirementError wire mirror', () => {
  // Compile-time guard for the deliberate re-statement in cross-tab.types.ts:
  // if CheckResultError and the wire type stop being mutually assignable
  // (field added/removed/retyped on either side), these lines stop compiling
  // and force a conscious decision about the wire contract.
  it('stays mutually assignable with CheckResultError', () => {
    const local: CheckResultError = { requirement: 'r', pass: true };
    const wire: RemoteRequirementError = local;
    const back: CheckResultError = wire;
    expect(back).toBe(local);
  });
});
