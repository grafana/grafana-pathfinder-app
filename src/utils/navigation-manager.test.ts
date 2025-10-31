import { NavigationManager } from './navigation-manager';
import * as elementValidator from './element-validator';

// Mock the element validator functions
jest.mock('./element-validator');

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

    it('should always call scrollIntoView (browser handles optimization)', async () => {
      mockIsElementVisible.mockReturnValue(true);
      mockHasFixedPosition.mockReturnValue(true);
      mockIsInViewport.mockReturnValue(true);

      await navigationManager.ensureElementVisible(mockElement);

      // New approach: always call scrollIntoView, let browser optimize
      expect(mockElement.scrollIntoView).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'start',
        inline: 'nearest',
      });
    });

    it('should always call scrollIntoView even when element appears in viewport', async () => {
      mockIsElementVisible.mockReturnValue(true);
      mockHasFixedPosition.mockReturnValue(false);
      mockIsInViewport.mockReturnValue(true);

      await navigationManager.ensureElementVisible(mockElement);

      // New approach: always call scrollIntoView, let browser optimize
      expect(mockElement.scrollIntoView).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'start',
        inline: 'nearest',
      });
    });

    it('should scroll element into view when not in viewport', async () => {
      mockIsElementVisible.mockReturnValue(true);
      mockHasFixedPosition.mockReturnValue(false);
      mockIsInViewport.mockReturnValue(false);
      mockGetScrollParent.mockReturnValue(document.documentElement);

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
        top: 300,
        left: 100,
        bottom: 400,
        right: 200,
        width: 100,
        height: 100,
      });

      await navigationManager.ensureElementVisible(mockElement);

      // Now we use scrollIntoView on the element within custom containers
      expect(mockElement.scrollIntoView).toHaveBeenCalled();

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
      const element1 = document.createElement('div');
      element1.className = 'interactive-highlighted';
      const element2 = document.createElement('div');
      element2.className = 'interactive-guided-active';

      document.body.appendChild(element1);
      document.body.appendChild(element2);

      navigationManager.clearAllHighlights();

      expect(element1.classList.contains('interactive-highlighted')).toBe(false);
      expect(element2.classList.contains('interactive-guided-active')).toBe(false);

      document.body.removeChild(element1);
      document.body.removeChild(element2);
    });
  });
});
