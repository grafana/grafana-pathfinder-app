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
import { CONTAINER_BLOCK_TYPES } from '../../utils/block-registry';
import { SERVER_INSTRUCTIONS } from '../lib/server-instructions';
import { buildServer } from '../server';
import { KNOWN_TOOL_OPERATIONS } from '../transports/access-log';

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
          'pathfinder_create_package',
          'pathfinder_finalize_for_app_platform',
          'pathfinder_get_schema',
          'pathfinder_help',
          'pathfinder_inspect',
          'pathfinder_launch_package',
          'pathfinder_manage_block',
          'pathfinder_manage_guide',
          'pathfinder_read_session',
          'pathfinder_read_repository',
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
      expect(schema.properties?.operation?.enum).toEqual([
        'add-block',
        'edit-block',
        'remove-block',
        'add-step',
        'add-choice',
      ]);
      expect(schema.properties?.resource).toBeUndefined();
      expect(schema.required).toContain('operation');
      expect(manage!.description).toMatch(/pathfinder_help.*add-block/);
      expect(manage!.description).toMatch(/edit-block/);
      expect(manage!.description).toMatch(/remove-block/);
      expect(manage!.description).toMatch(/add-step/);
      expect(manage!.description).toMatch(/add-choice/);
      expect(schema.properties?.opts?.description).toMatch(/pathfinder_help/);
      expect(schema.required).toEqual(expect.arrayContaining(['operation', 'opts']));
      for (const oldOpt of ['type', 'parentId', 'branch', 'id', 'cascade']) {
        expect(schema.properties?.[oldOpt]).toBeUndefined();
      }

      const guide = tools.find((tool) => tool.name === 'pathfinder_manage_guide');
      expect(guide).toBeDefined();
      const guideSchema = guide!.inputSchema as {
        properties?: Record<string, { enum?: string[]; description?: string }>;
        required?: string[];
      };
      expect(guideSchema.properties?.operation?.enum).toEqual(['set-manifest']);
      expect(guideSchema.required).toEqual(expect.arrayContaining(['operation', 'opts']));
      expect(guide!.description).toContain('set-manifest');
    } finally {
      await close();
    }
  });

  it('publishes help-derived opts bags for 1:1 CLI tools', async () => {
    const { client, close } = await spinUp();
    try {
      const { tools } = await client.listTools();
      for (const [toolName, legacyOpts, optsRequired] of [
        ['pathfinder_create_package', ['title', 'id', 'type', 'description'], true],
        ['pathfinder_inspect', ['blockId', 'at'], false],
        ['pathfinder_get_schema', ['name', 'mode', 'includeVersion'], true],
      ] as const) {
        const tool = tools.find((candidate) => candidate.name === toolName);
        const schema = tool!.inputSchema as {
          properties?: Record<string, unknown>;
          required?: string[];
        };
        if (optsRequired) {
          expect(schema.required).toContain('opts');
        } else {
          expect(schema.required ?? []).not.toContain('opts');
        }
        expect(schema.properties?.opts).toBeDefined();
        for (const legacy of legacyOpts) {
          expect(schema.properties?.[legacy]).toBeUndefined();
        }
      }

      const expectedByCommand = {
        create: ['title', 'id', 'type', 'description'],
        inspect: ['block', 'at'],
        schema: ['name', 'list', 'all', 'includeVersion'],
      };
      for (const [command, expected] of Object.entries(expectedByCommand)) {
        const help = await callTool(client, 'pathfinder_help', { command });
        const names = [
          ...(help.required as Array<{ name: string }>),
          ...(help.optional as Array<{ name: string }>),
          ...((help.addressing as Array<{ name: string }> | undefined) ?? []),
        ].map((field) => field.name);
        expect(names).toEqual(expect.arrayContaining(expected));
        expect(names).not.toContain('dir');
      }

      const schemaHelp = await callTool(client, 'pathfinder_help', { command: 'schema' });
      const schemaFlags = [
        ...(schemaHelp.required as Array<{ name: string; valueType: string }>),
        ...(schemaHelp.optional as Array<{ name: string; valueType: string }>),
      ];
      expect(schemaFlags.find((flag) => flag.name === 'list')).toMatchObject({ valueType: 'boolean' });
      expect(schemaFlags.find((flag) => flag.name === 'all')).toMatchObject({ valueType: 'boolean' });
      expect(schemaFlags.find((flag) => flag.name === 'includeVersion')).toMatchObject({ valueType: 'boolean' });

      const rejected = await callTool(client, 'pathfinder_create_package', {
        opts: { title: 'Nope', unsupported: true },
      });
      expect(rejected.code).toBe('UNSUPPORTED_PARAMETER');
    } finally {
      await close();
    }
  });

  // MCP reaches the runners without Commander's parser, so the adapter has to
  // replicate the checks the parser would have made before the runner ran.
  it('rejects a bag missing a Commander-mandatory option', async () => {
    const { client, close } = await spinUp();
    try {
      const missing = await callTool(client, 'pathfinder_create_package', { opts: {} });
      expect(missing.status).toBe('error');
      expect(missing.code).toBe('SCHEMA_VALIDATION');
      expect(missing.message).toMatch(/missing required parameter: title/);

      const badEnum = await callTool(client, 'pathfinder_create_package', {
        opts: { title: 'Guide', type: 'not-a-type' },
      });
      expect(badEnum.status).toBe('error');
      expect(badEnum.message).toMatch(/type expected guide\|path\|journey/);
    } finally {
      await close();
    }
  });

  it('publishes explicit top-level schemas for MCP-native read suites', async () => {
    const { client, close } = await spinUp();
    try {
      const { tools } = await client.listTools();
      for (const [toolName, nativeParameters] of [
        ['pathfinder_read_session', ['sessionToken', 'operation', 'blockId']],
        ['pathfinder_read_repository', ['operation', 'id', 'type', 'category', 'q']],
      ] as const) {
        const tool = tools.find((candidate) => candidate.name === toolName);
        const schema = tool!.inputSchema as {
          properties?: Record<string, unknown>;
        };
        expect(schema.properties?.opts).toBeUndefined();
        for (const parameter of nativeParameters) {
          expect(schema.properties?.[parameter]).toBeDefined();
        }
      }
    } finally {
      await close();
    }
  });

  it('runs two-mode validation for a dedicated child mutation tool', async () => {
    const { client, close } = await spinUp();
    try {
      const result = await callTool(client, 'pathfinder_manage_block', {
        operation: 'add-step',
        opts: { parent: 'ms-1', action: 'noop', description: 'look' },
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
        opts: { title: 'MCP Smoke Test', type: 'guide' },
      });
      expect(created.status).toBe('ok');
      expect(created.hints).toBeUndefined();
      expect(created.artifact?.content.id).toBeDefined();
      let artifact = created.artifact!;

      // 3. add_block — markdown leaf.
      const added = await callTool(client, 'pathfinder_manage_block', {
        operation: 'add-block',
        artifact,
        opts: { type: 'markdown', content: 'Hello from the MCP test.' },
      });
      expect(added.status).toBe('ok');
      expect(added.hints).toBeUndefined();
      artifact = added.artifact!;
      expect(Array.isArray(artifact.content.blocks) && (artifact.content.blocks as unknown[]).length).toBe(1);

      // 4. inspect — tree summary.
      const inspected = await callTool(client, 'pathfinder_inspect', { artifact });
      expect(inspected.status).toBe('ok');
      const blockId = (artifact.content.blocks as Array<{ id: string }>)[0]!.id;
      const inspectedBlock = await callTool(client, 'pathfinder_inspect', {
        artifact,
        opts: { block: blockId },
      });
      expect((inspectedBlock.data as { block?: { id?: string } })?.block?.id).toBe(blockId);

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

  it('rejects pathfinder_manage_block add-block without type at the MCP schema boundary', async () => {
    const { client, close } = await spinUp();
    try {
      const created = await callTool(client, 'pathfinder_create_package', {
        opts: { title: 'op check', type: 'guide' },
      });
      const result = await callTool(client, 'pathfinder_manage_block', {
        operation: 'add-block',
        artifact: created.artifact!,
        opts: { content: 'missing type' },
      });
      expect(result.status).toBe('error');
      expect(result.code).toBe('SCHEMA_VALIDATION');
      expect((result.data as { missing?: string[] })?.missing).toEqual(['type']);
      expect(result.message).toContain('pathfinder_help');
    } finally {
      await close();
    }
  });

  // Table-driven over every container type so the MCP-visible behavior and
  // the CLI's isContainerBlockType predicate cannot drift apart silently.
  it.each([...CONTAINER_BLOCK_TYPES])(
    'surfaces the CLI CONTAINER_REQUIRES_ID error for a "%s" block added without id',
    async (type) => {
      const { client, close } = await spinUp();
      try {
        const created = await callTool(client, 'pathfinder_create_package', {
          opts: { title: 'container check', type: 'guide' },
        });
        // `conditional` gates on non-empty conditions before the id check.
        const extra = type === 'conditional' ? { conditions: ['has-datasource:prometheus'] } : {};
        const result = await callTool(client, 'pathfinder_manage_block', {
          operation: 'add-block',
          artifact: created.artifact!,
          opts: { type, ...extra },
        });
        expect(result.status).toBe('error');
        expect(result.code).toBe('CONTAINER_REQUIRES_ID');
      } finally {
        await close();
      }
    }
  );

  it('makes a retried add-block a no-op via ifAbsent instead of duplicating content', async () => {
    const { client, close } = await spinUp();
    try {
      const created = await callTool(client, 'pathfinder_create_package', {
        opts: { title: 'retry check', type: 'guide' },
      });
      const first = await callTool(client, 'pathfinder_manage_block', {
        operation: 'add-block',
        artifact: created.artifact!,
        opts: { type: 'section', id: 'sec-1', title: 'Section', ifAbsent: true },
      });
      expect(first.status).toBe('ok');
      // Simulates a crashed-and-retried call: same opts against the updated
      // artifact must not mint a second block.
      const retry = await callTool(client, 'pathfinder_manage_block', {
        operation: 'add-block',
        artifact: first.artifact!,
        opts: { type: 'section', id: 'sec-1', title: 'Section', ifAbsent: true },
      });
      expect(retry.status).toBe('ok');
      const blocks = retry.artifact?.content.blocks as Array<Record<string, unknown>>;
      expect(blocks.filter((block) => block.id === 'sec-1')).toHaveLength(1);
    } finally {
      await close();
    }
  });

  it('re-words CONTAINER_HAS_CHILDREN in MCP terms instead of CLI-only flag advice', async () => {
    const { client, close } = await spinUp();
    try {
      const created = await callTool(client, 'pathfinder_create_package', {
        opts: { title: 'remove check', type: 'guide' },
      });
      const withSection = await callTool(client, 'pathfinder_manage_block', {
        operation: 'add-block',
        artifact: created.artifact!,
        opts: { type: 'section', id: 'sec-1', title: 'Section' },
      });
      const withChild = await callTool(client, 'pathfinder_manage_block', {
        operation: 'add-block',
        artifact: withSection.artifact!,
        opts: { type: 'markdown', parent: 'sec-1', content: 'child' },
      });
      const result = await callTool(client, 'pathfinder_manage_block', {
        operation: 'remove-block',
        artifact: withChild.artifact!,
        opts: { id: 'sec-1' },
      });
      expect(result.status).toBe('error');
      expect(result.code).toBe('CONTAINER_HAS_CHILDREN');
      // The remedy must be phrased in MCP parameters — `--orphan-children`
      // is withheld from this surface and would be rejected on retry.
      expect(result.message).toContain('cascade: true');
      expect(result.message).not.toContain('--orphan-children');
      expect(result.message).not.toContain('--cascade');
    } finally {
      await close();
    }
  });

  it('accepts a leaf block added without id at the MCP schema boundary', async () => {
    const { client, close } = await spinUp();
    try {
      const created = await callTool(client, 'pathfinder_create_package', {
        opts: { title: 'leaf check', type: 'guide' },
      });
      const result = await callTool(client, 'pathfinder_manage_block', {
        operation: 'add-block',
        artifact: created.artifact!,
        opts: { type: 'markdown', content: 'auto-minted id' },
      });
      expect(result.status).not.toBe('error');
    } finally {
      await close();
    }
  });

  it('exposes Commander camelCase names and filters unsupported add-block parameters from help', async () => {
    const { client, close } = await spinUp();
    try {
      const result = await callTool(client, 'pathfinder_help', {
        command: 'add-block',
        subcommand: 'section',
      });
      const parameters = [
        ...(result.required as Array<{ name: string }>),
        ...(result.optional as Array<{ name: string }>),
        ...((result.addressing as Array<{ name: string }> | undefined) ?? []),
      ].map((parameter) => parameter.name);
      expect(parameters).toContain('autoCollapse');
      expect(parameters).not.toContain('auto-collapse');
      // ifAbsent is deliberately published: it is the retry-idempotency
      // mechanism (a crashed-and-retried add duplicates content without it).
      expect(parameters).toEqual(expect.arrayContaining(['type', 'parent', 'branch', 'id', 'ifAbsent']));
      // Placement stays a CLI power tool; the MCP procedure is append-only.
      expect(parameters).not.toEqual(expect.arrayContaining(['dir', 'before', 'after', 'position']));
      const parent = [
        ...(result.required as Array<{ name: string; description: string }>),
        ...(result.optional as Array<{ name: string; description: string }>),
        ...((result.addressing as Array<{ name: string; description: string }> | undefined) ?? []),
      ].find((parameter) => parameter.name === 'parent');
      expect(parent?.description).toMatch(/container/i);

      const rootHelp = await callTool(client, 'pathfinder_help', { command: 'add-block' });
      const requiredByType = rootHelp.requiredByType as Record<string, string[]> | undefined;
      expect(requiredByType?.input).toEqual(expect.arrayContaining(['prompt', 'inputType', 'variableName']));
      expect(requiredByType?.input).not.toContain('input-type');
      expect(requiredByType?.input).not.toContain('variable-name');

      // Positional id and cascade are now part of the generic fields bag;
      // orphanChildren is the only block-manager exclusion.
      const remove = await callTool(client, 'pathfinder_help', { command: 'remove-block' });
      expect(remove.required).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'id' })]));
      expect(remove.optional).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'cascade' })]));
      expect(remove.addressing).toBeUndefined();

      const addStep = await callTool(client, 'pathfinder_help', { command: 'add-step' });
      expect(addStep.addressing).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'parent' })]));
    } finally {
      await close();
    }
  });

  it('rejects a parameter filtered from the MCP command interface', async () => {
    const { client, close } = await spinUp();
    try {
      const created = await callTool(client, 'pathfinder_create_package', {
        opts: { title: 'filtered parameter', type: 'guide' },
      });
      const result = await callTool(client, 'pathfinder_manage_block', {
        operation: 'add-block',
        artifact: created.artifact!,
        opts: { type: 'section', id: 'section-1', title: 'Section', 'auto-collapse': true },
      });

      expect(result.status).toBe('error');
      expect(result.code).toBe('UNSUPPORTED_PARAMETER');
      expect((result.data as { unsupported?: string[] })?.unsupported).toEqual(['auto-collapse']);

      const accepted = await callTool(client, 'pathfinder_manage_block', {
        operation: 'add-block',
        artifact: created.artifact!,
        opts: { type: 'section', id: 'section-1', title: 'Section', autoCollapse: true },
      });
      expect(accepted.status).toBe('ok');
      const blocks = accepted.artifact?.content.blocks as Array<Record<string, unknown>>;
      expect(blocks[0]?.autoCollapse).toBe(true);
    } finally {
      await close();
    }
  });

  it('resolves the add-block subcommand from the type field', async () => {
    const { client, close } = await spinUp();
    try {
      const created = await callTool(client, 'pathfinder_create_package', {
        opts: { title: 'subcommand selector', type: 'guide' },
      });

      const unknownType = await callTool(client, 'pathfinder_manage_block', {
        operation: 'add-block',
        artifact: created.artifact!,
        opts: { type: 'not-a-block-type', content: 'hi' },
      });
      expect(unknownType.status).toBe('error');
      expect(unknownType.code).toBe('UNKNOWN_SUBCOMMAND');

      const missingType = await callTool(client, 'pathfinder_manage_block', {
        operation: 'add-block',
        artifact: created.artifact!,
        opts: { content: 'hi' },
      });
      expect(missingType.status).toBe('error');
      expect((missingType.data as { missing?: string[] })?.missing).toEqual(['type']);
    } finally {
      await close();
    }
  });

  // The regexes below pin the hand-written superRefine messages, not the
  // SDK's generic "invalid arguments" prefix — they must fail if the custom
  // message disappears.
  it.each(['get-package', 'get-manifest'] as const)(
    'rejects pathfinder_read_repository %s without id at the MCP schema boundary',
    async (operation) => {
      const { client, close } = await spinUp();
      try {
        const result = await client.callTool({
          name: 'pathfinder_read_repository',
          arguments: { operation },
        });
        expect(result.isError).toBe(true);
        const content = result.content as Array<{ type: string; text?: string }>;
        const text = content.find((part) => part.type === 'text');
        expect(text?.text ?? '').toMatch(new RegExp(`operation "${operation}" requires \`id\``));
        expect(text?.text ?? '').not.toMatch(/--id/);
      } finally {
        await close();
      }
    }
  );

  it('rejects pathfinder_read_session get-block without blockId at the MCP schema boundary', async () => {
    const { client, close } = await spinUp();
    try {
      const created = await callTool(client, 'pathfinder_create_package', {
        opts: { title: 'read check', type: 'guide' },
      });
      expect(created.sessionToken).toBeDefined();
      const result = await client.callTool({
        name: 'pathfinder_read_session',
        arguments: {
          operation: 'get-block',
          sessionToken: created.sessionToken,
        },
      });
      expect(result.isError).toBe(true);
      const content = result.content as Array<{ type: string; text?: string }>;
      const text = content.find((part) => part.type === 'text');
      expect(text?.text ?? '').toMatch(/operation "get-block" requires `blockId`/);
    } finally {
      await close();
    }
  });

  it('every pathfinder_* name referenced by an agent-facing surface resolves in tools/list', async () => {
    const { client, close } = await spinUp();
    try {
      const tools = await client.listTools();
      const registered = new Set(tools.tools.map((tool) => tool.name));
      // The three surfaces agents actually read: the authoring index, the
      // initialize-handshake instructions, and every tool description. A
      // rename that updates the registry but not these would strand agents
      // on a dead index with all other tests green.
      const surfaces = [
        JSON.stringify(await callTool(client, 'pathfinder_authoring_start')),
        SERVER_INSTRUCTIONS,
        ...tools.tools.map((tool) => tool.description ?? ''),
      ].join('\n');
      const mentioned = [...new Set(surfaces.match(/pathfinder_[a-z_]+/g) ?? [])];
      // Sanity floor: guards against the regex or the index going empty.
      expect(mentioned.length).toBeGreaterThanOrEqual(5);
      expect(mentioned.filter((name) => !registered.has(name))).toEqual([]);
    } finally {
      await close();
    }
  });

  it('KNOWN_TOOL_OPERATIONS stays in sync with the operation enums the tools publish', async () => {
    const { client, close } = await spinUp();
    try {
      const tools = await client.listTools();
      const published = new Set<string>();
      for (const tool of tools.tools) {
        const properties = (tool.inputSchema as { properties?: Record<string, { enum?: string[] }> }).properties;
        for (const value of properties?.operation?.enum ?? []) {
          published.add(value);
        }
      }
      // The access log extracts `operation` from the raw body before Zod
      // runs, so its allowlist must mirror exactly what the tools publish.
      expect([...published].sort()).toEqual([...KNOWN_TOOL_OPERATIONS].sort());
    } finally {
      await close();
    }
  });

  it('surfaces CLI-detected schema violations verbatim through pathfinder_manage_block', async () => {
    const { client, close } = await spinUp();
    try {
      const created = await callTool(client, 'pathfinder_create_package', {
        opts: { title: 'bad', type: 'guide' },
      });
      const artifact = created.artifact!;

      // Conditional blocks require at least one --conditions value (CLI-strict
      // guard in runAddBlock). The MCP must surface the CLI's structured
      // error verbatim instead of accepting the call.
      const result = await callTool(client, 'pathfinder_manage_block', {
        operation: 'add-block',
        artifact,
        opts: { type: 'conditional', id: 'cond-1' },
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
      const created = await callTool(client, 'pathfinder_create_package', {
        opts: { title: 'video test', type: 'guide' },
      });
      const artifact = created.artifact!;

      const result = await callTool(client, 'pathfinder_manage_block', {
        operation: 'add-block',
        artifact,
        opts: { type: 'video', src: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
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

  it('publishes video start as a number and rejects a string', async () => {
    const { client, close } = await spinUp();
    try {
      const help = await callTool(client, 'pathfinder_help', { command: 'add-block', subcommand: 'video' });
      const flags = [
        ...(help.required as Array<{ name: string; valueType: string }>),
        ...(help.optional as Array<{ name: string; valueType: string }>),
      ];
      expect(flags.find((flag) => flag.name === 'start')).toMatchObject({ valueType: 'number' });

      const created = await callTool(client, 'pathfinder_create_package', {
        opts: { title: 'video start type', type: 'guide' },
      });
      const asString = await callTool(client, 'pathfinder_manage_block', {
        operation: 'add-block',
        artifact: created.artifact!,
        opts: { type: 'video', src: 'https://www.youtube.com/embed/dQw4w9WgXcQ', start: '10' },
      });
      expect(asString).toMatchObject({ status: 'error', code: 'SCHEMA_VALIDATION' });

      const applied = await callTool(client, 'pathfinder_manage_block', {
        operation: 'add-block',
        artifact: created.artifact!,
        opts: { type: 'video', src: 'https://www.youtube.com/embed/dQw4w9WgXcQ', start: 10 },
      });
      expect(applied.status).toBe('ok');
      const blocks = applied.artifact?.content.blocks as Array<{ start?: number }> | undefined;
      expect(blocks?.[0]?.start).toBe(10);
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
      expect(names).toEqual([
        'create',
        'add-block',
        'add-step',
        'add-choice',
        'set-manifest',
        'inspect',
        'edit-block',
        'remove-block',
        'schema',
      ]);

      const { tools } = await client.listTools();
      const helpTool = tools.find((tool) => tool.name === 'pathfinder_help');
      expect(helpTool?.description).toMatch(/list: true/);
      expect(helpTool?.description).toMatch(/never send `--flag` names/);
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

  it('translates every registered CLI command, not just the mutation ones', async () => {
    const { client, close } = await spinUp();
    try {
      // A command with no exclusion entry inherits its full Commander surface,
      // so new CLI capability reaches agents without touching the adapter.
      const validate = await callTool(client, 'pathfinder_help', { command: 'validate' });
      expect(validate.command).toBe('validate');
      expect(validate.status).not.toBe('error');

      const unknown = await callTool(client, 'pathfinder_help', { command: 'not-a-command' });
      expect(unknown.status).toBe('error');
      expect(unknown.code).toBe('UNKNOWN_COMMAND');

      const unknownSub = await callTool(client, 'pathfinder_help', {
        command: 'add-block',
        subcommand: 'not-a-type',
      });
      expect(unknownSub.status).toBe('error');
      expect(unknownSub.code).toBe('UNKNOWN_SUBCOMMAND');
    } finally {
      await close();
    }
  });

  it('surfaces UNVERIFIED_SELECTOR through pathfinder_manage_block add-step (issue #3, M2 outcome-time)', async () => {
    const { client, close } = await spinUp();
    try {
      const created = await callTool(client, 'pathfinder_create_package', {
        opts: { title: 'selector test', type: 'guide' },
      });
      let artifact = created.artifact!;
      const withMs = await callTool(client, 'pathfinder_manage_block', {
        operation: 'add-block',
        artifact,
        opts: { type: 'multistep', id: 'ms-1', content: 'walk' },
      });
      artifact = withMs.artifact!;
      const stepped = await callTool(client, 'pathfinder_manage_block', {
        operation: 'add-step',
        artifact,
        opts: { parent: 'ms-1', action: 'button', reftarget: '[data-testid="save"]', description: 'Click Save' },
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
      const created = await callTool(client, 'pathfinder_create_package', {
        opts: { title: 'hint test', type: 'guide' },
      });
      const artifact = created.artifact!;
      const result = await callTool(client, 'pathfinder_manage_block', {
        operation: 'add-block',
        artifact,
        opts: { type: 'multistep', id: 'ms-1', content: 'walkthrough heading' },
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

  it('appends a step to a multistep block via pathfinder_manage_block add-step', async () => {
    const { client, close } = await spinUp();
    try {
      const created = await callTool(client, 'pathfinder_create_package', {
        opts: { title: 'step test', type: 'guide' },
      });
      let artifact = created.artifact!;

      // Need a multistep container before add-step has somewhere to land.
      const withMs = await callTool(client, 'pathfinder_manage_block', {
        operation: 'add-block',
        artifact,
        opts: { type: 'multistep', id: 'ms-1', content: 'walkthrough heading' },
      });
      expect(withMs.status).toBe('ok');
      artifact = withMs.artifact!;

      const stepped = await callTool(client, 'pathfinder_manage_block', {
        artifact,
        operation: 'add-step',
        opts: { parent: 'ms-1', action: 'noop', description: 'just look' },
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

  it('appends a choice to a quiz block via pathfinder_manage_block add-choice', async () => {
    const { client, close } = await spinUp();
    try {
      const created = await callTool(client, 'pathfinder_create_package', {
        opts: { title: 'quiz test', type: 'guide' },
      });
      let artifact = created.artifact!;

      const withQuiz = await callTool(client, 'pathfinder_manage_block', {
        operation: 'add-block',
        artifact,
        opts: {
          type: 'quiz',
          id: 'q-1',
          question: 'Is this a test?',
          completionMode: 'correct-only',
        },
      });
      expect(withQuiz.status).toBe('ok');
      artifact = withQuiz.artifact!;

      const choiced = await callTool(client, 'pathfinder_manage_block', {
        artifact,
        operation: 'add-choice',
        opts: { parent: 'q-1', id: 'a', text: 'Yes', correct: true },
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

  it('updates an existing block in place via pathfinder_manage_block edit-block', async () => {
    const { client, close } = await spinUp();
    try {
      const created = await callTool(client, 'pathfinder_create_package', {
        opts: { title: 'edit test', type: 'guide' },
      });
      let artifact = created.artifact!;

      const added = await callTool(client, 'pathfinder_manage_block', {
        operation: 'add-block',
        artifact,
        opts: { type: 'markdown', id: 'md-1', content: 'before' },
      });
      expect(added.status).toBe('ok');
      artifact = added.artifact!;

      const edited = await callTool(client, 'pathfinder_manage_block', {
        operation: 'edit-block',
        artifact,
        opts: { id: 'md-1', content: 'after' },
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

  it('updates manifest fields via pathfinder_manage_guide set-manifest', async () => {
    const { client, close } = await spinUp();
    try {
      const created = await callTool(client, 'pathfinder_create_package', {
        opts: { title: 'manifest test', type: 'guide' },
      });
      const artifact = created.artifact!;

      const updated = await callTool(client, 'pathfinder_manage_guide', {
        artifact,
        operation: 'set-manifest',
        opts: { description: 'a brand-new description' },
      });
      expect(updated.status).toBe('ok');
      expect(updated.artifact?.manifest?.description).toBe('a brand-new description');
    } finally {
      await close();
    }
  });

  it('publishes, validates, and applies set-manifest targeting arrays', async () => {
    const { client, close } = await spinUp();
    try {
      const help = await callTool(client, 'pathfinder_help', { command: 'set-manifest' });
      const flags = [
        ...(help.required as Array<{ name: string; valueType: string; enum?: string[] }>),
        ...(help.optional as Array<{ name: string; valueType: string; enum?: string[] }>),
      ];
      expect(flags.find((flag) => flag.name === 'targetUrlPrefix')).toMatchObject({ valueType: 'array' });
      expect(flags.find((flag) => flag.name === 'targetPlatform')).toMatchObject({
        valueType: 'array',
        enum: ['oss', 'cloud', 'enterprise'],
      });

      const created = await callTool(client, 'pathfinder_create_package', {
        opts: { title: 'targeting test', type: 'guide' },
      });

      const scalar = await callTool(client, 'pathfinder_manage_guide', {
        artifact: created.artifact!,
        operation: 'set-manifest',
        opts: { targetUrlPrefix: '/dashboards' },
      });
      expect(scalar).toMatchObject({ status: 'error', code: 'SCHEMA_VALIDATION' });

      const invalidPlatform = await callTool(client, 'pathfinder_manage_guide', {
        artifact: created.artifact!,
        operation: 'set-manifest',
        opts: { targetPlatform: ['invalid'] },
      });
      expect(invalidPlatform).toMatchObject({ status: 'error', code: 'SCHEMA_VALIDATION' });

      const applied = await callTool(client, 'pathfinder_manage_guide', {
        artifact: created.artifact!,
        operation: 'set-manifest',
        opts: { targetUrlPrefix: ['/dashboards'], targetPlatform: ['cloud'] },
      });
      expect(applied.status).toBe('ok');
      const targeting = applied.artifact?.manifest?.targeting as
        { match?: { and?: Array<Record<string, unknown>> } } | undefined;
      expect(targeting?.match?.and).toEqual([{ urlPrefix: '/dashboards' }, { targetPlatform: 'cloud' }]);
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
