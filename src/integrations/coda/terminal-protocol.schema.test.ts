import { parseTerminalFrame, TerminalStreamOutputSchema } from './terminal-protocol.schema';

/**
 * Wraps a frame the way the Go backend does: JSON marshalled into the first
 * value of a single-field DataFrame, shipped via `sender.SendFrame`. This is
 * the production framing, so it is the shape every test below uses unless it
 * is explicitly exercising one of the fallback shapes.
 */
function asDataFrame(frame: unknown) {
  return {
    schema: { fields: [{ name: 'data', type: 'string' }] },
    data: { values: [[JSON.stringify(frame)]] },
  };
}

function withDataFramePayload(payload: unknown) {
  return {
    schema: { fields: [{ name: 'data', type: 'string' }] },
    data: { values: [[payload]] },
  };
}

describe('parseTerminalFrame — DataFrame path', () => {
  it('accepts each frame variant the backend emits', () => {
    const frames = [
      { type: 'output', data: 'hello\r\n' },
      { type: 'error', error: 'SSH connection failed' },
      { type: 'connected', vmId: 'vm-123' },
      { type: 'disconnected' },
      { type: 'status', state: 'provisioning', message: 'VM is booting...', vmId: 'vm-123' },
      { type: 'heartbeat' },
    ];

    for (const frame of frames) {
      const parsed = parseTerminalFrame(asDataFrame(frame));
      expect(parsed).toEqual({ status: 'ok', frame });
    }
  });

  it('reports a renamed frame type by name', () => {
    const parsed = parseTerminalFrame(asDataFrame({ type: 'sshConnected', vmId: 'vm-123' }));

    expect(parsed.status).toBe('invalid');
    if (parsed.status === 'invalid') {
      expect(parsed.detail).toBe('unknown message type "sshConnected"');
    }
  });

  it('reports a wrongly typed field with its path', () => {
    const parsed = parseTerminalFrame(asDataFrame({ type: 'output', data: 42 }));

    expect(parsed.status).toBe('invalid');
    if (parsed.status === 'invalid') {
      expect(parsed.detail).toContain('data');
      expect(parsed.detail).toContain('expected string');
    }
  });

  it('rejects output and error frames missing the field they exist to carry', () => {
    expect(parseTerminalFrame(asDataFrame({ type: 'output' })).status).toBe('invalid');
    expect(parseTerminalFrame(asDataFrame({ type: 'error' })).status).toBe('invalid');
  });

  it('reports a payload that is not JSON', () => {
    const parsed = parseTerminalFrame({ data: { values: [['not json at all']] } });

    expect(parsed).toEqual({ status: 'invalid', detail: 'payload is not valid JSON' });
  });

  it.each([
    ['null', null, 'data.values.0.0: expected string'],
    ['empty', '', 'data.values.0.0: expected non-empty JSON string'],
    ['numeric', 42, 'data.values.0.0: expected string'],
    ['object', { type: 'connected' }, 'data.values.0.0: expected string'],
  ])('reports a %s payload cell as invalid', (_name, payload, detail) => {
    expect(parseTerminalFrame(withDataFramePayload(payload))).toEqual({ status: 'invalid', detail });
  });
});

describe('parseTerminalFrame — VM state stays open', () => {
  // The backend forwards Coda's raw VM state and formats unrecognized tokens
  // instead of rejecting them, so closing this to an enum would drop frames the
  // backend legitimately sends.
  it.each(['pending', 'provisioning', 'active', 'retrying', 'checking', 'ssh_connecting', 'replacing', 'destroying'])(
    'accepts state "%s"',
    (state) => {
      const parsed = parseTerminalFrame(asDataFrame({ type: 'status', state, message: `VM state: ${state}` }));

      expect(parsed.status).toBe('ok');
      if (parsed.status === 'ok' && parsed.frame.type === 'status') {
        expect(parsed.frame.state).toBe(state);
      }
    }
  );

  it('accepts a status frame with no state, matching the backend omitempty tag', () => {
    expect(parseTerminalFrame(asDataFrame({ type: 'status', message: 'VM state: ' })).status).toBe('ok');
  });
});

describe('parseTerminalFrame — fallback shapes', () => {
  it('accepts a direct JSON object', () => {
    const parsed = parseTerminalFrame({ type: 'connected', vmId: 'vm-9' });

    expect(parsed).toEqual({ status: 'ok', frame: { type: 'connected', vmId: 'vm-9' } });
  });

  it('accepts a raw JSON string', () => {
    const parsed = parseTerminalFrame(JSON.stringify({ type: 'heartbeat' }));

    expect(parsed).toEqual({ status: 'ok', frame: { type: 'heartbeat' } });
  });

  it('reports an object that claims to be a frame but is not one', () => {
    expect(parseTerminalFrame({ type: 'output', data: null }).status).toBe('invalid');
  });

  it('treats a message that never claimed to be a frame as unrecognized', () => {
    expect(parseTerminalFrame({ schema: { fields: [] } })).toEqual({ status: 'unrecognized' });
    expect(parseTerminalFrame({ data: { values: [] } })).toEqual({ status: 'unrecognized' });
    expect(parseTerminalFrame({ data: { values: [[]] } })).toEqual({ status: 'unrecognized' });
    expect(parseTerminalFrame(null)).toEqual({ status: 'unrecognized' });
    expect(parseTerminalFrame(undefined)).toEqual({ status: 'unrecognized' });
    expect(parseTerminalFrame(7)).toEqual({ status: 'unrecognized' });
  });
});

describe('TerminalStreamOutputSchema', () => {
  it('discriminates on type, so each arm narrows on its own', () => {
    expect(TerminalStreamOutputSchema.options.map((option) => option.shape.type.value)).toEqual([
      'output',
      'error',
      'connected',
      'disconnected',
      'status',
      'heartbeat',
    ]);
  });

  it('strips fields the frame variant does not declare', () => {
    const parsed = TerminalStreamOutputSchema.safeParse({ type: 'heartbeat', futureField: 'ignored' });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual({ type: 'heartbeat' });
  });
});
