import { ButtonHandler } from './button-handler';
import { InteractiveStateManager } from '../interactive-state-manager';
import { NavigationManager } from '../navigation-manager';
import { InteractiveElementData } from '../../types/interactive.types';
import { findButtonByText } from '../../lib/dom';
import * as elementValidator from '../../lib/dom';

// Mock dependencies
jest.mock('../../lib/dom');
jest.mock('../interactive-state-manager');
jest.mock('../navigation-manager');

const mockFindButtonByText = findButtonByText as jest.MockedFunction<typeof findButtonByText>;
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

describe('ButtonHandler', () => {
  let buttonHandler: ButtonHandler;
  let mockButtons: HTMLButtonElement[];

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsElementVisible.mockReturnValue(true); // Default to visible

    // Create mock buttons
    mockButtons = [
      { click: jest.fn() } as unknown as HTMLButtonElement,
      { click: jest.fn() } as unknown as HTMLButtonElement,
    ];

    mockFindButtonByText.mockReturnValue(mockButtons);

    buttonHandler = new ButtonHandler(mockStateManager, mockNavigationManager, mockWaitForReactUpdates);
  });

  describe('execute', () => {
    const mockData: InteractiveElementData = {
      reftarget: 'test-button',
      targetaction: 'button',
      targetvalue: 'test-value',
      requirements: 'test-requirements',
      tagName: 'button',
      textContent: 'Test Button',
      timestamp: Date.now(),
    };

    it('should handle show mode correctly', async () => {
      await buttonHandler.execute(mockData, false);

      expect(mockStateManager.setState).toHaveBeenCalledWith(mockData, 'running');
      expect(mockFindButtonByText).toHaveBeenCalledWith('test-button');
      expect(mockNavigationManager.ensureNavigationOpen).toHaveBeenCalledWith(mockButtons[0]);
      expect(mockNavigationManager.ensureElementVisible).toHaveBeenCalledWith(mockButtons[0]);
      expect(mockNavigationManager.highlightWithComment).toHaveBeenCalledWith(mockButtons[0], undefined);
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
      mockFindButtonByText.mockImplementation(() => {
        throw testError;
      });

      await buttonHandler.execute(mockData, true);

      expect(mockStateManager.handleError).toHaveBeenCalledWith(testError, 'ButtonHandler', mockData, false);
    });

    it('should warn when button is not visible but continue execution', async () => {
      mockIsElementVisible.mockReturnValue(false);

      await buttonHandler.execute(mockData, false);

      expect(mockConsoleWarn).toHaveBeenCalledWith('[pathfinder]', 'Target button is not visible:', mockButtons[0]);
      expect(mockNavigationManager.ensureNavigationOpen).toHaveBeenCalled();
      expect(mockNavigationManager.highlightWithComment).toHaveBeenCalled();
    });

    it('should warn when button is not visible in do mode but continue execution', async () => {
      mockIsElementVisible.mockReturnValue(false);

      await buttonHandler.execute(mockData, true);

      expect(mockConsoleWarn).toHaveBeenCalledWith('[pathfinder]', 'Target button is not visible:', mockButtons[0]);
      expect(mockButtons[0].click).toHaveBeenCalled();
      expect(mockStateManager.setState).toHaveBeenCalledWith(mockData, 'completed');
    });
  });

  afterAll(() => {
    mockConsoleWarn.mockRestore();
  });
});
