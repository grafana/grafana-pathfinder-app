/**
 * @jest-environment node
 *
 * Unit tests for the registerTool wrapper and the per-replica session
 * counter. Exercises the wrapper without spinning up an HTTP server, and
 * the counter without the time-source dependency.
 */

import {
  instrumentServer,
  SessionHopCounter,
  SESSION_TTL_MS,
  MAX_SESSIONS,
  type ToolCallObservation,
} from '../transports/instrumentation';

interface FakeServer {
  registerTool: (name: string, schema: unknown, handler: (args: unknown) => unknown) => unknown;
  registered: Array<{ name: string; handler: (args: unknown) => unknown }>;
}

function makeFakeServer(): FakeServer {
  const registered: FakeServer['registered'] = [];
  return {
    registered,
    registerTool: (name, _schema, handler) => {
      registered.push({ name, handler });
      return undefined;
    },
  };
}

describe('instrumentServer', () => {
  it('forwards observations on a successful tool call with an artifact', async () => {
    const observed: ToolCallObservation[] = [];
    const fake = makeFakeServer();
    instrumentServer(fake, (obs) => observed.push(obs));

    fake.registerTool('pathfinder_add_block', {}, async () => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            status: 'ok',
            artifact: { content: { blocks: [{ id: 'a' }] } },
          }),
        },
      ],
    }));

    const handler = fake.registered[0]!.handler;
    const args = { artifact: { content: { blocks: [] } }, type: 'markdown' };
    await handler(args);

    expect(observed).toHaveLength(1);
    const obs = observed[0]!;
    expect(obs.toolName).toBe('pathfinder_add_block');
    expect(obs.isError).toBe(false);
    expect(obs.toolStatus).toBe('ok');
    expect(obs.artifactBytesIn).toBe(Buffer.byteLength(JSON.stringify(args.artifact)));
    expect(obs.artifactBytesOut).toBeGreaterThan(0);
  });

  it('marks isError=true and surfaces toolStatus="error"', async () => {
    const observed: ToolCallObservation[] = [];
    const fake = makeFakeServer();
    instrumentServer(fake, (obs) => observed.push(obs));

    fake.registerTool('pathfinder_add_block', {}, async () => ({
      content: [{ type: 'text', text: JSON.stringify({ status: 'error', code: 'BAD_INPUT' }) }],
      isError: true,
    }));

    await fake.registered[0]!.handler({ artifact: { content: {} } });

    expect(observed[0]!.isError).toBe(true);
    expect(observed[0]!.toolStatus).toBe('error');
    expect(observed[0]!.artifactBytesOut).toBeUndefined();
  });

  it('omits artifact byte fields when args/result have no artifact', async () => {
    const observed: ToolCallObservation[] = [];
    const fake = makeFakeServer();
    instrumentServer(fake, (obs) => observed.push(obs));

    fake.registerTool('pathfinder_authoring_start', {}, async () => ({
      content: [{ type: 'text', text: JSON.stringify({ status: 'ok', workflow: '...' }) }],
    }));

    await fake.registered[0]!.handler({});

    expect(observed[0]!.artifactBytesIn).toBeUndefined();
    expect(observed[0]!.artifactBytesOut).toBeUndefined();
    expect(observed[0]!.toolStatus).toBe('ok');
  });

  it('treats unparseable text content as missing toolStatus, not as failure', async () => {
    const observed: ToolCallObservation[] = [];
    const fake = makeFakeServer();
    instrumentServer(fake, (obs) => observed.push(obs));

    fake.registerTool('pathfinder_help', {}, async () => ({
      content: [{ type: 'text', text: 'not json' }],
    }));

    await fake.registered[0]!.handler({});

    expect(observed[0]!.isError).toBe(false);
    expect(observed[0]!.toolStatus).toBeUndefined();
  });

  it('preserves the original handler return value', async () => {
    const fake = makeFakeServer();
    instrumentServer(fake, () => {});

    const expected = { content: [{ type: 'text', text: '{}' }] };
    fake.registerTool('pathfinder_inspect', {}, async () => expected);

    const result = await fake.registered[0]!.handler({ artifact: { content: {} } });
    expect(result).toBe(expected);
  });
});

describe('SessionHopCounter', () => {
  it('returns monotonically increasing counts per session', () => {
    const c = new SessionHopCounter();
    expect(c.bump('s1')).toBe(1);
    expect(c.bump('s1')).toBe(2);
    expect(c.bump('s2')).toBe(1);
    expect(c.bump('s1')).toBe(3);
  });

  it('evicts entries older than SESSION_TTL_MS', () => {
    const c = new SessionHopCounter();
    const t0 = 1_000_000;
    c.bump('s1', t0);
    c.bump('s2', t0);
    expect(c.size()).toBe(2);

    // Past TTL — sweep on the next bump should drop both.
    c.bump('s3', t0 + SESSION_TTL_MS + 1);
    // s1 and s2 evicted, s3 added.
    expect(c.size()).toBe(1);

    // s1 starts fresh.
    expect(c.bump('s1', t0 + SESSION_TTL_MS + 2)).toBe(1);
  });

  it('drops the oldest entry when the cap is reached', () => {
    const c = new SessionHopCounter();
    const base = 1_000_000;
    // Fill to the cap. Each entry has a strictly increasing lastSeen so
    // the oldest is unambiguous.
    for (let i = 0; i < MAX_SESSIONS; i++) {
      c.bump(`s${i}`, base + i);
    }
    expect(c.size()).toBe(MAX_SESSIONS);

    // One more pushes us over; sweep drops the oldest (s0).
    c.bump('snew', base + MAX_SESSIONS);
    expect(c.size()).toBe(MAX_SESSIONS);
    // s0 is gone, so bumping it again starts back at 1.
    expect(c.bump('s0', base + MAX_SESSIONS + 1)).toBe(1);
  });

  it('reset() clears the map', () => {
    const c = new SessionHopCounter();
    c.bump('a');
    c.bump('b');
    c.reset();
    expect(c.size()).toBe(0);
    expect(c.bump('a')).toBe(1);
  });
});
