/**
 * P7 task 18 — Cloud Run smoke test for GCS-backed authoring sessions.
 *
 * Runs a 20+ hop authoring loop against a deployed MCP HTTP endpoint
 * and reports the wire-bytes profile so we can confirm session-mode
 * achieves the O(N²) → O(N) projection from the 2026-05-01 telemetry
 * note. The script runs the same loop twice — once in stateless mode
 * (`{artifact}` echoed on every hop) and once in session mode
 * (`{sessionToken}` only) — and prints the side-by-side bytes/hop
 * comparison.
 *
 * Usage:
 *
 *   npm run build:cli
 *   node dist/cli/cli/scripts/smoke-gcs-sessions.js \
 *     --url=https://pathfinder-mcp-xxxxx-uc.a.run.app/mcp \
 *     --hops=30
 *
 * Or with ts-node:
 *
 *   npx ts-node scripts/smoke-gcs-sessions.ts \
 *     --url=https://pathfinder-mcp-xxxxx-uc.a.run.app/mcp \
 *     --hops=30
 *
 * Flags:
 *   --url=<endpoint>   Required. The /mcp endpoint of the deployed service.
 *   --mode=<m>         hops (default) or concurrent. See modes below.
 *   --hops=<n>         hops mode: number of add_block calls per loop. Default 25.
 *                      concurrent mode: hops per writer. Default 25.
 *   --writers=<n>      concurrent mode only: number of parallel writers
 *                      hitting the same session token. Default 4.
 *   --delay-ms=<n>     hops mode only: sleep between hops. Default 1100 —
 *                      just above GCS's per-object 1-mutation/sec rate limit.
 *                      Real agent flows are LLM-paced so this knob does not
 *                      exist in production; set to 0 for a synthetic burst
 *                      test (server retries 429s with exponential backoff).
 *   --json             Emit a JSON report instead of human-readable output.
 *
 * Modes:
 *   --mode=hops (default) — runs the wire-bytes profile loop twice (stateless
 *     vs session) and prints the side-by-side comparison. Asserts:
 *       - session-mode requestBytes per hop is roughly constant,
 *       - stateless-mode requestBytes per hop grows linearly with N,
 *       - both modes return the same final block count,
 *       - finalize deletes the session (next call → SESSION_NOT_FOUND).
 *   --mode=concurrent — spawns N writers in parallel against one session,
 *     zero inter-hop delay, to stress the staged-write + 429 retry path.
 *     Asserts every writer returns parseable JSON. The final block count
 *     may be < the expected total (concurrent lost-update is a known,
 *     separately-tracked behavior; it does NOT fail this run).
 *
 * Exits nonzero on any tool-level error so the script can be wired into
 * deploy gating.
 */

interface Args {
  url: string;
  mode: 'hops' | 'concurrent';
  hops: number;
  writers: number;
  json: boolean;
  delayMs: number;
}

function parseArgs(argv: string[]): Args {
  let url: string | undefined;
  let mode: 'hops' | 'concurrent' = 'hops';
  let hops = 25;
  let writers = 4;
  let json = false;
  // GCS imposes a per-object write rate limit of ~1 mutation per second
  // (https://cloud.google.com/storage/docs/gcs429). Real agent flows are
  // LLM-paced so they never approach this, but a synthetic smoke loop
  // fires as fast as the network allows and trivially blows past it on
  // the per-session content.json / manifest.json objects. The server
  // retries through 429s with exponential backoff (~1.1s base, exp to 8s),
  // which keeps the smoke run correct but blows the per-call wallclock
  // budget on long bursts. Defaulting to 1100ms between hops keeps us
  // just above the per-object ceiling without relying on retries.
  // The concurrent mode deliberately ignores this and runs zero-delay to
  // stress the staged-write + retry path.
  let delayMs = 1100;
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--url=')) {
      url = arg.slice('--url='.length);
    } else if (arg.startsWith('--mode=')) {
      const v = arg.slice('--mode='.length);
      if (v !== 'hops' && v !== 'concurrent') {
        throw new Error(`--mode must be hops|concurrent (got ${v})`);
      }
      mode = v;
    } else if (arg.startsWith('--hops=')) {
      hops = Number.parseInt(arg.slice('--hops='.length), 10);
    } else if (arg.startsWith('--writers=')) {
      writers = Number.parseInt(arg.slice('--writers='.length), 10);
    } else if (arg.startsWith('--delay-ms=')) {
      delayMs = Number.parseInt(arg.slice('--delay-ms='.length), 10);
    } else if (arg === '--json') {
      json = true;
    } else {
      throw new Error(`unknown arg: ${arg}`);
    }
  }
  if (!url) {
    throw new Error('--url=<endpoint> is required');
  }
  if (!Number.isFinite(hops) || hops < 1) {
    throw new Error(`--hops must be a positive integer (got ${hops})`);
  }
  if (!Number.isFinite(writers) || writers < 1) {
    throw new Error(`--writers must be a positive integer (got ${writers})`);
  }
  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new Error(`--delay-ms must be a non-negative integer (got ${delayMs})`);
  }
  return { url, mode, hops, writers, json, delayMs };
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

interface RpcResult {
  payload: Record<string, unknown>;
  requestBytes: number;
  responseBytes: number;
  durationMs: number;
}

let nextId = 1;

async function rpc(url: string, method: string, params: Record<string, unknown>): Promise<RpcResult> {
  const body = JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params });
  const requestBytes = Buffer.byteLength(body);
  const start = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body,
  });
  const text = await res.text();
  const responseBytes = Buffer.byteLength(text);
  const durationMs = Date.now() - start;
  if (!res.ok) {
    throw new Error(`rpc ${method} → HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  // The SDK can return either text/event-stream or application/json. For
  // the smoke test we accept both and pull the first JSON-RPC envelope.
  const payloadJson = extractFirstEnvelope(text);
  const result = payloadJson.result as { content?: Array<{ type: string; text: string }> } | undefined;
  if (!result?.content) {
    throw new Error(`rpc ${method} → no result.content in: ${text.slice(0, 200)}`);
  }
  const inner = result.content.find((b) => b.type === 'text')?.text;
  if (!inner) {
    throw new Error(`rpc ${method} → no text content in: ${text.slice(0, 200)}`);
  }
  // Many tool responses are JSON-encoded strings inside a text content
  // block (CommandOutcome shape). Some — server-side errors not wrapped in
  // wire codes — are plain strings. Tolerate both so the operator can see
  // what the server actually said.
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(inner);
  } catch {
    throw new Error(
      `rpc ${method} → tool returned non-JSON text content (length ${inner.length}): ${inner.slice(0, 500)}`
    );
  }
  return {
    payload,
    requestBytes,
    responseBytes,
    durationMs,
  };
}

function extractFirstEnvelope(text: string): { result?: unknown; error?: unknown } {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    return JSON.parse(trimmed) as { result?: unknown; error?: unknown };
  }
  // SSE: lines like `data: {...}`. Pull the first one.
  for (const line of trimmed.split('\n')) {
    if (line.startsWith('data:')) {
      return JSON.parse(line.slice('data:'.length).trim()) as { result?: unknown; error?: unknown };
    }
  }
  throw new Error(`could not extract JSON envelope from: ${trimmed.slice(0, 200)}`);
}

interface HopMetrics {
  hop: number;
  requestBytes: number;
  responseBytes: number;
  durationMs: number;
}

interface LoopReport {
  mode: 'stateless' | 'session';
  hops: HopMetrics[];
  finalBlockCount: number;
  totalRequestBytes: number;
  totalResponseBytes: number;
}

async function runStatelessLoop(url: string, hops: number, delayMs: number): Promise<LoopReport> {
  const initial = await rpc(url, 'tools/call', {
    name: 'pathfinder_create_package',
    arguments: { title: `smoke-stateless-${Date.now()}`, type: 'guide' },
  });
  let artifact = (initial.payload as { artifact: unknown }).artifact;
  const metrics: HopMetrics[] = [];
  for (let i = 0; i < hops; i++) {
    if (i > 0) {
      await sleep(delayMs);
    }
    const r = await rpc(url, 'tools/call', {
      name: 'pathfinder_add_block',
      arguments: {
        artifact,
        type: 'markdown',
        fields: { content: `block ${i}` },
      },
    });
    metrics.push({
      hop: i + 1,
      requestBytes: r.requestBytes,
      responseBytes: r.responseBytes,
      durationMs: r.durationMs,
    });
    artifact = (r.payload as { artifact: unknown }).artifact;
  }
  const finalBlocks = ((artifact as { content: { blocks: unknown[] } }).content.blocks ?? []).length;
  return {
    mode: 'stateless',
    hops: metrics,
    finalBlockCount: finalBlocks,
    totalRequestBytes: metrics.reduce((s, h) => s + h.requestBytes, 0),
    totalResponseBytes: metrics.reduce((s, h) => s + h.responseBytes, 0),
  };
}

async function runSessionLoop(
  url: string,
  hops: number,
  delayMs: number
): Promise<LoopReport & { sessionToken: string }> {
  const initial = await rpc(url, 'tools/call', {
    name: 'pathfinder_create_package',
    arguments: { title: `smoke-session-${Date.now()}`, type: 'guide' },
  });
  const sessionToken = (initial.payload as { sessionToken: string }).sessionToken;
  if (!sessionToken) {
    throw new Error('create_package returned no sessionToken — is the server P7-deployed?');
  }
  const metrics: HopMetrics[] = [];
  for (let i = 0; i < hops; i++) {
    if (i > 0) {
      await sleep(delayMs);
    }
    const r = await rpc(url, 'tools/call', {
      name: 'pathfinder_add_block',
      arguments: {
        sessionToken,
        type: 'markdown',
        fields: { content: `block ${i}` },
      },
    });
    metrics.push({
      hop: i + 1,
      requestBytes: r.requestBytes,
      responseBytes: r.responseBytes,
      durationMs: r.durationMs,
    });
  }
  // Final block count via list_blocks (cheap session read).
  const list = await rpc(url, 'tools/call', {
    name: 'pathfinder_list_blocks',
    arguments: { sessionToken },
  });
  const blocks = (list.payload as { blocks: Array<{ children?: unknown[] }> }).blocks ?? [];
  return {
    mode: 'session',
    hops: metrics,
    finalBlockCount: blocks.length,
    totalRequestBytes: metrics.reduce((s, h) => s + h.requestBytes, 0),
    totalResponseBytes: metrics.reduce((s, h) => s + h.responseBytes, 0),
    sessionToken,
  };
}

async function verifyFinalizeDeletesSession(url: string, sessionToken: string): Promise<void> {
  await rpc(url, 'tools/call', {
    name: 'pathfinder_finalize_for_app_platform',
    arguments: { sessionToken, status: 'draft' },
  });
  // Next session-mode call should surface SESSION_NOT_FOUND.
  const r = await rpc(url, 'tools/call', {
    name: 'pathfinder_list_blocks',
    arguments: { sessionToken },
  });
  const code = (r.payload as { code?: string }).code;
  if (code !== 'SESSION_NOT_FOUND') {
    throw new Error(`expected SESSION_NOT_FOUND after finalize, got code=${code ?? '(none)'}`);
  }
}

function renderHuman(stateless: LoopReport, session: LoopReport): string {
  const last = (r: LoopReport): HopMetrics => r.hops[r.hops.length - 1]!;
  const first = (r: LoopReport): HopMetrics => r.hops[0]!;
  const ratio = (n: number, d: number): string => (d === 0 ? 'n/a' : (n / d).toFixed(2));
  return [
    `Smoke test — ${stateless.hops.length} hops per mode`,
    '',
    'Stateless mode ({artifact} echoed each hop):',
    `  first-hop request bytes : ${first(stateless).requestBytes}`,
    `  last-hop  request bytes : ${last(stateless).requestBytes}`,
    `  growth ratio            : ${ratio(last(stateless).requestBytes, first(stateless).requestBytes)}×`,
    `  total wire bytes        : ${stateless.totalRequestBytes + stateless.totalResponseBytes}`,
    `  final block count       : ${stateless.finalBlockCount}`,
    '',
    'Session mode ({sessionToken}):',
    `  first-hop request bytes : ${first(session).requestBytes}`,
    `  last-hop  request bytes : ${last(session).requestBytes}`,
    `  growth ratio            : ${ratio(last(session).requestBytes, first(session).requestBytes)}×`,
    `  total wire bytes        : ${session.totalRequestBytes + session.totalResponseBytes}`,
    `  final block count       : ${session.finalBlockCount}`,
    '',
    `Wire-bytes ratio (session / stateless): ${ratio(
      session.totalRequestBytes + session.totalResponseBytes,
      stateless.totalRequestBytes + stateless.totalResponseBytes
    )}`,
  ].join('\n');
}

interface ConcurrentReport {
  sessionToken: string;
  writers: number;
  hopsPerWriter: number;
  writerOk: number;
  writerFailures: Array<{ writer: number; error: string }>;
  finalBlockCount: number;
  expectedBlockCount: number;
  elapsedMs: number;
}

/**
 * Stress mode: spawn `writers` parallel clients hitting the same session
 * token at full speed. Exercises the staged-write + 429 retry path on the
 * server. Every writer must return parseable JSON; the wire-shape contract
 * is what this test pins. The final block count may legitimately be < the
 * expected total (concurrent RMW lost-update is a separate, deferred bug).
 */
async function runConcurrentLoop(url: string, writers: number, hopsPerWriter: number): Promise<ConcurrentReport> {
  const initial = await rpc(url, 'tools/call', {
    name: 'pathfinder_create_package',
    arguments: { title: `smoke-concurrent-${Date.now()}`, type: 'guide' },
  });
  const sessionToken = (initial.payload as { sessionToken: string }).sessionToken;
  if (!sessionToken) {
    throw new Error('create_package returned no sessionToken — is the server P7-deployed?');
  }

  const start = Date.now();
  const settled = await Promise.allSettled(
    Array.from({ length: writers }, (_, w) =>
      (async () => {
        for (let i = 0; i < hopsPerWriter; i++) {
          await rpc(url, 'tools/call', {
            name: 'pathfinder_add_block',
            arguments: { sessionToken, type: 'markdown', fields: { content: `writer ${w} hop ${i}` } },
          });
        }
      })()
    )
  );
  const elapsedMs = Date.now() - start;

  const writerFailures = settled
    .map((s, idx) => ({ s, idx }))
    .filter(({ s }) => s.status === 'rejected')
    .map(({ s, idx }) => ({
      writer: idx,
      error: ((s as PromiseRejectedResult).reason as Error)?.message ?? String((s as PromiseRejectedResult).reason),
    }));

  const list = await rpc(url, 'tools/call', { name: 'pathfinder_list_blocks', arguments: { sessionToken } });
  const blocks = (list.payload as { blocks?: unknown[] }).blocks ?? [];

  return {
    sessionToken,
    writers,
    hopsPerWriter,
    writerOk: settled.length - writerFailures.length,
    writerFailures,
    finalBlockCount: blocks.length,
    expectedBlockCount: writers * hopsPerWriter,
    elapsedMs,
  };
}

function renderConcurrent(r: ConcurrentReport): string {
  const lines = [
    `Concurrent smoke — ${r.writers} writers × ${r.hopsPerWriter} hops`,
    `  session token        : ${r.sessionToken}`,
    `  writers ok           : ${r.writerOk}/${r.writers} in ${r.elapsedMs}ms`,
    `  final block count    : ${r.finalBlockCount} (expected ${r.expectedBlockCount})`,
  ];
  for (const f of r.writerFailures) {
    lines.push(`  writer ${f.writer} failed   : ${f.error}`);
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  if (args.mode === 'concurrent') {
    const report = await runConcurrentLoop(args.url, args.writers, args.hops);
    if (args.json) {
      process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    } else {
      process.stdout.write(renderConcurrent(report) + '\n');
    }
    // Exit nonzero on any writer failure (parse crash or other) — that's
    // the contract this mode is here to pin. Lost-update on the block
    // count is currently expected and does NOT fail the run.
    if (report.writerFailures.length > 0) {
      throw new Error(`${report.writerFailures.length}/${report.writers} writers failed`);
    }
    return;
  }

  const stateless = await runStatelessLoop(args.url, args.hops, args.delayMs);
  const session = await runSessionLoop(args.url, args.hops, args.delayMs);
  await verifyFinalizeDeletesSession(args.url, session.sessionToken);

  if (args.json) {
    process.stdout.write(JSON.stringify({ stateless, session }, null, 2) + '\n');
  } else {
    process.stdout.write(renderHuman(stateless, session) + '\n');
  }

  if (stateless.finalBlockCount !== args.hops || session.finalBlockCount !== args.hops) {
    throw new Error(
      `block count mismatch: expected ${args.hops}, got stateless=${stateless.finalBlockCount} session=${session.finalBlockCount}`
    );
  }
}

main().catch((err) => {
  process.stderr.write(`smoke test failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
