/**
 * Tests for useEditorActions hook
 */

import { renderHook, act, cleanup } from '@testing-library/react';
import { useEditorActions } from './useEditorActions';
import type { Editor } from '@tiptap/react';

// Mock dependencies
jest.mock('../services/editorToJson', () => ({
  convertEditorToJson: jest.fn((_editor, metadata) => ({
    guide: {
      id: metadata?.id || 'test-guide',
      title: metadata?.title || 'Test Guide',
      blocks: [{ type: 'markdown', content: '# Test' }],
    },
    warnings: [],
  })),
  formatJsonGuide: jest.fn((guide) => JSON.stringify(guide, null, 2)),
}));

jest.mock('../../../security', () => ({
  sanitizeDocumentationHTML: jest.fn((html: string) => html),
}));

jest.mock('../utils/logger', () => ({
  debug: jest.fn(),
  error: jest.fn(),
}));

describe('useEditorActions', () => {
  let mockEditor: Editor;
  let mockCreateObjectURL: jest.Mock;
  let mockRevokeObjectURL: jest.Mock;
  let mockAnchorElement: HTMLAnchorElement;
  let originalCreateObjectURL: typeof URL.createObjectURL;
  let originalRevokeObjectURL: typeof URL.revokeObjectURL;
  let originalAppendChild: typeof document.body.appendChild;
  let originalRemoveChild: typeof document.body.removeChild;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Store original methods
    originalCreateObjectURL = URL.createObjectURL;
    originalRevokeObjectURL = URL.revokeObjectURL;
    originalAppendChild = document.body.appendChild;
    originalRemoveChild = document.body.removeChild;

    // Create a real anchor element
    mockAnchorElement = document.createElement('a');
    mockAnchorElement.click = jest.fn();

    // Spy on appendChild and removeChild
    document.body.appendChild = jest.fn((node) => {
      return originalAppendChild.call(document.body, node);
    }) as typeof document.body.appendChild;

    document.body.removeChild = jest.fn((node) => {
      return originalRemoveChild.call(document.body, node);
    }) as typeof document.body.removeChild;

    // Mock URL methods
    mockCreateObjectURL = jest.fn(() => 'blob:mock-url');
    mockRevokeObjectURL = jest.fn();
    global.URL.createObjectURL = mockCreateObjectURL;
    global.URL.revokeObjectURL = mockRevokeObjectURL;

    // Mock navigator.clipboard
    Object.defineProperty(global.navigator, 'clipboard', {
      value: {
        writeText: jest.fn().mockResolvedValue(undefined),
      },
      writable: true,
      configurable: true,
    });

    // Mock localStorage
    Object.defineProperty(global, 'localStorage', {
      value: {
        getItem: jest.fn(),
        setItem: jest.fn(),
        removeItem: jest.fn(),
        clear: jest.fn(),
      },
      writable: true,
      configurable: true,
    });

    // Mock document.createElement to return our mock anchor for 'a' tags
    const originalCreateElement = document.createElement.bind(document);
    jest.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      if (tagName === 'a') {
        return mockAnchorElement;
      }
      return originalCreateElement(tagName);
    });

    // Mock editor with state for JSON conversion
    mockEditor = {
      getHTML: jest.fn(() => '<p>Test HTML</p>'),
      state: {
        doc: {
          forEach: jest.fn(),
        },
      },
      commands: {
        setContent: jest.fn(),
      },
    } as unknown as Editor;
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
    jest.restoreAllMocks();
    // Restore original methods
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    document.body.appendChild = originalAppendChild;
    document.body.removeChild = originalRemoveChild;
  });

  describe('export dialog state', () => {
    it('should start with dialog closed', () => {
      const { result } = renderHook(() => useEditorActions({ editor: mockEditor }));

      expect(result.current.isExportDialogOpen).toBe(false);
    });

    it('should open dialog in copy mode', () => {
      const { result } = renderHook(() => useEditorActions({ editor: mockEditor }));

      act(() => {
        result.current.openExportDialog('copy');
      });

      expect(result.current.isExportDialogOpen).toBe(true);
      expect(result.current.exportMode).toBe('copy');
    });

    it('should open dialog in download mode', () => {
      const { result } = renderHook(() => useEditorActions({ editor: mockEditor }));

      act(() => {
        result.current.openExportDialog('download');
      });

      expect(result.current.isExportDialogOpen).toBe(true);
      expect(result.current.exportMode).toBe('download');
    });

    it('should close dialog', () => {
      const { result } = renderHook(() => useEditorActions({ editor: mockEditor }));

      act(() => {
        result.current.openExportDialog('copy');
      });

      expect(result.current.isExportDialogOpen).toBe(true);

      act(() => {
        result.current.closeExportDialog();
      });

      expect(result.current.isExportDialogOpen).toBe(false);
    });
  });

  describe('performExport - copy mode', () => {
    it('should copy JSON to clipboard', async () => {
      const { result } = renderHook(() => useEditorActions({ editor: mockEditor }));

      act(() => {
        result.current.openExportDialog('copy');
      });

      await act(async () => {
        await result.current.performExport({ id: 'test', title: 'Test' });
      });

      expect(global.navigator.clipboard.writeText).toHaveBeenCalled();
    });

    it('should not copy if editor is null', async () => {
      const { result } = renderHook(() => useEditorActions({ editor: null }));

      act(() => {
        result.current.openExportDialog('copy');
      });

      await act(async () => {
        await result.current.performExport({ id: 'test', title: 'Test' });
      });

      expect(global.navigator.clipboard.writeText).not.toHaveBeenCalled();
    });
  });

  describe('performExport - download mode', () => {
    it('should open JSON in new tab', async () => {
      const windowOpenSpy = jest.spyOn(window, 'open').mockReturnValue({
        onload: null,
      } as Window);

      const { result } = renderHook(() => useEditorActions({ editor: mockEditor }));

      act(() => {
        result.current.openExportDialog('download');
      });

      await act(async () => {
        await result.current.performExport({ id: 'test-guide', title: 'Test Guide' });
      });

      // Verify blob URL was created
      expect(mockCreateObjectURL).toHaveBeenCalled();

      // Verify window.open was called with blob URL
      expect(windowOpenSpy).toHaveBeenCalledWith('blob:mock-url', '_blank');

      // Verify URL is revoked after window loads
      const mockWindow = windowOpenSpy.mock.results[0].value as Window & { onload: (() => void) | null };
      if (mockWindow.onload) {
        mockWindow.onload();
      }
      expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:mock-url');

      windowOpenSpy.mockRestore();
    });

    it('should revoke URL immediately if popup is blocked', async () => {
      const windowOpenSpy = jest.spyOn(window, 'open').mockReturnValue(null);

      const { result } = renderHook(() => useEditorActions({ editor: mockEditor }));

      act(() => {
        result.current.openExportDialog('download');
      });

      await act(async () => {
        await result.current.performExport({ id: 'test-guide', title: 'Test Guide' });
      });

      // Verify blob URL was created
      expect(mockCreateObjectURL).toHaveBeenCalled();

      // Verify window.open was attempted
      expect(windowOpenSpy).toHaveBeenCalledWith('blob:mock-url', '_blank');

      // Verify URL is revoked immediately when popup is blocked
      expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:mock-url');

      windowOpenSpy.mockRestore();
    });

    it('should not open tab if editor is null', async () => {
      const windowOpenSpy = jest.spyOn(window, 'open').mockReturnValue({
        onload: null,
      } as Window);

      const { result } = renderHook(() => useEditorActions({ editor: null }));

      act(() => {
        result.current.openExportDialog('download');
      });

      await act(async () => {
        await result.current.performExport({ id: 'test', title: 'Test' });
      });

      expect(mockCreateObjectURL).not.toHaveBeenCalled();
      expect(windowOpenSpy).not.toHaveBeenCalled();

      windowOpenSpy.mockRestore();
    });
  });

  describe('testGuide', () => {
    it('should convert to JSON, save to localStorage, and dispatch event', () => {
      const dispatchEventSpy = jest.spyOn(document, 'dispatchEvent').mockImplementation(() => true);
      const { result } = renderHook(() => useEditorActions({ editor: mockEditor }));

      act(() => {
        result.current.testGuide();
      });

      // Verify JSON was saved to localStorage
      expect(localStorage.setItem).toHaveBeenCalled();
      const savedContent = (localStorage.setItem as jest.Mock).mock.calls[0][1];
      const parsedContent = JSON.parse(savedContent);
      expect(parsedContent.id).toBe('wysiwyg-preview');
      expect(parsedContent.title).toBe('Preview: WYSIWYG Guide');
      expect(Array.isArray(parsedContent.blocks)).toBe(true);

      // Verify event was dispatched
      expect(dispatchEventSpy).toHaveBeenCalled();
      const event = dispatchEventSpy.mock.calls[0][0] as CustomEvent;
      expect(event.type).toBe('pathfinder-auto-open-docs');
      expect(event.detail.url).toBe('bundled:wysiwyg-preview');
      expect(event.detail.title).toBe('Preview: WYSIWYG Guide');

      dispatchEventSpy.mockRestore();
    });

    it('should not test if editor is null', () => {
      const dispatchEventSpy = jest.spyOn(document, 'dispatchEvent').mockImplementation(() => true);
      const { result } = renderHook(() => useEditorActions({ editor: null }));

      act(() => {
        result.current.testGuide();
      });

      expect(localStorage.setItem).not.toHaveBeenCalled();
      expect(dispatchEventSpy).not.toHaveBeenCalled();

      dispatchEventSpy.mockRestore();
    });
  });

  describe('resetGuide', () => {
    it('should reset editor content to default', () => {
      const mockSetContent = jest.fn();
      const mockCommands = {
        setContent: mockSetContent,
      };
      const editorWithCommands = {
        ...mockEditor,
        commands: mockCommands,
      } as unknown as Editor;

      const { result } = renderHook(() => useEditorActions({ editor: editorWithCommands }));

      act(() => {
        result.current.resetGuide();
      });

      expect(mockSetContent).toHaveBeenCalled();
      expect(localStorage.setItem).toHaveBeenCalled();
    });
  });
});
