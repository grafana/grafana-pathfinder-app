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
  it('surfaces non-empty server `instructions` on the initialize handshake (M1 layer 3)', async () => {
    const { client, close } = await spinUp();
    try {
      const instructions = client.getInstructions();
      expect(typeof instructions).toBe('string');
      expect(instructions!.length).toBeGreaterThan(0);
      // Routing vocabulary (#7) — at least one canonical trigger phrase must
      // make it through so MCP-aware clients have a concrete handle.
      expect(instructions).toMatch(/create a pathfinder/i);
      // Selector discipline (#3) — the layer-3 surface is the only hint that
      // reaches the model BEFORE tool selection, so the "never invent
      // selectors" rule has to land here, not just in field descriptions.
      expect(instructions).toMatch(/reftarget/i);
      expect(instructions).toMatch(/never invent/i);
      // Composition rule (#8) — same reasoning. The model must see "prefer
      // siblings over multistep, no noop filler" before it picks a tool.
      expect(instructions).toMatch(/multistep/i);
      expect(instructions).toMatch(/noop/i);
      // Workflow anchor — every flow starts with `pathfinder_authoring_start`,
      // so the instructions must point there explicitly.
      expect(instructions).toContain('pathfinder_authoring_start');
    } finally {
      await close();
    }
  });

  it('surfaces routing vocabulary in pathfinder_authoring_start (issue #7, layer 2)', async () => {
    const { client, close } = await spinUp();
    try {
      const ctx = await callTool(client, 'pathfinder_authoring_start');
      // `triggers`, `notFor`, and `domains` reaffirm routing for agents that
      // already reached the MCP, including clients that don't render the
      // layer-3 server `instructions`. All three come from
      // `lib/agent-routing.ts` — see the matching layer-3 assertions
      // earlier in this file.
      expect(Array.isArray(ctx.triggers)).toBe(true);
      expect((ctx.triggers as string[]).length).toBeGreaterThan(0);
      expect(ctx.triggers).toContain('create a pathfinder');
      // Slice 3 — verb × asset-noun expansion. The looser phrases must
      // land so any write/edit/create verb + content/guide/tutorial noun
      // routes here.
      expect(ctx.triggers).toContain('write content');
      expect(ctx.triggers).toContain('create a tutorial');
      expect(ctx.triggers).toContain('author a guide');
      expect(Array.isArray(ctx.notFor)).toBe(true);
      expect((ctx.notFor as string[]).length).toBeGreaterThan(0);
      // Slice 3 — domain vocabulary so an agent already in the MCP can
      // reaffirm routing when product-area followups come in.
      expect(Array.isArray(ctx.domains)).toBe(true);
      expect(ctx.domains).toContain('Prometheus');
      expect(ctx.domains).toContain('Loki');
    } finally {
      await close();
    }
  });

  it('surfaces distilled compositionRules in pathfinder_authoring_start (issue #8, OQ7 inline variant)', async () => {
    const { client, close } = await spinUp();
    try {
      const ctx = await callTool(client, 'pathfinder_authoring_start');
      const rules = ctx.compositionRules as string[];
      expect(Array.isArray(rules)).toBe(true);
      // Budget guard — distilled from grafana/interactive-tutorials, hard
      // ceiling per the slice plan is 25 rules. If a future edit pushes the
      // list past 20, that's the signal to consider shipping a separate
      // `pathfinder_authoring_best_practices` tool (OQ7) instead.
      expect(rules.length).toBeGreaterThanOrEqual(3);
      expect(rules.length).toBeLessThanOrEqual(20);
      const joined = rules.join('\n');
      // The three load-bearing anchors from the slice plan — must always
      // ship together (#3 selector hallucination, #8 multistep over-use,
      // #8 noop-as-defense).
      expect(joined).toMatch(/multistep/i);
      expect(joined).toMatch(/sibling/i);
      expect(joined).toMatch(/noop/i);
      expect(joined).toMatch(/reftarget/i);
      expect(joined).toMatch(/never invent|do not invent|do not guess/i);
    } finally {
      await close();
    }
  });

  it('describes every tool with a use-case-led opener so MCP clients can route on description-time hints (issue #7)', async () => {
    const { client, close } = await spinUp();
    try {
      const { tools } = await client.listTools();
      // The hardening slice (task 3) rewrites every registerTool description
      // to lead with "Use this tool when the user wants to ..." or, for
      // meta/introspection tools, "Use this when you need ...". This guard
      // catches a future edit that reverts to behavior-led prose.
      const offenders = tools
        .filter((t) => !/^Use this (tool )?(when|to)\b/i.test(t.description ?? ''))
        .map((t) => ({ name: t.name, description: t.description }));
      expect(offenders).toEqual([]);
    } finally {
      await close();
    }
  });

  it('lists every authoring tool', async () => {
    const { client, close } = await spinUp();
    try {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name).sort();
      expect(names).toEqual(
        [
          'pathfinder_authoring_start',
          'pathfinder_add_choice',
          'pathfinder_add_step',
          'pathfinder_create_package',
          'pathfinder_finalize_for_app_platform',
          'pathfinder_get_schema',
          'pathfinder_help',
          'pathfinder_inspect',
          'pathfinder_launch_package',
          'pathfinder_manage_block',
          'pathfinder_read_session',
          'pathfinder_read_repository',
          'pathfinder_set_manifest',
          'pathfinder_validate',
        ].sort()
      );
    } finally {
      await close();
    }
  });

  it('publishes resource-focused mutation schemas', async () => {
    const { client, close } = await spinUp();
    try {
      const { tools } = await client.listTools();
      const manage = tools.find((tool) => tool.name === 'pathfinder_manage_block');
      expect(manage).toBeDefined();
      const schema = manage!.inputSchema as {
        properties?: Record<string, { enum?: string[]; description?: string }>;
        required?: string[];
      };
      expect(schema.properties?.operation?.enum).toEqual(['add', 'edit', 'remove']);
      expect(schema.properties?.resource).toBeUndefined();
      expect(schema.required).toContain('operation');
      expect(manage!.description).toMatch(/pathfinder_help.*add-block/);
      expect(manage!.description).toMatch(/edit-block/);
      expect(manage!.description).toMatch(/remove-block/);
      // Applicability tags — same `[op]` / `[op|op]` prefix style as
      // pathfinder_read_session / pathfinder_read_repository.
      expect(schema.properties?.type?.description).toMatch(/^\[add\]/);
      expect(schema.properties?.parentId?.description).toMatch(/^\[add\]/);
      expect(schema.properties?.branch?.description).toMatch(/^\[add\]/);
      expect(schema.properties?.id?.description).toMatch(/\[add\]/);
      expect(schema.properties?.id?.description).toMatch(/\[edit\|remove\]/);
      expect(schema.properties?.fields?.description).toMatch(/\[edit\]/);
      expect(schema.properties?.cascade?.description).toMatch(/^\[remove\]/);

      for (const name of ['pathfinder_add_step', 'pathfinder_add_choice']) {
        const childTool = tools.find((tool) => tool.name === name);
        expect(childTool).toBeDefined();
        const childSchema = childTool!.inputSchema as {
          properties?: Record<string, unknown>;
          required?: string[];
        };
        expect(childSchema.properties?.operation).toBeUndefined();
        expect(childSchema.properties?.resource).toBeUndefined();
        expect(childSchema.required).toEqual(expect.arrayContaining(['parentId', 'fields']));
        const helpCommand = name === 'pathfinder_add_step' ? 'add-step' : 'add-choice';
        expect(childTool!.description).toContain(`pathfinder_help(command="${helpCommand}")`);
      }
    } finally {
      await close();
    }
  });

  it('runs two-mode validation for a dedicated child mutation tool', async () => {
    const { client, close } = await spinUp();
    try {
      const result = await callTool(client, 'pathfinder_add_step', {
        parentId: 'ms-1',
        fields: { action: 'noop', description: 'look' },
      });
      expect(result.status).toBe('error');
      expect(result.code).toBe('INPUT_MODE_MISSING');
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
      const added = await callTool(client, 'pathfinder_manage_block', {
        operation: 'add',
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

  it('rejects pathfinder_manage_block add without type at the MCP schema boundary', async () => {
    const { client, close } = await spinUp();
    try {
      const created = await callTool(client, 'pathfinder_create_package', { title: 'op check', type: 'guide' });
      const result = await client.callTool({
        name: 'pathfinder_manage_block',
        arguments: {
          operation: 'add',
          artifact: created.artifact!,
          fields: { content: 'missing type' },
        },
      });
      expect(result.isError).toBe(true);
      const content = result.content as Array<{ type: string; text?: string }>;
      const text = content.find((part) => part.type === 'text');
      expect(text?.text ?? '').toMatch(/invalid arguments|type/i);
    } finally {
      await close();
    }
  });

  it('rejects a container block added without id at the MCP schema boundary', async () => {
    const { client, close } = await spinUp();
    try {
      const created = await callTool(client, 'pathfinder_create_package', { title: 'container check', type: 'guide' });
      const result = await client.callTool({
        name: 'pathfinder_manage_block',
        arguments: {
          operation: 'add',
          type: 'section',
          artifact: created.artifact!,
          fields: { title: 'No id' },
        },
      });
      expect(result.isError).toBe(true);
      const content = result.content as Array<{ type: string; text?: string }>;
      const text = content.find((part) => part.type === 'text');
      // Must name the MCP field `id`, never the CLI's `--id`, and must never reach
      // the CLI's CONTAINER_REQUIRES_ID path.
      expect(text?.text ?? '').toMatch(/`id`/);
      expect(text?.text ?? '').not.toMatch(/--id/);
    } finally {
      await close();
    }
  });

  it('accepts a leaf block added without id at the MCP schema boundary', async () => {
    const { client, close } = await spinUp();
    try {
      const created = await callTool(client, 'pathfinder_create_package', { title: 'leaf check', type: 'guide' });
      const result = await callTool(client, 'pathfinder_manage_block', {
        operation: 'add',
        type: 'markdown',
        artifact: created.artifact!,
        fields: { content: 'auto-minted id' },
      });
      expect(result.status).not.toBe('error');
    } finally {
      await close();
    }
  });

  it('rejects pathfinder_read_repository get without id at the MCP schema boundary', async () => {
    const { client, close } = await spinUp();
    try {
      const result = await client.callTool({
        name: 'pathfinder_read_repository',
        arguments: { operation: 'get' },
      });
      expect(result.isError).toBe(true);
      const content = result.content as Array<{ type: string; text?: string }>;
      const text = content.find((part) => part.type === 'text');
      expect(text?.text ?? '').toMatch(/invalid arguments|id/i);
    } finally {
      await close();
    }
  });

  it('rejects pathfinder_read_session get_block without blockId at the MCP schema boundary', async () => {
    const { client, close } = await spinUp();
    try {
      const created = await callTool(client, 'pathfinder_create_package', { title: 'read check', type: 'guide' });
      expect(created.sessionToken).toBeDefined();
      const result = await client.callTool({
        name: 'pathfinder_read_session',
        arguments: {
          operation: 'get_block',
          sessionToken: created.sessionToken,
        },
      });
      expect(result.isError).toBe(true);
      const content = result.content as Array<{ type: string; text?: string }>;
      const text = content.find((part) => part.type === 'text');
      expect(text?.text ?? '').toMatch(/invalid arguments|blockId/i);
    } finally {
      await close();
    }
  });

  it('surfaces CLI-detected schema violations verbatim through pathfinder_manage_block', async () => {
    const { client, close } = await spinUp();
    try {
      const created = await callTool(client, 'pathfinder_create_package', { title: 'bad', type: 'guide' });
      const artifact = created.artifact!;

      // Conditional blocks require at least one --conditions value (CLI-strict
      // guard in runAddBlock). The MCP must surface the CLI's structured
      // error verbatim instead of accepting the call.
      const result = await callTool(client, 'pathfinder_manage_block', {
        operation: 'add',
        artifact,
        type: 'conditional',
        id: 'cond-1',
        fields: {},
      });
      expect(result.status).toBe('error');
      expect(result.code).toBe('SCHEMA_VALIDATION');
    } finally {
      await close();
    }
  });

  it('normalizes a YouTube watch URL through pathfinder_manage_block and surfaces INPUT_NORMALIZED (issue #2)', async () => {
    const { client, close } = await spinUp();
    try {
      const created = await callTool(client, 'pathfinder_create_package', { title: 'video test', type: 'guide' });
      const artifact = created.artifact!;

      const result = await callTool(client, 'pathfinder_manage_block', {
        operation: 'add',
        artifact,
        type: 'video',
        fields: { src: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
      });
      // M3 — the CLI rewrites the non-canonical form before validation, so
      // the call succeeds in one round-trip and the agent gets a warning
      // naming the rewrite. The persisted artifact carries the embed form.
      expect(result.status).toBe('ok');
      const warnings = result.warnings as Array<{ code: string; path?: string; message: string }> | undefined;
      const normalized = warnings?.find((w) => w.code === 'INPUT_NORMALIZED');
      expect(normalized).toBeDefined();
      expect(normalized?.message).toContain('https://www.youtube.com/embed/dQw4w9WgXcQ');
      const blocks = result.artifact?.content.blocks as Array<{ src?: string }>;
      expect(blocks?.[0]?.src).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ');
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

  it('surfaces UNVERIFIED_SELECTOR through pathfinder_add_step (issue #3, M2 outcome-time)', async () => {
    const { client, close } = await spinUp();
    try {
      const created = await callTool(client, 'pathfinder_create_package', { title: 'selector test', type: 'guide' });
      let artifact = created.artifact!;
      const withMs = await callTool(client, 'pathfinder_manage_block', {
        operation: 'add',
        artifact,
        type: 'multistep',
        id: 'ms-1',
        fields: { content: 'walk' },
      });
      artifact = withMs.artifact!;
      const stepped = await callTool(client, 'pathfinder_add_step', {
        artifact,
        parentId: 'ms-1',
        fields: { action: 'button', reftarget: '[data-testid="save"]', description: 'Click Save' },
      });
      expect(stepped.status).toBe('ok');
      // End-to-end: warning is emitted by `runAddStep`, rides on the CLI's
      // `CommandOutcome`, and the MCP forwards it via `outcomeResult` so a
      // connected client sees it in the tool response.
      const warnings = stepped.warnings as Array<{ code: string; path?: string }> | undefined;
      const unverified = warnings?.find((w) => w.code === 'UNVERIFIED_SELECTOR');
      expect(unverified).toBeDefined();
      expect(unverified?.path).toContain('reftarget');
    } finally {
      await close();
    }
  });

  it('surfaces MULTISTEP_COMPOSITION_HINT through pathfinder_manage_block (issue #8, M2 outcome-time)', async () => {
    const { client, close } = await spinUp();
    try {
      const created = await callTool(client, 'pathfinder_create_package', { title: 'hint test', type: 'guide' });
      const artifact = created.artifact!;
      const result = await callTool(client, 'pathfinder_manage_block', {
        operation: 'add',
        artifact,
        type: 'multistep',
        id: 'ms-1',
        fields: { content: 'walkthrough heading' },
      });
      expect(result.status).toBe('ok');
      // The CLI's `warnings[]` field rides on `CommandOutcome` and the MCP
      // forwards it verbatim via `outcomeResult` — no transformation. This
      // assertion closes the loop end-to-end: warning emitted by the runner,
      // serialized by the renderer, surfaced through the wire.
      const warnings = result.warnings as Array<{ code: string }> | undefined;
      expect(warnings?.[0]?.code).toBe('MULTISTEP_COMPOSITION_HINT');
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
      const withMs = await callTool(client, 'pathfinder_manage_block', {
        operation: 'add',
        artifact,
        type: 'multistep',
        id: 'ms-1',
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

      const withQuiz = await callTool(client, 'pathfinder_manage_block', {
        operation: 'add',
        artifact,
        type: 'quiz',
        id: 'q-1',
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

  it('updates an existing block in place via pathfinder_manage_block edit+block', async () => {
    const { client, close } = await spinUp();
    try {
      const created = await callTool(client, 'pathfinder_create_package', { title: 'edit test', type: 'guide' });
      let artifact = created.artifact!;

      const added = await callTool(client, 'pathfinder_manage_block', {
        operation: 'add',
        artifact,
        type: 'markdown',
        id: 'md-1',
        fields: { content: 'before' },
      });
      expect(added.status).toBe('ok');
      artifact = added.artifact!;

      const edited = await callTool(client, 'pathfinder_manage_block', {
        operation: 'edit',
        artifact,
        id: 'md-1',
        fields: { content: 'after' },
        // The block tool has one stable shape. Operation-irrelevant values are
        // accepted and ignored rather than forcing callers to prune the object.
        type: 'section',
        parentId: 'unused',
        branch: 'true',
        cascade: true,
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
