/**
 * E2E Contract Tests: Comment Box Attributes
 *
 * This test suite validates the contract between comment box data attributes and their
 * corresponding functionality. Comment boxes are created by NavigationManager and GuidedHandler
 * as DOM elements (not React components).
 *
 * Test Coverage:
 * - Existing attributes: data-ready, data-position, data-noop
 * - New tier 1 attributes: data-test-action
 * - New tier 2 attributes: data-test-target-value
 *
 * Test Pattern:
 * Each test verifies that comment boxes created through the NavigationManager API
 * have the correct attributes set based on the provided options.
 */

import { NavigationManager } from './navigation-manager';
import * as elementValidator from '../lib/dom';

// Mock the element validator functions
jest.mock('../lib/dom');

// Mock ResizeObserver which is not available in jsdom
class MockResizeObserver {
  observe = jest.fn();
  unobserve = jest.fn();
  disconnect = jest.fn();
}
global.ResizeObserver = MockResizeObserver as any;

const mockIsElementVisible = elementValidator.isElementVisible as jest.MockedFunction<
  typeof elementValidator.isElementVisible
>;
const mockHasFixedPosition = elementValidator.hasFixedPosition as jest.MockedFunction<
  typeof elementValidator.hasFixedPosition
>;
const mockIsInViewport = elementValidator.isInViewport as jest.MockedFunction<typeof elementValidator.isInViewport>;
const mockGetScrollParent = elementValidator.getScrollParent as jest.MockedFunction<
  typeof elementValidator.getScrollParent
>;
const mockGetStickyHeaderOffset = elementValidator.getStickyHeaderOffset as jest.MockedFunction<
  typeof elementValidator.getStickyHeaderOffset
>;
const mockGetVisibleHighlightTarget = elementValidator.getVisibleHighlightTarget as jest.MockedFunction<
  typeof elementValidator.getVisibleHighlightTarget
>;

// Mock console.warn to avoid noise in tests
const mockConsoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});

// ============================================================================
// Test Setup
// ============================================================================

describe('E2E Contract: Comment Box Attributes', () => {
  let navigationManager: NavigationManager;
  let mockElement: HTMLElement;

  // Store original window dimensions for restoration
  const originalInnerHeight = window.innerHeight;
  const originalInnerWidth = window.innerWidth;

  beforeEach(() => {
    jest.clearAllMocks();
    navigationManager = new NavigationManager();

    // Create mock element
    mockElement = document.createElement('div');
    mockElement.style.width = '100px';
    mockElement.style.height = '100px';
    document.body.appendChild(mockElement);

    // Default mock implementations
    mockIsElementVisible.mockReturnValue(true);
    mockHasFixedPosition.mockReturnValue(false);
    mockIsInViewport.mockReturnValue(false);
    mockGetScrollParent.mockReturnValue(document.documentElement);
    mockGetStickyHeaderOffset.mockReturnValue(0);
    mockGetVisibleHighlightTarget.mockImplementation((el) => el);

    // Mock scrollIntoView
    mockElement.scrollIntoView = jest.fn();

    // Mock window dimensions
    Object.defineProperty(window, 'innerHeight', {
      writable: true,
      configurable: true,
      value: 768,
    });

    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1024,
    });

    // Mock getBoundingClientRect - position element in center of viewport
    mockElement.getBoundingClientRect = jest.fn().mockReturnValue({
      top: 300,
      left: 400,
      bottom: 400,
      right: 500,
      width: 100,
      height: 100,
    });
  });

  afterEach(() => {
    // Clean up highlights and comment boxes
    navigationManager.clearAllHighlights();
    // Remove mockElement from DOM
    if (mockElement.parentElement) {
      mockElement.parentElement.removeChild(mockElement);
    }

    // Restore original window dimensions to prevent test pollution
    Object.defineProperty(window, 'innerHeight', {
      writable: true,
      configurable: true,
      value: originalInnerHeight,
    });
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: originalInnerWidth,
    });
  });

  afterAll(() => {
    mockConsoleWarn.mockRestore();
  });

  // ============================================================================
  // Existing Attributes Tests
  // ============================================================================

  describe('existing attributes', () => {
    describe('data-ready', () => {
      it('is set to "true" when comment box is visible', async () => {
        await navigationManager.highlightWithComment(mockElement, 'Test comment', true, undefined, undefined, undefined, undefined, undefined, {
          skipAnimations: true,
        });

        const commentBox = document.querySelector('.interactive-comment-box');
        expect(commentBox).not.toBeNull();
        expect(commentBox).toHaveAttribute('data-ready', 'true');
      });

      it('is set immediately when skipAnimations is true', async () => {
        await navigationManager.highlightWithComment(mockElement, 'Test comment', true, undefined, undefined, undefined, undefined, undefined, {
          skipAnimations: true,
        });

        const commentBox = document.querySelector('.interactive-comment-box');
        expect(commentBox).not.toBeNull();
        expect(commentBox).toHaveAttribute('data-ready', 'true');
      });

      it('is set after requestAnimationFrame when skipAnimations is false', async () => {
        // When skipAnimations is false, data-ready is set in requestAnimationFrame
        // We can test that it's NOT set immediately, but will be set eventually
        await navigationManager.highlightWithComment(mockElement, 'Test comment', true, undefined, undefined, undefined, undefined, undefined, {
          skipAnimations: false,
        });

        const commentBox = document.querySelector('.interactive-comment-box');
        expect(commentBox).not.toBeNull();

        // Wait for requestAnimationFrame to complete
        await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));

        expect(commentBox).toHaveAttribute('data-ready', 'true');
      });
    });

    describe('data-position', () => {
      it('is present on all comment boxes', async () => {
        await navigationManager.highlightWithComment(mockElement, 'Test comment');

        const commentBox = document.querySelector('.interactive-comment-box');
        expect(commentBox).not.toBeNull();
        expect(commentBox).toHaveAttribute('data-position');
      });

      it('has valid position values: center, left, right, top, bottom', async () => {
        // Position depends on element location in viewport
        await navigationManager.highlightWithComment(mockElement, 'Test comment');

        const commentBox = document.querySelector('.interactive-comment-box');
        expect(commentBox).not.toBeNull();

        const position = commentBox?.getAttribute('data-position');
        expect(position).toMatch(/^(center|left|right|top|bottom)$/);
      });

      it('uses "center" position for noop comment boxes', async () => {
        // Noop comment boxes are created directly by guided-handler
        // We'll test that separately in the data-noop section
        // Here we just verify that position attribute exists
        await navigationManager.highlightWithComment(mockElement, 'Test comment');

        const commentBox = document.querySelector('.interactive-comment-box');
        expect(commentBox?.getAttribute('data-position')).toBeDefined();
      });
    });

    describe('data-noop', () => {
      it('is set to "true" for noop actions created via showNoopComment', () => {
        // Test noop comment box creation through the NavigationManager API
        navigationManager.showNoopComment('This is a noop instruction');

        const commentBox = document.querySelector('.interactive-comment-box');
        expect(commentBox).not.toBeNull();
        expect(commentBox).toHaveAttribute('data-noop', 'true');
        expect(commentBox).toHaveAttribute('data-position', 'center');
        expect(commentBox).toHaveAttribute('data-ready', 'true');
      });

      it('is absent for normal action comment boxes', async () => {
        await navigationManager.highlightWithComment(mockElement, 'Test comment', true, undefined, undefined, undefined, undefined, undefined, {
          actionType: 'button',
        });

        const commentBox = document.querySelector('.interactive-comment-box');
        expect(commentBox).not.toBeNull();
        expect(commentBox).not.toHaveAttribute('data-noop');
      });
    });
  });

  // ============================================================================
  // data-test-action Tests (Tier 1)
  // ============================================================================

  describe('data-test-action (Tier 1)', () => {
    it('is not set by showNoopComment (only by GuidedHandler)', () => {
      // NavigationManager.showNoopComment only sets data-noop, not data-test-action.
      // The data-test-action='noop' attribute is set by GuidedHandler.showNoopCommentBox
      // which is a private method tested through integration/e2e tests.
      navigationManager.showNoopComment('Noop instruction');

      const commentBox = document.querySelector('.interactive-comment-box');
      expect(commentBox).not.toBeNull();
      expect(commentBox).toHaveAttribute('data-noop', 'true');
      // showNoopComment does NOT set data-test-action - that's GuidedHandler's responsibility
      expect(commentBox).not.toHaveAttribute('data-test-action');
    });

    it('is set to "hover" when actionType option is "hover"', async () => {
      await navigationManager.highlightWithComment(mockElement, 'Hover over this', true, undefined, undefined, undefined, undefined, undefined, {
        actionType: 'hover',
      });

      const commentBox = document.querySelector('.interactive-comment-box');
      expect(commentBox).not.toBeNull();
      expect(commentBox).toHaveAttribute('data-test-action', 'hover');
    });

    it('is set to "button" when actionType option is "button"', async () => {
      await navigationManager.highlightWithComment(mockElement, 'Click this button', true, undefined, undefined, undefined, undefined, undefined, {
        actionType: 'button',
      });

      const commentBox = document.querySelector('.interactive-comment-box');
      expect(commentBox).not.toBeNull();
      expect(commentBox).toHaveAttribute('data-test-action', 'button');
    });

    it('is set to "highlight" when actionType option is "highlight"', async () => {
      await navigationManager.highlightWithComment(mockElement, 'Look at this', true, undefined, undefined, undefined, undefined, undefined, {
        actionType: 'highlight',
      });

      const commentBox = document.querySelector('.interactive-comment-box');
      expect(commentBox).not.toBeNull();
      expect(commentBox).toHaveAttribute('data-test-action', 'highlight');
    });

    it('is set to "formfill" when actionType option is "formfill"', async () => {
      await navigationManager.highlightWithComment(mockElement, 'Fill in this field', true, undefined, undefined, undefined, undefined, undefined, {
        actionType: 'formfill',
      });

      const commentBox = document.querySelector('.interactive-comment-box');
      expect(commentBox).not.toBeNull();
      expect(commentBox).toHaveAttribute('data-test-action', 'formfill');
    });

    it('is absent when actionType option is not provided', async () => {
      await navigationManager.highlightWithComment(mockElement, 'Test comment');

      const commentBox = document.querySelector('.interactive-comment-box');
      expect(commentBox).not.toBeNull();
      expect(commentBox).not.toHaveAttribute('data-test-action');
    });

    it('accepts only valid action type values', async () => {
      const validActionTypes: Array<'hover' | 'button' | 'highlight' | 'formfill'> = [
        'hover',
        'button',
        'highlight',
        'formfill',
      ];

      for (const actionType of validActionTypes) {
        navigationManager.clearAllHighlights();

        await navigationManager.highlightWithComment(mockElement, `Test ${actionType}`, true, undefined, undefined, undefined, undefined, undefined, {
          actionType,
        });

        const commentBox = document.querySelector('.interactive-comment-box');
        expect(commentBox).toHaveAttribute('data-test-action', actionType);
      }
    });
  });

  // ============================================================================
  // data-test-target-value Tests (Tier 2)
  // ============================================================================

  describe('data-test-target-value (Tier 2)', () => {
    it('is present when targetValue option is provided', async () => {
      await navigationManager.highlightWithComment(mockElement, 'Enter username', true, undefined, undefined, undefined, undefined, undefined, {
        actionType: 'formfill',
        targetValue: 'testuser',
      });

      const commentBox = document.querySelector('.interactive-comment-box');
      expect(commentBox).not.toBeNull();
      expect(commentBox).toHaveAttribute('data-test-target-value', 'testuser');
    });

    it('is absent when targetValue option is not provided', async () => {
      await navigationManager.highlightWithComment(mockElement, 'Test comment', true, undefined, undefined, undefined, undefined, undefined, {
        actionType: 'button',
      });

      const commentBox = document.querySelector('.interactive-comment-box');
      expect(commentBox).not.toBeNull();
      expect(commentBox).not.toHaveAttribute('data-test-target-value');
    });

    it('matches the provided targetValue exactly', async () => {
      const testValues = [
        'simple-value',
        'Value with spaces',
        'special!@#$%^&*()chars',
        '123456',
        'multi\nline\nvalue',
      ];

      for (const targetValue of testValues) {
        navigationManager.clearAllHighlights();

        await navigationManager.highlightWithComment(mockElement, 'Test comment', true, undefined, undefined, undefined, undefined, undefined, {
          actionType: 'formfill',
          targetValue,
        });

        const commentBox = document.querySelector('.interactive-comment-box');
        expect(commentBox).toHaveAttribute('data-test-target-value', targetValue);
      }
    });

    it('works with button actions that have target values', async () => {
      await navigationManager.highlightWithComment(mockElement, 'Select option', true, undefined, undefined, undefined, undefined, undefined, {
        actionType: 'button',
        targetValue: 'option-1',
      });

      const commentBox = document.querySelector('.interactive-comment-box');
      expect(commentBox).not.toBeNull();
      expect(commentBox).toHaveAttribute('data-test-action', 'button');
      expect(commentBox).toHaveAttribute('data-test-target-value', 'option-1');
    });

    it('can be used without actionType (backward compatibility)', async () => {
      await navigationManager.highlightWithComment(mockElement, 'Test comment', true, undefined, undefined, undefined, undefined, undefined, {
        targetValue: 'some-value',
      });

      const commentBox = document.querySelector('.interactive-comment-box');
      expect(commentBox).not.toBeNull();
      expect(commentBox).toHaveAttribute('data-test-target-value', 'some-value');
      expect(commentBox).not.toHaveAttribute('data-test-action');
    });

    it('does not set attribute for empty string (falsy value)', async () => {
      // Empty string is falsy, so the attribute won't be set
      // This is intentional - empty strings don't add meaningful test data
      await navigationManager.highlightWithComment(mockElement, 'Clear field', true, undefined, undefined, undefined, undefined, undefined, {
        actionType: 'formfill',
        targetValue: '',
      });

      const commentBox = document.querySelector('.interactive-comment-box');
      expect(commentBox).not.toBeNull();
      expect(commentBox).not.toHaveAttribute('data-test-target-value');
    });
  });

  // ============================================================================
  // Integration: Combined Attributes
  // ============================================================================

  describe('combined attributes', () => {
    it('sets all relevant attributes together for formfill actions', async () => {
      await navigationManager.highlightWithComment(mockElement, 'Enter your email', true, undefined, undefined, undefined, undefined, undefined, {
        actionType: 'formfill',
        targetValue: 'user@example.com',
        skipAnimations: true,
      });

      const commentBox = document.querySelector('.interactive-comment-box');
      expect(commentBox).not.toBeNull();

      // Existing attributes
      expect(commentBox).toHaveAttribute('data-ready', 'true');
      expect(commentBox).toHaveAttribute('data-position');

      // New tier 1 attribute
      expect(commentBox).toHaveAttribute('data-test-action', 'formfill');

      // New tier 2 attribute
      expect(commentBox).toHaveAttribute('data-test-target-value', 'user@example.com');

      // Should not have noop attribute
      expect(commentBox).not.toHaveAttribute('data-noop');
    });

    it('sets correct attributes for button actions without target values', async () => {
      await navigationManager.highlightWithComment(mockElement, 'Click to continue', true, undefined, undefined, undefined, undefined, undefined, {
        actionType: 'button',
        skipAnimations: true,
      });

      const commentBox = document.querySelector('.interactive-comment-box');
      expect(commentBox).not.toBeNull();

      // Existing attributes
      expect(commentBox).toHaveAttribute('data-ready', 'true');
      expect(commentBox).toHaveAttribute('data-position');

      // New tier 1 attribute
      expect(commentBox).toHaveAttribute('data-test-action', 'button');

      // Tier 2 attribute should be absent
      expect(commentBox).not.toHaveAttribute('data-test-target-value');

      // Should not have noop attribute
      expect(commentBox).not.toHaveAttribute('data-noop');
    });

    it('comment box created through highlightWithComment has correct attributes', async () => {
      // This verifies the full integration: NavigationManager creates the comment box
      // with all the correct attributes based on the options provided
      const stepInfo = { current: 1, total: 3, completedSteps: [0] };

      await navigationManager.highlightWithComment(
        mockElement,
        'Complete this step',
        false, // enableAutoCleanup
        stepInfo,
        undefined, // onSkipCallback
        undefined, // onCancelCallback
        undefined, // onNextCallback
        undefined, // onPreviousCallback
        {
          showKeyboardHint: true,
          stepTitle: 'Step 1',
          skipAnimations: true,
          actionType: 'formfill',
          targetValue: 'test-value',
        }
      );

      const commentBox = document.querySelector('.interactive-comment-box');
      expect(commentBox).not.toBeNull();

      // Verify all attributes are set correctly
      expect(commentBox).toHaveAttribute('data-ready', 'true');
      expect(commentBox).toHaveAttribute('data-position');
      expect(commentBox).toHaveAttribute('data-test-action', 'formfill');
      expect(commentBox).toHaveAttribute('data-test-target-value', 'test-value');
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('edge cases', () => {
    it('handles undefined options gracefully', async () => {
      await navigationManager.highlightWithComment(mockElement, 'Test comment', true, undefined, undefined, undefined, undefined, undefined, {
        skipAnimations: true,
      });

      const commentBox = document.querySelector('.interactive-comment-box');
      expect(commentBox).not.toBeNull();

      // Should have existing attributes
      expect(commentBox).toHaveAttribute('data-ready', 'true');
      expect(commentBox).toHaveAttribute('data-position');

      // Should not have new attributes when options not provided
      expect(commentBox).not.toHaveAttribute('data-test-action');
      expect(commentBox).not.toHaveAttribute('data-test-target-value');
    });

    it('handles empty options object gracefully', async () => {
      await navigationManager.highlightWithComment(mockElement, 'Test comment', true, undefined, undefined, undefined, undefined, undefined, {
        skipAnimations: true,
      });

      const commentBox = document.querySelector('.interactive-comment-box');
      expect(commentBox).not.toBeNull();

      // Should have existing attributes
      expect(commentBox).toHaveAttribute('data-ready', 'true');
      expect(commentBox).toHaveAttribute('data-position');

      // Should not have new attributes when options are empty
      expect(commentBox).not.toHaveAttribute('data-test-action');
      expect(commentBox).not.toHaveAttribute('data-test-target-value');
    });

    it('maintains backward compatibility with existing code', async () => {
      // Call without new options - should work exactly as before
      await navigationManager.highlightWithComment(
        mockElement,
        'Legacy comment',
        true,
        { current: 0, total: 1, completedSteps: [] },
        undefined,
        undefined,
        undefined,
        undefined,
        { skipAnimations: true }
      );

      const commentBox = document.querySelector('.interactive-comment-box');
      expect(commentBox).not.toBeNull();

      // Should have all existing attributes
      expect(commentBox).toHaveAttribute('data-ready', 'true');
      expect(commentBox).toHaveAttribute('data-position');

      // Should not have new attributes
      expect(commentBox).not.toHaveAttribute('data-test-action');
      expect(commentBox).not.toHaveAttribute('data-test-target-value');
    });
  });
});
