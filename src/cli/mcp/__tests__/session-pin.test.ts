/**
 * P7 task 16 — Mcp-Session-Id binding tests.
 *
 * Covers the three paths from the design:
 *
 *   1. MATCH    — mint over header A, subsequent call with header A succeeds.
 *   2. MISMATCH — mint over header A, subsequent call with header B
 *                  surfaces SESSION_NOT_FOUND (404, not 403 — the pin is
 *                  a confidentiality boundary).
 *   3. ABSENT   — mint over header A, subsequent call with no header
 *                  succeeds (stdio fallback). Also: mint with no header,
 *                  any subsequent call succeeds (no pin to enforce).
 *
 * Tests build a server per call to simulate the per-request McpServer
 * the HTTP transport constructs — each request picks up its own
 * `mcpSessionId` value (or undefined).
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

async function callTool(
  store: InMemorySessionStore,
  mcpSessionId: string | undefined,
  name: string,
  args: Record<string, unknown>
): Promise<ToolPayload> {
  const server = buildServer({ sessionStore: store, mcpSessionId });
  const [s, c] = InMemoryTransport.createLinkedPair();
  await server.connect(s);
  const client = new Client({ name: 'session-pin-test', version: '0' }, { capabilities: {} });
  await client.connect(c);
  try {
    const result = await client.callTool({ name, arguments: args });
    const blocks = result.content as Array<{ type: string; text: string }>;
    const text = blocks.find((b) => b.type === 'text')?.text;
    if (!text) {
      throw new Error(`${name} returned no text`);
    }
    return JSON.parse(text) as ToolPayload;
  } finally {
    await client.close();
    await server.close();
  }
}

async function mintSession(
  store: InMemorySessionStore,
  mcpSessionId: string | undefined
): Promise<string> {
  const r = await callTool(store, mcpSessionId, 'pathfinder_create_package', {
    title: 'pin-test',
    type: 'guide',
  });
  if (typeof r.sessionToken !== 'string') {
    throw new Error('create_package did not return a sessionToken');
  }
  return r.sessionToken;
}

describe('Mcp-Session-Id binding (P7 task 16)', () => {
  describe('happy path — matching pin', () => {
    it('lets subsequent mutations through when the header matches the pin', async () => {
      const store = new InMemorySessionStore();
      const token = await mintSession(store, 'transport-session-A');
      expect(await store.readMcpSessionPin(token)).toBe('transport-session-A');

      const r = await callTool(store, 'transport-session-A', 'pathfinder_add_block', {
        sessionToken: token,
        type: 'markdown',
        fields: { content: 'hello' },
      });
      expect(r.status).toBe('ok');
      expect(r.generation).toBe(2);
    });

    it('lets subsequent reads through when the header matches the pin', async () => {
      const store = new InMemorySessionStore();
      const token = await mintSession(store, 'transport-session-A');

      const r = await callTool(store, 'transport-session-A', 'pathfinder_list_blocks', {
        sessionToken: token,
      });
      expect(r.status).toBe('ok');
    });
  });

  describe('mismatch — SESSION_NOT_FOUND (per design: 404, not 403)', () => {
    it('rejects a mutation from a different transport session', async () => {
      const store = new InMemorySessionStore();
      const token = await mintSession(store, 'transport-session-A');

      const r = await callTool(store, 'transport-session-B', 'pathfinder_add_block', {
        sessionToken: token,
        type: 'markdown',
        fields: { content: 'hello' },
      });
      // 404 (SESSION_NOT_FOUND), not 403. The pin is a confidentiality
      // boundary; we don't leak "exists but not yours."
      expect(r.code).toBe('SESSION_NOT_FOUND');
    });

    it('rejects a read from a different transport session', async () => {
      const store = new InMemorySessionStore();
      const token = await mintSession(store, 'transport-session-A');

      const r = await callTool(store, 'transport-session-B', 'pathfinder_get_manifest_session', {
        sessionToken: token,
      });
      expect(r.code).toBe('SESSION_NOT_FOUND');
    });

    it('rejects an inspect from a different transport session', async () => {
      const store = new InMemorySessionStore();
      const token = await mintSession(store, 'transport-session-A');

      const r = await callTool(store, 'transport-session-B', 'pathfinder_inspect', {
        sessionToken: token,
      });
      expect(r.code).toBe('SESSION_NOT_FOUND');
    });

    it('rejects a finalize from a different transport session', async () => {
      const store = new InMemorySessionStore();
      const token = await mintSession(store, 'transport-session-A');

      const r = await callTool(store, 'transport-session-B', 'pathfinder_finalize_for_app_platform', {
        sessionToken: token,
        status: 'draft',
      });
      expect(r.code).toBe('SESSION_NOT_FOUND');

      // Important: the rejected finalize did NOT delete the session.
      // Otherwise an attacker who guessed a token could nuke a stranger's
      // session even though they can't read it.
      expect(await store.load(token)).not.toBeNull();
    });
  });

  describe('absent — skip check', () => {
    it('skips the pin check when the request omits the header (stdio fallback)', async () => {
      const store = new InMemorySessionStore();
      const token = await mintSession(store, 'transport-session-A');

      const r = await callTool(store, undefined, 'pathfinder_add_block', {
        sessionToken: token,
        type: 'markdown',
        fields: { content: 'hello' },
      });
      expect(r.status).toBe('ok');
    });

    it('skips the pin check when no pin was bound at mint time', async () => {
      const store = new InMemorySessionStore();
      // Mint with no header (stdio-style mint).
      const token = await mintSession(store, undefined);
      expect(await store.readMcpSessionPin(token)).toBeNull();

      // Subsequent call with a header still succeeds — no pin to enforce.
      // Design choice: we do NOT lazily bind the pin on first-with-header
      // access. Otherwise a bystander could claim a stdio-minted session.
      const r = await callTool(store, 'transport-session-A', 'pathfinder_list_blocks', {
        sessionToken: token,
      });
      expect(r.status).toBe('ok');
      expect(await store.readMcpSessionPin(token)).toBeNull();
    });
  });
});
