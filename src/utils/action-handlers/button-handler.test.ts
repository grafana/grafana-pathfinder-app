import { ButtonHandler } from './button-handler';
import { InteractiveStateManager } from '../interactive-state-manager';
import { NavigationManager } from '../navigation-manager';
import { InteractiveElementData } from '../../types/interactive.types';
import { findButtonByText } from '../dom-utils';

// Mock dependencies
jest.mock('../dom-utils');
jest.mock('../interactive-state-manager');
jest.mock('../navigation-manager');

const mockFindButtonByText = findButtonByText as jest.MockedFunction<typeof findButtonByText>;
const mockStateManager = {
  setState: jest.fn(),
  handleError: jest.fn()
} as unknown as InteractiveStateManager;

const mockNavigationManager = {
  ensureNavigationOpen: jest.fn(),
  ensureElementVisible: jest.fn(),
  highlight: jest.fn()
} as unknown as NavigationManager;

const mockWaitForReactUpdates = jest.fn().mockResolvedValue(undefined);

describe('ButtonHandler', () => {
  let buttonHandler: ButtonHandler;
  let mockButtons: HTMLElement[];

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create mock buttons
    mockButtons = [
      { click: jest.fn() } as unknown as HTMLElement,
      { click: jest.fn() } as unknown as HTMLElement
    ];
    
    mockFindButtonByText.mockReturnValue(mockButtons);
    
    buttonHandler = new ButtonHandler(
      mockStateManager,
      mockNavigationManager,
      mockWaitForReactUpdates
    );
  });

  describe('execute', () => {
    const mockData: InteractiveElementData = {
      reftarget: 'test-button',
      targetaction: 'button',
      targetvalue: 'test-value',
      requirements: 'test-requirements',
      tagName: 'button',
      textContent: 'Test Button',
      timestamp: Date.now()
    };

    it('should handle show mode correctly', async () => {
      await buttonHandler.execute(mockData, false);

      expect(mockStateManager.setState).toHaveBeenCalledWith(mockData, 'running');
      expect(mockFindButtonByText).toHaveBeenCalledWith('test-button');
      expect(mockNavigationManager.ensureNavigationOpen).toHaveBeenCalledWith(mockButtons[0]);
      expect(mockNavigationManager.ensureElementVisible).toHaveBeenCalledWith(mockButtons[0]);
      expect(mockNavigationManager.highlight).toHaveBeenCalledWith(mockButtons[0]);
      expect(mockWaitForReactUpdates).not.toHaveBeenCalled(); // No completion in show mode
    });

    it('should handle do mode correctly', async () => {
      await buttonHandler.execute(mockData, true);

      expect(mockStateManager.setState).toHaveBeenCalledWith(mockData, 'running');
      expect(mockFindButtonByText).toHaveBeenCalledWith('test-button');
      expect(mockNavigationManager.ensureNavigationOpen).toHaveBeenCalledWith(mockButtons[0]);
      expect(mockNavigationManager.ensureElementVisible).toHaveBeenCalledWith(mockButtons[0]);
      expect(mockButtons[0].click).toHaveBeenCalled();
      expect(mockWaitForReactUpdates).toHaveBeenCalled();
      expect(mockStateManager.setState).toHaveBeenCalledWith(mockData, 'completed');
    });

    it('should handle errors gracefully', async () => {
      const testError = new Error('Button not found');
      mockFindButtonByText.mockImplementation(() => { throw testError; });

      await buttonHandler.execute(mockData, true);

      expect(mockStateManager.handleError).toHaveBeenCalledWith(
        testError,
        'ButtonHandler',
        mockData,
        false
      );
    });
  });
}); 