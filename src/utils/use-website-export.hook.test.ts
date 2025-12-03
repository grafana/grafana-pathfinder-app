/**
 * Tests for useWebsiteExport hook
 */

import { renderHook, act } from '@testing-library/react';
import { useWebsiteExport, type RecordedStep } from './use-website-export.hook';

const mockClipboard = {
  writeText: jest.fn(),
};

Object.assign(navigator, {
  clipboard: mockClipboard,
});

describe('useWebsiteExport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  describe('exportSteps', () => {
    it('should export steps to website shortcode format', () => {
      const { result } = renderHook(() => useWebsiteExport());

      const steps: RecordedStep[] = [
        {
          action: 'button',
          selector: 'button[data-testid="save"]',
          description: 'Click save',
          isUnique: true,
        },
      ];

      const output = result.current.exportSteps(steps);

      expect(output).toContain('{{< sequence');
      expect(output).toContain('{{< button');
      expect(output).toContain('reftarget="button[data-testid=\\"save\\"]"');
      expect(output).toContain('Click save');
    });

    it('should accept export options', () => {
      const { result } = renderHook(() => useWebsiteExport());

      const steps: RecordedStep[] = [
        {
          action: 'highlight',
          selector: 'div.panel',
          description: 'Highlight panel',
          isUnique: true,
        },
      ];

      const output = result.current.exportSteps(steps, {
        wrapInSequence: false,
        includeComments: false,
      });

      expect(output).not.toContain('{{< sequence');
      expect(output).toContain('{{< highlight');
    });
  });

  describe('exportSingleStep', () => {
    it('should export a single step to website shortcode', () => {
      const { result } = renderHook(() => useWebsiteExport());

      const output = result.current.exportSingleStep('formfill', 'input[name="query"]', 'prometheus', 'Enter query');

      expect(output).toContain('{{< formfill');
      expect(output).toContain('reftarget="input[name=\\"query\\"]"');
      expect(output).toContain('targetvalue="prometheus"');
      expect(output).toContain('Enter query');
    });
  });

  describe('copyForWebsite', () => {
    it('should copy steps to clipboard', async () => {
      mockClipboard.writeText.mockResolvedValue(undefined);
      const { result } = renderHook(() => useWebsiteExport());

      const steps: RecordedStep[] = [
        {
          action: 'button',
          selector: 'button[data-testid="save"]',
          description: 'Click save',
          isUnique: true,
        },
      ];

      let success = false;
      await act(async () => {
        success = await result.current.copyForWebsite(steps);
      });

      expect(success).toBe(true);
      expect(mockClipboard.writeText).toHaveBeenCalledTimes(1);
      expect(result.current.copied).toBe(true);

      await act(async () => {
        jest.advanceTimersByTime(2000);
      });

      expect(result.current.copied).toBe(false);
    });

    it('should return false on clipboard failure', async () => {
      mockClipboard.writeText.mockRejectedValue(new Error('Clipboard error'));
      const { result } = renderHook(() => useWebsiteExport());

      const steps: RecordedStep[] = [
        {
          action: 'button',
          selector: 'button[data-testid="save"]',
          description: 'Click save',
          isUnique: true,
        },
      ];

      let success = true;
      await act(async () => {
        success = await result.current.copyForWebsite(steps);
      });

      expect(success).toBe(false);
      expect(result.current.copied).toBe(false);
    });
  });

  describe('copySingleForWebsite', () => {
    it('should copy a single step to clipboard', async () => {
      mockClipboard.writeText.mockResolvedValue(undefined);
      const { result } = renderHook(() => useWebsiteExport());

      let success = false;
      await act(async () => {
        success = await result.current.copySingleForWebsite('highlight', 'div.panel', undefined, 'Highlight the panel');
      });

      expect(success).toBe(true);
      expect(mockClipboard.writeText).toHaveBeenCalledTimes(1);
      expect(result.current.copied).toBe(true);

      await act(async () => {
        jest.advanceTimersByTime(2000);
      });

      expect(result.current.copied).toBe(false);
    });

    it('should handle clipboard errors gracefully', async () => {
      mockClipboard.writeText.mockRejectedValue(new Error('Clipboard error'));
      const { result } = renderHook(() => useWebsiteExport());

      let success = true;
      await act(async () => {
        success = await result.current.copySingleForWebsite('button', 'button[id="test"]');
      });

      expect(success).toBe(false);
      expect(result.current.copied).toBe(false);
    });
  });

  describe('copied state management', () => {
    it('should reset copied state after timeout', async () => {
      mockClipboard.writeText.mockResolvedValue(undefined);
      const { result } = renderHook(() => useWebsiteExport());

      const steps: RecordedStep[] = [
        {
          action: 'button',
          selector: 'button[data-testid="save"]',
          description: 'Click save',
          isUnique: true,
        },
      ];

      await act(async () => {
        await result.current.copyForWebsite(steps);
      });

      expect(result.current.copied).toBe(true);

      await act(async () => {
        jest.advanceTimersByTime(2000);
      });

      expect(result.current.copied).toBe(false);
    });
  });
});
