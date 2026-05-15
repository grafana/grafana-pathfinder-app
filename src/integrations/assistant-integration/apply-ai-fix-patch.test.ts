/**
 * apply-ai-fix-patch tests
 *
 * Cover the pure tree-walk that AI auto-heal uses to mutate a running guide:
 * - selector-patch finds the target by `id` and replaces `reftarget`
 * - prepend-step inserts a new block before the target
 * - both operations re-validate via `JsonGuideSchema`
 * - container blocks (section / conditional) are recursed into
 * - missing targets and malformed guide JSON surface as errors
 */

import { applyPatchToGuide } from './apply-ai-fix-patch';
import type { AiFixPatch } from './ai-fix-patch.schema';

function makeGuide(blocks: unknown[]): string {
  return JSON.stringify({
    schemaVersion: '1.1.0',
    id: 'test-guide',
    title: 'Test guide',
    blocks,
  });
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
      const guideJson = makeGuide([validStep]);
      const patch: AiFixPatch = {
        type: 'selector-patch',
        targetStepId: 'step-1',
        newReftarget: '[data-testid="new-selector"]',
      };
      const result = applyPatchToGuide(guideJson, patch);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const parsed = JSON.parse(result.newGuideJson);
        expect(parsed.blocks[0].reftarget).toBe('[data-testid="new-selector"]');
      }
    });

    it('reaches a step nested in a section block', () => {
      const nested = {
        type: 'section',
        title: 'Outer',
        blocks: [validStep],
      };
      const guideJson = makeGuide([nested]);
      const patch: AiFixPatch = {
        type: 'selector-patch',
        targetStepId: 'step-1',
        newReftarget: '[data-testid="found-in-section"]',
      };
      const result = applyPatchToGuide(guideJson, patch);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const parsed = JSON.parse(result.newGuideJson);
        expect(parsed.blocks[0].blocks[0].reftarget).toBe('[data-testid="found-in-section"]');
      }
    });

    it('fails when no block matches the target id', () => {
      const guideJson = makeGuide([validStep]);
      const patch: AiFixPatch = {
        type: 'selector-patch',
        targetStepId: 'step-missing',
        newReftarget: '[data-testid="x"]',
      };
      const result = applyPatchToGuide(guideJson, patch);
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
      const guideJson = makeGuide([conditional]);
      const result = applyPatchToGuide(guideJson, {
        type: 'selector-patch',
        targetStepId: 'step-1',
        newReftarget: '[data-testid="found-in-whenTrue"]',
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        const parsed = JSON.parse(result.newGuideJson);
        expect(parsed.blocks[0].whenTrue[0].reftarget).toBe('[data-testid="found-in-whenTrue"]');
      }
    });

    it('reaches a step nested in a conditional whenFalse branch', () => {
      const conditional = {
        type: 'conditional',
        conditions: ['has-datasource:prometheus'],
        whenTrue: [],
        whenFalse: [validStep],
      };
      const guideJson = makeGuide([conditional]);
      const result = applyPatchToGuide(guideJson, {
        type: 'selector-patch',
        targetStepId: 'step-1',
        newReftarget: '[data-testid="found-in-whenFalse"]',
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        const parsed = JSON.parse(result.newGuideJson);
        expect(parsed.blocks[0].whenFalse[0].reftarget).toBe('[data-testid="found-in-whenFalse"]');
      }
    });

    it('does not crash when a sibling conditional has no matching step', () => {
      const conditional = {
        type: 'conditional',
        conditions: ['has-datasource:prometheus'],
        whenTrue: [{ ...validStep, id: 'unrelated-a' }],
        whenFalse: [{ ...validStep, id: 'unrelated-b' }],
      };
      const guideJson = makeGuide([conditional, validStep]);
      const result = applyPatchToGuide(guideJson, {
        type: 'selector-patch',
        targetStepId: 'step-1',
        newReftarget: '[data-testid="found-after-conditional"]',
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        const parsed = JSON.parse(result.newGuideJson);
        expect(parsed.blocks[1].reftarget).toBe('[data-testid="found-after-conditional"]');
      }
    });
  });

  describe('prepend-step', () => {
    it('inserts the new step immediately before the target', () => {
      const guideJson = makeGuide([validStep]);
      const patch: AiFixPatch = {
        type: 'prepend-step',
        beforeStepId: 'step-1',
        newStep: {
          type: 'interactive',
          action: 'button',
          reftarget: '[data-testid="setup-step"]',
          content: 'Open the menu first',
        } as never,
      };
      const result = applyPatchToGuide(guideJson, patch);
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
      const nested = {
        type: 'section',
        title: 'Outer',
        blocks: [other, validStep],
      };
      const guideJson = makeGuide([nested]);
      const patch: AiFixPatch = {
        type: 'prepend-step',
        beforeStepId: 'step-1',
        newStep: {
          type: 'interactive',
          action: 'button',
          reftarget: '[data-testid="setup"]',
          content: 'Setup',
        } as never,
      };
      const result = applyPatchToGuide(guideJson, patch);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const parsed = JSON.parse(result.newGuideJson);
        const sectionBlocks = parsed.blocks[0].blocks;
        expect(sectionBlocks).toHaveLength(3);
        expect(sectionBlocks[0].id).toBe('step-other');
        expect(sectionBlocks[1].reftarget).toBe('[data-testid="setup"]');
        expect(sectionBlocks[2].id).toBe('step-1');
      }
    });

    it('inserts before multistep and guided containers by id', () => {
      const containers = [
        {
          type: 'multistep',
          id: 'multi-1',
          content: 'Do two things',
          steps: [{ action: 'button', reftarget: '[data-testid="first"]' }],
        },
        {
          type: 'guided',
          id: 'guided-1',
          content: 'Guided sequence',
          steps: [{ action: 'button', reftarget: '[data-testid="guided"]' }],
        },
      ];

      for (const container of containers) {
        const guideJson = makeGuide([container]);
        const patch: AiFixPatch = {
          type: 'prepend-step',
          beforeStepId: container.id,
          newStep: {
            type: 'interactive',
            action: 'button',
            reftarget: '[data-testid="setup"]',
            content: 'Setup',
          } as never,
        };

        const result = applyPatchToGuide(guideJson, patch);

        expect(result.ok).toBe(true);
        if (result.ok) {
          const parsed = JSON.parse(result.newGuideJson);
          expect(parsed.blocks[0].reftarget).toBe('[data-testid="setup"]');
          expect(parsed.blocks[1].id).toBe(container.id);
        }
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
      const guideJson = makeGuide([multistepWithTwoSteps]);
      const result = applyPatchToGuide(guideJson, {
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
      const section = {
        type: 'section',
        title: 'Outer',
        blocks: [multistepWithTwoSteps],
      };
      const result = applyPatchToGuide(makeGuide([section]), {
        type: 'substep-selector-patch',
        containerId: 'multi-1',
        subStepIndex: 0,
        newReftarget: '[data-testid="first-fixed"]',
      });
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
        const parsed = JSON.parse(result.newGuideJson);
        expect(parsed.blocks[0].whenTrue[0].steps[1].reftarget).toBe('[data-testid="patched-via-conditional"]');
      }
    });
  });

  describe('error paths', () => {
    it('rejects unparseable JSON', () => {
      const result = applyPatchToGuide('not-json', {
        type: 'selector-patch',
        targetStepId: 'x',
        newReftarget: '.btn',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/Failed to parse/);
      }
    });

    it('rejects a guide that fails schema validation before the patch', () => {
      const malformed = JSON.stringify({ id: 'g', title: 't', blocks: 'not-an-array' });
      const result = applyPatchToGuide(malformed, {
        type: 'selector-patch',
        targetStepId: 'x',
        newReftarget: '.btn',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/schema validation/);
      }
    });
  });
});
