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
 * downstream by the agent's own credentials. Abuse mitigations live here:
 *   - request body size cap (`MAX_REQUEST_BYTES`)
 *   - per-call wallclock budget (`PER_CALL_WALLCLOCK_MS`)
 *   - global concurrency cap (`MAX_CONCURRENT_REQUESTS`) — excess returns 503
 *   - slowloris / idle timeouts on the underlying http.Server
 *   - structured access log to stderr (one JSON line per request)
 *   - GET /healthz endpoint that does not construct an McpServer
 *
 * The access log includes `bytesIn`, `bytesOut`, and heuristic token
 * estimates (`bytes / 4`, rounded up). Token estimates are useful for
 * spotting outliers and trends; authoritative billing comes from the
 * model host, not this log.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { buildServer } from '../server';
import { defaultSessionHopCounter, type SessionHopCounter, type ToolCallObservation } from './instrumentation';

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

/**
 * Maximum number of MCP requests in flight at once. Each in-flight request
 * holds a fresh McpServer, a per-call tmpdir, and up to PER_CALL_WALLCLOCK_MS
 * of wallclock. Cap chosen to bound worst-case resource use on a single
 * replica: 100 × 30s × ~1MB tmpdir is the upper envelope. Exceeding this
 * returns 503 immediately so the load balancer can shed to a healthy
 * replica or rate-limit upstream.
 */
export const MAX_CONCURRENT_REQUESTS = 100;

/**
 * Idle / header timeouts on the underlying http.Server. These close the
 * slowloris door — a client that opens a TCP connection and dribbles bytes
 * cannot tie up a connection slot indefinitely.
 *   - keepAliveTimeout: how long an idle keep-alive connection lingers.
 *   - headersTimeout: max time to receive the full request headers.
 *   - requestTimeout: max wallclock from connection accept to body end.
 *     Set higher than PER_CALL_WALLCLOCK_MS so the handler-level timeout
 *     produces a structured 504 instead of a TCP reset.
 */
export const KEEPALIVE_TIMEOUT_MS = 5_000;
export const HEADERS_TIMEOUT_MS = 10_000;
export const REQUEST_TIMEOUT_MS = 60_000;

export interface RunHttpOptions {
  port: number;
  /** Hostname to bind. Defaults to '0.0.0.0'. */
  host?: string;
  /** Path prefix for the MCP endpoint. Defaults to '/mcp'. */
  path?: string;
  /** Healthcheck path. Defaults to '/healthz'. */
  healthPath?: string;
  /**
   * Override the access logger (one structured JSON line per request).
   * Defaults to writing to stderr. Pass `() => {}` to silence in tests.
   */
  log?: (entry: AccessLogEntry) => void;
  /**
   * Override the per-replica session hop counter. Tests pass a dedicated
   * instance for isolation; production uses the module singleton.
   */
  sessionHopCounter?: SessionHopCounter;
  /**
   * Override the per-call wallclock budget in milliseconds. Tests use a tiny
   * value to assert the 504 timeout path; production omits this and gets
   * `PER_CALL_WALLCLOCK_MS`.
   */
  wallclockMs?: number;
  /**
   * Override the server factory. Default constructs the production
   * `buildServer({ instrumentation })`. Tests override this to register a
   * deliberately-slow tool that exercises the wallclock timeout path
   * without racing against real authoring tools.
   */
  buildServer?: (instrumentation: (obs: ToolCallObservation) => void) => McpServer;
}

export interface HttpHandle {
  server: Server;
  port: number;
  close(): Promise<void>;
}

export interface AccessLogEntry {
  ts: string;
  remote: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  bytesIn: number;
  bytesOut: number;
  /**
   * Heuristic token estimate: ceil(bytes / 4). Rough lower bound for
   * English/JSON tokens under common BPE tokenizers; over-estimates for
   * CJK / base64 / random binary. Useful for spotting outliers; not
   * authoritative for billing.
   */
  tokensInEstimate: number;
  tokensOutEstimate: number;
  outcome: 'ok' | 'too_large' | 'bad_json' | 'overloaded' | 'timeout' | 'not_found' | 'error';
  /**
   * JSON-RPC method from the parsed request body (e.g. "tools/call",
   * "tools/list", "initialize"). Absent for non-RPC requests (healthcheck,
   * 404s, malformed bodies). For batch requests the value is "batch".
   */
  rpcMethod?: string;
  /**
   * For `tools/call` requests, the `params.name` value (e.g.
   * "pathfinder_add_block"). Lets us break token spend down by tool, which
   * the HTTP-level `path` field cannot — every tool call hits `/mcp`.
   */
  rpcToolName?: string;
  /**
   * Echoed JSON-RPC id, for cross-correlating client logs with server logs.
   * Strings, numbers, and null are preserved as-is; objects/arrays are
   * dropped to keep the log line tidy.
   */
  rpcId?: string | number | null;
  /** Number of envelopes in a batch request. Absent for single requests. */
  batchSize?: number;
  /**
   * MCP session id from the client's `mcp-session-id` header, when
   * supplied. Lets us reconstruct an authoring run end-to-end; clustering
   * by remote IP fails as soon as two clients share egress NAT.
   */
  sessionId?: string;
  /**
   * Hop count within this MCP session. Increments only on `tools/call`,
   * so `initialize`, `tools/list`, and SSE polls do not bump it. Lets us
   * plot tokens-per-hop curves directly per session.
   */
  sessionHopCount?: number;
  /**
   * Byte length of the JSON-stringified `args.artifact` on tools/call
   * requests that carry an artifact. The artifact-only number is the
   * apples-to-apples signal for O(N²) reasoning; `bytesIn` includes the
   * full JSON-RPC envelope and tool-args wrapper.
   */
  artifactBytesIn?: number;
  /**
   * Byte length of the JSON-stringified artifact echoed back in the tool
   * result. Absent for tools that don't return an artifact.
   */
  artifactBytesOut?: number;
  /**
   * True when the resolved tool result had `isError: true`. The HTTP
   * envelope is still 200 in that case (and `outcome` stays `ok`), so
   * without this field the log can't surface tool-level rejection.
   */
  toolError?: boolean;
  /**
   * `CommandOutcome.status` from the structured tool result, when
   * recognizable (most authoring tools wrap the CLI's CommandOutcome
   * verbatim via `outcomeResult`). Best-effort.
   */
  toolStatus?: string;
}

interface RpcInfo {
  rpcMethod?: string;
  rpcToolName?: string;
  rpcId?: string | number | null;
  batchSize?: number;
}

/**
 * Extract JSON-RPC method, tool name, and id from a parsed request body.
 *
 * Defensive: the body is `unknown` here (it has only been JSON.parsed, not
 * validated). Any shape we don't recognize returns an empty object so the
 * log line still emits with the standard fields.
 */
function extractRpcInfo(body: unknown): RpcInfo {
  if (Array.isArray(body)) {
    // JSON-RPC batch. Surface the size; individual methods would clutter
    // the log line and batches are rare in practice for this server.
    return { rpcMethod: 'batch', batchSize: body.length };
  }
  if (!body || typeof body !== 'object') {
    return {};
  }
  const obj = body as { method?: unknown; id?: unknown; params?: unknown };
  const info: RpcInfo = {};
  if (typeof obj.method === 'string') {
    info.rpcMethod = obj.method;
  }
  if (typeof obj.id === 'string' || typeof obj.id === 'number' || obj.id === null) {
    info.rpcId = obj.id;
  }
  if (info.rpcMethod === 'tools/call' && obj.params && typeof obj.params === 'object') {
    const name = (obj.params as { name?: unknown }).name;
    if (typeof name === 'string') {
      info.rpcToolName = name;
    }
  }
  return info;
}

/** Heuristic char-to-token estimate. See AccessLogEntry doc. */
function estimateTokens(bytes: number): number {
  return Math.ceil(bytes / 4);
}

const defaultLog = (entry: AccessLogEntry): void => {
  process.stderr.write(JSON.stringify(entry) + '\n');
};

export async function runHttp(options: RunHttpOptions): Promise<HttpHandle> {
  const path = options.path ?? '/mcp';
  const healthPath = options.healthPath ?? '/healthz';
  const host = options.host ?? '0.0.0.0';
  const log = options.log ?? defaultLog;
  const sessionHopCounter = options.sessionHopCounter ?? defaultSessionHopCounter;
  const wallclockMs = options.wallclockMs ?? PER_CALL_WALLCLOCK_MS;
  const factory =
    options.buildServer ?? ((instrumentation: (obs: ToolCallObservation) => void) => buildServer({ instrumentation }));

  const state = { inFlight: 0 };

  const server = createServer((req, res) => {
    void handleRequest(req, res, path, healthPath, state, log, sessionHopCounter, wallclockMs, factory);
  });

  server.keepAliveTimeout = KEEPALIVE_TIMEOUT_MS;
  server.headersTimeout = HEADERS_TIMEOUT_MS;
  server.requestTimeout = REQUEST_TIMEOUT_MS;

  await new Promise<void>((resolve) => server.listen(options.port, host, resolve));
  const address = server.address();
  const boundPort = typeof address === 'object' && address ? address.port : options.port;

  return {
    server,
    port: boundPort,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

interface ConcurrencyState {
  inFlight: number;
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  mcpPath: string,
  healthPath: string,
  state: ConcurrencyState,
  log: (entry: AccessLogEntry) => void,
  sessionHopCounter: SessionHopCounter,
  wallclockMs: number,
  factory: (instrumentation: (obs: ToolCallObservation) => void) => McpServer
): Promise<void> {
  const start = Date.now();
  const remote = req.socket.remoteAddress ?? 'unknown';
  const method = req.method ?? 'GET';
  const reqPath = parsePath(req.url);
  const sessionId = readSessionId(req);
  let bytesIn = 0;
  let bytesOut = 0;
  let rpc: RpcInfo = {};
  let sessionHopCount: number | undefined;
  let observation: ToolCallObservation | undefined;

  // Wrap res.write/end so every byte path (SSE chunks, error helpers, the
  // SDK's StreamableHTTPServerTransport writes) gets counted in one place.
  // The wrapper preserves the original `this` binding by calling through to
  // the captured originals on `res`.
  const origWrite = res.write.bind(res);
  const origEnd = res.end.bind(res);
  const countChunk = (chunk: unknown): void => {
    if (chunk === undefined || chunk === null) {
      return;
    }
    if (typeof chunk === 'string' || Buffer.isBuffer(chunk) || chunk instanceof Uint8Array) {
      bytesOut += Buffer.byteLength(chunk as string | Buffer);
    }
  };
  res.write = ((chunk: unknown, ...rest: unknown[]) => {
    countChunk(chunk);
    return (origWrite as (...args: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof res.write;
  res.end = ((chunk?: unknown, ...rest: unknown[]) => {
    countChunk(chunk);
    return (origEnd as (...args: unknown[]) => ServerResponse)(chunk, ...rest);
  }) as typeof res.end;

  const finish = (status: number, outcome: AccessLogEntry['outcome']): void => {
    log({
      ts: new Date().toISOString(),
      remote,
      method,
      path: reqPath,
      status,
      durationMs: Date.now() - start,
      bytesIn,
      bytesOut,
      tokensInEstimate: estimateTokens(bytesIn),
      tokensOutEstimate: estimateTokens(bytesOut),
      outcome,
      ...rpc,
      ...(sessionId !== undefined ? { sessionId } : {}),
      ...(sessionHopCount !== undefined ? { sessionHopCount } : {}),
      ...(observation?.artifactBytesIn !== undefined ? { artifactBytesIn: observation.artifactBytesIn } : {}),
      ...(observation?.artifactBytesOut !== undefined ? { artifactBytesOut: observation.artifactBytesOut } : {}),
      ...(observation ? { toolError: observation.isError } : {}),
      ...(observation?.toolStatus !== undefined ? { toolStatus: observation.toolStatus } : {}),
    });
  };

  // Healthcheck: cheap, no McpServer, no body parsing. Probes hit this on
  // every replica every few seconds — keep it allocation-light.
  if (method === 'GET' && reqPath === healthPath) {
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"ok"}');
    finish(200, 'ok');
    return;
  }

  if (reqPath !== mcpPath) {
    writeJsonRpcError(res, 404, -32601, `Not found: ${reqPath}`);
    finish(404, 'not_found');
    return;
  }

  // Concurrency gate. We bump `inFlight` only after we've decided to handle
  // the request so 503-rejected requests don't double-count against the cap.
  if (state.inFlight >= MAX_CONCURRENT_REQUESTS) {
    res.writeHead(503, { 'content-type': 'application/json', 'retry-after': '1' }).end(
      JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32002,
          message: `Server at capacity (${MAX_CONCURRENT_REQUESTS} concurrent requests). Retry shortly.`,
        },
        id: null,
      })
    );
    finish(503, 'overloaded');
    return;
  }

  state.inFlight += 1;
  try {
    let body: unknown;
    try {
      const read = await readJsonBody(req);
      body = read.body;
      bytesIn = read.bytes;
      rpc = extractRpcInfo(body);
      if (rpc.rpcMethod === 'tools/call' && sessionId !== undefined) {
        sessionHopCount = sessionHopCounter.bump(sessionId);
      }
    } catch (err) {
      if (err instanceof RequestTooLarge) {
        writeJsonRpcError(res, 413, -32700, err.message);
        finish(413, 'too_large');
      } else {
        writeJsonRpcError(res, 400, -32700, err instanceof Error ? err.message : 'Bad request');
        finish(400, 'bad_json');
      }
      return;
    }

    // Stateless mode: build a fresh server + transport per request. This is
    // intentional — the authoring tool surface holds no per-session state, and
    // sharing one transport across requests would require session tracking
    // we explicitly do not want. The instrumentation callback only fires
    // for `tools/call`; on tools/list and initialize `observation` stays
    // undefined and the log line elides the tool fields.
    const mcp = factory((obs) => {
      observation = obs;
    });
    const transport = new StreamableHTTPServerTransport({});

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (!res.headersSent) {
        writeJsonRpcError(res, 504, -32001, `Wallclock budget exceeded (${wallclockMs}ms)`);
      }
      void transport.close();
    }, wallclockMs);

    try {
      await mcp.connect(transport);
      await transport.handleRequest(req, res, body);
      finish(res.statusCode, timedOut ? 'timeout' : 'ok');
    } catch (err) {
      if (!res.headersSent) {
        writeJsonRpcError(res, 500, -32000, err instanceof Error ? err.message : 'Internal error');
      }
      // If the wallclock timer fired, the response is already a 504 and the
      // handler typically rejects because the transport was closed under it.
      // Surface that as `timeout` so the access log doesn't misclassify
      // timeouts as generic errors.
      finish(res.statusCode || 500, timedOut ? 'timeout' : 'error');
    } finally {
      clearTimeout(timer);
      void transport.close();
      void mcp.close();
    }
  } finally {
    state.inFlight -= 1;
  }
}

/**
 * Read the MCP session id from request headers. The SDK runs in stateless
 * mode (no `sessionIdGenerator`), so it neither validates nor strips the
 * header — clients that send one (Cursor, Claude Desktop) reach us
 * unchanged; ad-hoc curl callers that omit it get `undefined`.
 *
 * Header values can theoretically be string[] under Node's IncomingMessage
 * typings; in practice `mcp-session-id` is single-valued. We pick the first
 * occurrence either way and require it to be non-empty.
 */
function readSessionId(req: IncomingMessage): string | undefined {
  const raw = req.headers['mcp-session-id'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function parsePath(url: string | undefined): string {
  if (!url) {
    return '/';
  }
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

function writeJsonRpcError(res: ServerResponse, httpStatus: number, code: number, message: string): void {
  if (res.headersSent) {
    return;
  }
  res.writeHead(httpStatus, { 'content-type': 'application/json' }).end(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code, message },
      id: null,
    })
  );
}

class RequestTooLarge extends Error {
  constructor() {
    super(`Request body exceeds ${MAX_REQUEST_BYTES} bytes`);
  }
}

interface ReadResult {
  body: unknown;
  bytes: number;
}

function readJsonBody(req: IncomingMessage): Promise<ReadResult> {
  return new Promise((resolve, reject) => {
    if (req.method === 'GET' || req.method === 'DELETE') {
      // The streamable transport handles GET (SSE polling) and DELETE
      // (session termination) without a body. Pass undefined so the
      // transport's own parsing path runs.
      resolve({ body: undefined, bytes: 0 });
      return;
    }

    let total = 0;
    let aborted = false;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      if (aborted) {
        return;
      }
      total += chunk.length;
      if (total > MAX_REQUEST_BYTES) {
        aborted = true;
        // Pause rather than destroy: destroying tears down the shared
        // request/response socket before our 413 body has flushed, leaving
        // the client to see a TCP RST instead of the structured error.
        req.pause();
        reject(new RequestTooLarge());
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({ body: undefined, bytes: total });
        return;
      }
      try {
        resolve({ body: JSON.parse(Buffer.concat(chunks).toString('utf-8')), bytes: total });
      } catch (err) {
        reject(err instanceof Error ? err : new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}
