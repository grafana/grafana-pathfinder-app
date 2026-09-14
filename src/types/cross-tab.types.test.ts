import {
  toCrossTabInternalAction,
  validateCrossTabMessage,
  type RemoteRequirementError,
  type WireMirrors,
} from './cross-tab.types';
import type { GuidedAction, GuidedSubstepResult } from './interactive-actions.types';
import type { CheckResultError } from './requirements.types';

function envelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { source: 'pathfinder', senderId: 'sender-1', timestamp: 1, ...overrides };
}

function stepCommand(action: unknown): Record<string, unknown> {
  return envelope({ kind: 'step-command', phase: 'do', stepId: 'guided', runId: 'run-1', action });
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
    ['fractional index', { index: 0.5, total: 3 }],
    ['fractional total', { index: 0, total: 3.5 }],
    ['infinite index', { index: Infinity, total: Infinity }],
    ['infinite total', { index: 0, total: Infinity }],
    ['unsafe total', { index: 0, total: Number.MAX_SAFE_INTEGER + 1 }],
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

describe('guided action transport', () => {
  const action: GuidedAction = {
    targetAction: 'formfill',
    refTarget: '#query',
    targetValue: 'up',
    targetState: 'checked:true',
    requirements: ['var-ready:true', 'has-dashboard-named:CPU, memory'],
    targetComment: 'Enter the query.',
    isSkippable: true,
    formHint: 'Use a metric name.',
    validateInput: false,
    lazyRender: true,
    scrollContainer: '#panels',
  };

  it('preserves every guided field and explicit scope', () => {
    const wire = toCrossTabInternalAction(action);
    expect(wire).toEqual(action);
    const message = stepCommand({
      targetAction: 'guided',
      refTarget: '',
      internalActions: [wire],
      stepTimeout: 45_000,
      guideId: 'guide-a',
      contentKey: 'content-a',
    });
    expect(validateCrossTabMessage(message)).toBe(message);
  });

  it.each(['hover', 'button', 'highlight', 'noop', 'formfill'])('accepts the guided verb %s', (targetAction) => {
    expect(
      validateCrossTabMessage(
        stepCommand({ targetAction: 'guided', refTarget: '', internalActions: [{ targetAction }] })
      )
    ).not.toBeNull();
  });

  it('accepts noop only in guided substeps', () => {
    expect(validateCrossTabMessage(stepCommand({ targetAction: 'noop', refTarget: '' }))).toBeNull();
    expect(
      validateCrossTabMessage(
        stepCommand({ targetAction: 'multistep', refTarget: '', internalActions: [{ targetAction: 'noop' }] })
      )
    ).toBeNull();
  });

  it.each(['navigate', 'guided', 'multistep'])('rejects the non-guided substep verb %s', (targetAction) => {
    expect(
      validateCrossTabMessage(
        stepCommand({ targetAction: 'guided', refTarget: '', internalActions: [{ targetAction }] })
      )
    ).toBeNull();
  });

  it.each([
    ['refTarget', 1],
    ['targetValue', {}],
    ['targetState', []],
    ['targetComment', false],
    ['isSkippable', 'true'],
    ['formHint', []],
    ['validateInput', 'false'],
    ['lazyRender', 1],
    ['scrollContainer', null],
    ['requirements', null],
    ['requirements', {}],
    ['requirements', ['is-admin', 1]],
    ['requirements', [['is-admin']]],
    ['requirements', new Array(1)],
    ['requirements', new Array(33).fill('is-admin')],
    ['requirements', ['x'.repeat(513)]],
    ['requirements', 'x'.repeat(16385)],
  ])('rejects malformed %s before dispatch', (field, value) => {
    const invalid = { ...action, [field as string]: value };
    expect(validateCrossTabMessage(stepCommand(invalid))).toBeNull();
    expect(
      validateCrossTabMessage(
        stepCommand({ targetAction: 'guided', refTarget: '', internalActions: [action, invalid] })
      )
    ).toBeNull();
  });

  it('rejects sparse substep arrays', () => {
    expect(
      validateCrossTabMessage(stepCommand({ targetAction: 'guided', refTarget: '', internalActions: new Array(1) }))
    ).toBeNull();
  });

  it.each(
    [[], new Array(32).fill('is-admin'), ['x'.repeat(512)], 'x'.repeat(16384)].map((requirements) => ({ requirements }))
  )('accepts bounded requirements %#', ({ requirements }) => {
    expect(
      validateCrossTabMessage(
        stepCommand({ targetAction: 'guided', refTarget: '', internalActions: [{ ...action, requirements }] })
      )
    ).not.toBeNull();
  });

  it.each([undefined, 30_000, 45_000, 60_000, 120_000, 2_147_483_647])(
    'accepts the authored timeout %s',
    (stepTimeout) => {
      expect(
        validateCrossTabMessage(stepCommand({ targetAction: 'guided', refTarget: '', stepTimeout }))
      ).not.toBeNull();
    }
  );

  it.each([null, false, '30000', 0, -1, NaN, Infinity, -Infinity, 2_147_483_648])(
    'rejects an invalid authored timeout %s',
    (stepTimeout) => {
      expect(validateCrossTabMessage(stepCommand({ targetAction: 'guided', refTarget: '', stepTimeout }))).toBeNull();
    }
  );

  it.each(['guideId', 'contentKey'])('requires string scope for %s', (field) => {
    for (const value of [null, 1, {}, []]) {
      expect(
        validateCrossTabMessage(stepCommand({ targetAction: 'guided', refTarget: '', [field]: value }))
      ).toBeNull();
    }
    expect(validateCrossTabMessage(stepCommand({ targetAction: 'guided', refTarget: '', [field]: '' }))).not.toBeNull();
  });
});

describe('guided substep evidence transport', () => {
  const result: GuidedSubstepResult = { index: 0, action: 'noop', status: 'completed', durationMs: 0 };
  const replies = (substepResults: unknown, total = 5) => [
    envelope({ kind: 'step-progress', stepId: 's', runId: 'r', index: total - 1, total, substepResults }),
    envelope({ kind: 'step-complete', stepId: 's', runId: 'r', ok: false, substepResults }),
  ];

  it('accepts every guided action and settlement status', () => {
    const results: GuidedSubstepResult[] = [
      { ...result, index: 0, action: 'hover', status: 'completed' },
      { ...result, index: 1, action: 'button', status: 'skipped' },
      { ...result, index: 2, action: 'highlight', status: 'timeout' },
      { ...result, index: 3, action: 'formfill', status: 'cancelled' },
      { ...result, index: 4, action: 'noop', status: 'error' },
    ];
    for (const message of replies(results)) {
      expect(validateCrossTabMessage(message)).toBe(message);
    }
  });

  it.each([
    { label: 'omitted', substepResults: undefined },
    { label: 'empty', substepResults: [] },
  ])('accepts $label cumulative results', ({ substepResults }) => {
    for (const message of replies(substepResults)) {
      expect(validateCrossTabMessage(message)).toBe(message);
    }
  });

  it('accepts 1024 cumulative results', () => {
    const results = Array.from({ length: 1024 }, (_, index) => ({ ...result, index }));
    for (const message of replies(results, results.length)) {
      expect(validateCrossTabMessage(message)).toBe(message);
    }
  });
  it('rejects more than 1024 results before reading records, regardless of the reported total', () => {
    const results = Array.from({ length: 1025 }, (_, index) => ({ ...result, index }));
    const readResult = jest.fn(() => result);
    Object.defineProperty(results, '0', { get: readResult });

    for (const message of replies(results, Number.MAX_SAFE_INTEGER)) {
      expect(validateCrossTabMessage(message)).toBeNull();
    }
    expect(readResult).not.toHaveBeenCalled();
  });

  it.each([
    ['missing index', { ...result, index: undefined }],
    ['negative index', { ...result, index: -1 }],
    ['fractional index', { ...result, index: 0.5 }],
    ['string index', { ...result, index: '0' }],
    ['out-of-order index', { ...result, index: 1 }],
    ['unknown action', { ...result, action: 'navigate' }],
    ['nested action', { ...result, action: {} }],
    ['unknown status', { ...result, status: 'waiting' }],
    ['missing duration', { ...result, durationMs: undefined }],
    ['negative duration', { ...result, durationMs: -1 }],
    ['nonfinite duration', { ...result, durationMs: Infinity }],
    ['NaN duration', { ...result, durationMs: NaN }],
    ['string duration', { ...result, durationMs: '10' }],
  ])('rejects a result with %s', (_label, invalid) => {
    for (const message of replies([invalid])) {
      expect(validateCrossTabMessage(message)).toBeNull();
    }
  });

  it.each(
    [null, {}, '[]', [null], [[]], new Array(1), [result, result], [result, { ...result, index: 1, status: {} }]].map(
      (invalid) => ({ invalid })
    )
  )('rejects malformed cumulative results %#', ({ invalid }) => {
    for (const message of replies(invalid)) {
      expect(validateCrossTabMessage(message)).toBeNull();
    }
  });

  it('rejects results beyond the progress total', () => {
    expect(
      validateCrossTabMessage(
        envelope({
          kind: 'step-progress',
          stepId: 's',
          runId: 'r',
          index: 1,
          total: 1,
          substepResults: [result, { ...result, index: 1 }],
        })
      )
    ).toBeNull();
  });
});

describe('RemoteRequirementError wire mirror', () => {
  // Compile-time guard for the deliberate re-statement in cross-tab.types.ts:
  // if CheckResultError and the wire type diverge by a field, a key, or the
  // required/optional-ness of a key, this stops compiling and forces a
  // conscious decision about the wire contract. `WireMirrors` is stricter than
  // plain mutual assignability, which cannot see an optional-only difference.
  it('mirrors CheckResultError exactly, optional fields included', () => {
    const errorMirrorIsExact: WireMirrors<RemoteRequirementError, CheckResultError> = true;
    const local: CheckResultError = { requirement: 'r', pass: true };
    const wire: RemoteRequirementError = local;
    const back: CheckResultError = wire;
    expect(errorMirrorIsExact).toBe(true);
    expect(back).toBe(local);
  });
});

describe('condition array transport', () => {
  it('accepts intact condition arrays', () => {
    const message = envelope({
      kind: 'check-requirements',
      requestId: 'r',
      stepId: 's',
      requirements: ['has-dashboard-named:CPU, memory'],
    });
    expect(validateCrossTabMessage(message)).toBe(message);
  });
  it('rejects non-string condition entries', () => {
    expect(
      validateCrossTabMessage(
        envelope({ kind: 'check-requirements', requestId: 'r', stepId: 's', requirements: ['is-admin', {}] })
      )
    ).toBeNull();
  });

  // The walk runs before the executor's signature gate, so a forged message
  // must not be able to make it iterate an unbounded payload.
  it.each(['check-requirements', 'fix-requirement'] as const)('bounds condition arity on %s', (kind) => {
    expect(
      validateCrossTabMessage(
        envelope({ kind, requestId: 'r', stepId: 's', requirements: new Array(32).fill('is-admin') })
      )
    ).not.toBeNull();
    expect(
      validateCrossTabMessage(
        envelope({ kind, requestId: 'r', stepId: 's', requirements: new Array(33).fill('is-admin') })
      )
    ).toBeNull();
  });

  it.each(['check-requirements', 'fix-requirement'] as const)('bounds each condition token on %s', (kind) => {
    expect(
      validateCrossTabMessage(envelope({ kind, requestId: 'r', stepId: 's', requirements: ['a'.repeat(512)] }))
    ).not.toBeNull();
    expect(
      validateCrossTabMessage(envelope({ kind, requestId: 'r', stepId: 's', requirements: ['a'.repeat(513)] }))
    ).toBeNull();
  });

  it('bounds the legacy comma-separated string form too', () => {
    const kind = 'check-requirements';
    expect(
      validateCrossTabMessage(envelope({ kind, requestId: 'r', stepId: 's', requirements: 'a'.repeat(16384) }))
    ).not.toBeNull();
    expect(
      validateCrossTabMessage(envelope({ kind, requestId: 'r', stepId: 's', requirements: 'a'.repeat(16385) }))
    ).toBeNull();
  });
});
