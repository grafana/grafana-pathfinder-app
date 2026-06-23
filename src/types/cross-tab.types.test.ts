import { validateCrossTabMessage } from './cross-tab.types';

function envelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { source: 'pathfinder', senderId: 'sender-1', timestamp: 1, ...overrides };
}

describe('validateCrossTabMessage', () => {
  it('accepts a well-formed step-command', () => {
    const message = envelope({
      kind: 'step-command',
      phase: 'do',
      stepId: 's1',
      action: { targetAction: 'button', refTarget: 'Save' },
    });
    expect(validateCrossTabMessage(message)).toBe(message);
  });

  it('accepts a well-formed heartbeat', () => {
    const message = envelope({ kind: 'heartbeat', role: 'live' });
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
      action: { targetAction: 'exec', refTarget: '#x' },
    });
    expect(validateCrossTabMessage(message)).toBeNull();
  });

  it.each([
    [
      'bad phase',
      { kind: 'step-command', phase: 'destroy', stepId: 's1', action: { targetAction: 'button', refTarget: 'x' } },
    ],
    ['missing stepId', { kind: 'step-command', phase: 'do', action: { targetAction: 'button', refTarget: 'x' } }],
    ['non-object action', { kind: 'step-command', phase: 'do', stepId: 's1', action: 'button' }],
    ['missing refTarget', { kind: 'step-command', phase: 'do', stepId: 's1', action: { targetAction: 'button' } }],
  ])('rejects a malformed step-command (%s)', (_label, partial) => {
    expect(validateCrossTabMessage(envelope(partial))).toBeNull();
  });

  it('rejects a heartbeat with an invalid role', () => {
    expect(validateCrossTabMessage(envelope({ kind: 'heartbeat', role: 'admin' }))).toBeNull();
  });

  it('accepts a sidebar-handoff with a known action and rejects others', () => {
    expect(validateCrossTabMessage(envelope({ kind: 'sidebar-handoff', action: 'close' }))).not.toBeNull();
    expect(validateCrossTabMessage(envelope({ kind: 'sidebar-handoff', action: 'reopen' }))).not.toBeNull();
    expect(validateCrossTabMessage(envelope({ kind: 'sidebar-handoff', action: 'detonate' }))).toBeNull();
    expect(validateCrossTabMessage(envelope({ kind: 'sidebar-handoff' }))).toBeNull();
  });
});
