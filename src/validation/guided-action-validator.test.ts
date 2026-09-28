/**
 * Guided-block verb gate.
 *
 * `JsonGuidedBlockSchema` shares `JsonStepSchema` with multistep, so Zod admits
 * every authorable verb into a guided block. These tests pin the post-Zod gate
 * that rejects the ones `GuidedHandler` cannot drive, and the runtime-tolerant
 * escape hatch that keeps already-published guides rendering.
 */
import { validateGuide } from './validate-guide';
import { GUIDED_ACTION_TYPES } from '../types/interactive-actions.types';

const guideWithGuidedSteps = (steps: unknown[]) => ({
  id: 'test',
  title: 'Test',
  blocks: [{ type: 'guided', content: 'Follow along', steps }],
});

const unsupportedErrors = (result: ReturnType<typeof validateGuide>) =>
  result.errors.filter((e) => e.code === 'unsupported_guided_action');

describe('guided action gate', () => {
  describe('authoring gates reject what the handler cannot drive', () => {
    it.each(['navigate', 'popout'])('rejects a guided "%s" step', (action) => {
      const step = action === 'popout' ? { action, targetvalue: 'floating' } : { action, reftarget: '/explore' };
      const result = validateGuide(guideWithGuidedSteps([step]));

      expect(result.isValid).toBe(false);
      expect(unsupportedErrors(result)).toHaveLength(1);
      expect(unsupportedErrors(result)[0]!.message).toContain(action);
    });

    it.each([...GUIDED_ACTION_TYPES])('accepts a guided "%s" step', (action) => {
      const step = action === 'noop' ? { action } : { action, reftarget: '#target' };
      const result = validateGuide(guideWithGuidedSteps([step]));

      expect(unsupportedErrors(result)).toHaveLength(0);
      expect(result.isValid).toBe(true);
    });

    it('names the offending step by path', () => {
      const result = validateGuide(
        guideWithGuidedSteps([
          { action: 'button', reftarget: '#a' },
          { action: 'navigate', reftarget: '/explore' },
        ])
      );

      expect(unsupportedErrors(result)[0]!.path).toEqual(['blocks', 0, 'steps', 1, 'action']);
    });

    it('reports every offending step, not just the first', () => {
      const result = validateGuide(
        guideWithGuidedSteps([
          { action: 'navigate', reftarget: '/explore' },
          { action: 'popout', targetvalue: 'sidebar' },
        ])
      );

      expect(unsupportedErrors(result)).toHaveLength(2);
    });

    it('accepts the same verb inside a multistep block', () => {
      const result = validateGuide({
        id: 'test',
        title: 'Test',
        blocks: [
          {
            type: 'multistep',
            content: 'Navigate then click',
            steps: [
              { action: 'navigate', reftarget: '/explore' },
              { action: 'button', reftarget: '#go' },
            ],
          },
        ],
      });

      expect(result.isValid).toBe(true);
    });
  });

  describe('nesting', () => {
    it('finds a guided block inside a section', () => {
      const result = validateGuide({
        id: 'test',
        title: 'Test',
        blocks: [
          {
            type: 'section',
            title: 'S',
            blocks: [{ type: 'guided', content: 'c', steps: [{ action: 'navigate', reftarget: '/x' }] }],
          },
        ],
      });

      expect(unsupportedErrors(result)).toHaveLength(1);
      expect(unsupportedErrors(result)[0]!.path).toEqual(['blocks', 0, 'blocks', 0, 'steps', 0, 'action']);
    });

    it.each(['whenTrue', 'whenFalse'])('finds a guided block inside a conditional %s branch', (branch) => {
      const result = validateGuide({
        id: 'test',
        title: 'Test',
        blocks: [
          {
            type: 'conditional',
            conditions: ['is-admin'],
            // Both branches are required by the schema; only one carries the block.
            whenTrue: [],
            whenFalse: [],
            [branch]: [{ type: 'guided', content: 'c', steps: [{ action: 'popout', targetvalue: 'sidebar' }] }],
          },
        ],
      });

      expect(unsupportedErrors(result)).toHaveLength(1);
    });
  });

  describe('runtime loaders stay tolerant', () => {
    it('downgrades the error to an advisory so a published guide still renders', () => {
      const guide = guideWithGuidedSteps([{ action: 'navigate', reftarget: '/explore' }]);

      const authoring = validateGuide(guide);
      const runtime = validateGuide(guide, { allowUnsupportedGuidedAction: true });

      expect(authoring.isValid).toBe(false);
      expect(runtime.isValid).toBe(true);
      expect(runtime.guide).not.toBeNull();
      expect(runtime.warnings.some((w) => w.message.includes('navigate'))).toBe(true);
    });

    it('keeps the tolerated guide out of the strict-mode promotion', () => {
      // Advisories are returned separately from `warnings`, so `strict` must not
      // turn a tolerated published guide into a failure.
      const result = validateGuide(guideWithGuidedSteps([{ action: 'navigate', reftarget: '/explore' }]), {
        allowUnsupportedGuidedAction: true,
        strict: true,
      });

      expect(result.isValid).toBe(true);
    });
  });
});
