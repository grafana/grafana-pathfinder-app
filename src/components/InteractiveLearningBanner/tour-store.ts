/**
 * Open/closed state for the interactive-learning tour.
 *
 * Module-level rather than component state because the banner that starts the tour
 * lives in the context panel, which unmounts the moment the tour's hand-off step
 * opens a guide tab. The tour is hosted from the docs-panel root instead, and this
 * is the seam between them.
 */

let isOpen = false;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

export function startInteractiveLearningTour(): void {
  if (isOpen) {
    return;
  }
  isOpen = true;
  notify();
}

export function stopInteractiveLearningTour(): void {
  if (!isOpen) {
    return;
  }
  isOpen = false;
  notify();
}

export function isInteractiveLearningTourOpen(): boolean {
  return isOpen;
}

export function subscribeInteractiveLearningTour(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
