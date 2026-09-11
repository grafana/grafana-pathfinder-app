export interface E2ECommentBoxAttributeOptions {
  actionType?: string;
  targetValue?: string;
  refTarget?: string;
  substepIndex?: number;
  substepSkippable?: boolean;
}

export function applyE2ECommentBoxAttributes(commentBox: HTMLElement, options?: E2ECommentBoxAttributeOptions): void {
  if (!options) {
    return;
  }

  if (options.actionType) {
    commentBox.setAttribute('data-test-action', options.actionType);
  }

  if (options.targetValue) {
    commentBox.setAttribute('data-test-target-value', options.targetValue);
  }

  if (options.refTarget) {
    commentBox.setAttribute('data-test-refTarget', options.refTarget);
  }

  if (options.substepIndex !== undefined) {
    commentBox.setAttribute('data-test-substep-index', String(options.substepIndex));
  }

  if (options.substepSkippable !== undefined) {
    commentBox.setAttribute('data-test-substep-skippable', String(options.substepSkippable));
  }
}
