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
