/**
 * HTTP transport for the Pathfinder authoring MCP server.
 *
 * Uses the SDK's StreamableHTTP transport in **stateless mode** —
 * `sessionIdGenerator` is omitted so each request gets a fresh transport
 * and there is no server-side session state. This matches the design's
 * stateless artifact model: the in-flight artifact is passed in and
 * returned out on every tool call.
 *
 * **No authentication.** Per the resolved open question in
 * AI-AUTHORING-IMPLEMENTATION.md, the MVP HTTP transport ships open. The
 * MCP holds no privileged resource; the App Platform write is performed
 * downstream by the agent's own credentials. Abuse mitigations are in
 * code (request body size cap, per-call wallclock budget) and at the
 * deployment edge (per-IP rate limits, autoscaling ceiling).
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { buildServer } from '../server';

/**
 * Maximum size of an inbound request body, in bytes. Anything larger is
 * rejected before the transport sees it. Sized for a typical multi-block
 * authoring artifact (a few hundred KB) plus headroom; pathological inputs
 * fail loud rather than burning wallclock through validation.
 */
export const MAX_REQUEST_BYTES = 1_000_000;

/**
 * Per-call wallclock budget, in milliseconds. The MCP tool handler races
 * the in-process work against this timeout; on expiry the response is a
 * structured error and the underlying call is abandoned.
 */
export const PER_CALL_WALLCLOCK_MS = 30_000;

export interface RunHttpOptions {
  port: number;
  /** Hostname to bind. Defaults to '0.0.0.0'. */
  host?: string;
  /** Path prefix for the MCP endpoint. Defaults to '/mcp'. */
  path?: string;
}

export interface HttpHandle {
  server: Server;
  port: number;
  close(): Promise<void>;
}

export async function runHttp(options: RunHttpOptions): Promise<HttpHandle> {
  const path = options.path ?? '/mcp';
  const host = options.host ?? '0.0.0.0';

  const server = createServer((req, res) => {
    void handleRequest(req, res, path);
  });

  await new Promise<void>((resolve) => server.listen(options.port, host, resolve));
  const address = server.address();
  const boundPort = typeof address === 'object' && address ? address.port : options.port;

  return {
    server,
    port: boundPort,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

async function handleRequest(req: IncomingMessage, res: ServerResponse, mcpPath: string): Promise<void> {
  if (!req.url || !req.url.startsWith(mcpPath)) {
    res.writeHead(404, { 'content-type': 'application/json' }).end(
      JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32601, message: `Not found: ${req.url}` },
        id: null,
      })
    );
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    const code = err instanceof RequestTooLarge ? 413 : 400;
    res.writeHead(code, { 'content-type': 'application/json' }).end(
      JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32700, message: err instanceof Error ? err.message : 'Bad request' },
        id: null,
      })
    );
    return;
  }

  // Stateless mode: build a fresh server + transport per request. This is
  // intentional — the authoring tool surface holds no per-session state, and
  // sharing one transport across requests would require session tracking
  // we explicitly do not want.
  const mcp = buildServer();
  const transport = new StreamableHTTPServerTransport({});

  const timer = setTimeout(() => {
    if (!res.headersSent) {
      res.writeHead(504, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32001, message: `Wallclock budget exceeded (${PER_CALL_WALLCLOCK_MS}ms)` },
          id: null,
        })
      );
    }
    void transport.close();
  }, PER_CALL_WALLCLOCK_MS);

  try {
    await mcp.connect(transport);
    await transport.handleRequest(req, res, body);
  } finally {
    clearTimeout(timer);
    void transport.close();
    void mcp.close();
  }
}

class RequestTooLarge extends Error {
  constructor() {
    super(`Request body exceeds ${MAX_REQUEST_BYTES} bytes`);
  }
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (req.method === 'GET' || req.method === 'DELETE') {
      // The streamable transport handles GET (SSE polling) and DELETE
      // (session termination) without a body. Pass undefined so the
      // transport's own parsing path runs.
      resolve(undefined);
      return;
    }

    let total = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_REQUEST_BYTES) {
        req.destroy();
        reject(new RequestTooLarge());
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
      } catch (err) {
        reject(err instanceof Error ? err : new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}
