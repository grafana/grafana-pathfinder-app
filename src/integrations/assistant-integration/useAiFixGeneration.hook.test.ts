/**
 * Tests for the pure helpers in useAiFixGeneration:
 * - `parseAssistantPatch` — boundary between assistant text and validated patch.
 * - `buildUserPrompt` — prompt envelope shape (smoke test, no LLM behavior).
 *
 * The React hook itself is exercised end-to-end in docs-panel.ai-fix.test.tsx
 * via the dev-mode mock assistant. Keeping these as pure-function tests so
 * the suite is fast and deterministic.
 */

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

  it('strips bare ``` fences too', () => {
    const text = '```\n{"type":"selector-patch","targetStepId":"x","newReftarget":".btn"}\n```';
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

  it('omits the screenshot block when no data URL is supplied', () => {
    const prompt = buildUserPrompt(base);
    expect(prompt).not.toContain('![viewport]');
  });

  it('embeds the screenshot as a markdown image when supplied', () => {
    const prompt = buildUserPrompt({ ...base, screenshotDataUrl: 'data:image/jpeg;base64,/9j/abc' });
    expect(prompt).toContain('![viewport](data:image/jpeg;base64,/9j/abc)');
  });

  it('falls back to a placeholder when no DOM hint is collected', () => {
    const prompt = buildUserPrompt({ ...base, domHint: '' });
    expect(prompt).toContain('(none collected)');
  });
});
