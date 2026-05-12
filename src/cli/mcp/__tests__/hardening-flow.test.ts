/**
 * End-to-end composition test for the MCP hardening slice (issues #3, #7, #8).
 *
 * Each individual hint surface has a focused test elsewhere — server
 * `instructions` and tool descriptions in `server.test.ts`, warnings in
 * `commands.test.ts`, the `_start` payload in `server.test.ts`. This file
 * exists to prove the surfaces **compose** under a canonical authoring flow:
 * an agent that walks `_start` → `create_package` → `add_block` → `add_step`
 * sees the right hint at every layer it touches.
 *
 * Layered hints exercised:
 * - **Layer 3** (initialize handshake): `client.getInstructions()` returns the
 *   server-level instructions string covering routing vocabulary + selector
 *   discipline + composition rules.
 * - **Layer 2** (`pathfinder_authoring_start` payload): `triggers`, `notFor`,
 *   `compositionRules` ride on the first session-time tool call.
 * - **Layer 1** (tool descriptions): leaders are use-case-led ("Use this tool
 *   when the user wants to ...") — verified at scale in `server.test.ts`.
 * - **Outcome-time** (`warnings[]`): `MULTISTEP_COMPOSITION_HINT` on
 *   `add_block(multistep)`; `UNVERIFIED_SELECTOR` on any write that lands a
 *   non-empty `reftarget`.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { buildServer } from '../server';

interface Outcome {
  status?: string;
  artifact?: { content: Record<string, unknown>; manifest?: Record<string, unknown> };
  warnings?: Array<{ code: string; message: string; path?: string }>;
  [key: string]: unknown;
}

async function callTool(client: Client, name: string, args: Record<string, unknown> = {}): Promise<Outcome> {
  const result = await client.callTool({ name, arguments: args });
  const blocks = result.content as Array<{ type: string; text: string }>;
  const text = blocks.find((b) => b.type === 'text')?.text;
  if (!text) {
    throw new Error(`tool ${name} returned no text content`);
  }
  return JSON.parse(text) as Outcome;
}

describe('MCP hardening — end-to-end composition', () => {
  it('an agent walking the canonical flow sees every hardening hint at the right layer', async () => {
    const server = buildServer();
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'hardening-flow-test', version: '0' }, { capabilities: {} });
    await client.connect(clientTransport);

    try {
      // -------- Layer 3: initialize handshake carries server instructions.
      const instructions = client.getInstructions();
      expect(instructions).toBeTruthy();
      expect(instructions).toMatch(/create a pathfinder/i);
      expect(instructions).toMatch(/reftarget/i);
      expect(instructions).toMatch(/multistep/i);

      // -------- Layer 2: `_start` carries routing vocabulary + composition rules.
      const ctx = await callTool(client, 'pathfinder_authoring_start');
      expect(ctx.triggers).toEqual(expect.arrayContaining(['create a pathfinder']));
      expect(ctx.notFor).toBeDefined();
      const compositionRules = ctx.compositionRules as string[];
      expect(compositionRules.length).toBeGreaterThanOrEqual(3);
      const compositionJoined = compositionRules.join('\n');
      expect(compositionJoined).toMatch(/multistep/i);
      expect(compositionJoined).toMatch(/noop/i);
      expect(compositionJoined).toMatch(/reftarget/i);

      // -------- Setup: fresh artifact for the authoring flow.
      const created = await callTool(client, 'pathfinder_create_package', {
        title: 'Hardening flow test',
        type: 'guide',
      });
      expect(created.status).toBe('ok');
      let artifact = created.artifact!;

      // -------- Control: a markdown block emits no hardening warnings —
      // confirms the warning channel doesn't false-fire on unrelated calls.
      const markdownAdd = await callTool(client, 'pathfinder_add_block', {
        artifact,
        type: 'markdown',
        fields: { content: 'Intro' },
      });
      expect(markdownAdd.status).toBe('ok');
      expect(markdownAdd.warnings).toBeUndefined();
      artifact = markdownAdd.artifact!;

      // -------- Issue #8: adding a multistep block fires the composition hint
      // at outcome-time so the agent gets a reinforcing nudge even if it
      // ignored the same rule in `_start.compositionRules`.
      const multistepAdd = await callTool(client, 'pathfinder_add_block', {
        artifact,
        type: 'multistep',
        explicitId: 'walk-1',
        fields: { content: 'walkthrough heading' },
      });
      expect(multistepAdd.status).toBe('ok');
      const compositionHint = multistepAdd.warnings?.find((w) => w.code === 'MULTISTEP_COMPOSITION_HINT');
      expect(compositionHint).toBeDefined();
      artifact = multistepAdd.artifact!;

      // -------- Issue #3: adding a step with a `reftarget` fires the
      // unverified-selector signal at outcome-time. The path carries the
      // position so a reviewer can grep for the exact step that took the risk.
      const stepAdd = await callTool(client, 'pathfinder_add_step', {
        artifact,
        parentId: 'walk-1',
        fields: { action: 'button', reftarget: '[data-testid="save"]', description: 'Click Save' },
      });
      expect(stepAdd.status).toBe('ok');
      const unverified = stepAdd.warnings?.find((w) => w.code === 'UNVERIFIED_SELECTOR');
      expect(unverified).toBeDefined();
      expect(unverified?.path).toContain('reftarget');
    } finally {
      await client.close();
      await server.close();
    }
  });
});
