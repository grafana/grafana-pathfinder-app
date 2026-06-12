/**
 * @jest-environment node
 *
 * Tests for the P7 session-mode branch on pathfinder_inspect and
 * pathfinder_validate. The existing stateless-mode tests in
 * artifact-tools.test.ts and server.test.ts continue to cover the
 * artifact-in/artifact-out path; this file pins the session-mode
 * additions.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { InMemorySessionStore } from '../lib/session-store';
import { buildServer } from '../server';

interface ToolPayload {
  status?: string;
  code?: string;
  artifact?: { content: { id: string; title: string; blocks: unknown[] } };
  data?: { blocks?: unknown[]; block?: unknown };
  [key: string]: unknown;
}

const TOKEN = 'aaaaaaaaaaaaaaaaaaaaaa';

async function newHarness(): Promise<{
  call: (n: string, a: Record<string, unknown>) => Promise<ToolPayload>;
  store: InMemorySessionStore;
  close: () => Promise<void>;
}> {
  const store = new InMemorySessionStore();
  const server = buildServer({ sessionStore: store });
  const [serverT, clientT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: 'inspect-session-test', version: '0' }, { capabilities: {} });
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

async function mintSession(call: (n: string, a: Record<string, unknown>) => Promise<ToolPayload>): Promise<string> {
  const created = await call('pathfinder_create_package', { title: 'Inspect Test' });
  if (!created.sessionToken) {
    throw new Error('mint failed');
  }
  return created.sessionToken as string;
}

describe('pathfinder_inspect — session mode', () => {
  it('loads the session and returns the artifact', async () => {
    const h = await newHarness();
    try {
      const token = await mintSession(h.call);
      const r = await h.call('pathfinder_inspect', { sessionToken: token });
      expect(r.status).toBe('ok');
      expect(r.artifact?.content.title).toBe('Inspect Test');
    } finally {
      await h.close();
    }
  });

  it('returns SESSION_NOT_FOUND for an unknown token', async () => {
    const h = await newHarness();
    try {
      const r = await h.call('pathfinder_inspect', { sessionToken: TOKEN });
      expect(r.code).toBe('SESSION_NOT_FOUND');
    } finally {
      await h.close();
    }
  });

  it('errors INPUT_MODE_AMBIGUOUS when both artifact and sessionToken are provided', async () => {
    const h = await newHarness();
    try {
      const token = await mintSession(h.call);
      const r = await h.call('pathfinder_inspect', {
        sessionToken: token,
        artifact: { content: { id: 'x', title: 'x', blocks: [] } },
      });
      expect(r.code).toBe('INPUT_MODE_AMBIGUOUS');
    } finally {
      await h.close();
    }
  });

  it('errors INPUT_MODE_MISSING when neither is provided', async () => {
    const h = await newHarness();
    try {
      const r = await h.call('pathfinder_inspect', {});
      expect(r.code).toBe('INPUT_MODE_MISSING');
    } finally {
      await h.close();
    }
  });
});

describe('pathfinder_validate — session mode', () => {
  it('validates a session-stored artifact', async () => {
    const h = await newHarness();
    try {
      const token = await mintSession(h.call);
      const r = await h.call('pathfinder_validate', { sessionToken: token });
      // Fresh artifact from create may or may not pass validation by
      // itself (depending on manifest defaults). We assert the dispatch
      // worked — no INPUT_MODE / SESSION_NOT_FOUND error from the
      // input-resolution layer. The outcome itself can be ok OR a
      // genuine validation error; both prove the session-mode read path
      // resolved the artifact.
      expect(r.code).not.toBe('SESSION_NOT_FOUND');
      expect(r.code).not.toBe('INPUT_MODE_AMBIGUOUS');
      expect(r.code).not.toBe('INPUT_MODE_MISSING');
      expect(r.code).not.toBe('INVALID_SESSION_TOKEN');
    } finally {
      await h.close();
    }
  });

  it('returns SESSION_NOT_FOUND on bad token', async () => {
    const h = await newHarness();
    try {
      const r = await h.call('pathfinder_validate', { sessionToken: TOKEN });
      expect(r.code).toBe('SESSION_NOT_FOUND');
    } finally {
      await h.close();
    }
  });

  it('still works with stateless {artifact}', async () => {
    const h = await newHarness();
    try {
      const r = await h.call('pathfinder_validate', {
        artifact: {
          content: { id: 'inline', title: 'Inline', blocks: [] },
        },
      });
      expect(r.code).not.toBe('INPUT_MODE_MISSING');
    } finally {
      await h.close();
    }
  });
});
