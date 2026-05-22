/**
 * Tests for the camelCase ↔ lowercase field aliasing in the JSON parser.
 *
 * The Zod schema (validate-guide) still requires the canonical
 * lowercase form (`action`, `reftarget`, `targetvalue`) so the CLI's
 * flag-generation and Commander help-text contracts stay stable.
 *
 * The runtime parser is a step more lenient: when an authored block
 * contains BOTH the lowercase canonical and a camelCase alias, canonical
 * wins; missing-lowercase + present-camelCase is still rejected at
 * validation time (intentional — schema-level acceptance is a follow-up).
 *
 * The parser also plumbs an explicit JSON `id` field into the
 * `ParsedElement.props.stepId` slot so author-stable IDs override the
 * section's positional `${sectionId}-step-N` convention.
 */

import { parseJsonGuide } from './json-parser';
import type { JsonGuide } from '../types/json-guide.types';

function makeGuide(blockOverrides: Record<string, unknown>): JsonGuide {
  return {
    id: 'aliases-test',
    title: 'Aliases test',
    blocks: [
      {
        type: 'interactive',
        content: 'Click the button',
        ...blockOverrides,
      } as never,
    ],
  };
}

describe('json-parser — field-name alias acceptance', () => {
  it('interactive block: reads canonical lowercase fields', () => {
    const guide = makeGuide({
      action: 'button',
      reftarget: 'Save',
      targetvalue: undefined,
    });

    const result = parseJsonGuide(guide);
    const interactive = result.data!.elements.find((el) => el.type === 'interactive-step');

    expect(interactive).toBeDefined();
    expect(interactive!.props.targetAction).toBe('button');
    expect(interactive!.props.refTarget).toBe('Save');
  });

  it('interactive block: camelCase-alias-only input is rejected by the schema (canonical required)', () => {
    const guide = makeGuide({
      targetAction: 'highlight',
      refTarget: '.my-element',
      targetValue: 'expected',
    });

    const result = parseJsonGuide(guide);
    // Schema-level acceptance of camelCase aliases is a follow-up — for
    // now the validator rejects guides that omit the lowercase canonical
    // form. The parser's `?? camelCase` fallback only fires when both
    // are present (defensive coexistence).
    expect(result.isValid).toBe(false);
  });

  it('interactive block: canonical wins when both are present', () => {
    const guide = makeGuide({
      action: 'button',
      targetAction: 'highlight',
      reftarget: 'A',
      refTarget: 'B',
    });

    const result = parseJsonGuide(guide);
    const interactive = result.data!.elements.find((el) => el.type === 'interactive-step');

    expect(interactive!.props.targetAction).toBe('button');
    expect(interactive!.props.refTarget).toBe('A');
  });

  it('interactive block: explicit `id` is plumbed into `props.stepId`', () => {
    const guide = makeGuide({
      id: 'my-custom-step-id',
      action: 'button',
      reftarget: 'Save',
    });

    const result = parseJsonGuide(guide);
    const interactive = result.data!.elements.find((el) => el.type === 'interactive-step');

    expect(interactive!.props.stepId).toBe('my-custom-step-id');
  });

  it('multistep block: reads canonical lowercase on each inner step', () => {
    const guide: JsonGuide = {
      id: 'multistep-aliases',
      title: 'multistep aliases',
      blocks: [
        {
          type: 'multistep',
          content: 'Sequence',
          steps: [
            { action: 'highlight', reftarget: '.a' },
            { action: 'button', reftarget: 'Save' },
          ],
        },
      ],
    };

    const result = parseJsonGuide(guide);
    const multistep = result.data!.elements.find((el) => el.type === 'interactive-multi-step');

    expect(multistep).toBeDefined();
    const actions = (multistep!.props as { internalActions: Array<{ targetAction: string; refTarget?: string }> })
      .internalActions;
    expect(actions[0]).toMatchObject({ targetAction: 'highlight', refTarget: '.a' });
    expect(actions[1]).toMatchObject({ targetAction: 'button', refTarget: 'Save' });
  });
});

describe('json-parser — stable derived stepIds (closes #8 standalone instability)', () => {
  function findInteractive(result: ReturnType<typeof parseJsonGuide>, type: string) {
    return result.data!.elements.find((el) => el.type === type);
  }

  it('emits a derived stepId for a top-level interactive block with no author id', () => {
    const guide = makeGuide({ action: 'button', reftarget: 'Save' });
    const result = parseJsonGuide(guide);
    const interactive = findInteractive(result, 'interactive-step');
    expect(interactive!.props.stepId).toBeDefined();
    expect(typeof interactive!.props.stepId).toBe('string');
    // Derived IDs are scoped to the synthetic standalone parent.
    expect(interactive!.props.stepId).toMatch(/^__standalone__-step-/);
  });

  it('derived stepId is stable across re-parses of the same JSON', () => {
    const guide = makeGuide({ action: 'highlight', reftarget: '.target' });
    const a = parseJsonGuide(guide);
    const b = parseJsonGuide(guide);
    const idA = findInteractive(a, 'interactive-step')!.props.stepId;
    const idB = findInteractive(b, 'interactive-step')!.props.stepId;
    expect(idA).toBe(idB);
  });

  it('derived stepId changes when the block content changes', () => {
    const idA = findInteractive(
      parseJsonGuide(makeGuide({ action: 'highlight', reftarget: '.a' })),
      'interactive-step'
    )!.props.stepId;
    const idB = findInteractive(
      parseJsonGuide(makeGuide({ action: 'highlight', reftarget: '.b' })),
      'interactive-step'
    )!.props.stepId;
    expect(idA).not.toBe(idB);
  });

  it('author-supplied id always wins over the derived hash', () => {
    const guide = makeGuide({ id: 'author-chosen', action: 'button', reftarget: 'Save' });
    const result = parseJsonGuide(guide);
    expect(findInteractive(result, 'interactive-step')!.props.stepId).toBe('author-chosen');
  });

  it('section-managed children receive section-prefixed derived stepIds', () => {
    const guide: JsonGuide = {
      id: 'section-stable',
      title: 'section-stable',
      blocks: [
        {
          type: 'section',
          id: 'setup',
          title: 'Setup',
          blocks: [
            { type: 'interactive', content: 'a', action: 'highlight', reftarget: '.a' },
            { type: 'interactive', content: 'b', action: 'button', reftarget: 'Save' },
          ],
        } as never,
      ],
    };

    const result = parseJsonGuide(guide);
    const section = result.data!.elements.find((el) => el.type === 'interactive-section')!;
    const children = (section.children ?? []) as Array<{ props: { stepId?: string } }>;
    const childIds = children.map((c) => c.props.stepId);
    expect(childIds[0]).toMatch(/^section-setup-step-/);
    expect(childIds[1]).toMatch(/^section-setup-step-/);
    expect(childIds[0]).not.toBe(childIds[1]);
  });

  it('emits stable stepIds for terminal / code-block / quiz blocks too', () => {
    const guide: JsonGuide = {
      id: 'all-types',
      title: 'all-types',
      blocks: [
        { type: 'terminal', command: 'ls', content: 'List files' } as never,
        { type: 'code-block', code: 'console.log()', reftarget: '.editor', content: 'Paste this' } as never,
        {
          type: 'quiz',
          question: 'Pick one',
          choices: [
            { id: 'a', text: 'A', correct: true },
            { id: 'b', text: 'B', correct: false },
          ],
        } as never,
      ],
    };

    const result = parseJsonGuide(guide);
    if (!result.isValid) {
      // Surface validator output so a future schema tightening tells us
      // why the test had to update its fixture.
      throw new Error(`fixture rejected by schema: ${JSON.stringify(result.errors)}`);
    }
    const types = ['terminal-step', 'code-block-step', 'quiz-block'];
    for (const t of types) {
      const el = result.data!.elements.find((e) => e.type === t);
      expect(el).toBeDefined();
      expect(el!.props.stepId).toBeDefined();
    }
  });

  it('conditional-branch children get distinct parentIds so duplicate content does not collide', () => {
    const guide: JsonGuide = {
      id: 'conditional-stable',
      title: 'conditional-stable',
      blocks: [
        {
          type: 'conditional',
          conditions: ['has-datasource:prometheus'],
          whenTrue: [{ type: 'interactive', content: 'x', action: 'highlight', reftarget: '.x' }],
          whenFalse: [{ type: 'interactive', content: 'x', action: 'highlight', reftarget: '.x' }],
        } as never,
      ],
    };

    const result = parseJsonGuide(guide);
    const conditional = result.data!.elements.find((el) => el.type === 'interactive-conditional')!;
    const trueId = (conditional.props.whenTrueChildren as Array<{ props: { stepId: string } }>)[0]!.props.stepId;
    const falseId = (conditional.props.whenFalseChildren as Array<{ props: { stepId: string } }>)[0]!.props.stepId;
    expect(trueId).toBeDefined();
    expect(falseId).toBeDefined();
    expect(trueId).not.toBe(falseId);
  });
});
