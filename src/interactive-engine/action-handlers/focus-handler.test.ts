import { FocusHandler } from './focus-handler';
import { InteractiveStateManager } from '../interactive-state-manager';
import { NavigationManager } from '../navigation-manager';
import { InteractiveElementData } from '../../types/interactive.types';
import * as elementValidator from '../../lib/dom';

// Mock dependencies
jest.mock('../interactive-state-manager');
jest.mock('../navigation-manager');
jest.mock('../../lib/dom');

const mockStateManager = {
  setState: jest.fn(),
  handleError: jest.fn(),
} as unknown as InteractiveStateManager;

const mockNavigationManager = {
  ensureNavigationOpen: jest.fn(),
  ensureElementVisible: jest.fn(),
  highlight: jest.fn(),
  highlightWithComment: jest.fn(),
  clearAllHighlights: jest.fn(),
} as unknown as NavigationManager;

const mockWaitForReactUpdates = jest.fn().mockResolvedValue(undefined);

const mockIsElementVisible = elementValidator.isElementVisible as jest.MockedFunction<
  typeof elementValidator.isElementVisible
>;

// Mock console.warn to avoid noise in tests
const mockConsoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});

// Mock document.querySelectorAll
const mockQuerySelectorAll = jest.fn();
Object.defineProperty(document, 'querySelectorAll', {
  value: mockQuerySelectorAll,
  writable: true,
});

// Mock enhanced selector
jest.mock('../../lib/dom', () => ({
  querySelectorAllEnhanced: jest.fn((selector: string) => ({
    elements: mockQuerySelectorAll(selector),
    usedFallback: false,
    originalSelector: selector,
  })),
  isElementVisible: jest.fn(),
  resolveSelector: jest.fn((selector: string) => selector), // Pass through selector as-is for tests
}));

describe('FocusHandler', () => {
  let focusHandler: FocusHandler;
  let mockElements: HTMLElement[];

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsElementVisible.mockReturnValue(true); // Default to visible

    // Create mock elements
    mockElements = [{ click: jest.fn() } as unknown as HTMLElement, { click: jest.fn() } as unknown as HTMLElement];

    mockQuerySelectorAll.mockReturnValue(mockElements);

    focusHandler = new FocusHandler(mockStateManager, mockNavigationManager, mockWaitForReactUpdates);
  });

  describe('execute', () => {
    const mockData: InteractiveElementData = {
      reftarget: 'test-selector',
      targetaction: 'highlight',
      targetvalue: 'test-value',
      requirements: 'test-requirements',
      tagName: 'div',
      textContent: 'Test Element',
      timestamp: Date.now(),
    };

    it('should handle show mode correctly', async () => {
      await focusHandler.execute(mockData, false);

      expect(mockStateManager.setState).toHaveBeenCalledWith(mockData, 'running');
      expect(mockQuerySelectorAll).toHaveBeenCalledWith('test-selector');
      expect(mockNavigationManager.ensureNavigationOpen).toHaveBeenCalledWith(mockElements[0]!);
      expect(mockNavigationManager.ensureElementVisible).toHaveBeenCalledWith(mockElements[0]!);
      expect(mockNavigationManager.highlightWithComment).toHaveBeenCalledWith(mockElements[0]!, undefined);
      expect(mockWaitForReactUpdates).not.toHaveBeenCalled(); // No completion in show mode
    });

    it('should handle do mode correctly', async () => {
      await focusHandler.execute(mockData, true);

      expect(mockStateManager.setState).toHaveBeenCalledWith(mockData, 'running');
      expect(mockQuerySelectorAll).toHaveBeenCalledWith('test-selector');
      expect(mockNavigationManager.ensureNavigationOpen).toHaveBeenCalledWith(mockElements[0]!);
      expect(mockNavigationManager.ensureElementVisible).toHaveBeenCalledWith(mockElements[0]!);
      expect(mockElements[0]!.click).toHaveBeenCalled();
      expect(mockWaitForReactUpdates).toHaveBeenCalled();
      expect(mockStateManager.setState).toHaveBeenCalledWith(mockData, 'completed');
    });

    it('should handle multiple elements correctly', async () => {
      await focusHandler.execute(mockData, true);

      // Should process all elements
      expect(mockNavigationManager.ensureNavigationOpen).toHaveBeenCalledWith(mockElements[0]!);
      expect(mockNavigationManager.ensureNavigationOpen).toHaveBeenCalledWith(mockElements[1]!);
      expect(mockElements[0]!.click).toHaveBeenCalled();
      expect(mockElements[1]!.click).toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      // With enhanced selector, empty results are handled gracefully without throwing
      // The enhanced selector returns empty arrays instead of throwing errors
      mockQuerySelectorAll.mockReturnValue([]);

      await focusHandler.execute(mockData, true);

      // Should complete successfully even with no elements found
      // Enhanced selector handles this gracefully
      expect(mockStateManager.setState).toHaveBeenCalledWith(mockData, 'running');
      expect(mockStateManager.setState).toHaveBeenCalledWith(mockData, 'completed');
    });

    it('should handle empty element list in show mode', async () => {
      mockQuerySelectorAll.mockReturnValue([]);

      await focusHandler.execute(mockData, false);

      expect(mockStateManager.setState).toHaveBeenCalledWith(mockData, 'running');
      expect(mockNavigationManager.ensureNavigationOpen).not.toHaveBeenCalled();
      expect(mockNavigationManager.ensureElementVisible).not.toHaveBeenCalled();
      expect(mockNavigationManager.highlight).not.toHaveBeenCalled();
    });

    it('should handle empty element list in do mode', async () => {
      mockQuerySelectorAll.mockReturnValue([]);

      await focusHandler.execute(mockData, true);

      expect(mockStateManager.setState).toHaveBeenCalledWith(mockData, 'running');
      expect(mockNavigationManager.ensureNavigationOpen).not.toHaveBeenCalled();
      expect(mockNavigationManager.ensureElementVisible).not.toHaveBeenCalled();
      expect(mockWaitForReactUpdates).toHaveBeenCalled();
      expect(mockStateManager.setState).toHaveBeenCalledWith(mockData, 'completed');
    });

    it('should warn when element is not visible but continue execution', async () => {
      mockIsElementVisible.mockReturnValue(false);

      await focusHandler.execute(mockData, false);

      expect(mockConsoleWarn).toHaveBeenCalledWith('Target element is not visible:', mockElements[0]!);
      expect(mockNavigationManager.ensureNavigationOpen).toHaveBeenCalled();
      expect(mockNavigationManager.highlightWithComment).toHaveBeenCalled();
    });

    it('should warn when element is not visible in do mode but continue execution', async () => {
      mockIsElementVisible.mockReturnValue(false);

      await focusHandler.execute(mockData, true);

      expect(mockConsoleWarn).toHaveBeenCalledWith('Target element is not visible:', mockElements[0]!);
      expect(mockElements[0]!.click).toHaveBeenCalled();
      expect(mockStateManager.setState).toHaveBeenCalledWith(mockData, 'completed');
    });
  });

  afterAll(() => {
    mockConsoleWarn.mockRestore();
  });
});
