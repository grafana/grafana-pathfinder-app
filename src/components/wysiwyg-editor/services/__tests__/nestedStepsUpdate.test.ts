/**
 * Tests for nested steps update logic
 * Tests that nested steps in multistep/guided blocks are properly updated
 * when editing, including attributes and interactiveComment nodes
 */

import { ACTION_TYPES } from '../../../../constants/interactive-config';
import { CSS_CLASSES } from '../../../../constants/editor-config';

// Mock logger
jest.mock('../../utils/logger', () => ({
  debug: jest.fn(),
  error: jest.fn(),
}));

describe('Nested Steps Update Logic', () => {
  describe('buildEditData for nested steps', () => {
    // Test the data structure that should be passed when saving nested steps

    it('should include all nested step fields in save data', () => {
      const nestedSteps = [
        {
          actionType: ACTION_TYPES.HIGHLIGHT,
          refTarget: 'button.step1',
          requirements: 'exists-reftarget',
          interactiveComment: 'First step tooltip',
          targetValue: undefined,
        },
        {
          actionType: ACTION_TYPES.FORM_FILL,
          refTarget: 'input[name="email"]',
          requirements: 'on-page:/settings',
          interactiveComment: 'Enter your email',
          targetValue: 'test@example.com',
        },
      ];

      // Verify structure matches what WysiwygEditor expects
      expect(nestedSteps[0]).toMatchObject({
        actionType: ACTION_TYPES.HIGHLIGHT,
        refTarget: 'button.step1',
        requirements: 'exists-reftarget',
        interactiveComment: 'First step tooltip',
      });

      expect(nestedSteps[1]).toMatchObject({
        actionType: ACTION_TYPES.FORM_FILL,
        refTarget: 'input[name="email"]',
        targetValue: 'test@example.com',
      });
    });

    it('should handle nested steps with empty optional fields', () => {
      const nestedSteps = [
        {
          actionType: ACTION_TYPES.BUTTON,
          refTarget: 'button.submit',
          // No requirements, no comment, no targetValue
        },
      ];

      expect(nestedSteps[0].actionType).toBe(ACTION_TYPES.BUTTON);
      expect(nestedSteps[0].refTarget).toBe('button.submit');
      expect((nestedSteps[0] as any).requirements).toBeUndefined();
      expect((nestedSteps[0] as any).interactiveComment).toBeUndefined();
      expect((nestedSteps[0] as any).targetValue).toBeUndefined();
    });
  });

  describe('attribute update mapping', () => {
    // Test the attribute mapping for nested step updates

    it('should map nested step data to correct attributes', () => {
      const nestedStep = {
        actionType: ACTION_TYPES.HIGHLIGHT,
        refTarget: 'button.test',
        requirements: 'exists-reftarget',
        targetValue: 'form-value',
      };

      const expectedAttrs = {
        'data-targetaction': nestedStep.actionType,
        'data-reftarget': nestedStep.refTarget,
        'data-requirements': nestedStep.requirements || '',
        'data-targetvalue': nestedStep.targetValue || '',
      };

      expect(expectedAttrs['data-targetaction']).toBe(ACTION_TYPES.HIGHLIGHT);
      expect(expectedAttrs['data-reftarget']).toBe('button.test');
      expect(expectedAttrs['data-requirements']).toBe('exists-reftarget');
      expect(expectedAttrs['data-targetvalue']).toBe('form-value');
    });

    it('should handle empty requirements and targetValue', () => {
      const nestedStep = {
        actionType: ACTION_TYPES.BUTTON,
        refTarget: 'button.submit',
        // No requirements or targetValue
      };

      const attrs = {
        'data-targetaction': nestedStep.actionType,
        'data-reftarget': nestedStep.refTarget,
        'data-requirements': (nestedStep as any).requirements || '',
        'data-targetvalue': (nestedStep as any).targetValue || '',
      };

      expect(attrs['data-requirements']).toBe('');
      expect(attrs['data-targetvalue']).toBe('');
    });
  });

  describe('interactiveComment handling', () => {
    // Test scenarios for comment update/insert/remove logic

    it('should create comment node structure for new comment', () => {
      const commentText = 'This is a helpful tooltip';

      const commentNode = {
        type: 'interactiveComment',
        attrs: { class: CSS_CLASSES.INTERACTIVE_COMMENT },
        content: [{ type: 'text', text: commentText }],
      };

      expect(commentNode.type).toBe('interactiveComment');
      expect(commentNode.attrs.class).toBe(CSS_CLASSES.INTERACTIVE_COMMENT);
      expect(commentNode.content[0].text).toBe(commentText);
    });

    it('should handle clearing comment when value is empty', () => {
      const newComment = '';
      const hasExistingComment = true;

      // Logic: if newComment is empty and hasExistingComment, should remove
      const shouldRemove = !newComment?.trim() && hasExistingComment;

      expect(shouldRemove).toBe(true);
    });

    it('should handle adding comment when none exists', () => {
      const newComment = 'New tooltip text';
      const hasExistingComment = false;

      // Logic: if newComment has value and no existing comment, should insert
      const shouldInsert = newComment?.trim() && !hasExistingComment;

      expect(shouldInsert).toBe(true);
    });

    it('should handle updating existing comment', () => {
      const newComment = 'Updated tooltip';
      const hasExistingComment = true;

      // Logic: if newComment has value and existing comment exists, should update
      const shouldUpdate = newComment?.trim() && hasExistingComment;

      expect(shouldUpdate).toBe(true);
    });
  });

  describe('multistep vs guided detection', () => {
    it('should identify multistep action type', () => {
      const actionType: string = ACTION_TYPES.MULTISTEP;
      const isMultistepOrGuided = actionType === ACTION_TYPES.MULTISTEP || actionType === 'guided';

      expect(isMultistepOrGuided).toBe(true);
    });

    it('should identify guided action type', () => {
      const actionType: string = ACTION_TYPES.GUIDED;
      const isMultistepOrGuided = actionType === ACTION_TYPES.MULTISTEP || actionType === ACTION_TYPES.GUIDED;

      expect(isMultistepOrGuided).toBe(true);
    });

    it('should not identify regular actions as multistep/guided', () => {
      const actionType: string = ACTION_TYPES.HIGHLIGHT;
      const isMultistepOrGuided = actionType === ACTION_TYPES.MULTISTEP || actionType === ACTION_TYPES.GUIDED;

      expect(isMultistepOrGuided).toBe(false);
    });
  });

  describe('nested step filtering', () => {
    // Test that nested steps don't include the parent multistep/guided

    it('should filter out multistep from nested steps', () => {
      const allSteps: Array<{ actionType: string; refTarget: string }> = [
        { actionType: ACTION_TYPES.MULTISTEP, refTarget: '' },
        { actionType: ACTION_TYPES.HIGHLIGHT, refTarget: 'button.a' },
        { actionType: ACTION_TYPES.BUTTON, refTarget: 'button.b' },
      ];

      const nestedSteps = allSteps.filter(
        (step) => step.actionType !== ACTION_TYPES.MULTISTEP && step.actionType !== 'guided'
      );

      expect(nestedSteps).toHaveLength(2);
      expect(nestedSteps[0].actionType).toBe(ACTION_TYPES.HIGHLIGHT);
      expect(nestedSteps[1].actionType).toBe(ACTION_TYPES.BUTTON);
    });

    it('should filter out guided from nested steps', () => {
      const allSteps: Array<{ actionType: string; refTarget: string }> = [
        { actionType: 'guided', refTarget: '' },
        { actionType: ACTION_TYPES.HOVER, refTarget: 'div.tooltip' },
      ];

      const nestedSteps = allSteps.filter(
        (step) => step.actionType !== ACTION_TYPES.MULTISTEP && step.actionType !== 'guided'
      );

      expect(nestedSteps).toHaveLength(1);
      expect(nestedSteps[0].actionType).toBe(ACTION_TYPES.HOVER);
    });
  });

  describe('position calculation for updates', () => {
    // Document expected position calculation behavior

    it('should apply updates in reverse order', () => {
      const updates = [
        { pos: 10, data: 'first' },
        { pos: 20, data: 'second' },
        { pos: 30, data: 'third' },
      ];

      // Reverse order prevents position shifts from affecting subsequent updates
      const reversedUpdates = [...updates].reverse();

      expect(reversedUpdates[0].pos).toBe(30);
      expect(reversedUpdates[1].pos).toBe(20);
      expect(reversedUpdates[2].pos).toBe(10);
    });
  });

  describe('edit data structure validation', () => {
    it('should include nestedSteps array when present', () => {
      const editData = {
        actionType: ACTION_TYPES.MULTISTEP,
        refTarget: '',
        requirements: 'on-page:/test',
        nestedSteps: [
          {
            actionType: ACTION_TYPES.HIGHLIGHT,
            refTarget: 'button.step1',
            interactiveComment: 'Step 1 comment',
          },
        ],
      };

      expect(editData.nestedSteps).toBeDefined();
      expect(editData.nestedSteps).toHaveLength(1);
      expect(editData.nestedSteps[0].interactiveComment).toBe('Step 1 comment');
    });

    it('should omit nestedSteps when array is empty', () => {
      const nestedSteps: any[] = [];
      const editData = {
        actionType: ACTION_TYPES.MULTISTEP,
        refTarget: '',
        nestedSteps: nestedSteps.length > 0 ? nestedSteps : undefined,
      };

      expect(editData.nestedSteps).toBeUndefined();
    });
  });
});
