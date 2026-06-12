/**
 * @jest-environment node
 *
 * Tests for the P7 fine-grained read tools:
 *   - pathfinder_list_blocks
 *   - pathfinder_get_block
 *   - pathfinder_get_manifest_session
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
  blocks?: Array<{ id: string; type: string }>;
  block?: { id?: string; type?: string; content?: string };
  manifest?: Record<string, unknown> | null;
  [key: string]: unknown;
}

const BOGUS_TOKEN = 'zzzzzzzzzzzzzzzzzzzzzz';

async function newHarness(): Promise<{
  call: (n: string, a: Record<string, unknown>) => Promise<ToolPayload>;
  store: InMemorySessionStore;
  close: () => Promise<void>;
}> {
  const store = new InMemorySessionStore();
  const server = buildServer({ sessionStore: store });
  const [serverT, clientT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: 'session-read-test', version: '0' }, { capabilities: {} });
  await client.connect(clientT);
  return {
    store,
    call: async (name, args) => {
      const r = await client.callTool({ name, arguments: args });
      const text = (r.content as Array<{ type: string; text: string }>).find((b) => b.type === 'text')?.text;
      if (!text) {
        throw new Error('no text');
      }
      return JSON.parse(text) as ToolPayload;
    },
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

async function seedWithOneBlock(
  call: (n: string, a: Record<string, unknown>) => Promise<ToolPayload>
): Promise<string> {
  const created = await call('pathfinder_create_package', { title: 'Reads Test' });
  if (!created.sessionToken) {
    throw new Error('create failed');
  }
  const added = await call('pathfinder_add_block', {
    sessionToken: created.sessionToken,
    type: 'markdown',
    explicitId: 'md-1',
    fields: { content: 'Hello world' },
  });
  if (added.status !== 'ok') {
    throw new Error(`add_block failed: ${JSON.stringify(added)}`);
  }
  return created.sessionToken;
}

describe('pathfinder_list_blocks', () => {
  it('returns the tree summary for a real session', async () => {
    const h = await newHarness();
    try {
      const token = await seedWithOneBlock(h.call);
      const r = await h.call('pathfinder_list_blocks', { sessionToken: token });
      expect(r.status).toBe('ok');
      expect(r.sessionToken).toBe(token);
      expect(r.generation).toBe(2);
      expect(Array.isArray(r.blocks)).toBe(true);
      expect(r.blocks!.length).toBe(1);
      expect(r.blocks![0]?.id).toBe('md-1');
      expect(r.blocks![0]?.type).toBe('markdown');
    } finally {
      await h.close();
    }
  });

  it('returns SESSION_NOT_FOUND for an unknown token', async () => {
    const h = await newHarness();
    try {
      const r = await h.call('pathfinder_list_blocks', { sessionToken: BOGUS_TOKEN });
      expect(r.code).toBe('SESSION_NOT_FOUND');
    } finally {
      await h.close();
    }
  });

  it('returns INVALID_SESSION_TOKEN for a malformed token', async () => {
    const h = await newHarness();
    try {
      const r = await h.call('pathfinder_list_blocks', { sessionToken: 'too-short' });
      expect(r.code).toBe('INVALID_SESSION_TOKEN');
    } finally {
      await h.close();
    }
  });
});

describe('pathfinder_get_block', () => {
  it('returns the block by id', async () => {
    const h = await newHarness();
    try {
      const token = await seedWithOneBlock(h.call);
      const r = await h.call('pathfinder_get_block', { sessionToken: token, blockId: 'md-1' });
      expect(r.status).toBe('ok');
      expect(r.block?.id).toBe('md-1');
      expect(r.block?.type).toBe('markdown');
      expect(r.block?.content).toBe('Hello world');
    } finally {
      await h.close();
    }
  });

  it('returns NOT_FOUND for an unknown block id (with generation echoed)', async () => {
    const h = await newHarness();
    try {
      const token = await seedWithOneBlock(h.call);
      const r = await h.call('pathfinder_get_block', { sessionToken: token, blockId: 'never-existed' });
      expect(r.code).toBe('NOT_FOUND');
      expect(r.sessionToken).toBe(token);
      expect(r.generation).toBe(2);
    } finally {
      await h.close();
    }
  });

  it('returns SESSION_NOT_FOUND for an unknown token', async () => {
    const h = await newHarness();
    try {
      const r = await h.call('pathfinder_get_block', { sessionToken: BOGUS_TOKEN, blockId: 'anything' });
      expect(r.code).toBe('SESSION_NOT_FOUND');
    } finally {
      await h.close();
    }
  });
});

describe('pathfinder_get_manifest_session', () => {
  it('returns the manifest for a real session', async () => {
    const h = await newHarness();
    try {
      const created = await newHarness();
      try {
        const r = await created.call('pathfinder_create_package', { title: 'Manifest Test' });
        const m = await created.call('pathfinder_get_manifest_session', { sessionToken: r.sessionToken });
        expect(m.status).toBe('ok');
        // create_package always sets up a manifest with the package id + type.
        expect(m.manifest).not.toBeNull();
        expect((m.manifest as Record<string, unknown>).id).toBeDefined();
      } finally {
        await created.close();
      }
    } finally {
      await h.close();
    }
  });

  it('returns SESSION_NOT_FOUND for unknown token', async () => {
    const h = await newHarness();
    try {
      const r = await h.call('pathfinder_get_manifest_session', { sessionToken: BOGUS_TOKEN });
      expect(r.code).toBe('SESSION_NOT_FOUND');
    } finally {
      await h.close();
    }
  });
});
