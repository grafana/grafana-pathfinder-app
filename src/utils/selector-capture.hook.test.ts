import { renderHook, act, cleanup } from '@testing-library/react';
import { useSelectorCapture } from './selector-capture.hook';
import { generateSelectorFromEvent } from './selector-generator.util';

// Mock the selector generator utility
jest.mock('./selector-generator.util', () => ({
  generateSelectorFromEvent: jest.fn(),
}));

describe('useSelectorCapture', () => {
  let mockElement: HTMLElement;

  beforeEach(() => {
    mockElement = document.createElement('button');
    mockElement.setAttribute('data-testid', 'test-button');
    mockElement.textContent = 'Test Button';
    document.body.appendChild(mockElement);

    jest.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  it('should initialize with inactive state', () => {
    const { result } = renderHook(() => useSelectorCapture());

    expect(result.current.isActive).toBe(false);
    expect(result.current.capturedSelector).toBe(null);
    expect(result.current.selectorInfo).toBe(null);
  });

  it('should start capture mode', () => {
    const { result } = renderHook(() => useSelectorCapture());

    act(() => {
      result.current.startCapture();
    });

    expect(result.current.isActive).toBe(true);
  });

  it('should stop capture mode', () => {
    const { result } = renderHook(() => useSelectorCapture());

    act(() => {
      result.current.startCapture();
      result.current.stopCapture();
    });

    expect(result.current.isActive).toBe(false);
    expect(result.current.capturedSelector).toBe(null);
    expect(result.current.selectorInfo).toBe(null);
  });

  it('should capture selector on click when active', () => {
    (generateSelectorFromEvent as jest.Mock).mockReturnValue({
      selector: 'button[data-testid="test-button"]',
      action: 'highlight',
      selectorInfo: {
        method: 'data-testid',
        isUnique: true,
        matchCount: 1,
        contextStrategy: undefined,
      },
      warnings: [],
    });

    const { result } = renderHook(() => useSelectorCapture());

    act(() => {
      result.current.startCapture();
    });

    act(() => {
      mockElement.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(result.current.capturedSelector).toBe('button[data-testid="test-button"]');
    expect(result.current.selectorInfo).toEqual({
      method: 'data-testid',
      isUnique: true,
      matchCount: 1,
      contextStrategy: undefined,
    });
  });

  it('should call onCapture callback when provided', () => {
    const onCapture = jest.fn();
    (generateSelectorFromEvent as jest.Mock).mockReturnValue({
      selector: 'button[data-testid="test-button"]',
      action: 'highlight',
      selectorInfo: {
        method: 'data-testid',
        isUnique: true,
        matchCount: 1,
      },
      warnings: [],
    });

    const { result } = renderHook(() =>
      useSelectorCapture({
        onCapture,
      })
    );

    act(() => {
      result.current.startCapture();
    });

    act(() => {
      mockElement.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(onCapture).toHaveBeenCalledWith('button[data-testid="test-button"]', {
      method: 'data-testid',
      isUnique: true,
      matchCount: 1,
    });
  });

  it('should auto-disable after capture when autoDisable is true', () => {
    (generateSelectorFromEvent as jest.Mock).mockReturnValue({
      selector: 'button[data-testid="test-button"]',
      action: 'highlight',
      selectorInfo: {
        method: 'data-testid',
        isUnique: true,
        matchCount: 1,
      },
      warnings: [],
    });

    const { result } = renderHook(() =>
      useSelectorCapture({
        autoDisable: true,
      })
    );

    act(() => {
      result.current.startCapture();
    });

    expect(result.current.isActive).toBe(true);

    act(() => {
      mockElement.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(result.current.isActive).toBe(false);
  });

  it('should not auto-disable when autoDisable is false', () => {
    (generateSelectorFromEvent as jest.Mock).mockReturnValue({
      selector: 'button[data-testid="test-button"]',
      action: 'highlight',
      selectorInfo: {
        method: 'data-testid',
        isUnique: true,
        matchCount: 1,
      },
      warnings: [],
    });

    const { result } = renderHook(() =>
      useSelectorCapture({
        autoDisable: false,
      })
    );

    act(() => {
      result.current.startCapture();
    });

    act(() => {
      mockElement.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(result.current.isActive).toBe(true);
  });

  it('should exclude clicks within excluded selectors', () => {
    const excludedElement = document.createElement('div');
    excludedElement.className = 'excluded-container';
    excludedElement.appendChild(mockElement);
    document.body.appendChild(excludedElement);

    const { result } = renderHook(() =>
      useSelectorCapture({
        excludeSelectors: ['.excluded-container'],
      })
    );

    act(() => {
      result.current.startCapture();
    });

    act(() => {
      mockElement.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(result.current.capturedSelector).toBe(null);
  });

  it('should log warnings when validation produces warnings', () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    (generateSelectorFromEvent as jest.Mock).mockReturnValue({
      selector: 'button[data-testid="test-button"]',
      action: 'highlight',
      selectorInfo: {
        method: 'data-testid',
        isUnique: true,
        matchCount: 1,
      },
      warnings: ['Removed auto-generated class'],
    });

    const { result } = renderHook(() => useSelectorCapture());

    act(() => {
      result.current.startCapture();
    });

    act(() => {
      mockElement.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(consoleWarnSpy).toHaveBeenCalledWith('Watch mode selector validation warnings:', [
      'Removed auto-generated class',
    ]);

    consoleWarnSpy.mockRestore();
  });

  it('should reset captured selector when starting new capture after stopping', () => {
    (generateSelectorFromEvent as jest.Mock).mockReturnValue({
      selector: 'button[data-testid="test-button"]',
      action: 'highlight',
      selectorInfo: {
        method: 'data-testid',
        isUnique: true,
        matchCount: 1,
      },
      warnings: [],
    });

    const { result } = renderHook(() => useSelectorCapture());

    // First capture
    act(() => {
      result.current.startCapture();
    });

    act(() => {
      mockElement.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(result.current.capturedSelector).toBe('button[data-testid="test-button"]');

    // Stop capture
    act(() => {
      result.current.stopCapture();
    });

    expect(result.current.capturedSelector).toBe(null);
    expect(result.current.isActive).toBe(false);

    // Start new capture - should reset state
    act(() => {
      result.current.startCapture();
    });

    expect(result.current.capturedSelector).toBe(null);
    expect(result.current.selectorInfo).toBe(null);
    expect(result.current.isActive).toBe(true);
  });
});
