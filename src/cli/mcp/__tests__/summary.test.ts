/**
 * Tests for the `summary` field that mutation tools attach to their
 * responses. The shape is `TreeNode[]` from `package-io/summary` —
 * an agent reads this instead of re-parsing `artifact.content` after
 * every mutation.
 *
 * These tests drive the real MCP server through the in-memory transport
 * pair, so they exercise the same path production traffic uses.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import type { TreeNode } from '../../utils/package-io';
import { buildServer } from '../server';

interface SummaryPayload {
  status?: string;
  artifact?: { content: Record<string, unknown>; manifest?: Record<string, unknown> };
  summary?: TreeNode[];
  [key: string]: unknown;
}

async function spinUp(): Promise<{ client: Client; close: () => Promise<void> }> {
  const server = buildServer();
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'summary-test', version: '0' }, { capabilities: {} });
  await client.connect(clientTransport);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<SummaryPayload> {
  const result = await client.callTool({ name, arguments: args });
  const blocks = result.content as Array<{ type: string; text: string }>;
  const text = blocks.find((b) => b.type === 'text')?.text;
  if (!text) {
    throw new Error(`tool ${name} returned no text content`);
  }
  return JSON.parse(text) as SummaryPayload;
}

describe('mutation responses include a TreeNode[] summary', () => {
  it('pathfinder_create_package returns an empty summary', async () => {
    const { client, close } = await spinUp();
    try {
      const created = await call(client, 'pathfinder_create_package', { title: 'Sum1', type: 'guide' });
      expect(created.status).toBe('ok');
      expect(Array.isArray(created.summary)).toBe(true);
      expect(created.summary).toEqual([]);
    } finally {
      await close();
    }
  });

  it('pathfinder_add_block updates the summary tree', async () => {
    const { client, close } = await spinUp();
    try {
      const created = await call(client, 'pathfinder_create_package', { title: 'Sum2', type: 'guide' });
      let artifact = created.artifact!;

      const added = await call(client, 'pathfinder_add_block', {
        artifact,
        type: 'markdown',
        fields: { content: 'Hello' },
      });
      expect(added.status).toBe('ok');
      expect(added.summary).toHaveLength(1);
      expect(added.summary![0]!.type).toBe('markdown');
      expect(added.summary![0]!.path).toBe('blocks[0]');
      expect(added.summary![0]!.children).toBeUndefined();
      artifact = added.artifact!;

      const sectioned = await call(client, 'pathfinder_add_block', {
        artifact,
        type: 'section',
        explicitId: 'intro',
        fields: { title: 'Intro' },
      });
      expect(sectioned.summary).toHaveLength(2);
      const section = sectioned.summary!.find((n) => n.id === 'intro');
      expect(section?.type).toBe('section');
      expect(section?.hint).toBe('Intro');
    } finally {
      await close();
    }
  });

  it('nested children appear under their container in the summary', async () => {
    const { client, close } = await spinUp();
    try {
      const created = await call(client, 'pathfinder_create_package', { title: 'Sum3', type: 'guide' });
      let artifact = created.artifact!;

      const sectioned = await call(client, 'pathfinder_add_block', {
        artifact,
        type: 'section',
        explicitId: 'intro',
        fields: { title: 'Intro' },
      });
      artifact = sectioned.artifact!;

      const nested = await call(client, 'pathfinder_add_block', {
        artifact,
        type: 'markdown',
        parentId: 'intro',
        fields: { content: 'Inside intro' },
      });
      expect(nested.status).toBe('ok');
      expect(nested.summary).toHaveLength(1);
      const section = nested.summary![0]!;
      expect(section.id).toBe('intro');
      expect(section.children).toHaveLength(1);
      expect(section.children![0]!.type).toBe('markdown');
      expect(section.children![0]!.path).toBe('blocks[0].blocks[0]');
    } finally {
      await close();
    }
  });

  it('cascade-removing a container drops its subtree from the summary', async () => {
    const { client, close } = await spinUp();
    try {
      const created = await call(client, 'pathfinder_create_package', { title: 'Sum4', type: 'guide' });
      let artifact = created.artifact!;

      artifact = (
        await call(client, 'pathfinder_add_block', {
          artifact,
          type: 'section',
          explicitId: 'intro',
          fields: { title: 'Intro' },
        })
      ).artifact!;
      artifact = (
        await call(client, 'pathfinder_add_block', {
          artifact,
          type: 'markdown',
          parentId: 'intro',
          fields: { content: 'inside' },
        })
      ).artifact!;

      const removed = await call(client, 'pathfinder_remove_block', {
        artifact,
        id: 'intro',
        cascade: true,
      });
      expect(removed.status).toBe('ok');
      expect(removed.summary).toEqual([]);
    } finally {
      await close();
    }
  });

  it('summary is also returned on validation failure (so the agent can still navigate)', async () => {
    const { client, close } = await spinUp();
    try {
      const created = await call(client, 'pathfinder_create_package', { title: 'Sum5', type: 'guide' });
      const artifact = created.artifact!;

      // Conditional without --conditions trips a CLI-strict guard. The
      // mutation fails but the agent still benefits from receiving the
      // pre-mutation summary.
      const result = await call(client, 'pathfinder_add_block', {
        artifact,
        type: 'conditional',
        explicitId: 'cond-1',
        fields: {},
      });
      expect(result.status).toBe('error');
      expect(Array.isArray(result.summary)).toBe(true);
      expect(result.summary).toEqual([]);
    } finally {
      await close();
    }
  });
});
