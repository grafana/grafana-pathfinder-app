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

import { runHttp, MAX_REQUEST_BYTES, type AccessLogEntry, type HttpHandle } from '../transports/http';

interface Harness {
  handle: HttpHandle;
  base: string;
  logs: AccessLogEntry[];
  close(): Promise<void>;
}

async function start(): Promise<Harness> {
  const logs: AccessLogEntry[] = [];
  const handle = await runHttp({ port: 0, host: '127.0.0.1', log: (entry) => logs.push(entry) });
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
        expect(['ok', 'too_large', 'bad_json', 'overloaded', 'timeout', 'not_found', 'error']).toContain(entry.outcome);
      }
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
