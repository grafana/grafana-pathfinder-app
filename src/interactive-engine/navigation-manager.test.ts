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

// Mock console.warn to avoid noise in tests
const mockConsoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});

describe('NavigationManager', () => {
  let navigationManager: NavigationManager;
  let mockElement: HTMLElement;

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

    // Mock scrollIntoView
    mockElement.scrollIntoView = jest.fn();

    // Mock window.innerHeight for viewport calculations
    Object.defineProperty(window, 'innerHeight', {
      writable: true,
      configurable: true,
      value: 768,
    });

    // Mock getBoundingClientRect
    mockElement.getBoundingClientRect = jest.fn().mockReturnValue({
      top: 100,
      left: 100,
      bottom: 200,
      right: 200,
      width: 100,
      height: 100,
    });
  });

  afterEach(() => {
    // Remove mockElement from its parent (could be document.body or a custom container)
    if (mockElement.parentElement) {
      mockElement.parentElement.removeChild(mockElement);
    }
  });

  afterAll(() => {
    mockConsoleWarn.mockRestore();
  });

  describe('ensureElementVisible', () => {
    it('should warn when element is not visible', async () => {
      mockIsElementVisible.mockReturnValue(false);
      mockIsInViewport.mockReturnValue(false);

      await navigationManager.ensureElementVisible(mockElement);

      expect(mockConsoleWarn).toHaveBeenCalledWith('Element is hidden or not visible:', mockElement);
    });

    it('should scroll element into view when not in viewport', async () => {
      mockIsElementVisible.mockReturnValue(true);
      mockHasFixedPosition.mockReturnValue(false);
      mockIsInViewport.mockReturnValue(false);
      mockGetScrollParent.mockReturnValue(document.documentElement);

      // Element is outside viewport (below the fold)
      mockElement.getBoundingClientRect = jest.fn().mockReturnValue({
        top: 2000, // Way below viewport
        left: 100,
        bottom: 2100,
        right: 200,
        width: 100,
        height: 100,
      });

      await navigationManager.ensureElementVisible(mockElement);

      expect(mockElement.scrollIntoView).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'start',
        inline: 'nearest',
      });
    });

    it('should handle custom scroll containers', async () => {
      const customContainer = document.createElement('div');
      customContainer.style.overflow = 'auto';
      customContainer.style.height = '200px';
      customContainer.scrollBy = jest.fn();
      customContainer.getBoundingClientRect = jest.fn().mockReturnValue({
        top: 0,
        left: 0,
        bottom: 200,
        right: 300,
        width: 300,
        height: 200,
      });

      document.body.appendChild(customContainer);
      customContainer.appendChild(mockElement);

      mockIsElementVisible.mockReturnValue(true);
      mockHasFixedPosition.mockReturnValue(false);
      mockIsInViewport.mockReturnValue(false);
      mockGetScrollParent.mockReturnValue(customContainer);

      // Element is outside container viewport
      mockElement.getBoundingClientRect = jest.fn().mockReturnValue({
        top: 300, // Outside container (container bottom is 200)
        left: 100,
        bottom: 400,
        right: 200,
        width: 100,
        height: 100,
      });

      await navigationManager.ensureElementVisible(mockElement);

      // Should scroll with smooth behavior
      expect(mockElement.scrollIntoView).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'start',
        inline: 'nearest',
      });

      document.body.removeChild(customContainer);
    });

    it('should not scroll custom container when element is already visible within it', async () => {
      const customContainer = document.createElement('div');
      customContainer.style.overflow = 'auto';
      customContainer.style.height = '200px';
      customContainer.scrollBy = jest.fn();
      customContainer.getBoundingClientRect = jest.fn().mockReturnValue({
        top: 0,
        left: 0,
        bottom: 200,
        right: 300,
        width: 300,
        height: 200,
      });

      document.body.appendChild(customContainer);
      customContainer.appendChild(mockElement);

      mockIsElementVisible.mockReturnValue(true);
      mockHasFixedPosition.mockReturnValue(false);
      mockIsInViewport.mockReturnValue(false);
      mockGetScrollParent.mockReturnValue(customContainer);

      // Element is inside container viewport
      mockElement.getBoundingClientRect = jest.fn().mockReturnValue({
        top: 50,
        left: 100,
        bottom: 150,
        right: 200,
        width: 100,
        height: 100,
      });

      await navigationManager.ensureElementVisible(mockElement);

      expect(customContainer.scrollBy).not.toHaveBeenCalled();

      document.body.removeChild(customContainer);
    });
  });

  describe('clearAllHighlights', () => {
    it('should remove all highlight outlines', () => {
      const outline1 = document.createElement('div');
      outline1.className = 'interactive-highlight-outline';
      const outline2 = document.createElement('div');
      outline2.className = 'interactive-highlight-outline';

      document.body.appendChild(outline1);
      document.body.appendChild(outline2);

      navigationManager.clearAllHighlights();

      expect(document.querySelectorAll('.interactive-highlight-outline').length).toBe(0);
    });

    it('should remove all comment boxes', () => {
      const comment1 = document.createElement('div');
      comment1.className = 'interactive-comment-box';
      const comment2 = document.createElement('div');
      comment2.className = 'interactive-comment-box';

      document.body.appendChild(comment1);
      document.body.appendChild(comment2);

      navigationManager.clearAllHighlights();

      expect(document.querySelectorAll('.interactive-comment-box').length).toBe(0);
    });

    it('should remove highlighted classes from elements', () => {
      const element = document.createElement('div');
      element.className = 'interactive-guided-active';

      document.body.appendChild(element);

      navigationManager.clearAllHighlights();

      expect(element.classList.contains('interactive-guided-active')).toBe(false);

      document.body.removeChild(element);
    });

    it('should remove dot indicators in addition to outlines', () => {
      const outline = document.createElement('div');
      outline.className = 'interactive-highlight-outline';
      const dot = document.createElement('div');
      dot.className = 'interactive-highlight-dot';

      document.body.appendChild(outline);
      document.body.appendChild(dot);

      navigationManager.clearAllHighlights();

      expect(document.querySelectorAll('.interactive-highlight-outline').length).toBe(0);
      expect(document.querySelectorAll('.interactive-highlight-dot').length).toBe(0);
    });
  });

  describe('highlightWithComment', () => {
    beforeEach(() => {
      // Reset mocks for highlight tests
      mockIsElementVisible.mockReturnValue(true);
      mockGetScrollParent.mockReturnValue(document.documentElement);
      mockGetStickyHeaderOffset.mockReturnValue(0);
    });

    afterEach(() => {
      // Clean up any highlights after each test
      navigationManager.clearAllHighlights();
    });

    describe('normal elements (>= minDimensionForBox, 10px)', () => {
      it('should create bounding box highlight for visible element', async () => {
        // Element with normal dimensions
        mockElement.getBoundingClientRect = jest.fn().mockReturnValue({
          top: 100,
          left: 100,
          bottom: 200,
          right: 200,
          width: 100,
          height: 100,
        });

        await navigationManager.highlightWithComment(mockElement, 'Test comment');

        const highlight = document.querySelector('.interactive-highlight-outline');
        expect(highlight).not.toBeNull();
        expect(highlight?.className).toBe('interactive-highlight-outline');
      });

      it('should position box with 4px padding around element', async () => {
        mockElement.getBoundingClientRect = jest.fn().mockReturnValue({
          top: 100,
          left: 100,
          bottom: 150,
          right: 150,
          width: 50,
          height: 50,
        });

        await navigationManager.highlightWithComment(mockElement);

        const highlight = document.querySelector('.interactive-highlight-outline') as HTMLElement;
        expect(highlight).not.toBeNull();

        // Should have padding of 4px on each side, total 8px added to dimensions
        const width = highlight?.style.getPropertyValue('--highlight-width');
        const height = highlight?.style.getPropertyValue('--highlight-height');
        expect(width).toBe('58px'); // 50 + 8
        expect(height).toBe('58px'); // 50 + 8
      });

      it('should create comment box when comment provided', async () => {
        mockElement.getBoundingClientRect = jest.fn().mockReturnValue({
          top: 100,
          left: 100,
          bottom: 200,
          right: 200,
          width: 100,
          height: 100,
        });

        await navigationManager.highlightWithComment(mockElement, 'Test comment');

        const commentBox = document.querySelector('.interactive-comment-box');
        expect(commentBox).not.toBeNull();
      });

      it('should reject elements with no valid position (0,0,0,0)', async () => {
        mockElement.getBoundingClientRect = jest.fn().mockReturnValue({
          top: 0,
          left: 0,
          bottom: 0,
          right: 0,
          width: 0,
          height: 0,
        });

        await navigationManager.highlightWithComment(mockElement, 'Test comment');

        // Should NOT create highlight for invalid element
        const highlight = document.querySelector('.interactive-highlight-outline');
        expect(highlight).toBeNull();
        expect(mockConsoleWarn).toHaveBeenCalledWith(
          'Cannot highlight element: invalid position or dimensions',
          expect.any(Object)
        );
      });
    });

    describe('small elements (< minDimensionForBox, 10px)', () => {
      it('should use dot indicator for elements with width < 10px', async () => {
        mockElement.getBoundingClientRect = jest.fn().mockReturnValue({
          top: 100,
          left: 100,
          bottom: 110,
          right: 101, // 1px wide (like Monaco textarea)
          width: 1,
          height: 10,
        });

        await navigationManager.highlightWithComment(mockElement, 'Test comment');

        // Should create dot indicator instead of bounding box
        const dot = document.querySelector('.interactive-highlight-dot');
        expect(dot).not.toBeNull();
      });

      it('should use dot indicator for elements with height < 10px', async () => {
        mockElement.getBoundingClientRect = jest.fn().mockReturnValue({
          top: 100,
          left: 100,
          bottom: 105,
          right: 200,
          width: 100,
          height: 5, // Very short element
        });

        await navigationManager.highlightWithComment(mockElement, 'Test comment');

        const dot = document.querySelector('.interactive-highlight-dot');
        expect(dot).not.toBeNull();
      });

      it('should position dot at element center', async () => {
        mockElement.getBoundingClientRect = jest.fn().mockReturnValue({
          top: 100,
          left: 200,
          bottom: 110,
          right: 201,
          width: 1,
          height: 10,
        });

        await navigationManager.highlightWithComment(mockElement, 'Test comment');

        const dot = document.querySelector('.interactive-highlight-dot') as HTMLElement;
        expect(dot).not.toBeNull();

        // Dot should be positioned at center of element
        const dotTop = dot?.style.getPropertyValue('--highlight-top');
        const dotLeft = dot?.style.getPropertyValue('--highlight-left');
        // Center: top + height/2 = 100 + 5 = 105, left + width/2 = 200 + 0.5 = 200.5
        expect(dotTop).toBe('105px');
        expect(dotLeft).toBe('200.5px');
      });
    });

    describe('hidden elements', () => {
      it('should use dot indicator and show warning for hidden elements', async () => {
        mockIsElementVisible.mockReturnValue(false);
        mockElement.getBoundingClientRect = jest.fn().mockReturnValue({
          top: 100,
          left: 100,
          bottom: 200,
          right: 200,
          width: 100,
          height: 100,
        });

        await navigationManager.highlightWithComment(mockElement, 'Test comment');

        // Should use dot indicator for hidden elements
        const dot = document.querySelector('.interactive-highlight-dot');
        expect(dot).not.toBeNull();

        // Comment should include hidden warning
        const commentBox = document.querySelector('.interactive-comment-box');
        expect(commentBox?.textContent).toContain('hidden');
      });

      it('should prepend hidden warning even for normal-sized hidden elements', async () => {
        mockIsElementVisible.mockReturnValue(false);
        mockElement.getBoundingClientRect = jest.fn().mockReturnValue({
          top: 100,
          left: 100,
          bottom: 200,
          right: 200,
          width: 100,
          height: 100,
        });

        await navigationManager.highlightWithComment(mockElement, 'Original comment');

        const commentBox = document.querySelector('.interactive-comment-box');
        expect(commentBox?.textContent).toContain('Item hidden');
        expect(commentBox?.textContent).toContain('Original comment');
      });
    });

    describe('highlight cleanup', () => {
      it('should cancel pending cleanup when new highlight is created', async () => {
        jest.useFakeTimers();

        try {
          // Create first highlight (dot mode - 4000ms timeout)
          mockElement.getBoundingClientRect = jest.fn().mockReturnValue({
            top: 100,
            left: 100,
            bottom: 105,
            right: 105,
            width: 5,
            height: 5, // triggers dot mode
          });
          await navigationManager.highlightWithComment(mockElement, 'First');

          // Verify first highlight and comment box exist
          expect(document.querySelectorAll('.interactive-highlight-dot')).toHaveLength(1);
          expect(document.querySelectorAll('.interactive-comment-box')).toHaveLength(1);

          // Create second highlight immediately (outline mode - 5000ms timeout)
          // This should clear the first highlight AND cancel its pending timeout
          const secondElement = document.createElement('div');
          secondElement.getBoundingClientRect = jest.fn().mockReturnValue({
            top: 200,
            left: 200,
            bottom: 250,
            right: 250,
            width: 50,
            height: 50,
          });
          document.body.appendChild(secondElement);
          secondElement.scrollIntoView = jest.fn();
          await navigationManager.highlightWithComment(secondElement, 'Second');

          // Second highlight should exist, first should be gone
          expect(document.querySelectorAll('.interactive-highlight-outline')).toHaveLength(1);
          expect(document.querySelectorAll('.interactive-highlight-dot')).toHaveLength(0);
          // Only one comment box should exist (the second one)
          expect(document.querySelectorAll('.interactive-comment-box')).toHaveLength(1);

          // Advance past where first highlight's timeout WOULD have fired (4000ms)
          // but not past second highlight's timeout (5000ms)
          jest.advanceTimersByTime(4500);

          // Second highlight should still remain (its 5000ms timeout hasn't fired yet)
          // This proves the first timeout was properly cancelled and didn't interfere
          const highlights = document.querySelectorAll('.interactive-highlight-outline, .interactive-highlight-dot');
          expect(highlights).toHaveLength(1);
          expect(document.querySelectorAll('.interactive-highlight-outline')).toHaveLength(1);
          // Comment box should still exist
          expect(document.querySelectorAll('.interactive-comment-box')).toHaveLength(1);

          // Clean up
          document.body.removeChild(secondElement);
        } finally {
          jest.useRealTimers();
        }
      });

      it('should remove comment box when highlight is cleared', async () => {
        mockElement.getBoundingClientRect = jest.fn().mockReturnValue({
          top: 100,
          left: 100,
          bottom: 200,
          right: 200,
          width: 100,
          height: 100,
        });

        await navigationManager.highlightWithComment(mockElement, 'Test comment');

        // Verify both highlight and comment box exist
        expect(document.querySelectorAll('.interactive-highlight-outline')).toHaveLength(1);
        expect(document.querySelectorAll('.interactive-comment-box')).toHaveLength(1);

        // Clear all highlights
        navigationManager.clearAllHighlights();

        // Both should be removed
        expect(document.querySelectorAll('.interactive-highlight-outline')).toHaveLength(0);
        expect(document.querySelectorAll('.interactive-comment-box')).toHaveLength(0);
      });

      it('should remove dot indicator and comment box when cleared', async () => {
        // Small element triggers dot mode
        mockElement.getBoundingClientRect = jest.fn().mockReturnValue({
          top: 100,
          left: 100,
          bottom: 105,
          right: 105,
          width: 5,
          height: 5,
        });

        await navigationManager.highlightWithComment(mockElement, 'Test comment');

        // Verify both dot and comment box exist
        expect(document.querySelectorAll('.interactive-highlight-dot')).toHaveLength(1);
        expect(document.querySelectorAll('.interactive-comment-box')).toHaveLength(1);

        // Clear all highlights
        navigationManager.clearAllHighlights();

        // Both should be removed
        expect(document.querySelectorAll('.interactive-highlight-dot')).toHaveLength(0);
        expect(document.querySelectorAll('.interactive-comment-box')).toHaveLength(0);
      });
    });

    describe('position tracking', () => {
      it('should update highlight position when element moves', async () => {
        // Initial position
        mockElement.getBoundingClientRect = jest.fn().mockReturnValue({
          top: 100,
          left: 100,
          bottom: 200,
          right: 200,
          width: 100,
          height: 100,
        });

        await navigationManager.highlightWithComment(mockElement);

        const highlight = document.querySelector('.interactive-highlight-outline') as HTMLElement;
        expect(highlight).not.toBeNull();

        // Verify initial position
        expect(highlight.style.getPropertyValue('--highlight-top')).toBe('96px'); // 100 - 4

        // Simulate element moving (window resize)
        mockElement.getBoundingClientRect = jest.fn().mockReturnValue({
          top: 200, // Moved down
          left: 100,
          bottom: 300,
          right: 200,
          width: 100,
          height: 100,
        });

        // Trigger resize event
        window.dispatchEvent(new Event('resize'));

        // Wait for debounced update
        await new Promise((resolve) => setTimeout(resolve, 200));

        // Position should be updated
        expect(highlight.style.getPropertyValue('--highlight-top')).toBe('196px'); // 200 - 4
      });

      it('should hide highlight when element is removed from DOM', async () => {
        mockElement.getBoundingClientRect = jest.fn().mockReturnValue({
          top: 100,
          left: 100,
          bottom: 200,
          right: 200,
          width: 100,
          height: 100,
        });

        await navigationManager.highlightWithComment(mockElement);

        const highlight = document.querySelector('.interactive-highlight-outline') as HTMLElement;
        expect(highlight).not.toBeNull();

        // Remove element from DOM
        mockElement.parentElement?.removeChild(mockElement);

        // Trigger resize to trigger position check
        window.dispatchEvent(new Event('resize'));

        // Wait for debounced update
        await new Promise((resolve) => setTimeout(resolve, 200));

        // Highlight should be hidden
        expect(highlight.style.display).toBe('none');
      });
    });
  });
});
