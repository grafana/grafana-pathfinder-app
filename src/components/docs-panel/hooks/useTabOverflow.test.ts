/**
 * Unit tests for useTabOverflow hook
 */

import { renderHook, act } from '@testing-library/react';
import { useTabOverflow } from './useTabOverflow';
import { LearningJourneyTab } from '../../../types/content-panel.types';
import * as utils from '../utils';

// Mock computeTabVisibility
jest.mock('../utils', () => ({
  computeTabVisibility: jest.fn(),
}));

// Mock ResizeObserver
const mockObserve = jest.fn();
const mockDisconnect = jest.fn();
const mockUnobserve = jest.fn();

class MockResizeObserver {
  observe = mockObserve;
  disconnect = mockDisconnect;
  unobserve = mockUnobserve;
}

global.ResizeObserver = MockResizeObserver as any;

describe('useTabOverflow', () => {
  const mockTabs: LearningJourneyTab[] = [
    {
      id: 'recommendations',
      title: 'Recommendations',
      baseUrl: '',
      currentUrl: '',
      content: null,
      isLoading: false,
      error: null,
    },
    {
      id: 'tab-1',
      title: 'Tab 1',
      baseUrl: 'https://example.com/1',
      currentUrl: 'https://example.com/1',
      content: null,
      isLoading: false,
      error: null,
      type: 'learning-journey',
    },
    {
      id: 'tab-2',
      title: 'Tab 2',
      baseUrl: 'https://example.com/2',
      currentUrl: 'https://example.com/2',
      content: null,
      isLoading: false,
      error: null,
      type: 'docs',
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    mockObserve.mockClear();
    mockDisconnect.mockClear();
    mockUnobserve.mockClear();
    (utils.computeTabVisibility as jest.Mock).mockReturnValue({
      visibleTabs: mockTabs,
      overflowedTabs: [],
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns initial state with all refs', () => {
    const { result } = renderHook(() => useTabOverflow(mockTabs, 'tab-1'));

    expect(result.current.tabBarRef).toBeDefined();
    expect(result.current.tabBarRef.current).toBeNull();
    expect(result.current.tabListRef).toBeDefined();
    expect(result.current.chevronButtonRef).toBeDefined();
    expect(result.current.dropdownRef).toBeDefined();
    expect(result.current.dropdownOpenTimeRef).toBeDefined();
    expect(result.current.dropdownOpenTimeRef.current).toBe(0);
  });

  it('returns initial visible and overflowed tabs', () => {
    const { result } = renderHook(() => useTabOverflow(mockTabs, 'tab-1'));

    expect(result.current.visibleTabs).toEqual(mockTabs);
    expect(result.current.overflowedTabs).toEqual([]);
    expect(result.current.isDropdownOpen).toBe(false);
  });

  it('calls computeTabVisibility when tabs or activeTabId changes', () => {
    const { rerender } = renderHook(({ tabs, activeTabId }) => useTabOverflow(tabs, activeTabId), {
      initialProps: { tabs: mockTabs, activeTabId: 'tab-1' },
    });

    // Initial call
    expect(utils.computeTabVisibility).toHaveBeenCalledWith(mockTabs, 0, 'tab-1');

    // Change active tab
    rerender({ tabs: mockTabs, activeTabId: 'tab-2' });

    expect(utils.computeTabVisibility).toHaveBeenCalledWith(mockTabs, 0, 'tab-2');
  });

  it('updates visible and overflowed tabs when computeTabVisibility returns new values', () => {
    const visibleTabs = [mockTabs[0], mockTabs[1]];
    const overflowedTabs = [mockTabs[2]];

    (utils.computeTabVisibility as jest.Mock).mockReturnValue({
      visibleTabs,
      overflowedTabs,
    });

    const { result } = renderHook(() => useTabOverflow(mockTabs, 'tab-1'));

    expect(result.current.visibleTabs).toEqual(visibleTabs);
    expect(result.current.overflowedTabs).toEqual(overflowedTabs);
  });

  it('allows toggling dropdown open state', () => {
    const { result } = renderHook(() => useTabOverflow(mockTabs, 'tab-1'));

    expect(result.current.isDropdownOpen).toBe(false);

    act(() => {
      result.current.setIsDropdownOpen(true);
    });

    expect(result.current.isDropdownOpen).toBe(true);

    act(() => {
      result.current.setIsDropdownOpen(false);
    });

    expect(result.current.isDropdownOpen).toBe(false);
  });

  it('provides a tabBarRef for DOM attachment', () => {
    const { result } = renderHook(() => useTabOverflow(mockTabs, 'tab-1'));

    // Ref should exist and be usable for attaching to DOM elements
    expect(result.current.tabBarRef).toBeDefined();
    expect(result.current.tabBarRef.current).toBeNull(); // Not attached yet
  });

  it('provides all necessary refs for overflow management', () => {
    const { result } = renderHook(() => useTabOverflow(mockTabs, 'tab-1'));

    // All refs should be available
    expect(result.current.tabBarRef).toBeDefined();
    expect(result.current.tabListRef).toBeDefined();
    expect(result.current.chevronButtonRef).toBeDefined();
    expect(result.current.dropdownRef).toBeDefined();
    expect(result.current.dropdownOpenTimeRef).toBeDefined();
  });

  it('sets up click-outside listener when dropdown is open', () => {
    const addEventListenerSpy = jest.spyOn(document, 'addEventListener');
    const removeEventListenerSpy = jest.spyOn(document, 'removeEventListener');

    const { result } = renderHook(() => useTabOverflow(mockTabs, 'tab-1'));

    // Open dropdown
    act(() => {
      result.current.setIsDropdownOpen(true);
    });

    expect(addEventListenerSpy).toHaveBeenCalledWith('mousedown', expect.any(Function));

    // Close dropdown
    act(() => {
      result.current.setIsDropdownOpen(false);
    });

    expect(removeEventListenerSpy).toHaveBeenCalledWith('mousedown', expect.any(Function));
  });

  it('closes dropdown when clicking outside', () => {
    const { result } = renderHook(() => useTabOverflow(mockTabs, 'tab-1'));

    // Mock dropdown and chevron button elements
    const mockDropdown = document.createElement('div');
    const mockChevronButton = document.createElement('button');

    // Attach mocked elements to refs
    act(() => {
      Object.defineProperty(result.current.dropdownRef, 'current', {
        writable: true,
        value: mockDropdown,
      });
      Object.defineProperty(result.current.chevronButtonRef, 'current', {
        writable: true,
        value: mockChevronButton,
      });
    });

    // Open dropdown
    act(() => {
      result.current.setIsDropdownOpen(true);
    });

    expect(result.current.isDropdownOpen).toBe(true);

    // Simulate click outside (not on dropdown or chevron)
    act(() => {
      const event = new MouseEvent('mousedown', { bubbles: true });
      document.dispatchEvent(event);
    });

    expect(result.current.isDropdownOpen).toBe(false);
  });

  it('updates visible/overflowed tabs when tabs change', () => {
    const { rerender } = renderHook(({ tabs, activeTabId }) => useTabOverflow(tabs, activeTabId), {
      initialProps: { tabs: mockTabs, activeTabId: 'tab-1' },
    });

    // Mock overflow scenario
    const visibleTabs = [mockTabs[0], mockTabs[1]];
    const overflowedTabs = [mockTabs[2]];

    (utils.computeTabVisibility as jest.Mock).mockReturnValue({
      visibleTabs,
      overflowedTabs,
    });

    // Add a tab
    const newTabs = [
      ...mockTabs,
      {
        id: 'tab-3',
        title: 'Tab 3',
        baseUrl: 'https://example.com/3',
        currentUrl: 'https://example.com/3',
        content: null,
        isLoading: false,
        error: null,
        type: 'docs' as const,
      },
    ];

    rerender({ tabs: newTabs, activeTabId: 'tab-1' });

    // computeTabVisibility should have been called with new tabs
    expect(utils.computeTabVisibility).toHaveBeenCalledWith(newTabs, 0, 'tab-1');
  });
});
