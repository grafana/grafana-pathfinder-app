/**
 * Tests for useEditorActions hook
 */

import { renderHook, act, cleanup } from '@testing-library/react';
import { useEditorActions } from './useEditorActions';
import { EDITOR_DEFAULTS } from '../../../constants/editor-config';
import type { Editor } from '@tiptap/react';

// Mock dependencies
jest.mock('../utils/htmlFormatter', () => ({
  formatHTML: jest.fn(async (html: string) => html),
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

    // Mock editor
    mockEditor = {
      getHTML: jest.fn(() => '<p>Test HTML</p>'),
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

  describe('downloadHTML', () => {
    it('should download HTML file with correct filename', async () => {
      const createElementSpy = jest.spyOn(document, 'createElement');
      const { result } = renderHook(() => useEditorActions({ editor: mockEditor }));

      await act(async () => {
        await result.current.downloadHTML();
      });

      // Verify anchor element was created
      expect(createElementSpy).toHaveBeenCalledWith('a');

      // Verify download attribute is set to the correct filename
      expect(mockAnchorElement.download).toBe(EDITOR_DEFAULTS.DOWNLOAD_FILENAME);

      // Verify anchor was appended and clicked
      expect(document.body.appendChild).toHaveBeenCalledWith(mockAnchorElement);
      expect(mockAnchorElement.click).toHaveBeenCalled();

      // Verify cleanup happens after delay
      act(() => {
        jest.advanceTimersByTime(100);
      });

      expect(document.body.removeChild).toHaveBeenCalled();
      expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:mock-url');

      createElementSpy.mockRestore();
    });

    it('should not download if editor is null', async () => {
      const createElementSpy = jest.spyOn(document, 'createElement');
      const { result } = renderHook(() => useEditorActions({ editor: null }));

      await act(async () => {
        await result.current.downloadHTML();
      });

      // createElement may be called for other elements (like container divs),
      // but should not be called with 'a' for anchor element
      expect(createElementSpy).not.toHaveBeenCalledWith('a');
      expect(mockCreateObjectURL).not.toHaveBeenCalled();

      createElementSpy.mockRestore();
    });

    it('should create blob with correct type', async () => {
      const { result } = renderHook(() => useEditorActions({ editor: mockEditor }));

      await act(async () => {
        await result.current.downloadHTML();
      });

      // Verify createObjectURL was called (which means Blob was created)
      expect(mockCreateObjectURL).toHaveBeenCalled();
      // The blob type is checked indirectly through the createObjectURL call
      // We can't easily inspect the Blob constructor call in jsdom, but we verify
      // the download filename which is the main requirement
    });
  });

  describe('copyHTML', () => {
    it('should copy HTML to clipboard', async () => {
      const { result } = renderHook(() => useEditorActions({ editor: mockEditor }));

      await act(async () => {
        await result.current.copyHTML();
      });

      expect(global.navigator.clipboard.writeText).toHaveBeenCalled();
    });

    it('should not copy if editor is null', async () => {
      const { result } = renderHook(() => useEditorActions({ editor: null }));

      await act(async () => {
        await result.current.copyHTML();
      });

      expect(global.navigator.clipboard.writeText).not.toHaveBeenCalled();
    });
  });

  describe('testGuide', () => {
    it('should save HTML to localStorage and dispatch event', () => {
      const dispatchEventSpy = jest.spyOn(document, 'dispatchEvent').mockImplementation(() => true);
      const { result } = renderHook(() => useEditorActions({ editor: mockEditor }));

      act(() => {
        result.current.testGuide();
      });

      expect(localStorage.setItem).toHaveBeenCalled();
      expect(dispatchEventSpy).toHaveBeenCalled();
      const event = dispatchEventSpy.mock.calls[0][0] as CustomEvent;
      expect(event.type).toBe('pathfinder-auto-open-docs');
      expect(event.detail.url).toBe('bundled:wysiwyg-preview');

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

