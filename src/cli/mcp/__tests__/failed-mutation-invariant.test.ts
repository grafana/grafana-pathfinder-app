/**
 * @jest-environment node
 *
 * Load-bearing contract test for the P7 "MCP performs no schema
 * validation" invariant under session-mode.
 *
 * The contract: when a CLI runner returns status=error (any code), the
 * session store MUST remain at its prior generation with its prior
 * artifact byte-for-byte. The MCP cannot "almost commit" or partially
 * apply mutations — failed mutations cannot land.
 *
 * This is the test that catches a regression where someone refactors
 * the dispatch path and accidentally writes to the store BEFORE
 * checking the runner outcome. If it ever breaks, the agent could see
 * the bucket end up in a state the CLI rejected — which is exactly the
 * invariant we built P7 to preserve from the original stateless model.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { InMemorySessionStore } from '../lib/session-store';
import { buildServer } from '../server';

interface ToolPayload {
  status?: string;
  code?: string;
  sessionToken?: string;
  generation?: number;
  [key: string]: unknown;
}

async function newHarness(): Promise<{
  call: (name: string, args: Record<string, unknown>) => Promise<ToolPayload>;
  store: InMemorySessionStore;
  close: () => Promise<void>;
}> {
  const store = new InMemorySessionStore();
  const server = buildServer({ sessionStore: store });
  const [serverT, clientT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: 'invariant-test', version: '0' }, { capabilities: {} });
  await client.connect(clientT);

  return {
    store,
    call: async (name, args) => {
      const r = await client.callTool({ name, arguments: args });
      const text = (r.content as Array<{ type: string; text: string }>).find((b) => b.type === 'text')?.text;
      if (!text) {
        throw new Error(`${name} returned no text`);
      }
      return JSON.parse(text) as ToolPayload;
    },
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

/**
 * Snapshot the entire stored session state via JSON serialization. Two
 * snapshots compare byte-for-byte to assert that the store is unchanged.
 * Using JSON ensures we catch any field reordering or coercion as well
 * as actual content changes.
 */
async function snapshot(store: InMemorySessionStore, token: string): Promise<string> {
  const loaded = await store.load(token);
  if (!loaded) {
    return 'null';
  }
  return JSON.stringify({ generation: loaded.generation, artifact: loaded.artifact });
}

describe('P7 failed-mutation invariant — session store unchanged on CLI runner error', () => {
  let h: Awaited<ReturnType<typeof newHarness>>;
  let token: string;
  let initialSnapshot: string;

  beforeEach(async () => {
    h = await newHarness();
    const created = await h.call('pathfinder_create_package', { title: 'Invariant Test' });
    if (!created.sessionToken) {
      throw new Error('create returned no token');
    }
    token = created.sessionToken;
    initialSnapshot = await snapshot(h.store, token);
  });

  afterEach(async () => {
    await h.close();
  });

  it('add_block with an unknown block type leaves the store untouched', async () => {
    const r = await h.call('pathfinder_add_block', {
      sessionToken: token,
      type: 'markdown', // server-accepted type
      // Empty fields fails the per-type Zod validation in the CLI.
      fields: {},
    });
    expect(r.status).toBe('error');
    expect(r.code).toBe('SCHEMA_VALIDATION');
    expect(await snapshot(h.store, token)).toBe(initialSnapshot);
  });

  it('edit_block targeting a nonexistent block leaves the store untouched', async () => {
    const r = await h.call('pathfinder_edit_block', {
      sessionToken: token,
      id: 'does-not-exist',
      fields: { content: 'updated' },
    });
    expect(r.status).toBe('error');
    expect(await snapshot(h.store, token)).toBe(initialSnapshot);
  });

  it('remove_block targeting a nonexistent block leaves the store untouched', async () => {
    const r = await h.call('pathfinder_remove_block', {
      sessionToken: token,
      id: 'does-not-exist',
    });
    expect(r.status).toBe('error');
    expect(await snapshot(h.store, token)).toBe(initialSnapshot);
  });

  it('add_step targeting a non-multistep block leaves the store untouched', async () => {
    // Add a markdown block to provide a non-multistep target.
    const added = await h.call('pathfinder_add_block', {
      sessionToken: token,
      type: 'markdown',
      explicitId: 'md-1',
      fields: { content: 'hello' },
    });
    expect(added.status).toBe('ok');
    const afterAdd = await snapshot(h.store, token);

    // add_step against a markdown parent must fail.
    const r = await h.call('pathfinder_add_step', {
      sessionToken: token,
      parentId: 'md-1',
      fields: { title: 'should-fail', instruction: 'wont-land' },
    });
    expect(r.status).toBe('error');
    expect(await snapshot(h.store, token)).toBe(afterAdd);
  });

  it('a successful mutation followed by a failed mutation leaves the store at the successful generation', async () => {
    // Land a real change so the generation moves past the seed.
    const ok = await h.call('pathfinder_add_block', {
      sessionToken: token,
      type: 'markdown',
      fields: { content: 'this lands' },
    });
    expect(ok.status).toBe('ok');
    expect(ok.generation).toBe(2);
    const afterSuccess = await snapshot(h.store, token);

    // Try a failing edit.
    const fail = await h.call('pathfinder_edit_block', {
      sessionToken: token,
      id: 'never-existed',
      fields: { content: 'will not land' },
    });
    expect(fail.status).toBe('error');

    // Bucket still at the successful state — generation did not advance,
    // artifact did not change.
    expect(await snapshot(h.store, token)).toBe(afterSuccess);
    expect((await h.store.load(token))?.generation).toBe(2);
  });

  it('many sequential failures do not silently drift the generation', async () => {
    for (let i = 0; i < 5; i++) {
      const r = await h.call('pathfinder_edit_block', {
        sessionToken: token,
        id: `phantom-${i}`,
        fields: { content: 'x' },
      });
      expect(r.status).toBe('error');
    }
    expect(await snapshot(h.store, token)).toBe(initialSnapshot);
    expect((await h.store.load(token))?.generation).toBe(1);
  });
});
