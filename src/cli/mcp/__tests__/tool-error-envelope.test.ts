/**
 * @jest-environment node
 *
 * Integration test for the tool-layer error envelope. Any uncaught throw
 * inside a tool handler must still produce a well-formed CommandOutcome
 * inside a text content block — clients (smoke scripts, agent runtimes)
 * JSON.parse unconditionally, and a non-JSON body crashes them. Pins the
 * `withToolErrorEnvelope` INTERNAL_ERROR catch-all.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { runCreate } from '../../commands/create';
import { readPackage } from '../../utils/package-io';
import { InMemorySessionStore, SESSION_GENERATION_ABSENT, type AuthoringSessionStore } from '../lib/session-store';
import { buildServer } from '../server';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const TOKEN = 'aaaaaaaaaaaaaaaaaaaaaa';

interface ToolPayload {
  status?: string;
  code?: string;
  message?: string;
  sessionToken?: string;
  [key: string]: unknown;
}

interface RawResult {
  text: string;
  payload: ToolPayload;
}

async function newHarness(store: AuthoringSessionStore): Promise<{
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

async function seed(store: AuthoringSessionStore, token: string): Promise<void> {
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
function makeThrowingStore(inner: InMemorySessionStore, err: () => Error): AuthoringSessionStore {
  let armed = true;
  return {
    load: (t) => inner.load(t),
    save: async (t, art, ifGen) => {
      if (armed) {
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
  // Silence the intentional [tool] error log from the INTERNAL_ERROR branch;
  // the contract under test is the well-formed JSON wire response.
  let consoleSpy: jest.SpyInstance;
  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('wraps a raw throw from the store into a well-formed INTERNAL_ERROR', async () => {
    const inner = new InMemorySessionStore();
    await seed(inner, TOKEN);
    const store = makeThrowingStore(inner, () => new Error('totally raw error'));
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
});
