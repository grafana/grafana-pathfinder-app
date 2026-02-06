/**
 * E2E Testing Contract: Comment Box Attribute Helpers
 *
 * These helpers ensure consistency when applying data-test-* attributes to
 * DOM-created comment boxes (not React components). These attributes expose
 * the interactive system state for E2E testing.
 *
 * See: docs/developer/E2E_TESTING_CONTRACT.md for the full contract specification
 */

/**
 * Options for E2E comment box attributes
 */
export interface E2ECommentBoxAttributeOptions {
  /**
   * Action type for data-test-action attribute
   * Values: 'button', 'formfill', 'highlight', 'hover', 'noop'
   */
  actionType?: string;

  /**
   * Target value for data-test-target-value attribute
   * Used for formfill actions to expose the expected value to E2E tests
   */
  targetValue?: string;
}

/**
 * Apply E2E testing attributes to a comment box element
 *
 * This centralizes attribute application to ensure consistency between
 * NavigationManager and GuidedHandler when creating comment boxes.
 *
 * @param commentBox - The comment box element to annotate
 * @param options - E2E attribute options
 *
 * @example
 * ```ts
 * const commentBox = document.createElement('div');
 * commentBox.className = 'interactive-comment-box';
 * applyE2ECommentBoxAttributes(commentBox, {
 *   actionType: 'formfill',
 *   targetValue: 'username@example.com'
 * });
 * ```
 */
export function applyE2ECommentBoxAttributes(commentBox: HTMLElement, options?: E2ECommentBoxAttributeOptions): void {
  if (!options) {
    return;
  }

  // Tier 1 - Action type attribute
  if (options.actionType) {
    commentBox.setAttribute('data-test-action', options.actionType);
  }

  // Tier 2 - Target value attribute (for formfill actions)
  if (options.targetValue) {
    commentBox.setAttribute('data-test-target-value', options.targetValue);
  }
}
