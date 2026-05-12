/**
 * End-to-end composition test for the MCP hardening slices (issues #1, #2,
 * #3, #7, #8).
 *
 * Each individual hint surface has a focused test elsewhere — server
 * `instructions` and tool descriptions in `server.test.ts`, warnings in
 * `commands.test.ts`, the `_start` payload in `server.test.ts`, ETag
 * round-trip in `etag.test.ts`, normalizer in `input-normalizers.test.ts`.
 * This file exists to prove the surfaces **compose** under a canonical
 * authoring flow: an agent that walks `_start` → `create_package` →
 * `add_block` → `add_step` sees the right hint at every layer it touches,
 * and the wire-level integrity check survives multi-hop artifact passing.
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
 *   non-empty `reftarget`; `INPUT_NORMALIZED` on a YouTube watch URL.
 * - **Wire-level integrity** (slice 2 / issue #1): every response carries
 *   `artifact.__etag`; mutations check the echoed etag and return
 *   `ARTIFACT_MUTATED` on mismatch.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { buildServer } from '../server';

interface Outcome {
  status?: string;
  code?: string;
  artifact?: { content: Record<string, unknown>; manifest?: Record<string, unknown>; __etag?: string };
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
      artifact = stepAdd.artifact!;

      // -------- Slice 2 / Issue #1: every response so far carries an etag,
      // and the etag changes across mutations (state changed → hash changed).
      // The agent's verbatim-echo contract works because we've been threading
      // `artifact` from response to request without touching it.
      expect(typeof created.artifact?.__etag).toBe('string');
      expect(created.artifact?.__etag).toMatch(/^[0-9a-f]{16}$/);
      const etags = [
        created.artifact?.__etag,
        markdownAdd.artifact?.__etag,
        multistepAdd.artifact?.__etag,
        stepAdd.artifact?.__etag,
      ];
      // Every mutation produced a different etag — proves the hash actually
      // reflects content changes, not just a constant.
      expect(new Set(etags).size).toBe(etags.length);

      // -------- Slice 2 / Issue #2: a YouTube watch URL is auto-normalized
      // to the embed form. The agent gets an INPUT_NORMALIZED warning, the
      // call succeeds, and the persisted block carries the embed URL.
      const videoAdd = await callTool(client, 'pathfinder_add_block', {
        artifact,
        type: 'video',
        fields: { src: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
      });
      expect(videoAdd.status).toBe('ok');
      const normalized = videoAdd.warnings?.find((w) => w.code === 'INPUT_NORMALIZED');
      expect(normalized).toBeDefined();
      expect(normalized?.path).toBe('src');
      const videoBlock = (videoAdd.artifact?.content.blocks as Array<{ type: string; src?: string }>).find(
        (b) => b.type === 'video'
      );
      expect(videoBlock?.src).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ');
      artifact = videoAdd.artifact!;

      // -------- Slice 2 / Issue #1: artifact corruption is detected before
      // schema validation runs. Mutate any field in the echoed artifact and
      // confirm the next mutation returns ARTIFACT_MUTATED with remediation-
      // shaped text (not a SCHEMA_VALIDATION misdirection).
      const corrupted = {
        ...artifact,
        content: { ...artifact.content, title: 'Tampered title' },
        // Keep the stale __etag from before the mutation — that's what the
        // agent would echo if it forgot to round-trip cleanly.
      };
      const mutated = await callTool(client, 'pathfinder_add_block', {
        artifact: corrupted,
        type: 'markdown',
        fields: { content: 'should not be appended' },
      });
      expect(mutated.status).toBe('error');
      expect(mutated.code).toBe('ARTIFACT_MUTATED');
      expect(String(mutated.message)).toMatch(/integrity tag/i);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
