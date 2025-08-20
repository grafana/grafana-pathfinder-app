import { FocusHandler } from './focus-handler';
import { InteractiveStateManager } from '../interactive-state-manager';
import { NavigationManager } from '../navigation-manager';
import { InteractiveElementData } from '../../types/interactive.types';

// Mock dependencies
jest.mock('../interactive-state-manager');
jest.mock('../navigation-manager');

const mockStateManager = {
  setState: jest.fn(),
  handleError: jest.fn(),
} as unknown as InteractiveStateManager;

const mockNavigationManager = {
  ensureNavigationOpen: jest.fn(),
  ensureElementVisible: jest.fn(),
  highlight: jest.fn(),
  highlightWithComment: jest.fn(),
} as unknown as NavigationManager;

const mockWaitForReactUpdates = jest.fn().mockResolvedValue(undefined);

// Mock document.querySelectorAll
const mockQuerySelectorAll = jest.fn();
Object.defineProperty(document, 'querySelectorAll', {
  value: mockQuerySelectorAll,
  writable: true,
});

describe('FocusHandler', () => {
  let focusHandler: FocusHandler;
  let mockElements: HTMLElement[];

  beforeEach(() => {
    jest.clearAllMocks();

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
      expect(mockNavigationManager.ensureNavigationOpen).toHaveBeenCalledWith(mockElements[0]);
      expect(mockNavigationManager.ensureElementVisible).toHaveBeenCalledWith(mockElements[0]);
      expect(mockNavigationManager.highlightWithComment).toHaveBeenCalledWith(mockElements[0], undefined);
      expect(mockWaitForReactUpdates).not.toHaveBeenCalled(); // No completion in show mode
    });

    it('should handle do mode correctly', async () => {
      await focusHandler.execute(mockData, true);

      expect(mockStateManager.setState).toHaveBeenCalledWith(mockData, 'running');
      expect(mockQuerySelectorAll).toHaveBeenCalledWith('test-selector');
      expect(mockNavigationManager.ensureNavigationOpen).toHaveBeenCalledWith(mockElements[0]);
      expect(mockNavigationManager.ensureElementVisible).toHaveBeenCalledWith(mockElements[0]);
      expect(mockElements[0].click).toHaveBeenCalled();
      expect(mockWaitForReactUpdates).toHaveBeenCalled();
      expect(mockStateManager.setState).toHaveBeenCalledWith(mockData, 'completed');
    });

    it('should handle multiple elements correctly', async () => {
      await focusHandler.execute(mockData, true);

      // Should process all elements
      expect(mockNavigationManager.ensureNavigationOpen).toHaveBeenCalledWith(mockElements[0]);
      expect(mockNavigationManager.ensureNavigationOpen).toHaveBeenCalledWith(mockElements[1]);
      expect(mockElements[0].click).toHaveBeenCalled();
      expect(mockElements[1].click).toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      const testError = new Error('Element not found');
      mockQuerySelectorAll.mockImplementation(() => {
        throw testError;
      });

      await focusHandler.execute(mockData, true);

      expect(mockStateManager.handleError).toHaveBeenCalledWith(testError, 'FocusHandler', mockData, false);
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
  });
});
