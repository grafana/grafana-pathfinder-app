import { NavigateHandler } from './navigate-handler';
import { InteractiveStateManager } from '../interactive-state-manager';
import { InteractiveElementData } from '../../types/interactive.types';
import { locationService } from '@grafana/runtime';

// Mock dependencies
jest.mock('../interactive-state-manager');
jest.mock('@grafana/runtime', () => ({
  locationService: {
    push: jest.fn()
  }
}));

const mockStateManager = {
  setState: jest.fn(),
  handleError: jest.fn()
} as unknown as InteractiveStateManager;

const mockWaitForReactUpdates = jest.fn().mockResolvedValue(undefined);

// Mock window.open
const mockWindowOpen = jest.fn();
Object.defineProperty(window, 'open', {
  value: mockWindowOpen,
  writable: true
});

// Mock console.log to avoid noise in tests
const mockConsoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});

describe('NavigateHandler', () => {
  let navigateHandler: NavigateHandler;

  beforeEach(() => {
    jest.clearAllMocks();
    
    navigateHandler = new NavigateHandler(
      mockStateManager,
      mockWaitForReactUpdates
    );
  });

  afterAll(() => {
    mockConsoleLog.mockRestore();
  });

  describe('execute', () => {
    const mockData: InteractiveElementData = {
      reftarget: '/test-route',
      targetaction: 'navigate',
      targetvalue: 'test-value',
      requirements: 'test-requirements',
      tagName: 'a',
      textContent: 'Test Link',
      timestamp: Date.now()
    };

    it('should handle show mode correctly', async () => {
      await navigateHandler.execute(mockData, false);

      expect(mockStateManager.setState).toHaveBeenCalledWith(mockData, 'running');
      expect(mockConsoleLog).toHaveBeenCalledWith(`🔍 Show mode: Would navigate to ${mockData.reftarget}`);
      expect(mockWaitForReactUpdates).toHaveBeenCalled();
      expect(mockStateManager.setState).toHaveBeenCalledWith(mockData, 'completed');
    });

    it('should handle do mode with internal route correctly', async () => {
      await navigateHandler.execute(mockData, true);

      expect(mockStateManager.setState).toHaveBeenCalledWith(mockData, 'running');
      expect(mockConsoleLog).toHaveBeenCalledWith(`🧭 Navigating to: ${mockData.reftarget}`);
      expect(locationService.push).toHaveBeenCalledWith('/test-route');
      expect(mockWindowOpen).not.toHaveBeenCalled();
      expect(mockWaitForReactUpdates).toHaveBeenCalled();
      expect(mockStateManager.setState).toHaveBeenCalledWith(mockData, 'completed');
    });

    it('should handle do mode with external URL correctly', async () => {
      const externalData = { ...mockData, reftarget: 'https://example.com' };
      
      await navigateHandler.execute(externalData, true);

      expect(mockStateManager.setState).toHaveBeenCalledWith(externalData, 'running');
      expect(mockConsoleLog).toHaveBeenCalledWith(`🧭 Navigating to: ${externalData.reftarget}`);
      expect(mockWindowOpen).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer');
      expect(locationService.push).not.toHaveBeenCalled();
      expect(mockWaitForReactUpdates).toHaveBeenCalled();
      expect(mockStateManager.setState).toHaveBeenCalledWith(externalData, 'completed');
    });

    it('should handle HTTP external URL correctly', async () => {
      const httpData = { ...mockData, reftarget: 'http://example.com' };
      
      await navigateHandler.execute(httpData, true);

      expect(mockWindowOpen).toHaveBeenCalledWith('http://example.com', '_blank', 'noopener,noreferrer');
      expect(locationService.push).not.toHaveBeenCalled();
    });

    it('should handle HTTPS external URL correctly', async () => {
      const httpsData = { ...mockData, reftarget: 'https://example.com' };
      
      await navigateHandler.execute(httpsData, true);

      expect(mockWindowOpen).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer');
      expect(locationService.push).not.toHaveBeenCalled();
    });

    it('should handle relative internal route correctly', async () => {
      const relativeData = { ...mockData, reftarget: './relative-path' };
      
      await navigateHandler.execute(relativeData, true);

      expect(locationService.push).toHaveBeenCalledWith('./relative-path');
      expect(mockWindowOpen).not.toHaveBeenCalled();
    });

    it('should handle absolute internal route correctly', async () => {
      const absoluteData = { ...mockData, reftarget: '/absolute-path' };
      
      await navigateHandler.execute(absoluteData, true);

      expect(locationService.push).toHaveBeenCalledWith('/absolute-path');
      expect(mockWindowOpen).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      const testError = new Error('Navigation failed');
      mockWaitForReactUpdates.mockRejectedValueOnce(testError);

      await navigateHandler.execute(mockData, true);

      expect(mockStateManager.handleError).toHaveBeenCalledWith(
        testError,
        'NavigateHandler',
        mockData
      );
    });

    it('should handle errors in show mode', async () => {
      const testError = new Error('Show mode failed');
      mockWaitForReactUpdates.mockRejectedValueOnce(testError);

      await navigateHandler.execute(mockData, false);

      expect(mockStateManager.handleError).toHaveBeenCalledWith(
        testError,
        'NavigateHandler',
        mockData
      );
    });

    it('should handle locationService.push errors', async () => {
      const testError = new Error('Location service failed');
      (locationService.push as jest.Mock).mockImplementationOnce(() => { throw testError; });

      await navigateHandler.execute(mockData, true);

      expect(mockStateManager.handleError).toHaveBeenCalledWith(
        testError,
        'NavigateHandler',
        mockData
      );
    });

    it('should handle window.open errors', async () => {
      const externalData = { ...mockData, reftarget: 'https://example.com' };
      const testError = new Error('Window open failed');
      mockWindowOpen.mockImplementationOnce(() => { throw testError; });

      await navigateHandler.execute(externalData, true);

      expect(mockStateManager.handleError).toHaveBeenCalledWith(
        testError,
        'NavigateHandler',
        externalData
      );
    });
  });
}); 