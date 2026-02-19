import { NavigateHandler } from './navigate-handler';
import { InteractiveStateManager } from '../interactive-state-manager';
import { InteractiveElementData } from '../../types/interactive.types';
import { locationService } from '@grafana/runtime';

// Mock dependencies
jest.mock('../interactive-state-manager');
jest.mock('@grafana/runtime', () => ({
  locationService: {
    push: jest.fn(),
  },
}));

const mockStateManager = {
  setState: jest.fn(),
  handleError: jest.fn(),
} as unknown as InteractiveStateManager;

const mockWaitForReactUpdates = jest.fn().mockResolvedValue(undefined);

// Mock window.open
const mockWindowOpen = jest.fn();
Object.defineProperty(window, 'open', {
  value: mockWindowOpen,
  writable: true,
});

// Mock console.log to avoid noise in tests
const mockConsoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});

describe('NavigateHandler', () => {
  let navigateHandler: NavigateHandler;

  beforeEach(() => {
    jest.clearAllMocks();

    navigateHandler = new NavigateHandler(mockStateManager, mockWaitForReactUpdates);
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
      timestamp: Date.now(),
    };

    it('should handle show mode correctly', async () => {
      await navigateHandler.execute(mockData, false);

      expect(mockStateManager.setState).toHaveBeenCalledWith(mockData, 'running');
      expect(mockWaitForReactUpdates).toHaveBeenCalled();
      expect(mockStateManager.setState).toHaveBeenCalledWith(mockData, 'completed');
    });

    it('should handle do mode with internal route correctly', async () => {
      await navigateHandler.execute(mockData, true);

      expect(mockStateManager.setState).toHaveBeenCalledWith(mockData, 'running');
      expect(locationService.push).toHaveBeenCalledWith('/test-route');
      expect(mockWindowOpen).not.toHaveBeenCalled();
      expect(mockWaitForReactUpdates).toHaveBeenCalled();
      expect(mockStateManager.setState).toHaveBeenCalledWith(mockData, 'completed');
    });

    it('should handle do mode with external URL correctly', async () => {
      const externalData = { ...mockData, reftarget: 'https://example.com' };

      await navigateHandler.execute(externalData, true);

      expect(mockStateManager.setState).toHaveBeenCalledWith(externalData, 'running');
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

      expect(mockStateManager.handleError).toHaveBeenCalledWith(testError, 'NavigateHandler', mockData);
    });

    it('should handle errors in show mode', async () => {
      const testError = new Error('Show mode failed');
      mockWaitForReactUpdates.mockRejectedValueOnce(testError);

      await navigateHandler.execute(mockData, false);

      expect(mockStateManager.handleError).toHaveBeenCalledWith(testError, 'NavigateHandler', mockData);
    });

    it('should handle locationService.push errors', async () => {
      const testError = new Error('Location service failed');
      (locationService.push as jest.Mock).mockImplementationOnce(() => {
        throw testError;
      });

      await navigateHandler.execute(mockData, true);

      expect(mockStateManager.handleError).toHaveBeenCalledWith(testError, 'NavigateHandler', mockData);
    });

    it('should handle window.open errors', async () => {
      const externalData = { ...mockData, reftarget: 'https://example.com' };
      const testError = new Error('Window open failed');
      mockWindowOpen.mockImplementationOnce(() => {
        throw testError;
      });

      await navigateHandler.execute(externalData, true);

      expect(mockStateManager.handleError).toHaveBeenCalledWith(testError, 'NavigateHandler', externalData);
    });

    it('should block javascript: URLs and not call window.open', async () => {
      const maliciousData = { ...mockData, reftarget: 'https://javascript:alert(1)' };

      await navigateHandler.execute(maliciousData, true);

      // parseUrlSafely will fail for a malformed URL like this
      // The test verifies the guard works: no window.open call
      expect(mockWindowOpen).not.toHaveBeenCalled();
      expect(locationService.push).not.toHaveBeenCalled();
    });

    it('should block data: URLs that start with http prefix', async () => {
      // URL 'http://data:text/html,...' fails to parse because "text/html,..." is not a valid port
      // parseUrlSafely returns null, so the URL is blocked
      const dataUrl = { ...mockData, reftarget: 'http://data:text/html,<script>alert(1)</script>' };

      await navigateHandler.execute(dataUrl, true);

      // Verify the malformed URL was blocked
      expect(mockWindowOpen).not.toHaveBeenCalled();
      expect(locationService.push).not.toHaveBeenCalled();
    });

    it('should allow legitimate https URLs through validation', async () => {
      const safeData = { ...mockData, reftarget: 'https://grafana.com/docs/grafana/' };

      await navigateHandler.execute(safeData, true);

      expect(mockWindowOpen).toHaveBeenCalledWith('https://grafana.com/docs/grafana/', '_blank', 'noopener,noreferrer');
    });

    it('should allow legitimate http URLs through validation', async () => {
      const httpData = { ...mockData, reftarget: 'http://localhost:3000/test' };

      await navigateHandler.execute(httpData, true);

      expect(mockWindowOpen).toHaveBeenCalledWith('http://localhost:3000/test', '_blank', 'noopener,noreferrer');
    });

    it('should block URLs that fail to parse', async () => {
      const badUrlData = { ...mockData, reftarget: 'https://' };

      await navigateHandler.execute(badUrlData, true);

      expect(mockWindowOpen).not.toHaveBeenCalled();
    });

    it('should still complete the step even when URL is blocked', async () => {
      const maliciousData = { ...mockData, reftarget: 'https://' };

      await navigateHandler.execute(maliciousData, true);

      // Step should still complete to avoid blocking guide progression
      expect(mockStateManager.setState).toHaveBeenCalledWith(maliciousData, 'completed');
    });
  });
});
