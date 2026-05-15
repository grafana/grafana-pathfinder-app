/**
 * PERMANENT — unit tests for `useSectionScroll`.
 *
 * Focuses on the Pattern F resource lifecycle: listener attach/detach
 * gated by `isRunning`, the userScrolled-vs-programmatic
 * distinction, and `scrollToStep`'s bail-out when the user has
 * scrolled.
 */

import { act, renderHook } from '@testing-library/react';

import { useSectionScroll } from './use-section-scroll';

let scrollContainer: HTMLDivElement;

beforeEach(() => {
  scrollContainer = document.createElement('div');
  scrollContainer.id = 'inner-docs-content';
  document.body.appendChild(scrollContainer);
});

afterEach(() => {
  scrollContainer.remove();
});

function fireScroll() {
  scrollContainer.dispatchEvent(new Event('scroll'));
}

describe('useSectionScroll', () => {
  describe('listener lifecycle (Pattern F)', () => {
    it('attaches scroll listener when isRunning=true, removes when isRunning=false', () => {
      const addSpy = jest.spyOn(scrollContainer, 'addEventListener');
      const removeSpy = jest.spyOn(scrollContainer, 'removeEventListener');

      const { rerender } = renderHook(({ isRunning }) => useSectionScroll({ isRunning }), {
        initialProps: { isRunning: false },
      });
      expect(addSpy).not.toHaveBeenCalled();

      rerender({ isRunning: true });
      expect(addSpy).toHaveBeenCalledWith('scroll', expect.any(Function), { passive: true });

      rerender({ isRunning: false });
      expect(removeSpy).toHaveBeenCalled();
    });

    it('does not throw when #inner-docs-content is missing', () => {
      scrollContainer.remove();
      expect(() => {
        renderHook(() => useSectionScroll({ isRunning: true }));
      }).not.toThrow();
    });
  });

  describe('user-vs-programmatic scroll', () => {
    it('a real user scroll marks userScrolled, disabling scrollToStep for the rest of the run', () => {
      const { result, rerender } = renderHook(({ isRunning }) => useSectionScroll({ isRunning }), {
        initialProps: { isRunning: false },
      });

      // Begin a run; user has NOT scrolled.
      rerender({ isRunning: true });
      act(() => {
        result.current.beginProgrammaticScroll();
      });

      // Place a target element and verify scrollToStep would scroll it.
      const target = document.createElement('div');
      target.setAttribute('data-step-id', 's1');
      document.body.appendChild(target);
      const scrollIntoView = jest.fn();
      target.scrollIntoView = scrollIntoView;

      // Programmatic scroll fires — listener should ignore it.
      // (We can't directly observe userScrolledRef, but if it stayed
      // false, scrollToStep would still work after.)
      act(() => {
        fireScroll();
      });

      // Now end the programmatic window and fire a user scroll.
      act(() => {
        result.current.endProgrammaticScroll();
      });
      act(() => {
        fireScroll();
      });

      // userScrolledRef should now be true. scrollToStep must bail out.
      act(() => {
        result.current.scrollToStep('s1');
      });
      expect(scrollIntoView).not.toHaveBeenCalled();

      target.remove();
    });

    it('scrollToStep calls scrollIntoView when userScrolled is false and the target exists', () => {
      const { result } = renderHook(() => useSectionScroll({ isRunning: true }));
      act(() => {
        result.current.beginProgrammaticScroll();
      });

      const target = document.createElement('div');
      target.setAttribute('data-step-id', 's-existing');
      document.body.appendChild(target);
      const scrollIntoView = jest.fn();
      target.scrollIntoView = scrollIntoView;

      act(() => {
        result.current.scrollToStep('s-existing');
      });
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });

      target.remove();
    });

    it('scrollToStep is a no-op when the target is not in the DOM', () => {
      const { result } = renderHook(() => useSectionScroll({ isRunning: true }));
      act(() => {
        result.current.beginProgrammaticScroll();
      });
      // No target with data-step-id="missing" in the DOM.
      expect(() => {
        act(() => {
          result.current.scrollToStep('missing');
        });
      }).not.toThrow();
    });
  });

  describe('begin/end programmatic scroll', () => {
    it('beginProgrammaticScroll resets userScrolled to false', () => {
      const { result, rerender } = renderHook(({ isRunning }) => useSectionScroll({ isRunning }), {
        initialProps: { isRunning: true },
      });

      // Fire a user scroll first (not in programmatic window).
      act(() => {
        fireScroll();
      });

      // begin should reset userScrolled.
      act(() => {
        result.current.beginProgrammaticScroll();
      });

      // Now a scrollToStep should succeed.
      const target = document.createElement('div');
      target.setAttribute('data-step-id', 's-after-begin');
      document.body.appendChild(target);
      const scrollIntoView = jest.fn();
      target.scrollIntoView = scrollIntoView;

      act(() => {
        result.current.scrollToStep('s-after-begin');
      });
      expect(scrollIntoView).toHaveBeenCalled();

      target.remove();
      rerender({ isRunning: false });
    });
  });
});
