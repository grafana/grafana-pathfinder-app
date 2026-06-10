import { applyPatchToGuide } from './apply-ai-fix-patch';
import type { AiFixPatch } from './ai-fix-patch.schema';
import { parseJsonGuide } from '../../docs-retrieval';
import type { ParsedElement } from '../../types/content.types';

function makeGuide(blocks: unknown[]): string {
  return JSON.stringify({ schemaVersion: '1.1.0', id: 'test-guide', title: 'Test guide', blocks });
}

// Collect every props.stepId the parser assigns — used to drive the "addressable by the
// parser's stepId" contract tests below.
function collectStepIds(elements: Array<ParsedElement | string>): string[] {
  const ids: string[] = [];
  for (const el of elements) {
    if (typeof el === 'string') {
      continue;
    }
    const stepId = el.props?.stepId;
    if (typeof stepId === 'string' && stepId.length > 0) {
      ids.push(stepId);
    }
    ids.push(...collectStepIds(el.children));
  }
  return ids;
}

const validStep = {
  type: 'interactive',
  id: 'step-1',
  action: 'button',
  reftarget: '[data-testid="old-selector"]',
  content: 'Click me',
};

describe('applyPatchToGuide', () => {
  describe('selector-patch', () => {
    it('replaces the reftarget on the matching interactive block', () => {
      const result = applyPatchToGuide(makeGuide([validStep]), {
        type: 'selector-patch',
        targetStepId: 'step-1',
        newReftarget: '[data-testid="new-selector"]',
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(JSON.parse(result.newGuideJson).blocks[0].reftarget).toBe('[data-testid="new-selector"]');
      }
    });

    it('reaches a step nested in a section block', () => {
      const guideJson = makeGuide([{ type: 'section', title: 'Outer', blocks: [validStep] }]);
      const result = applyPatchToGuide(guideJson, {
        type: 'selector-patch',
        targetStepId: 'step-1',
        newReftarget: '[data-testid="found-in-section"]',
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(JSON.parse(result.newGuideJson).blocks[0].blocks[0].reftarget).toBe('[data-testid="found-in-section"]');
      }
    });

    it('fails when no block matches the target id', () => {
      const result = applyPatchToGuide(makeGuide([validStep]), {
        type: 'selector-patch',
        targetStepId: 'step-missing',
        newReftarget: '[data-testid="x"]',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/No interactive block found/);
      }
    });

    it('reaches a step nested in a conditional whenTrue branch', () => {
      const conditional = {
        type: 'conditional',
        conditions: ['has-datasource:prometheus'],
        whenTrue: [validStep],
        whenFalse: [],
      };
      const result = applyPatchToGuide(makeGuide([conditional]), {
        type: 'selector-patch',
        targetStepId: 'step-1',
        newReftarget: '[data-testid="found-in-whenTrue"]',
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(JSON.parse(result.newGuideJson).blocks[0].whenTrue[0].reftarget).toBe(
          '[data-testid="found-in-whenTrue"]'
        );
      }
    });

    it('reaches a step nested in a conditional whenFalse branch', () => {
      const conditional = {
        type: 'conditional',
        conditions: ['has-datasource:prometheus'],
        whenTrue: [],
        whenFalse: [validStep],
      };
      const result = applyPatchToGuide(makeGuide([conditional]), {
        type: 'selector-patch',
        targetStepId: 'step-1',
        newReftarget: '[data-testid="found-in-whenFalse"]',
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(JSON.parse(result.newGuideJson).blocks[0].whenFalse[0].reftarget).toBe(
          '[data-testid="found-in-whenFalse"]'
        );
      }
    });

    it('rejects an unsafe selector patch even when called directly with a typed patch', () => {
      const result = applyPatchToGuide(makeGuide([validStep]), {
        type: 'selector-patch',
        targetStepId: 'step-1',
        newReftarget: '<script>alert(1)</script>',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/patch/i);
      }
    });

    it('does not crash when a sibling conditional has no matching step', () => {
      const conditional = {
        type: 'conditional',
        conditions: ['has-datasource:prometheus'],
        whenTrue: [{ ...validStep, id: 'unrelated-a' }],
        whenFalse: [{ ...validStep, id: 'unrelated-b' }],
      };
      const result = applyPatchToGuide(makeGuide([conditional, validStep]), {
        type: 'selector-patch',
        targetStepId: 'step-1',
        newReftarget: '[data-testid="found-after-conditional"]',
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(JSON.parse(result.newGuideJson).blocks[1].reftarget).toBe('[data-testid="found-after-conditional"]');
      }
    });
  });

  describe('prepend-step', () => {
    it('inserts the new step immediately before the target', () => {
      const result = applyPatchToGuide(makeGuide([validStep]), {
        type: 'prepend-step',
        beforeStepId: 'step-1',
        newStep: {
          type: 'interactive',
          action: 'button',
          reftarget: '[data-testid="setup-step"]',
          content: 'Open the menu first',
        } as never,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        const parsed = JSON.parse(result.newGuideJson);
        expect(parsed.blocks).toHaveLength(2);
        expect(parsed.blocks[0].reftarget).toBe('[data-testid="setup-step"]');
        expect(parsed.blocks[1].id).toBe('step-1');
      }
    });

    it('inserts inside a container at the correct position', () => {
      const other = { ...validStep, id: 'step-other', reftarget: '[data-testid="other"]' };
      const guideJson = makeGuide([{ type: 'section', title: 'Outer', blocks: [other, validStep] }]);
      const result = applyPatchToGuide(guideJson, {
        type: 'prepend-step',
        beforeStepId: 'step-1',
        newStep: {
          type: 'interactive',
          action: 'button',
          reftarget: '[data-testid="setup"]',
          content: 'Setup',
        } as never,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        const sectionBlocks = JSON.parse(result.newGuideJson).blocks[0].blocks;
        expect(sectionBlocks).toHaveLength(3);
        expect(sectionBlocks[0].id).toBe('step-other');
        expect(sectionBlocks[1].reftarget).toBe('[data-testid="setup"]');
        expect(sectionBlocks[2].id).toBe('step-1');
      }
    });
  });

  describe('substep-selector-patch', () => {
    const multistepWithTwoSteps = {
      type: 'multistep',
      id: 'multi-1',
      content: 'Do two things',
      steps: [
        { action: 'button', reftarget: '[data-testid="first"]' },
        { action: 'button', reftarget: '[data-testid="second-stale"]' },
      ],
    };

    it('replaces the reftarget on the targeted sub-step inside a multistep block', () => {
      const result = applyPatchToGuide(makeGuide([multistepWithTwoSteps]), {
        type: 'substep-selector-patch',
        containerId: 'multi-1',
        subStepIndex: 1,
        newReftarget: '[data-testid="second-fixed"]',
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        const parsed = JSON.parse(result.newGuideJson);
        expect(parsed.blocks[0].steps[0].reftarget).toBe('[data-testid="first"]');
        expect(parsed.blocks[0].steps[1].reftarget).toBe('[data-testid="second-fixed"]');
      }
    });

    it('reaches a container nested in a section', () => {
      const result = applyPatchToGuide(
        makeGuide([{ type: 'section', title: 'Outer', blocks: [multistepWithTwoSteps] }]),
        {
          type: 'substep-selector-patch',
          containerId: 'multi-1',
          subStepIndex: 0,
          newReftarget: '[data-testid="first-fixed"]',
        }
      );
      expect(result.ok).toBe(true);
    });

    it('fails when the container id is not found', () => {
      const result = applyPatchToGuide(makeGuide([multistepWithTwoSteps]), {
        type: 'substep-selector-patch',
        containerId: 'missing',
        subStepIndex: 0,
        newReftarget: '[data-testid="x"]',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/No multistep\/guided container/);
      }
    });

    it('fails with a range error when subStepIndex is out of bounds', () => {
      const result = applyPatchToGuide(makeGuide([multistepWithTwoSteps]), {
        type: 'substep-selector-patch',
        containerId: 'multi-1',
        subStepIndex: 99,
        newReftarget: '[data-testid="x"]',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/out of range/);
      }
    });

    it('works for guided containers too', () => {
      const guided = {
        type: 'guided',
        id: 'guided-1',
        content: 'Guided sequence',
        steps: [{ action: 'button', reftarget: '[data-testid="g-step"]' }],
      };
      const result = applyPatchToGuide(makeGuide([guided]), {
        type: 'substep-selector-patch',
        containerId: 'guided-1',
        subStepIndex: 0,
        newReftarget: '[data-testid="g-step-fixed"]',
      });
      expect(result.ok).toBe(true);
    });

    it('reaches a multistep container nested in a conditional branch', () => {
      const conditional = {
        type: 'conditional',
        conditions: ['has-datasource:prometheus'],
        whenTrue: [multistepWithTwoSteps],
        whenFalse: [],
      };
      const result = applyPatchToGuide(makeGuide([conditional]), {
        type: 'substep-selector-patch',
        containerId: 'multi-1',
        subStepIndex: 1,
        newReftarget: '[data-testid="patched-via-conditional"]',
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(JSON.parse(result.newGuideJson).blocks[0].whenTrue[0].steps[1].reftarget).toBe(
          '[data-testid="patched-via-conditional"]'
        );
      }
    });
  });

  // The folded-in id reconciliation: an anonymous block (no author id) must be addressable by
  // the exact stepId the parser hands the component (props.stepId === materialized block.id).
  describe('addresses anonymous blocks by the parser-derived stepId', () => {
    it('selector-patch on an anonymous top-level interactive block', () => {
      const guideJson = makeGuide([
        { type: 'interactive', action: 'button', reftarget: '[data-testid="old"]', content: 'Click' },
      ]);
      const stepIds = collectStepIds(parseJsonGuide(guideJson).data?.elements ?? []);
      expect(stepIds).toHaveLength(1);
      const result = applyPatchToGuide(guideJson, {
        type: 'selector-patch',
        targetStepId: stepIds[0]!,
        newReftarget: '[data-testid="new"]',
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(JSON.parse(result.newGuideJson).blocks[0].reftarget).toBe('[data-testid="new"]');
      }
    });

    it('selector-patch on an anonymous interactive nested in a section', () => {
      const guideJson = makeGuide([
        {
          type: 'section',
          title: 'S',
          blocks: [{ type: 'interactive', action: 'button', reftarget: '[data-testid="old"]', content: 'Click' }],
        },
      ]);
      const stepIds = collectStepIds(parseJsonGuide(guideJson).data?.elements ?? []);
      expect(stepIds).toHaveLength(1);
      const result = applyPatchToGuide(guideJson, {
        type: 'selector-patch',
        targetStepId: stepIds[0]!,
        newReftarget: '[data-testid="new"]',
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(JSON.parse(result.newGuideJson).blocks[0].blocks[0].reftarget).toBe('[data-testid="new"]');
      }
    });

    it('substep-selector-patch on an anonymous multistep container', () => {
      const guideJson = makeGuide([
        {
          type: 'multistep',
          content: 'Do',
          steps: [
            { action: 'button', reftarget: '[data-testid="a"]' },
            { action: 'button', reftarget: '[data-testid="b-stale"]' },
          ],
        },
      ]);
      const stepIds = collectStepIds(parseJsonGuide(guideJson).data?.elements ?? []);
      expect(stepIds).toHaveLength(1);
      const result = applyPatchToGuide(guideJson, {
        type: 'substep-selector-patch',
        containerId: stepIds[0]!,
        subStepIndex: 1,
        newReftarget: '[data-testid="b-fixed"]',
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(JSON.parse(result.newGuideJson).blocks[0].steps[1].reftarget).toBe('[data-testid="b-fixed"]');
      }
    });
  });

  describe('error paths', () => {
    it('rejects unparseable JSON', () => {
      const result = applyPatchToGuide('not-json', { type: 'selector-patch', targetStepId: 'x', newReftarget: '.btn' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/Failed to parse/);
      }
    });

    it('rejects a guide that fails schema validation before the patch', () => {
      const malformed = JSON.stringify({ id: 'g', title: 't', blocks: 'not-an-array' });
      const result = applyPatchToGuide(malformed, { type: 'selector-patch', targetStepId: 'x', newReftarget: '.btn' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/schema validation/);
      }
    });

    it('rejects a structurally-invalid patch that bypassed schema validation at the call site', () => {
      const guideJson = makeGuide([validStep]);
      const badPatch = {
        type: 'prepend-step',
        beforeStepId: 'step-1',
        newStep: { type: 'interactive', action: 'button', reftarget: '[data-testid="x"]' }, // missing required content
      } as unknown as AiFixPatch;
      const result = applyPatchToGuide(guideJson, badPatch);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/patch failed schema validation/);
      }
      // Caller's input string is untouched.
      expect(JSON.parse(guideJson).blocks).toHaveLength(1);
    });
  });
});
