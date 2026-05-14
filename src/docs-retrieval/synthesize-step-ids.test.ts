/**
 * Tests for the runtime step-id synthesizer.
 *
 * The contract the AI auto-heal flow depends on: every interactive block,
 * step container, and sub-step receives a stable id derived from its
 * content. Author ids are preserved.
 */

import { SYNTHESIZED_ID_PREFIX, synthesizeStepIds, synthesizeStepIdsInJson } from './synthesize-step-ids';
import type { JsonGuide } from '../types/json-guide.types';

function makeGuide(blocks: unknown[]): JsonGuide {
  return {
    schemaVersion: '1.1.0',
    id: 'test-guide',
    title: 'Test',
    blocks: blocks as never,
  };
}

describe('synthesizeStepIds', () => {
  it('assigns an id to an interactive block that has none', () => {
    const guide = makeGuide([{ type: 'interactive', action: 'button', reftarget: '.btn', content: 'Click' }]);
    synthesizeStepIds(guide);
    const block = guide.blocks[0] as { id?: string };
    expect(block.id).toBeDefined();
    expect(block.id!.startsWith(SYNTHESIZED_ID_PREFIX)).toBe(true);
  });

  it('preserves an author-set id', () => {
    const guide = makeGuide([
      { type: 'interactive', id: 'my-step', action: 'button', reftarget: '.btn', content: 'Click' },
    ]);
    synthesizeStepIds(guide);
    const block = guide.blocks[0] as { id: string };
    expect(block.id).toBe('my-step');
  });

  it('is deterministic — same input produces same ids', () => {
    const input = [
      { type: 'interactive', action: 'button', reftarget: '.btn', content: 'Click me' },
      { type: 'interactive', action: 'highlight', reftarget: '.foo', content: 'Look here' },
    ];
    const a = makeGuide(JSON.parse(JSON.stringify(input)));
    const b = makeGuide(JSON.parse(JSON.stringify(input)));
    synthesizeStepIds(a);
    synthesizeStepIds(b);
    expect((a.blocks[0] as { id: string }).id).toBe((b.blocks[0] as { id: string }).id);
    expect((a.blocks[1] as { id: string }).id).toBe((b.blocks[1] as { id: string }).id);
  });

  it('two identical blocks at different positions get different ids', () => {
    const block = { type: 'interactive', action: 'button', reftarget: '.btn', content: 'Click' };
    const guide = makeGuide([JSON.parse(JSON.stringify(block)), JSON.parse(JSON.stringify(block))]);
    synthesizeStepIds(guide);
    const id0 = (guide.blocks[0] as { id: string }).id;
    const id1 = (guide.blocks[1] as { id: string }).id;
    expect(id0).not.toBe(id1);
  });

  it('descends into section containers', () => {
    const guide = makeGuide([
      {
        type: 'section',
        title: 'Outer',
        blocks: [{ type: 'interactive', action: 'button', reftarget: '.btn', content: 'Click' }],
      },
    ]);
    synthesizeStepIds(guide);
    const section = guide.blocks[0] as { id?: string; blocks: Array<{ id?: string }> };
    expect(section.id).toBeDefined();
    expect(section.blocks[0]!.id).toBeDefined();
  });

  it('descends into conditional whenTrue / whenFalse branches', () => {
    const guide = makeGuide([
      {
        type: 'conditional',
        condition: 'is-admin',
        whenTrue: [{ type: 'interactive', action: 'button', reftarget: '.t', content: 'T' }],
        whenFalse: [{ type: 'interactive', action: 'button', reftarget: '.f', content: 'F' }],
      },
    ]);
    synthesizeStepIds(guide);
    const cond = guide.blocks[0] as {
      id?: string;
      whenTrue: Array<{ id?: string }>;
      whenFalse: Array<{ id?: string }>;
    };
    expect(cond.id).toBeDefined();
    expect(cond.whenTrue[0]!.id).toBeDefined();
    expect(cond.whenFalse[0]!.id).toBeDefined();
  });

  it('assigns ids to both the multistep container and each sub-step', () => {
    const guide = makeGuide([
      {
        type: 'multistep',
        content: 'Do two things',
        steps: [
          { action: 'button', reftarget: '.a' },
          { action: 'button', reftarget: '.b' },
        ],
      },
    ]);
    synthesizeStepIds(guide);
    const ms = guide.blocks[0] as { id?: string; steps: Array<{ id?: string }> };
    expect(ms.id).toBeDefined();
    expect(ms.steps[0]!.id).toBeDefined();
    expect(ms.steps[1]!.id).toBeDefined();
    expect(ms.steps[0]!.id).not.toBe(ms.steps[1]!.id);
  });

  it('preserves author ids on sub-steps even when container id is synthesized', () => {
    const guide = makeGuide([
      {
        type: 'multistep',
        content: 'Mix',
        steps: [
          { id: 'pinned', action: 'button', reftarget: '.a' },
          { action: 'button', reftarget: '.b' },
        ],
      },
    ]);
    synthesizeStepIds(guide);
    const ms = guide.blocks[0] as { id?: string; steps: Array<{ id?: string }> };
    expect(ms.steps[0]!.id).toBe('pinned');
    expect(ms.steps[1]!.id!.startsWith(SYNTHESIZED_ID_PREFIX)).toBe(true);
  });

  it('changing a step content invalidates its synthesized id', () => {
    const a = makeGuide([{ type: 'interactive', action: 'button', reftarget: '.btn', content: 'V1' }]);
    const b = makeGuide([{ type: 'interactive', action: 'button', reftarget: '.btn', content: 'V2' }]);
    synthesizeStepIds(a);
    synthesizeStepIds(b);
    expect((a.blocks[0] as { id: string }).id).not.toBe((b.blocks[0] as { id: string }).id);
  });
});

describe('synthesizeStepIdsInJson', () => {
  it('round-trips a JSON string with ids assigned', () => {
    const json = JSON.stringify(
      makeGuide([{ type: 'interactive', action: 'button', reftarget: '.btn', content: 'Click' }])
    );
    const out = synthesizeStepIdsInJson(json);
    const parsed = JSON.parse(out);
    expect(parsed.blocks[0].id).toBeDefined();
  });

  it('returns the input unchanged when JSON is malformed', () => {
    expect(synthesizeStepIdsInJson('not-json')).toBe('not-json');
  });

  it('returns the input unchanged when shape is not a guide', () => {
    const notAGuide = JSON.stringify({ hello: 'world' });
    expect(synthesizeStepIdsInJson(notAGuide)).toBe(notAGuide);
  });
});
