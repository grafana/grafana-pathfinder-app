/**
 * @jest-environment node
 *
 * Integration tests for `pathfinder_get_schema`. Boots a real MCP server pair
 * (InMemoryTransport) and exercises every mode of the tool.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { CURRENT_SCHEMA_VERSION } from '../../../types/json-guide.schema';
import { buildServer } from '../server';

interface ToolPayload {
  status?: string;
  code?: string;
  [key: string]: unknown;
}

async function callTool(name: string, args: Record<string, unknown>): Promise<ToolPayload> {
  const server = buildServer();
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'schema-tools-test', version: '0' }, { capabilities: {} });
  await client.connect(clientTransport);
  try {
    const result = await client.callTool({ name, arguments: args });
    const blocks = result.content as Array<{ type: string; text: string }>;
    const text = blocks.find((b) => b.type === 'text')?.text;
    if (!text) {
      throw new Error(`${name} returned no text block`);
    }
    return JSON.parse(text) as ToolPayload;
  } finally {
    await client.close();
    await server.close();
  }
}

describe('pathfinder_get_schema', () => {
  describe('mode=one (named schema)', () => {
    it('returns the guide schema with x-schema-version by default', async () => {
      const payload = await callTool('pathfinder_get_schema', { name: 'guide' });
      expect(payload.name).toBe('guide');
      const schema = payload.schema as Record<string, unknown>;
      expect(schema).toBeDefined();
      expect(schema['x-schema-version']).toBe(CURRENT_SCHEMA_VERSION);
      expect(schema['x-refinements']).toBeDefined();
      // The guide schema is the strict root schema — should have required fields.
      expect(schema.type).toBe('object');
    });

    it('omits x-schema-version when includeVersion=false', async () => {
      const payload = await callTool('pathfinder_get_schema', {
        name: 'manifest',
        includeVersion: false,
      });
      const schema = payload.schema as Record<string, unknown>;
      expect(schema['x-schema-version']).toBeUndefined();
    });

    it('returns each registered schema by name', async () => {
      const names = ['guide', 'block', 'content', 'manifest', 'repository', 'graph'];
      for (const name of names) {
        const payload = await callTool('pathfinder_get_schema', { name });
        expect(payload.name).toBe(name);
        expect(payload.schema).toBeDefined();
      }
    });

    it('returns UNKNOWN_SCHEMA for an unregistered name', async () => {
      const payload = await callTool('pathfinder_get_schema', { name: 'nonexistent' });
      expect(payload.status).toBe('error');
      expect(payload.code).toBe('UNKNOWN_SCHEMA');
      expect(payload.message).toMatch(/nonexistent/);
    });

    it('returns MISSING_NAME when mode=one is explicit but name is omitted', async () => {
      const payload = await callTool('pathfinder_get_schema', { mode: 'one' });
      expect(payload.status).toBe('error');
      expect(payload.code).toBe('MISSING_NAME');
    });
  });

  describe('mode=list', () => {
    it('returns the registry summary without payloads', async () => {
      const payload = await callTool('pathfinder_get_schema', { mode: 'list' });
      const schemas = payload.schemas as Array<{ name: string; description: string }>;
      expect(schemas).toBeDefined();
      expect(schemas.length).toBeGreaterThan(0);
      const names = schemas.map((s) => s.name);
      expect(names).toEqual(expect.arrayContaining(['guide', 'block', 'content', 'manifest', 'repository', 'graph']));
      // No payloads in list mode.
      expect((schemas[0] as unknown as { schema?: unknown }).schema).toBeUndefined();
    });
  });

  describe('mode=all', () => {
    it('returns every schema keyed by name when neither name nor mode is supplied', async () => {
      const payload = await callTool('pathfinder_get_schema', {});
      const schemas = payload.schemas as Record<string, Record<string, unknown>>;
      expect(schemas).toBeDefined();
      expect(Object.keys(schemas)).toEqual(
        expect.arrayContaining(['guide', 'block', 'content', 'manifest', 'repository', 'graph'])
      );
      // Available names enumerated alongside payloads.
      expect(payload.available).toBeDefined();
      // Each entry is a JSON Schema object.
      const guideSchema = schemas.guide;
      expect(guideSchema).toBeDefined();
      expect(guideSchema!.type).toBe('object');
    });

    it('honors mode=all explicitly', async () => {
      const payload = await callTool('pathfinder_get_schema', { mode: 'all' });
      const schemas = payload.schemas as Record<string, unknown>;
      expect(schemas.manifest).toBeDefined();
    });
  });
});
