import { useCallback } from 'react';

/**
 * Hook for detecting DOM settling through event listeners
 * Replaces magic number timeouts with proper DOM state detection
 */
export function useDOMSettling() {
  /**
   * Wait for CSS animation to complete by listening for animationend events
   * @param element - The element with the animation
   * @param animationName - Optional specific animation name to wait for
   * @param fallbackTimeout - Fallback timeout in ms (default: 2000)
   */
  const waitForAnimationComplete = useCallback(
    (element: HTMLElement, animationName?: string, fallbackTimeout = 2000): Promise<void> => {
      return new Promise((resolve) => {
        const handleAnimationEnd = (event: AnimationEvent) => {
          if (!animationName || event.animationName === animationName) {
            element.removeEventListener('animationend', handleAnimationEnd);
            resolve();
          }
        };

        element.addEventListener('animationend', handleAnimationEnd);

        // Fallback timeout for animations that don't fire events
        setTimeout(resolve, fallbackTimeout);
      });
    },
    []
  );

  /**
   * Wait for CSS transition to complete by listening for transitionend events
   * @param element - The element with the transition
   * @param propertyName - Optional specific property to wait for
   * @param fallbackTimeout - Fallback timeout in ms (default: 500)
   */
  const waitForTransitionComplete = useCallback(
    (element: HTMLElement, propertyName?: string, fallbackTimeout = 500): Promise<void> => {
      return new Promise((resolve) => {
        const handleTransitionEnd = (event: TransitionEvent) => {
          if (!propertyName || event.propertyName === propertyName) {
            element.removeEventListener('transitionend', handleTransitionEnd);
            resolve();
          }
        };

        element.addEventListener('transitionend', handleTransitionEnd);

        // Fallback timeout for transitions that don't fire events
        setTimeout(resolve, fallbackTimeout);
      });
    },
    []
  );

  /**
   * Wait for scroll animation to complete by listening for scroll events
   * @param element - The element being scrolled
   * @param fallbackTimeout - Fallback timeout in ms (default: 500)
   */
  const waitForScrollComplete = useCallback((element: HTMLElement, fallbackTimeout = 500): Promise<void> => {
    return new Promise((resolve) => {
      let scrollTimeout: NodeJS.Timeout;

      const handleScroll = () => {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(resolve, 100);
      };

      element.addEventListener('scroll', handleScroll);

      // Fallback timeout
      setTimeout(resolve, fallbackTimeout);
    });
  }, []);

  /**
   * Wait for form input changes to complete (especially for Monaco editor)
   * @param element - The form input element
   * @param fallbackTimeout - Fallback timeout in ms (default: 100)
   */
  const waitForInputComplete = useCallback((element: HTMLElement, fallbackTimeout = 100): Promise<void> => {
    return new Promise((resolve) => {
      const handleInput = () => {
        element.removeEventListener('input', handleInput);
        resolve();
      };

      element.addEventListener('input', handleInput);

      // Fallback timeout
      setTimeout(resolve, fallbackTimeout);
    });
  }, []);

  return {
    waitForAnimationComplete,
    waitForTransitionComplete,
    waitForScrollComplete,
    waitForInputComplete,
  };
}
