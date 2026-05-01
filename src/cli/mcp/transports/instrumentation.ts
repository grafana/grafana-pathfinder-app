/**
 * Tool-call instrumentation for the Pathfinder MCP server.
 *
 * Provides a registration-time wrapper that observes every tool handler
 * with structured access to the parsed args (before serialization) and the
 * resolved tool result (before SSE/JSON envelope encoding). Used by the
 * HTTP transport to populate the per-request access log; the stdio
 * transport does not opt in.
 *
 * Also owns the per-session hop counter — a small in-memory map keyed by
 * the client's `mcp-session-id` header. This is **observability state**,
 * not authoring state: the artifact model remains stateless, and a fresh
 * `McpServer` is still built per request.
 */

/**
 * Hop counter map TTL. Sessions idle longer than this are evicted on the
 * next sweep so dropped clients don't pin memory indefinitely. 30 minutes
 * is comfortably longer than any real authoring session and short enough
 * that the map stays small under steady-state load.
 */
export const SESSION_TTL_MS = 30 * 60 * 1000;

/**
 * Hard cap on tracked sessions per replica. On overflow we drop the
 * least-recently-seen entry. A counter record is ~32 bytes; 1024 × 32 =
 * 32 KB, trivial against the 512 MiB Cloud Run allocation.
 */
export const MAX_SESSIONS = 1024;

/**
 * What the wrapper observes and forwards to the transport-supplied callback.
 * Fields are populated best-effort; consumers must treat them as optional.
 */
export interface ToolCallObservation {
  /** Tool name as registered (e.g. "pathfinder_add_block"). */
  toolName: string;
  /** True if the resolved tool result had `isError: true`. */
  isError: boolean;
  /**
   * CommandOutcome status if the result text was a CommandOutcome JSON
   * (the shape produced by `outcomeResult` in `tools/result.ts`). Absent
   * when the result text is not parseable or not the expected shape.
   */
  toolStatus?: string;
  /**
   * Byte length of the JSON-stringified `args.artifact` if present.
   * Absent for tools that don't take an artifact (start, help).
   */
  artifactBytesIn?: number;
  /**
   * Byte length of the JSON-stringified artifact echo in the result if
   * present. Absent for read-only or stateless tools.
   */
  artifactBytesOut?: number;
}

export type ToolCallInstrumentation = (observation: ToolCallObservation) => void;

/**
 * Wrap an `McpServer` so every tool handler registered after this call is
 * instrumented. Returns the same server for fluent use. We monkey-patch
 * `registerTool` rather than touching every tool registration site so the
 * tool registry files (`tools/*.ts`) stay free of observability concerns.
 *
 * The original `registerTool` signature varies by SDK version — the wrapper
 * is agnostic: it forwards every argument through and only intercepts the
 * handler (always the last argument).
 */
export function instrumentServer<T extends object>(server: T, hook: ToolCallInstrumentation): T {
  // The SDK's `McpServer.registerTool` is heavily generic; we treat it
  // structurally as a variadic function and forward all arguments through.
  // Only the handler (always last) is rewritten.
  const target = server as unknown as { registerTool: (...args: unknown[]) => unknown };
  const original = target.registerTool.bind(target) as (...args: unknown[]) => unknown;
  target.registerTool = (...args: unknown[]): unknown => {
    if (args.length === 0) {
      return original(...args);
    }
    const handler = args[args.length - 1];
    if (typeof handler !== 'function') {
      return original(...args);
    }
    const toolName = typeof args[0] === 'string' ? args[0] : 'unknown';
    const wrapped = wrapHandler(toolName, handler as (...a: unknown[]) => unknown, hook);
    return original(...args.slice(0, -1), wrapped);
  };
  return server;
}

function wrapHandler(toolName: string, handler: (...args: unknown[]) => unknown, hook: ToolCallInstrumentation) {
  return async (...handlerArgs: unknown[]) => {
    const toolArgs = handlerArgs[0];
    const artifactBytesIn = measureArtifact(toolArgs);
    const result = await handler(...handlerArgs);
    hook({
      toolName,
      isError: extractIsError(result),
      toolStatus: extractToolStatus(result),
      artifactBytesIn,
      artifactBytesOut: extractArtifactBytesOut(result),
    });
    return result;
  };
}

function measureArtifact(toolArgs: unknown): number | undefined {
  if (!toolArgs || typeof toolArgs !== 'object') {
    return undefined;
  }
  const artifact = (toolArgs as { artifact?: unknown }).artifact;
  if (!artifact || typeof artifact !== 'object') {
    return undefined;
  }
  try {
    return Buffer.byteLength(JSON.stringify(artifact));
  } catch {
    return undefined;
  }
}

function extractIsError(result: unknown): boolean {
  if (!result || typeof result !== 'object') {
    return false;
  }
  return (result as { isError?: unknown }).isError === true;
}

interface ParsedTextResult {
  status?: unknown;
  artifact?: unknown;
}

function parseTextResult(result: unknown): ParsedTextResult | undefined {
  if (!result || typeof result !== 'object') {
    return undefined;
  }
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content) || content.length === 0) {
    return undefined;
  }
  const first = content[0];
  if (!first || typeof first !== 'object') {
    return undefined;
  }
  const text = (first as { type?: unknown; text?: unknown }).text;
  if (typeof text !== 'string') {
    return undefined;
  }
  try {
    return JSON.parse(text) as ParsedTextResult;
  } catch {
    return undefined;
  }
}

function extractToolStatus(result: unknown): string | undefined {
  const parsed = parseTextResult(result);
  if (!parsed) {
    return undefined;
  }
  return typeof parsed.status === 'string' ? parsed.status : undefined;
}

function extractArtifactBytesOut(result: unknown): number | undefined {
  const parsed = parseTextResult(result);
  if (!parsed || !parsed.artifact || typeof parsed.artifact !== 'object') {
    return undefined;
  }
  try {
    return Buffer.byteLength(JSON.stringify(parsed.artifact));
  } catch {
    return undefined;
  }
}

interface SessionRecord {
  count: number;
  lastSeen: number;
}

/**
 * Per-session hop counter. Module-scoped so it survives the per-request
 * `buildServer()` lifecycle. Exposed as a class for test isolation — the
 * default singleton lives at the bottom of this file.
 */
export class SessionHopCounter {
  private readonly sessions = new Map<string, SessionRecord>();

  /**
   * Increment and return the current hop count for `sessionId`. Sweeps
   * expired and overflow entries opportunistically. `now` is injectable for
   * tests; callers in production should pass `Date.now()`.
   */
  bump(sessionId: string, now: number = Date.now()): number {
    this.sweep(now);
    const existing = this.sessions.get(sessionId);
    const next = (existing?.count ?? 0) + 1;
    this.sessions.set(sessionId, { count: next, lastSeen: now });
    return next;
  }

  /** Visible for tests. */
  size(): number {
    return this.sessions.size;
  }

  /** Visible for tests. */
  reset(): void {
    this.sessions.clear();
  }

  private sweep(now: number): void {
    // TTL pass: walk and drop expired. O(n) but n ≤ MAX_SESSIONS = 1024.
    for (const [id, record] of this.sessions) {
      if (now - record.lastSeen > SESSION_TTL_MS) {
        this.sessions.delete(id);
      }
    }
    // Overflow pass: if still over cap, drop oldest until under.
    while (this.sessions.size >= MAX_SESSIONS) {
      let oldestId: string | undefined;
      let oldestTs = Infinity;
      for (const [id, record] of this.sessions) {
        if (record.lastSeen < oldestTs) {
          oldestTs = record.lastSeen;
          oldestId = id;
        }
      }
      if (oldestId === undefined) {
        break;
      }
      this.sessions.delete(oldestId);
    }
  }
}

export const defaultSessionHopCounter = new SessionHopCounter();
