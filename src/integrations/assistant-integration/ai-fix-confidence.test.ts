jest.mock('../../lib/dom', () => ({
  primaryRefTarget: (rt: string | string[]) => (Array.isArray(rt) ? (rt[0] ?? '') : rt),
  resolveSelector: (selector: string) => selector,
  querySelectorAllEnhanced: (selector: string) => {
    try {
      return {
        elements: Array.from(document.querySelectorAll(selector)),
        usedFallback: false,
        originalSelector: selector,
      };
    } catch {
      return { elements: [], usedFallback: true, originalSelector: selector, effectiveSelector: 'ERROR' };
    }
  },
}));

import { evaluatePatchConfidence } from './ai-fix-confidence';
import type { AiFixPatch } from './ai-fix-patch.schema';

describe('evaluatePatchConfidence', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('accepts a selector-patch whose selector resolves to a live element', () => {
    document.body.innerHTML = '<button data-testid="run-query">Run</button>';
    const patch: AiFixPatch = { type: 'selector-patch', targetStepId: 's1', newReftarget: '[data-testid="run-query"]' };
    expect(evaluatePatchConfidence(patch)).toEqual({ ok: true });
  });

  it('rejects a selector-patch whose selector matches nothing on the page', () => {
    document.body.innerHTML = '<button data-testid="other">x</button>';
    const patch: AiFixPatch = { type: 'selector-patch', targetStepId: 's1', newReftarget: '[data-testid="missing"]' };
    const result = evaluatePatchConfidence(patch);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/does not match any element/);
    }
  });

  it('accepts a prepend-step with no reftarget (purely instructional)', () => {
    const patch = {
      type: 'prepend-step',
      beforeStepId: 's1',
      newStep: { type: 'interactive', action: 'noop', content: 'Read this first.' },
    } as AiFixPatch;
    expect(evaluatePatchConfidence(patch)).toEqual({ ok: true });
  });

  it('accepts a prepend-step whose reftarget resolves to a live element', () => {
    document.body.innerHTML = '<button data-testid="all-viz">All visualizations</button>';
    const patch = {
      type: 'prepend-step',
      beforeStepId: 's1',
      newStep: { type: 'interactive', action: 'button', reftarget: '[data-testid="all-viz"]', content: 'Open.' },
    } as AiFixPatch;
    expect(evaluatePatchConfidence(patch)).toEqual({ ok: true });
  });

  it('rejects an invalid CSS selector (it resolves to no live element)', () => {
    const patch: AiFixPatch = { type: 'selector-patch', targetStepId: 's1', newReftarget: '[[[not-valid' };
    const result = evaluatePatchConfidence(patch);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/does not match any element/);
    }
  });

  it('rejects a patch with no selector to verify', () => {
    const patch = {
      type: 'substep-selector-patch',
      containerId: 'c1',
      subStepIndex: 0,
      newReftarget: '',
    } as AiFixPatch;
    const result = evaluatePatchConfidence(patch);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/no selector to verify/);
    }
  });
});
