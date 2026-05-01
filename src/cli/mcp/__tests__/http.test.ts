/**
 * @jest-environment node
 *
 * Tests for the HTTP transport's abuse-mitigation surface: body-size cap,
 * wallclock timeout, healthcheck, 404 routing, concurrency cap, and the
 * structured access log shape.
 *
 * Each test boots a real `runHttp` listener on an ephemeral port (port 0),
 * exercises it with `fetch`, and tears it down. We capture access-log
 * entries by injecting a `log` collector, so assertions don't depend on
 * stderr scraping.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { CURRENT_SCHEMA_VERSION } from '../../../types/json-guide.schema';
import { runHttp, MAX_REQUEST_BYTES, type AccessLogEntry, type HttpHandle } from '../transports/http';
import { SessionHopCounter } from '../transports/instrumentation';

interface Harness {
  handle: HttpHandle;
  base: string;
  logs: AccessLogEntry[];
  close(): Promise<void>;
}

interface StartOptions {
  wallclockMs?: number;
  /** Sleep duration injected into a `slow_sleep` tool, when buildServer is overridden. */
  slowSleepMs?: number;
}

async function start(opts: StartOptions = {}): Promise<Harness> {
  const logs: AccessLogEntry[] = [];
  // Use a fresh counter per harness so test ordering doesn't bleed hop
  // counts across cases.
  const handle = await runHttp({
    port: 0,
    host: '127.0.0.1',
    log: (entry) => logs.push(entry),
    sessionHopCounter: new SessionHopCounter(),
    wallclockMs: opts.wallclockMs,
    buildServer:
      opts.slowSleepMs !== undefined
        ? () => {
            // Tiny synthetic server that exposes a tool which deliberately
            // sleeps. The server replies after the sleep, so the wallclock
            // timer can win the race deterministically.
            const ms = opts.slowSleepMs!;
            const server = new McpServer(
              { name: 'test-slow', version: CURRENT_SCHEMA_VERSION },
              { capabilities: { tools: {} } }
            );
            server.registerTool(
              'slow_sleep',
              {
                description: 'Sleeps for the configured duration before replying.',
                inputSchema: { _: z.unknown().optional() },
              },
              async () => {
                await new Promise<void>((resolve) => setTimeout(resolve, ms));
                return { content: [{ type: 'text', text: 'done' }] };
              }
            );
            return server;
          }
        : undefined,
  });
  return {
    handle,
    base: `http://127.0.0.1:${handle.port}`,
    logs,
    close: () => handle.close(),
  };
}

describe('HTTP transport', () => {
  it('serves /healthz without constructing an McpServer', async () => {
    const h = await start();
    try {
      const res = await fetch(`${h.base}/healthz`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: 'ok' });
      expect(h.logs.at(-1)?.outcome).toBe('ok');
      expect(h.logs.at(-1)?.path).toBe('/healthz');
    } finally {
      await h.close();
    }
  });

  it('returns 404 with a JSON-RPC error envelope for unknown paths', async () => {
    const h = await start();
    try {
      const res = await fetch(`${h.base}/nope`);
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: { code: number } };
      expect(body.error.code).toBe(-32601);
      expect(h.logs.at(-1)?.outcome).toBe('not_found');
    } finally {
      await h.close();
    }
  });

  it('does not match /mcp as a prefix (e.g. /mcpfoo is 404)', async () => {
    const h = await start();
    try {
      const res = await fetch(`${h.base}/mcpfoo`, { method: 'POST', body: '{}' });
      expect(res.status).toBe(404);
    } finally {
      await h.close();
    }
  });

  it('rejects bodies larger than MAX_REQUEST_BYTES with 413', async () => {
    const h = await start();
    try {
      const oversized = 'x'.repeat(MAX_REQUEST_BYTES + 1);
      const res = await fetch(`${h.base}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: oversized,
      });
      expect(res.status).toBe(413);
      const body = (await res.json()) as { error: { code: number; message: string } };
      expect(body.error.code).toBe(-32700);
      expect(body.error.message).toContain(String(MAX_REQUEST_BYTES));
      expect(h.logs.at(-1)?.outcome).toBe('too_large');
    } finally {
      await h.close();
    }
  });

  it('rejects malformed JSON with 400', async () => {
    const h = await start();
    try {
      const res = await fetch(`${h.base}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not json',
      });
      expect(res.status).toBe(400);
      expect(h.logs.at(-1)?.outcome).toBe('bad_json');
    } finally {
      await h.close();
    }
  });

  it('handles a valid JSON-RPC tools/list request', async () => {
    const h = await start();
    try {
      const res = await fetch(`${h.base}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
      // Streamable HTTP responds 200 with either JSON or SSE depending on
      // the Accept header. We don't assert on the body shape here — that's
      // covered by the in-memory transport tests; we just want proof the
      // wire path works end-to-end.
      expect(res.status).toBe(200);
      expect(h.logs.at(-1)?.outcome).toBe('ok');
      expect(h.logs.at(-1)?.bytesIn).toBeGreaterThan(0);
    } finally {
      await h.close();
    }
  });

  it('emits a structured access log entry per request', async () => {
    const h = await start();
    try {
      await fetch(`${h.base}/healthz`);
      await fetch(`${h.base}/nope`);
      expect(h.logs.length).toBeGreaterThanOrEqual(2);
      for (const entry of h.logs) {
        expect(typeof entry.ts).toBe('string');
        expect(typeof entry.durationMs).toBe('number');
        expect(typeof entry.status).toBe('number');
        expect(typeof entry.bytesIn).toBe('number');
        expect(typeof entry.bytesOut).toBe('number');
        expect(typeof entry.tokensInEstimate).toBe('number');
        expect(typeof entry.tokensOutEstimate).toBe('number');
        expect(['ok', 'too_large', 'bad_json', 'overloaded', 'timeout', 'not_found', 'error']).toContain(entry.outcome);
      }
    } finally {
      await h.close();
    }
  });

  it('counts response bytes and emits proportional token estimates', async () => {
    const h = await start();
    try {
      await fetch(`${h.base}/healthz`);
      const entry = h.logs.at(-1)!;
      expect(entry.bytesOut).toBeGreaterThan(0);
      // {"status":"ok"} is 15 bytes -> ceil(15/4) = 4 tokens.
      expect(entry.tokensOutEstimate).toBe(Math.ceil(entry.bytesOut / 4));
      expect(entry.tokensInEstimate).toBe(Math.ceil(entry.bytesIn / 4));
    } finally {
      await h.close();
    }
  });

  it('counts inbound and outbound bytes on a real MCP request', async () => {
    const h = await start();
    try {
      const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
      const res = await fetch(`${h.base}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body,
      });
      expect(res.status).toBe(200);
      const entry = h.logs.at(-1)!;
      expect(entry.bytesIn).toBe(Buffer.byteLength(body));
      expect(entry.bytesOut).toBeGreaterThan(0);
      expect(entry.tokensInEstimate).toBeGreaterThan(0);
      expect(entry.tokensOutEstimate).toBeGreaterThan(0);
    } finally {
      await h.close();
    }
  });

  it('logs the JSON-RPC method on a parsed request', async () => {
    const h = await start();
    try {
      await fetch(`${h.base}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/list' }),
      });
      const entry = h.logs.at(-1)!;
      expect(entry.rpcMethod).toBe('tools/list');
      expect(entry.rpcId).toBe(7);
      expect(entry.rpcToolName).toBeUndefined();
      expect(entry.batchSize).toBeUndefined();
    } finally {
      await h.close();
    }
  });

  it('logs the tool name on tools/call requests', async () => {
    const h = await start();
    try {
      await fetch(`${h.base}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'abc',
          method: 'tools/call',
          params: { name: 'pathfinder_authoring_start', arguments: {} },
        }),
      });
      const entry = h.logs.at(-1)!;
      expect(entry.rpcMethod).toBe('tools/call');
      expect(entry.rpcToolName).toBe('pathfinder_authoring_start');
      expect(entry.rpcId).toBe('abc');
    } finally {
      await h.close();
    }
  });

  it('marks JSON-RPC batches with rpcMethod=batch and a size', async () => {
    const h = await start();
    try {
      await fetch(`${h.base}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify([
          { jsonrpc: '2.0', id: 1, method: 'tools/list' },
          { jsonrpc: '2.0', id: 2, method: 'tools/list' },
        ]),
      });
      const entry = h.logs.at(-1)!;
      expect(entry.rpcMethod).toBe('batch');
      expect(entry.batchSize).toBe(2);
      expect(entry.rpcToolName).toBeUndefined();
    } finally {
      await h.close();
    }
  });

  it('omits rpc fields entirely on non-RPC requests', async () => {
    const h = await start();
    try {
      await fetch(`${h.base}/healthz`);
      const entry = h.logs.at(-1)!;
      expect(entry.rpcMethod).toBeUndefined();
      expect(entry.rpcToolName).toBeUndefined();
      expect(entry.rpcId).toBeUndefined();
      expect(entry.batchSize).toBeUndefined();
    } finally {
      await h.close();
    }
  });

  it('records sessionId from the mcp-session-id header', async () => {
    const h = await start();
    try {
      await fetch(`${h.base}/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-session-id': 'sess-123',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
      const entry = h.logs.at(-1)!;
      expect(entry.sessionId).toBe('sess-123');
      // tools/list does not bump the hop counter.
      expect(entry.sessionHopCount).toBeUndefined();
    } finally {
      await h.close();
    }
  });

  it('omits sessionId when the client sends no header', async () => {
    const h = await start();
    try {
      await fetch(`${h.base}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
      const entry = h.logs.at(-1)!;
      expect(entry.sessionId).toBeUndefined();
      expect(entry.sessionHopCount).toBeUndefined();
    } finally {
      await h.close();
    }
  });

  it('bumps sessionHopCount only on tools/call and surfaces tool fields', async () => {
    const h = await start();
    try {
      const callBody = JSON.stringify({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: { name: 'pathfinder_authoring_start', arguments: {} },
      });
      const callOnce = () =>
        fetch(`${h.base}/mcp`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            'mcp-session-id': 'sess-hop',
          },
          body: callBody,
        });

      await callOnce();
      const first = h.logs.at(-1)!;
      expect(first.rpcMethod).toBe('tools/call');
      expect(first.rpcToolName).toBe('pathfinder_authoring_start');
      expect(first.sessionId).toBe('sess-hop');
      expect(first.sessionHopCount).toBe(1);
      expect(first.toolError).toBe(false);

      await callOnce();
      const second = h.logs.at(-1)!;
      expect(second.sessionHopCount).toBe(2);

      // A non-tools/call request mid-session must not bump the counter.
      await fetch(`${h.base}/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-session-id': 'sess-hop',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 8, method: 'tools/list' }),
      });
      const listEntry = h.logs.at(-1)!;
      expect(listEntry.sessionHopCount).toBeUndefined();

      // Next tools/call resumes from 3, not 1.
      await callOnce();
      expect(h.logs.at(-1)!.sessionHopCount).toBe(3);
    } finally {
      await h.close();
    }
  });

  it('logs outcome=timeout when a tool call exceeds the wallclock budget', async () => {
    // Inject a synthetic server with a tool that sleeps 500ms; cap the
    // wallclock at 50ms. With Accept: text/event-stream, the SDK opens SSE
    // and writes 200 + headers before the tool runs, so the wire status
    // stays 200 even on timeout. What we *can* assert is that the timer
    // fired (transport closed under the handler) and the access log
    // surfaces `outcome: 'timeout'` — which is the field SREs actually
    // alert on. A buffered-JSON 504 path exists in code (if headers are
    // still unsent when the timer fires), but is unreachable through the
    // SDK on tools/call because SSE always wins the race.
    const h = await start({ wallclockMs: 50, slowSleepMs: 500 });
    try {
      const res = await fetch(`${h.base}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'slow_sleep', arguments: {} },
        }),
      });
      // Drain the body so the connection cleans up regardless of stream shape.
      await res.arrayBuffer().catch(() => undefined);
      expect(h.logs.at(-1)?.outcome).toBe('timeout');
      expect(h.logs.at(-1)?.rpcToolName).toBe('slow_sleep');
    } finally {
      await h.close();
    }
  });

  it('closes the listener on handle.close()', async () => {
    const h = await start();
    await h.close();
    await expect(fetch(`${h.base}/healthz`)).rejects.toBeDefined();
  });
});
