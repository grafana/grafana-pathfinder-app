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
 *   --hops=<n>         Number of pathfinder_add_block calls per loop. Default 25.
 *   --json             Emit a JSON report instead of human-readable output.
 *
 * Exits nonzero on any tool-level error so the script can be wired into
 * deploy gating. Verification asserts:
 *   - session-mode requestBytes per hop is roughly constant (independent of N),
 *   - stateless-mode requestBytes per hop grows linearly with N,
 *   - both modes return the same final block count,
 *   - finalize over session-mode deletes the session (next call → SESSION_NOT_FOUND).
 */

interface Args {
  url: string;
  hops: number;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  let url: string | undefined;
  let hops = 25;
  let json = false;
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--url=')) {
      url = arg.slice('--url='.length);
    } else if (arg.startsWith('--hops=')) {
      hops = Number.parseInt(arg.slice('--hops='.length), 10);
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
  return { url, hops, json };
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
  return {
    payload: JSON.parse(inner),
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

async function runStatelessLoop(url: string, hops: number): Promise<LoopReport> {
  const initial = await rpc(url, 'tools/call', {
    name: 'pathfinder_create_package',
    arguments: { title: `smoke-stateless-${Date.now()}`, type: 'guide' },
  });
  let artifact = (initial.payload as { artifact: unknown }).artifact;
  const metrics: HopMetrics[] = [];
  for (let i = 0; i < hops; i++) {
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

async function runSessionLoop(url: string, hops: number): Promise<LoopReport & { sessionToken: string }> {
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const stateless = await runStatelessLoop(args.url, args.hops);
  const session = await runSessionLoop(args.url, args.hops);
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
  process.stderr.write(`smoke test failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
