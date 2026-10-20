/**
 * @jest-environment node
 *
 * Every command and tool must be classified as a manifest producer or not, and every
 * producer must apply the author default. A new command or tool that is in neither
 * table fails here, so the decision "does this write a manifest, and does it fill the
 * author?" cannot be skipped by omission.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { CURRENT_SCHEMA_VERSION } from '../../../types/json-guide.schema';
import { runCreate } from '../../commands/create';
import { COMMAND_MANIFEST } from '../../commands/manifest';
import { readPackage } from '../../utils/package-io';
import { buildServer } from '../server';

/** Commands and tools that produce a manifest and therefore must apply the author default. */
const MANIFEST_PRODUCERS = {
  commands: ['create'],
  tools: ['pathfinder_create_package', 'pathfinder_finalize_for_app_platform'],
};

/** Everything else, with why it is not a producer. */
const NOT_PRODUCERS: Record<string, string> = {
  // commands
  'add-block': 'edits content.json only',
  'add-step': 'edits content.json only',
  'add-choice': 'edits content.json only',
  'add-hint': 'edits content.json only',
  'edit-block': 'edits content.json only',
  'remove-block': 'edits content.json only',
  'move-block': 'edits content.json only',
  'rename-id': 'renames ids; leaves the author untouched',
  'set-manifest': 'patches named fields only; auto-defaulting is out of scope (an explicit patch is the author)',
  inspect: 'read-only',
  validate: 'read-only',
  e2e: 'read-only',
  schema: 'read-only',
  'find-guides': 'read-only',
  requirements: 'read-only',
  'build-repository': 'builds a catalog from existing packages; out of scope',
  'build-stats': 'reports on existing packages; out of scope',
  'build-snippets': 'builds snippets from existing packages',
  'build-graph': 'builds a graph from existing packages; out of scope',
  // tools
  pathfinder_authoring_start: 'static guidance',
  pathfinder_find_guides: 'read-only',
  pathfinder_get_schema: 'read-only',
  pathfinder_help: 'read-only',
  pathfinder_inspect: 'read-only',
  pathfinder_launch_package: 'launches an existing package',
  pathfinder_manage_block: 'edits content only',
  pathfinder_manage_guide: 'set-manifest: patches named fields only; auto-defaulting is out of scope',
  pathfinder_read_session: 'read-only',
  pathfinder_read_repository: 'read-only',
  pathfinder_validate: 'read-only',
};

async function listToolNames(): Promise<string[]> {
  const server = buildServer();
  const [serverT, clientT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: 'author-coverage', version: '0' }, { capabilities: {} });
  await client.connect(clientT);
  try {
    return (await client.listTools()).tools.map((tool) => tool.name);
  } finally {
    await client.close();
    await server.close();
  }
}

async function callTool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const server = buildServer();
  const [serverT, clientT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: 'author-coverage', version: '0' }, { capabilities: {} });
  await client.connect(clientT);
  try {
    const result = await client.callTool({ name, arguments: args });
    const blocks = result.content as Array<{ type: string; text: string }>;
    return JSON.parse(blocks.find((b) => b.type === 'text')!.text) as Record<string, unknown>;
  } finally {
    await client.close();
    await server.close();
  }
}

const authorOf = (payload: Record<string, unknown>) =>
  (payload.artifact as { manifest?: { author?: unknown } }).manifest?.author;

/** One driver per producer: produce a manifest with no author supplied, return the author it carries. */
const PRODUCER_DRIVERS: Record<string, () => Promise<unknown>> = {
  create: async () => {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'author-coverage-')), 'pkg');
    await runCreate({ dir, id: 'coverage', title: 'Coverage', type: 'guide' });
    return readPackage(dir).manifest?.author;
  },
  pathfinder_create_package: async () =>
    authorOf(await callTool('pathfinder_create_package', { opts: { title: 'T' } })),
  pathfinder_finalize_for_app_platform: async () =>
    authorOf(
      await callTool('pathfinder_finalize_for_app_platform', {
        artifact: {
          content: {
            id: 'coverage',
            schemaVersion: CURRENT_SCHEMA_VERSION,
            title: 'Coverage',
            blocks: [{ type: 'markdown', id: 'm-1', content: 'hi' }],
          },
        },
      })
    ),
};

describe('author default coverage', () => {
  it('classifies every CLI command', () => {
    const commands = COMMAND_MANIFEST.map((entry) => entry.name);
    const classified = new Set([...MANIFEST_PRODUCERS.commands, ...Object.keys(NOT_PRODUCERS)]);
    expect(commands.filter((name) => !classified.has(name))).toEqual([]);
    expect(MANIFEST_PRODUCERS.commands.filter((name) => !commands.includes(name))).toEqual([]);
  });

  it('classifies every MCP tool', async () => {
    const tools = await listToolNames();
    const classified = new Set([...MANIFEST_PRODUCERS.tools, ...Object.keys(NOT_PRODUCERS)]);
    expect(tools.filter((name) => !classified.has(name))).toEqual([]);
    expect(MANIFEST_PRODUCERS.tools.filter((name) => !tools.includes(name))).toEqual([]);
  });

  it.each([...MANIFEST_PRODUCERS.commands, ...MANIFEST_PRODUCERS.tools])(
    '%s applies the author default when none is supplied',
    async (name) => {
      expect(await PRODUCER_DRIVERS[name]!()).toEqual({ name: 'pathfinder-mcp' });
    }
  );

  it('has a driver for exactly the declared producers', () => {
    expect(Object.keys(PRODUCER_DRIVERS).sort()).toEqual(
      [...MANIFEST_PRODUCERS.commands, ...MANIFEST_PRODUCERS.tools].sort()
    );
  });
});
