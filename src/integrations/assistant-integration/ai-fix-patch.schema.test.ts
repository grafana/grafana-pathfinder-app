import { AiFixPatchSchema } from './ai-fix-patch.schema';

describe('AiFixPatchSchema', () => {
  describe('selector-patch', () => {
    it('accepts a well-formed selector patch', () => {
      const result = AiFixPatchSchema.safeParse({
        type: 'selector-patch',
        targetStepId: 'step-1',
        newReftarget: '[data-testid="save-button"]',
      });
      expect(result.success).toBe(true);
    });

    it('rejects an empty targetStepId', () => {
      const result = AiFixPatchSchema.safeParse({
        type: 'selector-patch',
        targetStepId: '',
        newReftarget: '.save',
      });
      expect(result.success).toBe(false);
    });

    it('rejects an HTML-shaped selector', () => {
      const result = AiFixPatchSchema.safeParse({
        type: 'selector-patch',
        targetStepId: 'step-1',
        newReftarget: '<script>alert(1)</script>',
      });
      expect(result.success).toBe(false);
    });

    it('rejects a javascript: URL selector', () => {
      const result = AiFixPatchSchema.safeParse({
        type: 'selector-patch',
        targetStepId: 'step-1',
        newReftarget: 'javascript:alert(1)',
      });
      expect(result.success).toBe(false);
    });

    it('rejects a template-literal interpolation', () => {
      const result = AiFixPatchSchema.safeParse({
        type: 'selector-patch',
        targetStepId: 'step-1',
        newReftarget: '${process.env.SECRET}',
      });
      expect(result.success).toBe(false);
    });

    it('rejects a selector longer than 512 chars', () => {
      const result = AiFixPatchSchema.safeParse({
        type: 'selector-patch',
        targetStepId: 'step-1',
        newReftarget: '.x'.repeat(300),
      });
      expect(result.success).toBe(false);
    });
  });

  describe('substep-selector-patch', () => {
    it('accepts a well-formed substep selector patch', () => {
      const result = AiFixPatchSchema.safeParse({
        type: 'substep-selector-patch',
        containerId: 'multi-1',
        subStepIndex: 0,
        newReftarget: '[data-testid="run-query"]',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('prepend-step', () => {
    it('accepts a well-formed prepend-step', () => {
      const result = AiFixPatchSchema.safeParse({
        type: 'prepend-step',
        beforeStepId: 'step-1',
        newStep: {
          type: 'interactive',
          action: 'highlight',
          reftarget: '[data-testid="nav-dashboards"]',
          content: 'Open dashboards',
        },
      });
      expect(result.success).toBe(true);
    });

    it('rejects a newStep whose reftarget fails the safe-selector check', () => {
      const result = AiFixPatchSchema.safeParse({
        type: 'prepend-step',
        beforeStepId: 'step-1',
        newStep: {
          type: 'interactive',
          action: 'highlight',
          reftarget: '<img src=x onerror=alert(1)>',
          content: 'bad',
        },
      });
      expect(result.success).toBe(false);
    });

    it('rejects a newStep that fails JsonInteractiveBlockSchema (non-noop with no reftarget)', () => {
      const result = AiFixPatchSchema.safeParse({
        type: 'prepend-step',
        beforeStepId: 'step-1',
        newStep: {
          type: 'interactive',
          action: 'highlight',
          content: 'missing reftarget',
        },
      });
      expect(result.success).toBe(false);
    });

    it('accepts a noop newStep without reftarget', () => {
      const result = AiFixPatchSchema.safeParse({
        type: 'prepend-step',
        beforeStepId: 'step-1',
        newStep: {
          type: 'interactive',
          action: 'noop',
          content: 'informational',
        },
      });
      expect(result.success).toBe(true);
    });
  });

  describe('discriminator', () => {
    it('rejects a payload with an unknown type', () => {
      const result = AiFixPatchSchema.safeParse({
        type: 'replace-everything',
        targetStepId: 'step-1',
      });
      expect(result.success).toBe(false);
    });
  });
});
