/**
 * Concurrent-writers smoke test for the GCS session store.
 *
 * Fires N writers in parallel against a single sessionToken to stress the
 * staged-write + 429-retry path introduced in P7-D / P7-E. A correct
 * implementation finishes with WRITERS * HOPS_PER_WRITER blocks and zero
 * writer failures.
 *
 * Usage:
 *   npx tsx scripts/smoke-concurrent.ts <url> [writers=4] [hops=10]
 */
const URL_ARG = process.argv[2];
const WRITERS = Number(process.argv[3] ?? 4);
const HOPS_PER_WRITER = Number(process.argv[4] ?? 10);

if (!URL_ARG) {
  console.error('usage: smoke-concurrent.ts <url> [writers] [hops]');
  process.exit(2);
}

async function rpc(name: string, args: object): Promise<any> {
  const res = await fetch(URL_ARG, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  const envRaw = text.startsWith('{')
    ? text
    : text
        .split('\n')
        .find((l) => l.startsWith('data:'))!
        .slice(5)
        .trim();
  const env = JSON.parse(envRaw);
  if (env.error) throw new Error(`rpc error: ${JSON.stringify(env.error)}`);
  return JSON.parse(env.result.content.find((c: any) => c.type === 'text').text);
}

async function main() {
  const created = await rpc('pathfinder_create_package', { title: `concurrent-${Date.now()}`, type: 'guide' });
  const sessionToken: string = created.sessionToken;
  console.log('session:', sessionToken);
  console.log(`writers=${WRITERS} hops/writer=${HOPS_PER_WRITER} expected_blocks=${WRITERS * HOPS_PER_WRITER}`);

  const start = Date.now();
  const results = await Promise.allSettled(
    Array.from({ length: WRITERS }, (_, w) =>
      (async () => {
        for (let i = 0; i < HOPS_PER_WRITER; i++) {
          await rpc('pathfinder_add_block', {
            sessionToken,
            type: 'markdown',
            fields: { content: `writer ${w} hop ${i}` },
          });
        }
      })()
    )
  );
  const elapsedMs = Date.now() - start;

  const failed = results.filter((r) => r.status === 'rejected');
  console.log(`writers ok: ${results.length - failed.length}/${results.length} in ${elapsedMs}ms`);
  failed.forEach((r: any, idx) => console.log(`  writer fail #${idx}: ${r.reason?.message ?? r.reason}`));

  const list = await rpc('pathfinder_list_blocks', { sessionToken });
  const got = list.blocks?.length ?? -1;
  const expected = WRITERS * HOPS_PER_WRITER;
  console.log(`final block count: ${got} (expected ${expected})`);
  if (got !== expected) {
    console.log('LOST UPDATES — staged-write atomicity may be broken');
    process.exit(1);
  }
  console.log('OK');
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
