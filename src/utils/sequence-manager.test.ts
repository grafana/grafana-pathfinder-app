import { SequenceManager } from './sequence-manager';
import { InteractiveStateManager } from './interactive-state-manager';
import { InteractiveElementData } from '../types/interactive.types';
import { INTERACTIVE_CONFIG } from '../constants/interactive-config';

// Mock dependencies
const mockStateManager = {
  logError: jest.fn(),
  setState: jest.fn(),
  handleError: jest.fn()
} as unknown as InteractiveStateManager;

const mockCheckRequirementsFromData = jest.fn();
const mockDispatchInteractiveAction = jest.fn();
const mockWaitForReactUpdates = jest.fn();
const mockIsValidInteractiveElement = jest.fn();
const mockExtractInteractiveDataFromElement = jest.fn();

// Mock elements
const createMockElement = (data: Partial<InteractiveElementData> = {}): Element => ({
  tagName: 'DIV',
  classList: { contains: jest.fn() },
  getAttribute: jest.fn(),
  querySelector: jest.fn(),
  querySelectorAll: jest.fn()
} as unknown as Element);

const createMockInteractiveData = (overrides: Partial<InteractiveElementData> = {}): InteractiveElementData => ({
  reftarget: 'test-selector',
  targetaction: 'button',
  targetvalue: 'test-value',
  requirements: 'test-requirements',
  tagName: 'button',
  textContent: 'Test Button',
  timestamp: Date.now(),
  ...overrides
});

describe('SequenceManager', () => {
  let sequenceManager: SequenceManager;
  let mockElements: Element[];
  let mockInteractiveData: InteractiveElementData;
  let setTimeoutSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock setTimeout to resolve immediately for faster tests
    setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation((callback: any) => {
      callback();
      return 0 as any;
    });
    
    // Reset mocks to default behavior
    mockCheckRequirementsFromData.mockResolvedValue({ pass: true });
    mockDispatchInteractiveAction.mockResolvedValue(undefined);
    mockWaitForReactUpdates.mockResolvedValue(undefined);
    mockIsValidInteractiveElement.mockReturnValue(true);
    mockExtractInteractiveDataFromElement.mockReturnValue(createMockInteractiveData());
    
    // Create test data
    mockElements = [
      createMockElement(),
      createMockElement(),
      createMockElement()
    ];
    mockInteractiveData = createMockInteractiveData();
    
    // Create sequence manager instance
    sequenceManager = new SequenceManager(
      mockStateManager,
      mockCheckRequirementsFromData,
      mockDispatchInteractiveAction,
      mockWaitForReactUpdates,
      mockIsValidInteractiveElement,
      mockExtractInteractiveDataFromElement
    );
  });

  afterEach(() => {
    // Restore original setTimeout
    setTimeoutSpy.mockRestore();
  });

  describe('runInteractiveSequence', () => {
    it('should process all valid elements successfully', async () => {
      await sequenceManager.runInteractiveSequence(mockElements, false);

      expect(mockExtractInteractiveDataFromElement).toHaveBeenCalledTimes(3);
      expect(mockIsValidInteractiveElement).toHaveBeenCalledTimes(3);
      expect(mockCheckRequirementsFromData).toHaveBeenCalledTimes(3);
      expect(mockDispatchInteractiveAction).toHaveBeenCalledTimes(3);
      expect(mockWaitForReactUpdates).toHaveBeenCalledTimes(3);
    });

    it('should skip invalid elements', async () => {
      mockIsValidInteractiveElement.mockReturnValue(false);

      await sequenceManager.runInteractiveSequence(mockElements, false);

      expect(mockExtractInteractiveDataFromElement).toHaveBeenCalledTimes(3);
      expect(mockIsValidInteractiveElement).toHaveBeenCalledTimes(3);
      expect(mockCheckRequirementsFromData).not.toHaveBeenCalled();
      expect(mockDispatchInteractiveAction).not.toHaveBeenCalled();
    });

    it('should handle show mode correctly', async () => {
      await sequenceManager.runInteractiveSequence(mockElements, true);

      expect(mockDispatchInteractiveAction).toHaveBeenCalledWith(
        expect.any(Object),
        false // show mode = false for click parameter
      );
    });

    it('should handle do mode correctly', async () => {
      await sequenceManager.runInteractiveSequence(mockElements, false);

      expect(mockDispatchInteractiveAction).toHaveBeenCalledWith(
        expect.any(Object),
        true // do mode = true for click parameter
      );
    });

    it('should retry on requirements failure', async () => {
      // Mock requirements to fail first, then pass
      mockCheckRequirementsFromData
        .mockResolvedValueOnce({ pass: false })
        .mockResolvedValueOnce({ pass: true });

      await sequenceManager.runInteractiveSequence([mockElements[0]], false);

      expect(mockCheckRequirementsFromData).toHaveBeenCalledTimes(2);
      expect(mockDispatchInteractiveAction).toHaveBeenCalledTimes(1);
    });

    it('should stop retrying after max retries', async () => {
      mockCheckRequirementsFromData.mockResolvedValue({ pass: false });

      await sequenceManager.runInteractiveSequence([mockElements[0]], false);

      expect(mockCheckRequirementsFromData).toHaveBeenCalledTimes(INTERACTIVE_CONFIG.maxRetries);
      expect(mockDispatchInteractiveAction).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      mockDispatchInteractiveAction.mockRejectedValueOnce(new Error('Test error'));

      await sequenceManager.runInteractiveSequence([mockElements[0]], false);

      expect(mockStateManager.logError).toHaveBeenCalledWith(
        'Error processing interactive element',
        expect.any(Error),
        expect.any(Object)
      );
    });

    it('should retry on errors', async () => {
      // Mock action to fail first, then succeed
      mockDispatchInteractiveAction
        .mockRejectedValueOnce(new Error('Test error'))
        .mockResolvedValueOnce(undefined);

      await sequenceManager.runInteractiveSequence([mockElements[0]], false);

      expect(mockDispatchInteractiveAction).toHaveBeenCalledTimes(2);
      expect(mockStateManager.logError).toHaveBeenCalledTimes(1);
    });

    it('should use correct retry delay', async () => {
      mockCheckRequirementsFromData.mockResolvedValue({ pass: false });

      await sequenceManager.runInteractiveSequence([mockElements[0]], false);

      expect(setTimeoutSpy).toHaveBeenCalledWith(
        expect.any(Function),
        INTERACTIVE_CONFIG.delays.perceptual.retry
      );
    });
  });

  describe('runStepByStepSequence', () => {
    it('should process elements in step-by-step mode', async () => {
      await sequenceManager.runStepByStepSequence(mockElements);

      // Should call dispatchInteractiveAction twice per element (show + do)
      expect(mockDispatchInteractiveAction).toHaveBeenCalledTimes(6);
      // Should call waitForReactUpdates for each show/do pair, plus one between elements (but not after last)
      expect(mockWaitForReactUpdates).toHaveBeenCalledTimes(5); // 2 for first element + 2 for second + 1 for third
    });

    it('should skip invalid elements', async () => {
      mockIsValidInteractiveElement.mockReturnValue(false);

      await sequenceManager.runStepByStepSequence(mockElements);

      expect(mockDispatchInteractiveAction).not.toHaveBeenCalled();
      expect(mockWaitForReactUpdates).not.toHaveBeenCalled();
    });

    it('should show then do for each element', async () => {
      await sequenceManager.runStepByStepSequence([mockElements[0]]);

      expect(mockDispatchInteractiveAction).toHaveBeenCalledTimes(2);
      expect(mockDispatchInteractiveAction).toHaveBeenNthCalledWith(1, expect.any(Object), false); // show
      expect(mockDispatchInteractiveAction).toHaveBeenNthCalledWith(2, expect.any(Object), true);  // do
    });

    it('should check requirements before and after show', async () => {
      await sequenceManager.runStepByStepSequence([mockElements[0]]);

      expect(mockCheckRequirementsFromData).toHaveBeenCalledTimes(2);
    });

    it('should retry on requirements failure before show', async () => {
      mockCheckRequirementsFromData
        .mockResolvedValueOnce({ pass: false })
        .mockResolvedValueOnce({ pass: true })
        .mockResolvedValueOnce({ pass: true });

      await sequenceManager.runStepByStepSequence([mockElements[0]]);

      expect(mockCheckRequirementsFromData).toHaveBeenCalledTimes(3);
      expect(mockDispatchInteractiveAction).toHaveBeenCalledTimes(2);
    });

    it('should retry on requirements failure after show', async () => {
      mockCheckRequirementsFromData
        .mockResolvedValueOnce({ pass: true })
        .mockResolvedValueOnce({ pass: false })
        .mockResolvedValueOnce({ pass: true });

      await sequenceManager.runStepByStepSequence([mockElements[0]]);

      expect(mockCheckRequirementsFromData).toHaveBeenCalledTimes(4); // Initial + after show + retry + final
      expect(mockDispatchInteractiveAction).toHaveBeenCalledTimes(3); // show + do + retry do
    });

    it('should stop retrying after max retries', async () => {
      mockCheckRequirementsFromData.mockResolvedValue({ pass: false });

      await sequenceManager.runStepByStepSequence([mockElements[0]]);

      expect(mockCheckRequirementsFromData).toHaveBeenCalledTimes(INTERACTIVE_CONFIG.maxRetries);
      expect(mockDispatchInteractiveAction).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      mockDispatchInteractiveAction.mockRejectedValueOnce(new Error('Test error'));

      await sequenceManager.runStepByStepSequence([mockElements[0]]);

      expect(mockStateManager.logError).toHaveBeenCalledWith(
        'Error in interactive step',
        expect.any(Error),
        expect.any(Object)
      );
    });

    it('should retry on errors', async () => {
      // Mock action to fail first, then succeed
      mockDispatchInteractiveAction
        .mockRejectedValueOnce(new Error('Test error'))
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);

      await sequenceManager.runStepByStepSequence([mockElements[0]]);

      expect(mockDispatchInteractiveAction).toHaveBeenCalledTimes(3);
      expect(mockStateManager.logError).toHaveBeenCalledTimes(1);
    });

    it('should not wait for React updates after last element', async () => {
      await sequenceManager.runStepByStepSequence([mockElements[0]]);

      // Should call waitForReactUpdates for show and do, but not after the last do
      expect(mockWaitForReactUpdates).toHaveBeenCalledTimes(1); // Only one for show, not after do for single element
    });

    it('should wait for React updates between elements', async () => {
      await sequenceManager.runStepByStepSequence(mockElements);

      // Should call waitForReactUpdates for each show/do pair, but not after the last do
      expect(mockWaitForReactUpdates).toHaveBeenCalledTimes(5); // 2 for first element + 2 for second + 1 for third
    });

    it('should use correct retry delay', async () => {
      mockCheckRequirementsFromData.mockResolvedValue({ pass: false });

      await sequenceManager.runStepByStepSequence([mockElements[0]]);

      expect(setTimeoutSpy).toHaveBeenCalledWith(
        expect.any(Function),
        INTERACTIVE_CONFIG.delays.perceptual.retry
      );
    });
  });

  describe('constructor', () => {
    it('should accept all required dependencies', () => {
      expect(() => {
        new SequenceManager(
          mockStateManager,
          mockCheckRequirementsFromData,
          mockDispatchInteractiveAction,
          mockWaitForReactUpdates,
          mockIsValidInteractiveElement,
          mockExtractInteractiveDataFromElement
        );
      }).not.toThrow();
    });
  });

  describe('error handling', () => {
    it('should log errors with correct context', async () => {
      const testError = new Error('Test error');
      mockDispatchInteractiveAction.mockRejectedValue(testError);

      await sequenceManager.runInteractiveSequence([mockElements[0]], false);

      expect(mockStateManager.logError).toHaveBeenCalledWith(
        'Error processing interactive element',
        testError,
        expect.any(Object)
      );
    });

    it('should log step errors with correct context', async () => {
      const testError = new Error('Test error');
      mockDispatchInteractiveAction.mockRejectedValue(testError);

      await sequenceManager.runStepByStepSequence([mockElements[0]]);

      expect(mockStateManager.logError).toHaveBeenCalledWith(
        'Error in interactive step',
        testError,
        expect.any(Object)
      );
    });
  });

  describe('configuration usage', () => {
    it('should use INTERACTIVE_CONFIG.maxRetries', async () => {
      mockCheckRequirementsFromData.mockResolvedValue({ pass: false });

      await sequenceManager.runInteractiveSequence([mockElements[0]], false);

      expect(mockCheckRequirementsFromData).toHaveBeenCalledTimes(INTERACTIVE_CONFIG.maxRetries);
    });

    it('should use INTERACTIVE_CONFIG.delays.perceptual.retry', async () => {
      mockCheckRequirementsFromData.mockResolvedValue({ pass: false });

      await sequenceManager.runInteractiveSequence([mockElements[0]], false);

      expect(setTimeoutSpy).toHaveBeenCalledWith(
        expect.any(Function),
        INTERACTIVE_CONFIG.delays.perceptual.retry
      );
    });
  });
}); 