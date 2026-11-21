/**
 * @jest-environment node
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { runAddBlock } from '../../commands/add-block';
import { runCreate } from '../../commands/create';
import { readPackage } from '../../utils/package-io';
import { InMemorySessionStore, SESSION_GENERATION_ABSENT } from '../lib/session-store';
import { buildServer } from '../server';
import { useStepIndexFixture, VERIFIED_SELECTOR } from '../../../test-utils/mcp-step-index';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

type Payload = Record<string, any>;

const TOKEN = 'aaaaaaaaaaaaaaaaaaaaaa';

describe('quality hints over MCP', () => {
  useStepIndexFixture();
  let client: Client;
  let server: ReturnType<typeof buildServer>;

  const call = async (name: string, args: Record<string, unknown>): Promise<Payload> => {
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as Array<{ type: string; text: string }>).find((b) => b.type === 'text')?.text;
    return JSON.parse(text ?? '{}') as Payload;
  };
  const add = (opts: Record<string, unknown>) =>
    call('pathfinder_manage_block', { operation: 'add-block', sessionToken: TOKEN, opts });

  beforeEach(async () => {
    const store = new InMemorySessionStore();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pathfinder-quality-hints-'));
    try {
      const outcome = await runCreate({
        dir: path.join(dir, 'pkg'),
        id: 'fixture-pkg',
        title: 'Fixture',
        type: 'guide',
      });
      expect(outcome.status).toBe('ok');
      const state = readPackage(path.join(dir, 'pkg'));
      await store.save(TOKEN, { content: state.content, manifest: state.manifest }, SESSION_GENERATION_ABSENT);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    server = buildServer({ sessionStore: store });
    const [serverT, clientT] = InMemoryTransport.createLinkedPair();
    await server.connect(serverT);
    client = new Client({ name: 'hints-test', version: '0' }, { capabilities: {} });
    await client.connect(clientT);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  const codesOf = (payload: Payload): string[] =>
    (payload.qualityHints?.blocks ?? []).map((h: { code: string }) => h.code);

  it('reports a single-step multistep once, not on the next unrelated add', async () => {
    await add({ type: 'multistep', id: 'ms', content: 'Do it' });
    const step = await call('pathfinder_manage_block', {
      operation: 'add-step',
      sessionToken: TOKEN,
      opts: { parent: 'ms', action: 'highlight', reftarget: '[data-testid="x"]' },
    });
    expect(step.status).toBe('ok');
    expect(codesOf(step)).toContain('SINGLE_STEP_MULTISTEP');
    expect(codesOf(await add({ type: 'markdown', content: 'Next' }))).not.toContain('SINGLE_STEP_MULTISTEP');
  });

  it('flags a callout added right after a callout', async () => {
    await add({ type: 'callout', id: 'c1', title: 'A', content: 'a' });
    const second = await add({ type: 'callout', id: 'c2', title: 'B', content: 'b' });
    expect(second.qualityHints.blocks).toEqual([expect.objectContaining({ blockId: 'c1', code: 'ADJACENT_VISUALS' })]);
  });

  it('leaves qualityHints out of a failed mutation and of a clean one', async () => {
    const failed = await add({ type: 'nonsense' });
    expect(failed.status).toBe('error');
    expect(failed.qualityHints).toBeUndefined();
    expect((await add({ type: 'markdown', content: 'fine' })).qualityHints).toBeUndefined();
  });

  it('puts qualityHints after the short fields and before the large ones', async () => {
    await add({ type: 'html', content: '<p>x</p>' });
    const validated = await call('pathfinder_validate', { sessionToken: TOKEN });
    const second = await add({ type: 'html', content: '<p>y</p>' });
    const finalized = await call('pathfinder_finalize_for_app_platform', { sessionToken: TOKEN });
    const order = (payload: Payload, short: string, large: string[]) => {
      const keys = Object.keys(payload);
      expect(keys.indexOf('qualityHints')).toBeGreaterThan(keys.indexOf(short));
      for (const key of large.filter((k) => keys.includes(k))) {
        expect(keys.indexOf('qualityHints')).toBeLessThan(keys.indexOf(key));
      }
    };
    order(second, 'generation', ['summary', 'artifact']);
    order(validated, 'status', ['summary', 'artifact']);
    order(finalized, 'validation', ['appPlatform', 'resource']);
  });

  it('validate returns more than five hints in full', async () => {
    for (let i = 0; i < 7; i++) {
      await add({ type: 'html', content: `<p>${i}</p>` });
    }
    const validated = await call('pathfinder_validate', { sessionToken: TOKEN });
    expect(validated.qualityHints.blocks.length).toBeGreaterThan(5);
    expect(validated.qualityHints.more).toBeUndefined();
  });

  it('validate reads the kind declared at creation and flags a quiz-less guide that stays valid', async () => {
    const created = await call('pathfinder_create_package', { opts: { title: 'Taught' }, kind: 'teach' });
    const token = created.sessionToken as string;
    await call('pathfinder_manage_block', {
      operation: 'add-block',
      sessionToken: token,
      opts: { type: 'markdown', content: '# Title\n\nIntro' },
    });
    const validated = await call('pathfinder_validate', { sessionToken: token });
    expect(validated.status).toBe('ok');
    const codes = validated.qualityHints.guide.map((h: { code: string }) => h.code);
    expect(codes).toContain('TEACH_NO_QUIZ');
    expect(codes).not.toContain('KIND_NOT_GIVEN');
  });

  it('ignores a kind passed with a sessionToken', async () => {
    const created = await call('pathfinder_create_package', { opts: { title: 'Taught' }, kind: 'teach' });
    const token = created.sessionToken as string;
    const validated = await call('pathfinder_validate', { sessionToken: token, kind: 'reference' });
    const codes = validated.qualityHints.guide.map((h: { code: string }) => h.code);
    expect(codes).toContain('TEACH_NO_QUIZ');
  });

  it('stateless validate still takes kind', async () => {
    const created = await call('pathfinder_create_package', { opts: { title: 'Plain' } });
    const validated = await call('pathfinder_validate', { artifact: created.artifact, kind: 'teach' });
    const codes = validated.qualityHints.guide.map((h: { code: string }) => h.code);
    expect(codes).toContain('TEACH_NO_QUIZ');
  });

  it('keeps the kind out of the finalize resource and artifact', async () => {
    const created = await call('pathfinder_create_package', { opts: { title: 'Taught' }, kind: 'teach' });
    await call('pathfinder_finalize_for_app_platform', { sessionToken: created.sessionToken });
    const finalized = await call('pathfinder_finalize_for_app_platform', { sessionToken: created.sessionToken });
    expect(finalized.status).toBe('ready');
    expect(JSON.stringify(finalized.resource)).not.toContain('teach');
    expect(finalized.resource.spec).not.toHaveProperty('kind');
    expect(created.artifact.content).not.toHaveProperty('kind');
    expect(created.artifact.manifest ?? {}).not.toHaveProperty('kind');
  });

  it('validate without a declared kind says KIND_NOT_GIVEN', async () => {
    const created = await call('pathfinder_create_package', { opts: { title: 'Kindless' } });
    const validated = await call('pathfinder_validate', { sessionToken: created.sessionToken });
    expect(validated.qualityHints.guide).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'KIND_NOT_GIVEN',
          steer:
            'No guide kind was declared, so kind checks were skipped. Declare `kind` when you call pathfinder_create_package.',
        }),
      ])
    );
  });

  it('finalize carries the full list without a cap', async () => {
    for (let i = 0; i < 4; i++) {
      await add({ type: 'html', content: `<p>${i}</p>` });
    }
    await add({ type: 'divider' });
    await add({ type: 'divider' });
    const reviewed = await call('pathfinder_finalize_for_app_platform', { sessionToken: TOKEN });
    expect(reviewed.status).toBe('review');
    const finalized = await call('pathfinder_finalize_for_app_platform', { sessionToken: TOKEN });
    expect(finalized.status).toBe('ready');
    const { blocks, guide, more } = finalized.qualityHints;
    expect(blocks.length + guide.length).toBeGreaterThan(5);
    expect(more).toBeUndefined();
  });

  describe('UNVERIFIED_SELECTOR', () => {
    const unverified = (payload: Payload) =>
      (payload.warnings ?? []).filter((w: { code: string }) => w.code === 'UNVERIFIED_SELECTOR');
    const interactive = (action: string, reftarget: string) =>
      add({ type: 'interactive', action, reftarget, content: 'Do it' });

    it('is dropped for a placeholder, a navigate target and a verified selector', async () => {
      expect(unverified(await interactive('highlight', '[data-testid="TODO-save"]'))).toEqual([]);
      expect(unverified(await interactive('navigate', '/dashboards'))).toEqual([]);
      expect(unverified(await interactive('highlight', VERIFIED_SELECTOR))).toEqual([]);
    });

    it('is dropped for a verified selector on a step', async () => {
      await add({ type: 'multistep', id: 'ms', content: 'Do it' });
      const step = await call('pathfinder_manage_block', {
        operation: 'add-step',
        sessionToken: TOKEN,
        opts: { parent: 'ms', action: 'highlight', reftarget: VERIFIED_SELECTOR },
      });
      expect(unverified(step)).toEqual([]);
    });

    it('is kept for a guessed selector', async () => {
      const guessed = await interactive('highlight', '[data-testid="guess"]');
      expect(unverified(guessed)).toEqual([expect.objectContaining({ path: 'blocks[0]/reftarget' })]);
    });

    it('is kept in stateless mode for a guessed selector and dropped for a placeholder', async () => {
      const created = await call('pathfinder_create_package', { opts: { title: 'Plain' } });
      const addStateless = (reftarget: string) =>
        call('pathfinder_manage_block', {
          operation: 'add-block',
          artifact: created.artifact,
          opts: { type: 'interactive', action: 'highlight', reftarget, content: 'Do it' },
        });
      expect(unverified(await addStateless('[data-testid="guess"]'))).toHaveLength(1);
      expect(unverified(await addStateless('[data-testid="TODO-x"]'))).toEqual([]);
    });

    it('still comes out of the CLI for all of them', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pathfinder-unverified-cli-'));
      try {
        await runCreate({ dir, id: 'cli-pkg', title: 'CLI', type: 'guide' });
        for (const [action, reftarget] of [
          ['highlight', '[data-testid="TODO-save"]'],
          ['navigate', '/dashboards'],
          ['highlight', VERIFIED_SELECTOR],
        ]) {
          const outcome = await runAddBlock({
            dir,
            type: 'interactive',
            fields: { action, reftarget, content: reftarget },
          });
          expect(outcome.status === 'ok' && outcome.warnings?.some((w) => w.code === 'UNVERIFIED_SELECTOR')).toBe(true);
        }
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('finalize review pass', () => {
    const finalize = (args: Record<string, unknown> = { sessionToken: TOKEN }) =>
      call('pathfinder_finalize_for_app_platform', args);
    it('returns review while hints are open and keeps the session', async () => {
      await add({ type: 'html', content: '<p>x</p>' });
      const first = await finalize();
      expect(first.status).toBe('review');
      expect(first.message).toContain('Nothing was saved and the session is still open.');
      expect(first.qualityHints.blocks.length).toBeGreaterThan(0);
      expect(first.resource).toBeUndefined();
      expect((await call('pathfinder_validate', { sessionToken: TOKEN })).status).toBe('ok');
    });

    it('goes ready on the second call, lists the hints, and spends the session', async () => {
      await add({ type: 'html', content: '<p>x</p>' });
      await finalize();
      const second = await finalize();
      expect(second.status).toBe('ready');
      expect(second.qualityHints.blocks.length).toBeGreaterThan(0);
      expect((await finalize()).code).toBe('SESSION_NOT_FOUND');
    });

    it('reviews again when a hint appears after the review', async () => {
      await add({ type: 'html', content: '<p>x</p>' });
      await finalize();
      await add({ type: 'divider' });
      await add({ type: 'divider' });
      const again = await finalize();
      expect(again.status).toBe('review');
      expect((await finalize()).status).toBe('ready');
    });

    it('goes ready straight away with no hints', async () => {
      const created = await call('pathfinder_create_package', { opts: { title: 'Clean' }, kind: 'reference' });
      await call('pathfinder_manage_block', {
        operation: 'add-block',
        sessionToken: created.sessionToken,
        opts: { type: 'markdown', content: '# Clean\n\nIntro' },
      });
      await call('pathfinder_manage_block', {
        operation: 'add-block',
        sessionToken: created.sessionToken,
        opts: { type: 'markdown', content: 'You now know the basics. Next, read the docs.' },
      });
      const finalized = await finalize({ sessionToken: created.sessionToken });
      expect(finalized.qualityHints).toBeUndefined();
      expect(finalized.status).toBe('ready');
    });

    it('leaves stateless finalize unchanged', async () => {
      const created = await call('pathfinder_create_package', { opts: { title: 'Plain' } });
      expect((await finalize({ artifact: created.artifact })).status).toBe('ready');
    });
  });

  it('does not add qualityHints to the CLI outcome of the same command', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pathfinder-quality-hints-cli-'));
    try {
      await runCreate({ dir, id: 'cli-pkg', title: 'CLI', type: 'guide' });
      const outcome = await runAddBlock({ dir, type: 'html', content: '<p>x</p>' } as never);
      expect(JSON.stringify(outcome)).not.toContain('qualityHints');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
