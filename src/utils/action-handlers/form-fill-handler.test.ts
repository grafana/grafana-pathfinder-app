import { FormFillHandler } from './form-fill-handler';
import { InteractiveStateManager } from '../interactive-state-manager';
import { NavigationManager } from '../navigation-manager';
import { InteractiveElementData } from '../../types/interactive.types';
import { resetValueTracker } from '../dom-utils';

// Mock dependencies
jest.mock('../interactive-state-manager');
jest.mock('../navigation-manager');
jest.mock('../dom-utils', () => ({
  resetValueTracker: jest.fn(),
}));

const mockStateManager = {
  setState: jest.fn(),
  handleError: jest.fn(),
} as unknown as InteractiveStateManager;

const mockNavigationManager = {
  ensureNavigationOpen: jest.fn().mockResolvedValue(undefined),
  ensureElementVisible: jest.fn().mockResolvedValue(undefined),
  highlight: jest.fn().mockResolvedValue(undefined),
  highlightWithComment: jest.fn().mockResolvedValue(undefined),
  fixNavigationRequirements: jest.fn().mockResolvedValue(undefined),
  openAndDockNavigation: jest.fn().mockResolvedValue(undefined),
} as unknown as NavigationManager & {
  ensureNavigationOpen: jest.Mock;
  ensureElementVisible: jest.Mock;
  highlight: jest.Mock;
  highlightWithComment: jest.Mock;
  fixNavigationRequirements: jest.Mock;
  openAndDockNavigation: jest.Mock;
};

const mockWaitForReactUpdates = jest.fn().mockResolvedValue(undefined);

// Mock console methods to avoid noise in tests
const mockConsoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});

// Mock DOM methods
const mockQuerySelectorAll = jest.fn();
const mockDispatchEvent = jest.fn();
const mockFocus = jest.fn();
const mockBlur = jest.fn();

// Mock setTimeout for Monaco editor delays
const mockSetTimeout = jest.fn().mockImplementation((callback: any) => {
  callback();
  return 0;
});

describe('FormFillHandler', () => {
  let formFillHandler: FormFillHandler;
  let mockElement: HTMLElement;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock global setTimeout
    jest.spyOn(global, 'setTimeout').mockImplementation(mockSetTimeout);

    // Mock document.querySelectorAll
    document.querySelectorAll = mockQuerySelectorAll;

    // Create a mock element
    mockElement = {
      tagName: 'INPUT',
      classList: {
        contains: jest.fn().mockReturnValue(false),
      },
      focus: mockFocus,
      blur: mockBlur,
      dispatchEvent: mockDispatchEvent,
      textContent: '',
      value: '',
      getAttribute: jest.fn().mockReturnValue(null), // Needed for isAriaCombobox detection
    } as unknown as HTMLElement;

    // Mock Object.getOwnPropertyDescriptor for native setters
    const mockNativeSetter = jest.fn();
    Object.getOwnPropertyDescriptor = jest.fn().mockReturnValue({
      set: mockNativeSetter,
    });

    formFillHandler = new FormFillHandler(mockStateManager, mockNavigationManager, mockWaitForReactUpdates);
  });

  afterAll(() => {
    mockConsoleWarn.mockRestore();
    jest.restoreAllMocks();
  });

  describe('execute', () => {
    const mockData: InteractiveElementData = {
      reftarget: '#test-input',
      targetaction: 'formfill',
      targetvalue: 'test-value',
      requirements: 'test-requirements',
      tagName: 'input',
      textContent: 'Test Input',
      timestamp: Date.now(),
    };

    it('should handle show mode correctly', async () => {
      mockQuerySelectorAll.mockReturnValue([mockElement]);

      await formFillHandler.execute(mockData, false);

      expect(mockStateManager.setState).toHaveBeenCalledWith(mockData, 'running');
      expect(mockNavigationManager.ensureNavigationOpen).toHaveBeenCalledWith(mockElement);
      expect(mockNavigationManager.ensureElementVisible).toHaveBeenCalledWith(mockElement);
      expect(mockNavigationManager.highlightWithComment).toHaveBeenCalledWith(mockElement, undefined);
    });

    it('should handle do mode with input element correctly', async () => {
      mockQuerySelectorAll.mockReturnValue([mockElement]);

      await formFillHandler.execute(mockData, true);

      expect(mockStateManager.setState).toHaveBeenCalledWith(mockData, 'running');
      expect(mockNavigationManager.ensureNavigationOpen).toHaveBeenCalledWith(mockElement);
      expect(mockNavigationManager.ensureElementVisible).toHaveBeenCalledWith(mockElement);
      expect(mockFocus).toHaveBeenCalled();
      expect(mockDispatchEvent).toHaveBeenCalled();
      expect(mockWaitForReactUpdates).toHaveBeenCalled();
      expect(mockStateManager.setState).toHaveBeenCalledWith(mockData, 'completed');
    });

    it('should handle textarea element correctly', async () => {
      const textareaElement = {
        ...mockElement,
        tagName: 'TEXTAREA',
      } as unknown as HTMLElement;
      mockQuerySelectorAll.mockReturnValue([textareaElement]);

      await formFillHandler.execute(mockData, true);

      expect(mockFocus).toHaveBeenCalled();
      expect(mockDispatchEvent).toHaveBeenCalled();
    });

    it('should handle select element correctly', async () => {
      const selectElement = {
        ...mockElement,
        tagName: 'SELECT',
      } as unknown as HTMLElement;
      mockQuerySelectorAll.mockReturnValue([selectElement]);

      await formFillHandler.execute(mockData, true);

      expect(mockFocus).toHaveBeenCalled();
      expect(mockDispatchEvent).toHaveBeenCalled();
    });

    it('should handle div element with text content correctly', async () => {
      const divElement = {
        ...mockElement,
        tagName: 'DIV',
        textContent: '',
      } as unknown as HTMLElement;
      mockQuerySelectorAll.mockReturnValue([divElement]);

      await formFillHandler.execute(mockData, true);

      expect(divElement.textContent).toBe('test-value');
    });

    it('should handle checkbox input correctly', async () => {
      const checkboxElement = {
        ...mockElement,
        type: 'checkbox',
        checked: false,
      } as unknown as HTMLInputElement;
      mockQuerySelectorAll.mockReturnValue([checkboxElement]);

      await formFillHandler.execute(mockData, true);

      expect(checkboxElement.checked).toBe(true);
    });

    it('should handle unchecked checkbox correctly', async () => {
      const checkboxElement = {
        ...mockElement,
        type: 'checkbox',
        checked: true,
      } as unknown as HTMLInputElement;
      const uncheckedData = { ...mockData, targetvalue: 'false' };
      mockQuerySelectorAll.mockReturnValue([checkboxElement]);

      await formFillHandler.execute(uncheckedData, true);

      expect(checkboxElement.checked).toBe(false);
    });

    it('should handle radio input correctly', async () => {
      const radioElement = {
        ...mockElement,
        type: 'radio',
        checked: false,
      } as unknown as HTMLInputElement;
      mockQuerySelectorAll.mockReturnValue([radioElement]);

      await formFillHandler.execute(mockData, true);

      expect(radioElement.checked).toBe(true);
    });

    it('should handle Monaco editor correctly', async () => {
      const monacoElement = {
        ...mockElement,
        tagName: 'TEXTAREA',
        classList: {
          contains: jest
            .fn()
            .mockImplementation(
              (className: string) => className === 'inputarea' || className === 'monaco-mouse-cursor-text'
            ),
        },
        getAttribute: jest.fn().mockReturnValue(null),
      } as unknown as HTMLElement;
      mockQuerySelectorAll.mockReturnValue([monacoElement]);

      await formFillHandler.execute(mockData, true);

      // Should trigger Monaco-specific events
      expect(mockDispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'keydown', key: 'a', ctrlKey: true })
      );
      expect(mockDispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'keydown', key: 'Delete' }));
    });

    it('should handle empty target value correctly', async () => {
      const emptyData = { ...mockData, targetvalue: '' };
      mockQuerySelectorAll.mockReturnValue([mockElement]);

      await formFillHandler.execute(emptyData, true);

      expect(mockFocus).toHaveBeenCalled();
      expect(mockDispatchEvent).toHaveBeenCalled();
    });

    it('should handle undefined target value correctly', async () => {
      const undefinedData = { ...mockData, targetvalue: undefined };
      mockQuerySelectorAll.mockReturnValue([mockElement]);

      await formFillHandler.execute(undefinedData, true);

      expect(mockFocus).toHaveBeenCalled();
      expect(mockDispatchEvent).toHaveBeenCalled();
    });

    it('should handle multiple elements found warning', async () => {
      const multipleElements = [mockElement, mockElement];
      mockQuerySelectorAll.mockReturnValue(multipleElements);

      await formFillHandler.execute(mockData, true);

      expect(mockConsoleWarn).toHaveBeenCalledWith(
        expect.stringContaining('Multiple elements found matching selector')
      );
    });

    it('should handle no elements found error', async () => {
      mockQuerySelectorAll.mockReturnValue([]);

      await formFillHandler.execute(mockData, true);

      expect(mockStateManager.handleError).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'No elements found matching selector: #test-input' }),
        'FormFillHandler',
        mockData,
        false
      );
    });

    it('should handle navigation manager errors', async () => {
      const navigationError = new Error('Navigation failed');
      mockQuerySelectorAll.mockReturnValue([mockElement]);
      mockNavigationManager.ensureNavigationOpen.mockRejectedValueOnce(navigationError);

      await formFillHandler.execute(mockData, true);

      expect(mockStateManager.handleError).toHaveBeenCalledWith(navigationError, 'FormFillHandler', mockData, false);
    });

    it('should handle element preparation errors', async () => {
      const preparationError = new Error('Element preparation failed');
      mockQuerySelectorAll.mockReturnValue([mockElement]);
      mockNavigationManager.ensureElementVisible.mockRejectedValueOnce(preparationError);

      await formFillHandler.execute(mockData, true);

      expect(mockStateManager.handleError).toHaveBeenCalledWith(preparationError, 'FormFillHandler', mockData, false);
    });

    it('should handle Monaco editor value setting errors', async () => {
      const monacoElement = {
        ...mockElement,
        tagName: 'TEXTAREA',
        classList: {
          contains: jest
            .fn()
            .mockImplementation(
              (className: string) => className === 'inputarea' || className === 'monaco-mouse-cursor-text'
            ),
        },
        dispatchEvent: jest.fn().mockImplementation(() => {
          throw new Error('Monaco error');
        }),
      } as unknown as HTMLElement;
      mockQuerySelectorAll.mockReturnValue([monacoElement]);

      await formFillHandler.execute(mockData, true);

      expect(mockStateManager.handleError).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Monaco error' }),
        'FormFillHandler',
        mockData,
        false
      );
    });

    it('should handle native setter fallback correctly', async () => {
      // Mock no native setter available
      Object.getOwnPropertyDescriptor = jest.fn().mockReturnValue(undefined);
      mockQuerySelectorAll.mockReturnValue([mockElement]);

      await formFillHandler.execute(mockData, true);

      expect(mockFocus).toHaveBeenCalled();
      expect(mockDispatchEvent).toHaveBeenCalled();
    });

    it('should call resetValueTracker for input elements', async () => {
      mockQuerySelectorAll.mockReturnValue([mockElement]);

      await formFillHandler.execute(mockData, true);

      expect(resetValueTracker).toHaveBeenCalledWith(mockElement);
    });

    it('should handle Monaco editor with last character events', async () => {
      const monacoElement = {
        ...mockElement,
        tagName: 'TEXTAREA',
        classList: {
          contains: jest
            .fn()
            .mockImplementation(
              (className: string) => className === 'inputarea' || className === 'monaco-mouse-cursor-text'
            ),
        },
        getAttribute: jest.fn().mockReturnValue(null),
      } as unknown as HTMLElement;
      const dataWithLastChar = { ...mockData, targetvalue: 'test-value-e' };
      mockQuerySelectorAll.mockReturnValue([monacoElement]);

      await formFillHandler.execute(dataWithLastChar, true);

      // Should trigger events for the last character 'e'
      expect(mockDispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'keydown', key: 'e' }));
      expect(mockDispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'keyup', key: 'e' }));
    });

    it('should handle Monaco editor with empty value', async () => {
      const monacoElement = {
        ...mockElement,
        tagName: 'TEXTAREA',
        classList: {
          contains: jest
            .fn()
            .mockImplementation(
              (className: string) => className === 'inputarea' || className === 'monaco-mouse-cursor-text'
            ),
        },
      } as unknown as HTMLElement;
      const emptyData = { ...mockData, targetvalue: '' };
      mockQuerySelectorAll.mockReturnValue([monacoElement]);

      await formFillHandler.execute(emptyData, true);

      // Should not trigger last character events for empty value
      expect(mockDispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'input', bubbles: true }));
      expect(mockDispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'change', bubbles: true }));
    });
  });
});
