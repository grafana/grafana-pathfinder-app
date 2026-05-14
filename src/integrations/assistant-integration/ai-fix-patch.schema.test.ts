/**
 * AiFixPatchSchema tests
 *
 * Cover the boundary check that runs on every assistant response: shape,
 * disallowed selector content, and the prepend-step → JsonInteractiveBlock
 * passthrough.
 */

import { AiFixPatchSchema } from './ai-fix-patch.schema';

describe('AiFixPatchSchema', () => {
  describe('selector-patch', () => {
    const base = {
      type: 'selector-patch' as const,
      targetStepId: 'step-42',
      newReftarget: '[data-testid="datasource-card-prometheus"]',
    };

    it('accepts a well-formed selector patch', () => {
      expect(AiFixPatchSchema.safeParse(base).success).toBe(true);
    });

    it('accepts an optional rationale', () => {
      expect(AiFixPatchSchema.safeParse({ ...base, rationale: 'The button moved into the menu.' }).success).toBe(true);
    });

    it('rejects a missing targetStepId', () => {
      expect(AiFixPatchSchema.safeParse({ ...base, targetStepId: '' }).success).toBe(false);
    });

    it('rejects an HTML-shaped selector', () => {
      const bad = { ...base, newReftarget: '<script>alert(1)</script>' };
      expect(AiFixPatchSchema.safeParse(bad).success).toBe(false);
    });

    it('rejects a javascript: URL selector', () => {
      const bad = { ...base, newReftarget: 'javascript:alert(1)' };
      expect(AiFixPatchSchema.safeParse(bad).success).toBe(false);
    });

    it('rejects a template-literal interpolation', () => {
      const bad = { ...base, newReftarget: '${process.env.SECRET}' };
      expect(AiFixPatchSchema.safeParse(bad).success).toBe(false);
    });

    it('rejects a selector longer than 512 chars', () => {
      const bad = { ...base, newReftarget: '.x'.repeat(300) };
      expect(AiFixPatchSchema.safeParse(bad).success).toBe(false);
    });

    it('rejects an over-long rationale (analytics payload bound)', () => {
      const bad = { ...base, rationale: 'a'.repeat(501) };
      expect(AiFixPatchSchema.safeParse(bad).success).toBe(false);
    });
  });

  describe('prepend-step', () => {
    const validStep = {
      type: 'interactive' as const,
      action: 'button' as const,
      reftarget: 'button[data-testid="open-datasources"]',
      content: 'Click **Data sources** to open the management page.',
    };

    const base = {
      type: 'prepend-step' as const,
      beforeStepId: 'step-42',
      newStep: validStep,
    };

    it('accepts a well-formed prepend-step', () => {
      expect(AiFixPatchSchema.safeParse(base).success).toBe(true);
    });

    it('rejects a newStep whose reftarget fails the safe-selector check', () => {
      const bad = {
        ...base,
        newStep: { ...validStep, reftarget: '<img src=x onerror=alert(1)>' },
      };
      expect(AiFixPatchSchema.safeParse(bad).success).toBe(false);
    });

    it('rejects a newStep that fails JsonInteractiveBlockSchema (e.g., non-noop with no reftarget)', () => {
      const { reftarget, ...rest } = validStep;
      const bad = { ...base, newStep: rest };
      expect(AiFixPatchSchema.safeParse(bad).success).toBe(false);
    });

    it('accepts a noop newStep (informational step) without reftarget', () => {
      const noopStep = {
        type: 'interactive' as const,
        action: 'noop' as const,
        content: "Take a look around — we'll wait.",
      };
      expect(AiFixPatchSchema.safeParse({ ...base, newStep: noopStep }).success).toBe(true);
    });
  });

  describe('discriminator', () => {
    it('rejects a payload with an unknown type', () => {
      expect(AiFixPatchSchema.safeParse({ type: 'replace-everything', targetStepId: 'x' }).success).toBe(false);
    });

    it('rejects a payload missing the type discriminator', () => {
      expect(AiFixPatchSchema.safeParse({ targetStepId: 'x', newReftarget: '.btn' }).success).toBe(false);
    });
  });
});
