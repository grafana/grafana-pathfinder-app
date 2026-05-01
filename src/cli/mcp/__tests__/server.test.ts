/**
 * Integration tests for the Pathfinder authoring MCP server.
 *
 * Drives the real server through `InMemoryTransport.createLinkedPair()` so
 * tests exercise the same registration + dispatch path that production
 * stdio/HTTP transports use, without spawning a subprocess.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { CURRENT_SCHEMA_VERSION } from '../../../types/json-guide.schema';
import { buildServer } from '../server';

interface ToolPayload {
  status?: string;
  code?: string;
  message?: string;
  artifact?: { content: Record<string, unknown>; manifest?: Record<string, unknown> };
  [key: string]: unknown;
}

async function spinUp(): Promise<{ client: Client; close: () => Promise<void> }> {
  const server = buildServer();
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: 'mcp-test-client', version: '0' }, { capabilities: {} });
  await client.connect(clientTransport);

  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

async function callTool(client: Client, name: string, args: Record<string, unknown> = {}): Promise<ToolPayload> {
  const result = await client.callTool({ name, arguments: args });
  const blocks = result.content as Array<{ type: string; text: string }>;
  const text = blocks.find((b) => b.type === 'text')?.text;
  if (!text) {
    throw new Error(`tool ${name} returned no text content`);
  }
  return JSON.parse(text) as ToolPayload;
}

describe('MCP server', () => {
  it('lists every authoring tool', async () => {
    const { client, close } = await spinUp();
    try {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name).sort();
      expect(names).toEqual(
        [
          'pathfinder_add_block',
          'pathfinder_add_choice',
          'pathfinder_add_step',
          'pathfinder_authoring_start',
          'pathfinder_create_package',
          'pathfinder_edit_block',
          'pathfinder_finalize_for_app_platform',
          'pathfinder_help',
          'pathfinder_inspect',
          'pathfinder_remove_block',
          'pathfinder_set_manifest',
          'pathfinder_validate',
        ].sort()
      );
    } finally {
      await close();
    }
  });

  it('drives a full authoring flow end-to-end', async () => {
    const { client, close } = await spinUp();
    try {
      // 1. authoring_start — context.
      const ctx = await callTool(client, 'pathfinder_authoring_start');
      expect(ctx.version).toBe(CURRENT_SCHEMA_VERSION);

      // 2. create_package — fresh artifact.
      const created = await callTool(client, 'pathfinder_create_package', {
        title: 'MCP Smoke Test',
        type: 'guide',
      });
      expect(created.status).toBe('ok');
      expect(created.artifact?.content.id).toBeDefined();
      let artifact = created.artifact!;

      // 3. add_block — markdown leaf.
      const added = await callTool(client, 'pathfinder_add_block', {
        artifact,
        type: 'markdown',
        fields: { content: 'Hello from the MCP test.' },
      });
      expect(added.status).toBe('ok');
      artifact = added.artifact!;
      expect(Array.isArray(artifact.content.blocks) && (artifact.content.blocks as unknown[]).length).toBe(1);

      // 4. inspect — tree summary.
      const inspected = await callTool(client, 'pathfinder_inspect', { artifact });
      expect(inspected.status).toBe('ok');

      // 5. validate — must pass.
      const validated = await callTool(client, 'pathfinder_validate', { artifact });
      expect(validated.status).toBe('ok');

      // 6. finalize — handoff payload.
      const finalized = await callTool(client, 'pathfinder_finalize_for_app_platform', {
        artifact,
        status: 'draft',
      });
      expect(finalized.status).toBe('ready');
      expect(finalized.id).toBe(artifact.content.id);
      expect((finalized.appPlatform as Record<string, unknown>).itemPathTemplate).toContain(
        String(artifact.content.id)
      );
      expect((finalized.viewer as Record<string, unknown>).floatingPath).toContain('panelMode=floating');
      expect(finalized.localExport).toBeDefined();
    } finally {
      await close();
    }
  });

  it('surfaces CLI-detected schema violations verbatim through pathfinder_add_block', async () => {
    const { client, close } = await spinUp();
    try {
      const created = await callTool(client, 'pathfinder_create_package', { title: 'bad', type: 'guide' });
      const artifact = created.artifact!;

      // Conditional blocks require at least one --conditions value (CLI-strict
      // guard in runAddBlock). The MCP must surface the CLI's structured
      // error verbatim instead of accepting the call.
      const result = await callTool(client, 'pathfinder_add_block', {
        artifact,
        type: 'conditional',
        explicitId: 'cond-1',
        fields: {},
      });
      expect(result.status).toBe('error');
      expect(result.code).toBe('SCHEMA_VALIDATION');
    } finally {
      await close();
    }
  });

  it('forwards the YouTube watch-vs-embed remediation hint through pathfinder_add_block', async () => {
    const { client, close } = await spinUp();
    try {
      const created = await callTool(client, 'pathfinder_create_package', { title: 'video test', type: 'guide' });
      const artifact = created.artifact!;

      const result = await callTool(client, 'pathfinder_add_block', {
        artifact,
        type: 'video',
        fields: { src: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
      });
      expect(result.status).toBe('error');
      // The MCP must surface the CLI's exact remediation hint (URL rewrite)
      // verbatim so the agent can self-correct in one round-trip.
      expect(result.message).toContain('https://www.youtube.com/embed/dQw4w9WgXcQ');
    } finally {
      await close();
    }
  });

  it('returns the CLI command list from pathfinder_help when called with no command', async () => {
    const { client, close } = await spinUp();
    try {
      const result = await callTool(client, 'pathfinder_help');
      expect(Array.isArray(result.commands)).toBe(true);
      const names = (result.commands as Array<{ name: string }>).map((c) => c.name);
      // Spot-check a couple of commands that authors hit constantly; the full
      // list is enforced by the CLI command registry, not this test.
      expect(names).toEqual(expect.arrayContaining(['create', 'add-block', 'validate']));
    } finally {
      await close();
    }
  });

  it('returns per-command help shape from pathfinder_help when given a command', async () => {
    const { client, close } = await spinUp();
    try {
      const result = await callTool(client, 'pathfinder_help', { command: 'add-block' });
      // formatHelpAsJson surfaces `command` and `summary` at minimum; we
      // don't pin the full shape here (it's a CLI-owned contract).
      expect(result.command).toBe('add-block');
      expect(typeof result.summary).toBe('string');
    } finally {
      await close();
    }
  });

  it('appends a step to a multistep block via pathfinder_add_step', async () => {
    const { client, close } = await spinUp();
    try {
      const created = await callTool(client, 'pathfinder_create_package', { title: 'step test', type: 'guide' });
      let artifact = created.artifact!;

      // Need a multistep container before add-step has somewhere to land.
      const withMs = await callTool(client, 'pathfinder_add_block', {
        artifact,
        type: 'multistep',
        explicitId: 'ms-1',
        fields: { content: 'walkthrough heading' },
      });
      expect(withMs.status).toBe('ok');
      artifact = withMs.artifact!;

      const stepped = await callTool(client, 'pathfinder_add_step', {
        artifact,
        parentId: 'ms-1',
        fields: { action: 'noop', description: 'just look' },
      });
      expect(stepped.status).toBe('ok');
      const ms = (stepped.artifact!.content.blocks as Array<{ id: string; steps?: unknown[] }>).find(
        (b) => b.id === 'ms-1'
      );
      expect(ms?.steps?.length).toBe(1);
    } finally {
      await close();
    }
  });

  it('appends a choice to a quiz block via pathfinder_add_choice', async () => {
    const { client, close } = await spinUp();
    try {
      const created = await callTool(client, 'pathfinder_create_package', { title: 'quiz test', type: 'guide' });
      let artifact = created.artifact!;

      const withQuiz = await callTool(client, 'pathfinder_add_block', {
        artifact,
        type: 'quiz',
        explicitId: 'q-1',
        fields: { question: 'Is this a test?', completionMode: 'correct-only' },
      });
      expect(withQuiz.status).toBe('ok');
      artifact = withQuiz.artifact!;

      const choiced = await callTool(client, 'pathfinder_add_choice', {
        artifact,
        parentId: 'q-1',
        fields: { id: 'a', text: 'Yes', correct: true },
      });
      expect(choiced.status).toBe('ok');
      const quiz = (choiced.artifact!.content.blocks as Array<{ id: string; choices?: unknown[] }>).find(
        (b) => b.id === 'q-1'
      );
      expect(quiz?.choices?.length).toBe(1);
    } finally {
      await close();
    }
  });

  it('updates an existing block in place via pathfinder_edit_block', async () => {
    const { client, close } = await spinUp();
    try {
      const created = await callTool(client, 'pathfinder_create_package', { title: 'edit test', type: 'guide' });
      let artifact = created.artifact!;

      const added = await callTool(client, 'pathfinder_add_block', {
        artifact,
        type: 'markdown',
        explicitId: 'md-1',
        fields: { content: 'before' },
      });
      expect(added.status).toBe('ok');
      artifact = added.artifact!;

      const edited = await callTool(client, 'pathfinder_edit_block', {
        artifact,
        id: 'md-1',
        fields: { content: 'after' },
      });
      expect(edited.status).toBe('ok');
      const block = (edited.artifact!.content.blocks as Array<{ id: string; content?: string }>).find(
        (b) => b.id === 'md-1'
      );
      expect(block?.content).toBe('after');
    } finally {
      await close();
    }
  });

  it('updates manifest fields via pathfinder_set_manifest', async () => {
    const { client, close } = await spinUp();
    try {
      const created = await callTool(client, 'pathfinder_create_package', { title: 'manifest test', type: 'guide' });
      const artifact = created.artifact!;

      const updated = await callTool(client, 'pathfinder_set_manifest', {
        artifact,
        fields: { description: 'a brand-new description' },
      });
      expect(updated.status).toBe('ok');
      expect(updated.artifact?.manifest?.description).toBe('a brand-new description');
    } finally {
      await close();
    }
  });

  it('refuses finalize with status invalid when validation fails', async () => {
    const { client, close } = await spinUp();
    try {
      // Fabricate an artifact with a content/manifest id mismatch — fails the
      // cross-file check the CLI runs.
      const result = await callTool(client, 'pathfinder_finalize_for_app_platform', {
        artifact: {
          content: { id: 'one', schemaVersion: '1.1.0', title: 'X', type: 'guide', blocks: [] },
          manifest: { id: 'two', schemaVersion: '1.1.0', repository: 'interactive-tutorials' },
        },
      });
      expect(result.status).toBe('invalid');
      expect((result.validation as Record<string, unknown>).isValid).toBe(false);
      expect(result.appPlatform).toBeUndefined();
    } finally {
      await close();
    }
  });
});
