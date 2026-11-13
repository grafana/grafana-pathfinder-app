import { isPathfinderContent } from './pathfinder-content';

const SUCCESS_MARKER = '[data-testid="generate-token-success-message"]';
const RECHECK_DELAY_MS = 50;

function containsProductSuccess(node: Node): boolean {
  if (!(node instanceof Element) || isPathfinderContent(node)) {
    return false;
  }
  return (
    node.matches(SUCCESS_MARKER) ||
    Array.from(node.querySelectorAll(SUCCESS_MARKER)).some((marker) => !isPathfinderContent(marker))
  );
}

export function observeWorkflowStateChanges(onChange: () => void): () => void {
  let pending: ReturnType<typeof setTimeout> | undefined;
  const observer = new MutationObserver((records) => {
    if (
      pending !== undefined ||
      !records.some(
        (record) =>
          !(record.target instanceof Element && isPathfinderContent(record.target)) &&
          [...record.addedNodes, ...record.removedNodes].some(containsProductSuccess)
      )
    ) {
      return;
    }
    pending = setTimeout(() => {
      pending = undefined;
      onChange();
    }, RECHECK_DELAY_MS);
  });
  // Watch marker insertion/removal only; never inspect token values, form HTML, or text mutations.
  observer.observe(document.body, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
    clearTimeout(pending);
  };
}
