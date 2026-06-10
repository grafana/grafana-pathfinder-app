import { renderHook, act } from '@testing-library/react';

import { buildUserPrompt, parseAssistantPatch, useAiFixGeneration } from './useAiFixGeneration.hook';

const mockRawGenerate = jest.fn();

jest.mock('./useAssistantGeneration.hook', () => {
  const actual = jest.requireActual('./useAssistantGeneration.hook');
  return {
    ...actual,
    useAssistantGeneration: jest.fn(() => ({
      isAssistantAvailable: true,
      generate: mockRawGenerate,
    })),
  };
});

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

describe('useAiFixGeneration', () => {
  const input = {
    guideJson: '{}',
    failingStepId: 'step-1',
    failingReftarget: '.old',
    failingAction: 'button',
    domHint: 'none',
  };

  beforeEach(() => {
    mockRawGenerate.mockReset();
  });

  it('stores the parsed patch when onComplete delivers a valid patch', async () => {
    mockRawGenerate.mockImplementation(({ onComplete }) => {
      onComplete?.(
        JSON.stringify({ type: 'selector-patch', targetStepId: 'step-1', newReftarget: '[data-testid="x"]' })
      );
    });

    const { result } = renderHook(() => useAiFixGeneration('content-key'));

    await act(async () => {
      await result.current.generate(input);
    });

    expect(result.current.patch).toEqual({
      type: 'selector-patch',
      targetStepId: 'step-1',
      newReftarget: '[data-testid="x"]',
    });
    expect(result.current.error).toBeNull();
    expect(result.current.isGenerating).toBe(false);
  });

  it('surfaces a parse error when onComplete delivers an unparseable response', async () => {
    mockRawGenerate.mockImplementation(({ onComplete }) => {
      onComplete?.('not json at all');
    });

    const { result } = renderHook(() => useAiFixGeneration('content-key'));

    await act(async () => {
      await result.current.generate(input);
    });

    expect(result.current.patch).toBeNull();
    expect(result.current.error?.message).toMatch(/not valid JSON/);
    expect(result.current.isGenerating).toBe(false);
  });

  it('surfaces the error and clears the loading flag when onError fires', async () => {
    mockRawGenerate.mockImplementation(({ onError }) => {
      onError?.(new Error('stream failed'));
    });

    const { result } = renderHook(() => useAiFixGeneration('content-key'));

    await act(async () => {
      await result.current.generate(input);
    });

    expect(result.current.error?.message).toBe('stream failed');
    expect(result.current.isGenerating).toBe(false);
  });

  it('clears the loading flag when rawGenerate rejects before any callback fires', async () => {
    mockRawGenerate.mockRejectedValue(new Error('assistant unavailable'));

    const { result } = renderHook(() => useAiFixGeneration('content-key'));

    await act(async () => {
      await result.current.generate(input);
    });

    expect(result.current.isGenerating).toBe(false);
    expect(result.current.error?.message).toBe('assistant unavailable');
    expect(result.current.patch).toBeNull();
  });

  it('reset clears a previously stored patch', async () => {
    mockRawGenerate.mockImplementation(({ onComplete }) => {
      onComplete?.(
        JSON.stringify({ type: 'selector-patch', targetStepId: 'step-1', newReftarget: '[data-testid="x"]' })
      );
    });

    const { result } = renderHook(() => useAiFixGeneration('content-key'));

    await act(async () => {
      await result.current.generate(input);
    });
    expect(result.current.patch).not.toBeNull();

    act(() => {
      result.current.reset();
    });

    expect(result.current.patch).toBeNull();
    expect(result.current.error).toBeNull();
  });
});
