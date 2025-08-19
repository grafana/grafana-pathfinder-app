/**
 * Safe event handling utilities to prevent browser warnings about canceling non-cancelable events
 */

export interface SafeEventOptions {
  preventDefault?: boolean;
  stopPropagation?: boolean;
  stopImmediatePropagation?: boolean;
}

/**
 * Safely handle an event by checking if it's cancelable before calling preventDefault
 */
export function safeEventHandler(event: Event, options: SafeEventOptions = {}): void {
  const { preventDefault = false, stopPropagation = false, stopImmediatePropagation = false } = options;

  if (preventDefault && event.cancelable) {
    event.preventDefault();
  }

  if (stopPropagation) {
    event.stopPropagation();
  }

  if (stopImmediatePropagation) {
    event.stopImmediatePropagation();
  }
}

/**
 * Create a safe event handler wrapper function
 */
export function createSafeEventHandler<T extends Event>(
  handler: (event: T) => void,
  options: SafeEventOptions = {}
): (event: T) => void {
  return (event: T) => {
    safeEventHandler(event, options);
    handler(event);
  };
}

/**
 * Safe event listener options for events that might need preventDefault
 */
export const safeEventListenerOptions: AddEventListenerOptions = {
  passive: false,
  capture: false,
};

/**
 * Safe event listener options for passive events (won't call preventDefault)
 */
export const passiveEventListenerOptions: AddEventListenerOptions = {
  passive: true,
  capture: false,
};
