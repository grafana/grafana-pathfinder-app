/**
 * @jest-environment node
 *
 * Integration tests for the tool-layer error envelope. When the session
 * store throws — exhausted GCS 429 retries, network blip, auth failure —
 * the tool response must remain a well-formed CommandOutcome inside a
 * text content block. Clients (smoke scripts, agent runtimes) JSON.parse
 * unconditionally; a non-JSON body crashes them. Surface bug:
 *
 *   writer fail #0: Unexpected token 'T', "The object"... is not valid JSON
 *
 * That was a raw GCS rate-limit string leaking through. These tests pin
 * the contract so the leak can't come back.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { runCreate } from '../../commands/create';
import { readPackage } from '../../utils/package-io';
import {
  InMemorySessionStore,
  SESSION_GENERATION_ABSENT,
  SessionStoreUnavailableError,
  type LoadedSession,
  type SessionStore,
} from '../lib/session-store';
import { buildServer } from '../server';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const TOKEN = 'aaaaaaaaaaaaaaaaaaaaaa';

interface ToolPayload {
  status?: string;
  code?: string;
  reason?: string;
  message?: string;
  sessionToken?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

interface RawResult {
  text: string;
  payload: ToolPayload;
}

async function newHarness(store: SessionStore): Promise<{
  call: (name: string, args: Record<string, unknown>) => Promise<RawResult>;
  close: () => Promise<void>;
}> {
  const server = buildServer({ sessionStore: store });
  const [serverT, clientT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: 'envelope-test', version: '0' }, { capabilities: {} });
  await client.connect(clientT);
  return {
    call: async (name, args) => {
      const result = await client.callTool({ name, arguments: args });
      const blocks = result.content as Array<{ type: string; text: string }>;
      const text = blocks.find((b) => b.type === 'text')?.text;
      if (!text) {
        throw new Error(`${name} returned no text block`);
      }
      return { text, payload: JSON.parse(text) as ToolPayload };
    },
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

async function seed(store: SessionStore, token: string): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pathfinder-envelope-seed-'));
  try {
    const pkgDir = path.join(dir, 'pkg');
    const outcome = await runCreate({ dir: pkgDir, id: 'fixture', title: 'Fixture', type: 'guide' });
    if (outcome.status !== 'ok') {
      throw new Error('seed failed');
    }
    const state = readPackage(pkgDir);
    await store.save(token, { content: state.content, manifest: state.manifest }, SESSION_GENERATION_ABSENT);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Wraps an InMemorySessionStore so the next `save` throws the given error. */
function makeUnavailableStore(
  inner: InMemorySessionStore,
  err: () => Error,
  surface: 'save' | 'load' = 'save'
): SessionStore {
  let armed = true;
  return {
    load: async (t): Promise<LoadedSession | null> => {
      if (surface === 'load' && armed) {
        armed = false;
        throw err();
      }
      return inner.load(t);
    },
    save: async (t, art, ifGen) => {
      if (surface === 'save' && armed) {
        armed = false;
        throw err();
      }
      return inner.save(t, art, ifGen);
    },
    delete: (t) => inner.delete(t),
    bindMcpSessionId: (t, id) => inner.bindMcpSessionId(t, id),
    readMcpSessionPin: (t) => inner.readMcpSessionPin(t),
  };
}

describe('tool-layer error envelope', () => {
  // Silence the intentional [tool] error logs from withToolErrorEnvelope's
  // INTERNAL_ERROR branch; they're noise in test output but the contract
  // (well-formed JSON wire response) is what we're asserting.
  let consoleSpy: jest.SpyInstance;
  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe('pathfinder_add_block', () => {
    it('wraps a SessionStoreUnavailableError(rate_limited) into SESSION_STORE_UNAVAILABLE', async () => {
      const inner = new InMemorySessionStore();
      await seed(inner, TOKEN);
      const store = makeUnavailableStore(
        inner,
        () => new SessionStoreUnavailableError('rate_limited', 'simulated rate-limit')
      );
      const h = await newHarness(store);
      try {
        const { text, payload } = await h.call('pathfinder_add_block', {
          sessionToken: TOKEN,
          type: 'markdown',
          fields: { content: 'x' },
        });
        // The response text must be parseable JSON — that's the whole point.
        expect(() => JSON.parse(text)).not.toThrow();
        expect(payload.status).toBe('error');
        expect(payload.code).toBe('SESSION_STORE_UNAVAILABLE');
        expect(payload.data).toMatchObject({ reason: 'rate_limited' });
        expect(payload.sessionToken).toBe(TOKEN);
      } finally {
        await h.close();
      }
    });

    it('wraps a raw (non-typed) error from the store into INTERNAL_ERROR', async () => {
      // This pins the catch-all: if the storage layer ever throws something
      // that isn't a SessionStoreUnavailableError (a coding bug, an error
      // class we forgot to wrap), the wire response is still JSON.
      const inner = new InMemorySessionStore();
      await seed(inner, TOKEN);
      const store = makeUnavailableStore(inner, () => new Error('totally raw error'));
      const h = await newHarness(store);
      try {
        const { text, payload } = await h.call('pathfinder_add_block', {
          sessionToken: TOKEN,
          type: 'markdown',
          fields: { content: 'x' },
        });
        expect(() => JSON.parse(text)).not.toThrow();
        expect(payload.status).toBe('error');
        expect(payload.code).toBe('INTERNAL_ERROR');
      } finally {
        await h.close();
      }
    });

    it('wraps a load-time SessionStoreUnavailableError into SESSION_STORE_UNAVAILABLE', async () => {
      const inner = new InMemorySessionStore();
      await seed(inner, TOKEN);
      const store = makeUnavailableStore(
        inner,
        () => new SessionStoreUnavailableError('transient', 'simulated transient'),
        'load'
      );
      const h = await newHarness(store);
      try {
        const { text, payload } = await h.call('pathfinder_add_block', {
          sessionToken: TOKEN,
          type: 'markdown',
          fields: { content: 'x' },
        });
        expect(() => JSON.parse(text)).not.toThrow();
        expect(payload.code).toBe('SESSION_STORE_UNAVAILABLE');
        expect(payload.data).toMatchObject({ reason: 'transient' });
      } finally {
        await h.close();
      }
    });
  });

  describe('pathfinder_list_blocks', () => {
    it('wraps store-unavailable on a read into SESSION_STORE_UNAVAILABLE', async () => {
      const inner = new InMemorySessionStore();
      await seed(inner, TOKEN);
      const store = makeUnavailableStore(
        inner,
        () => new SessionStoreUnavailableError('rate_limited', 'simulated'),
        'load'
      );
      const h = await newHarness(store);
      try {
        const { text, payload } = await h.call('pathfinder_list_blocks', { sessionToken: TOKEN });
        expect(() => JSON.parse(text)).not.toThrow();
        expect(payload.code).toBe('SESSION_STORE_UNAVAILABLE');
      } finally {
        await h.close();
      }
    });
  });

  describe('pathfinder_finalize_for_app_platform', () => {
    it('wraps store-unavailable on a read into SESSION_STORE_UNAVAILABLE', async () => {
      const inner = new InMemorySessionStore();
      await seed(inner, TOKEN);
      const store = makeUnavailableStore(
        inner,
        () => new SessionStoreUnavailableError('transient', 'simulated'),
        'load'
      );
      const h = await newHarness(store);
      try {
        const { text, payload } = await h.call('pathfinder_finalize_for_app_platform', {
          sessionToken: TOKEN,
          status: 'draft',
        });
        expect(() => JSON.parse(text)).not.toThrow();
        expect(payload.code).toBe('SESSION_STORE_UNAVAILABLE');
      } finally {
        await h.close();
      }
    });
  });
});
