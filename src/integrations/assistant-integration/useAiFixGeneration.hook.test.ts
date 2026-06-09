import { buildUserPrompt, parseAssistantPatch } from './useAiFixGeneration.hook';

describe('parseAssistantPatch', () => {
  it('accepts a bare selector-patch JSON object', () => {
    const text = JSON.stringify({
      type: 'selector-patch',
      targetStepId: 'step-1',
      newReftarget: '[data-testid="ds-prom"]',
    });
    const result = parseAssistantPatch(text);
    expect(result.ok).toBe(true);
  });

  it('strips ```json fences before parsing', () => {
    const text = '```json\n{"type":"selector-patch","targetStepId":"x","newReftarget":".btn"}\n```';
    const result = parseAssistantPatch(text);
    expect(result.ok).toBe(true);
  });

  it('rejects non-JSON text', () => {
    const result = parseAssistantPatch('Sure! Here is the patch: change the selector to .btn');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toMatch(/not valid JSON/);
    }
  });

  it('rejects JSON that fails the patch schema (unsafe selector)', () => {
    const text = JSON.stringify({
      type: 'selector-patch',
      targetStepId: 'x',
      newReftarget: '<script>alert(1)</script>',
    });
    const result = parseAssistantPatch(text);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toMatch(/schema check/);
    }
  });

  it('accepts a prepend-step patch with a valid interactive block', () => {
    const text = JSON.stringify({
      type: 'prepend-step',
      beforeStepId: 'step-1',
      newStep: {
        type: 'interactive',
        action: 'button',
        reftarget: '[data-testid="open-menu"]',
        content: 'Open the **Connections** menu.',
      },
    });
    const result = parseAssistantPatch(text);
    expect(result.ok).toBe(true);
  });

  it('detects the "<unchanged>" sentinel in newReftarget before schema validation', () => {
    const text = JSON.stringify({
      type: 'selector-patch',
      targetStepId: 'step-1',
      newReftarget: '<unchanged>',
      rationale: 'no confident fix',
    });
    const result = parseAssistantPatch(text);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe("AI couldn't find a confident fix for this step");
      expect(result.error.message).not.toMatch(/schema check/);
      expect(result.error.message).not.toMatch(/disallowed substring/);
    }
  });
});

describe('buildUserPrompt', () => {
  const base = {
    guideJson: '{"blocks":[]}',
    failingStepId: 'step-7',
    failingReftarget: '[data-testid="missing"]',
    failingAction: 'button',
    domHint: 'Visible: Connections, Data sources, Alerting',
  };

  it('includes the failing step metadata and DOM hint', () => {
    const prompt = buildUserPrompt(base);
    expect(prompt).toContain('step-7');
    expect(prompt).toContain('[data-testid="missing"]');
    expect(prompt).toContain('button');
    expect(prompt).toContain('Connections, Data sources, Alerting');
    expect(prompt).toContain('{"blocks":[]}');
  });

  it('falls back to a placeholder when no DOM hint is collected', () => {
    const prompt = buildUserPrompt({ ...base, domHint: '' });
    expect(prompt).toContain('(none collected)');
  });
});
