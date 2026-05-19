/**
 * @jest-environment node
 *
 * Integration tests for `pathfinder_create_guide_template`. Boots a real
 * MCP server pair (InMemoryTransport) and exercises the tool, then
 * round-trips the returned artifact through `pathfinder_validate` to
 * confirm the template is schema-clean by construction.
 *
 * `pathfinder_create_package` is exercised via the broader hardening-flow
 * suite and is not duplicated here.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { CURRENT_SCHEMA_VERSION } from '../../../types/json-guide.schema';
import { buildServer } from '../server';

interface ToolPayload {
  status?: string;
  code?: string;
  artifact?: { content: Record<string, unknown>; manifest?: Record<string, unknown> };
  [key: string]: unknown;
}

async function callTool(name: string, args: Record<string, unknown>): Promise<ToolPayload> {
  const server = buildServer();
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'artifact-tools-test', version: '0' }, { capabilities: {} });
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

describe('pathfinder_create_guide_template', () => {
  it('returns a pre-populated artifact with the markdown intro + section blocks', async () => {
    const payload = await callTool('pathfinder_create_guide_template', {
      id: 'test-template',
      title: 'Test Template',
    });
    expect(payload.status).toBe('ok');
    const content = payload.artifact?.content as {
      id: string;
      title: string;
      schemaVersion: string;
      blocks: Array<{ type: string; id?: string; title?: string; content?: string; blocks?: unknown[] }>;
    };
    expect(content.id).toBe('test-template');
    expect(content.title).toBe('Test Template');
    expect(content.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(content.blocks).toHaveLength(2);
    const [intro, section] = content.blocks as [(typeof content.blocks)[number], (typeof content.blocks)[number]];
    expect(intro.type).toBe('markdown');
    expect(intro.content).toMatch(/# Test Template/);
    expect(section.type).toBe('section');
    expect(section.id).toBe('step-1');
    expect(section.title).toBe('Step 1');
    expect(section.blocks).toHaveLength(1);
  });

  it('uses sensible defaults for description and category', async () => {
    const payload = await callTool('pathfinder_create_guide_template', {
      id: 'defaults-test',
      title: 'Defaults Test',
    });
    const manifest = payload.artifact?.manifest as { description: string; category: string };
    // description defaults to title when omitted.
    expect(manifest.description).toBe('Defaults Test');
    // category defaults to "getting-started" when omitted.
    expect(manifest.category).toBe('getting-started');
  });

  it('honors explicit description and category', async () => {
    const payload = await callTool('pathfinder_create_guide_template', {
      id: 'explicit-test',
      title: 'Explicit Test',
      description: 'A custom description',
      category: 'observability',
    });
    const manifest = payload.artifact?.manifest as { description: string; category: string };
    expect(manifest.description).toBe('A custom description');
    expect(manifest.category).toBe('observability');
  });

  it('populates manifest with path, startingLocation, author, and testEnvironment defaults', async () => {
    const payload = await callTool('pathfinder_create_guide_template', {
      id: 'manifest-shape',
      title: 'Manifest Shape',
    });
    const manifest = payload.artifact?.manifest as {
      path: string;
      startingLocation: string;
      author: { name: string; team: string };
      testEnvironment: { tier: string; minVersion: string };
    };
    expect(manifest.path).toBe('manifest-shape/');
    expect(manifest.startingLocation).toBe('/');
    expect(manifest.author.name).toBe('Your Name');
    expect(manifest.testEnvironment.tier).toBe('local');
  });

  it('rejects an invalid (non-kebab-case) id via schema validation', async () => {
    const payload = await callTool('pathfinder_create_guide_template', {
      id: 'NotKebabCase',
      title: 'Bad ID',
    });
    expect(payload.status).toBe('error');
  });

  it('produces an artifact that passes pathfinder_validate by construction', async () => {
    const created = await callTool('pathfinder_create_guide_template', {
      id: 'validates-cleanly',
      title: 'Validates Cleanly',
    });
    expect(created.status).toBe('ok');
    const artifact = created.artifact;
    expect(artifact).toBeDefined();

    const validated = await callTool('pathfinder_validate', {
      artifact: { content: artifact!.content, manifest: artifact!.manifest },
    });
    expect(validated.status).toBe('ok');
  });
});
