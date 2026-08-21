/**
 * useTabOverflow hook - Manages tab bar overflow behavior
 *
 * This hook handles:
 * - Tab visibility calculation based on container width
 * - Dropdown state management for overflowed tabs
 * - ResizeObserver for dynamic container width tracking
 * - Click-outside handling for dropdown
 * - Dropdown positioning to prevent viewport clipping
 *
 * @param tabs - All tabs to manage
 * @param activeTabId - Currently active tab ID
 * @returns Tab overflow state and refs
 */

import { useState, useRef, useEffect, useMemo } from 'react';
import { LearningJourneyTab } from '../../../types/content-panel.types';
import { computeTabVisibility } from '../utils';

export interface UseTabOverflowResult {
  tabBarRef: React.RefObject<HTMLDivElement>;
  tabListRef: React.RefObject<HTMLDivElement>;
  visibleTabs: LearningJourneyTab[];
  overflowedTabs: LearningJourneyTab[];
  isDropdownOpen: boolean;
  setIsDropdownOpen: React.Dispatch<React.SetStateAction<boolean>>;
  dropdownRef: React.RefObject<HTMLDivElement>;
  chevronButtonRef: React.RefObject<HTMLButtonElement>;
  dropdownOpenTimeRef: React.MutableRefObject<number>;
}

export function useTabOverflow(tabs: LearningJourneyTab[], activeTabId: string): UseTabOverflowResult {
  // Refs for DOM elements
  const tabBarRef = useRef<HTMLDivElement>(null); // Container to measure
  const tabListRef = useRef<HTMLDivElement>(null);
  const chevronButtonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const dropdownOpenTimeRef = useRef<number>(0);

  // State
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [containerWidth, setContainerWidth] = useState<number>(0);

  // Derive visible/overflowed tabs from container width (use useMemo to avoid cascading renders)
  const { visibleTabs, overflowedTabs } = useMemo(() => {
    return computeTabVisibility(tabs, containerWidth, activeTabId);
  }, [tabs, containerWidth, activeTabId]);

  // ResizeObserver to track container width changes
  // Re-run when tabs.length changes to handle tab bar appearing/disappearing
  useEffect(() => {
    const tabBar = tabBarRef.current;
    if (!tabBar) {
      return;
    }

    // Measure tabBar and reserve space for chevron button
    const chevronWidth = 120; // Approximate width of chevron button + spacing

    // Set initial width immediately (ResizeObserver may not fire on initial mount)
    const tabBarWidth = tabBar.getBoundingClientRect().width;
    const availableForTabs = Math.max(0, tabBarWidth - chevronWidth);
    if (availableForTabs > 0) {
      setContainerWidth(availableForTabs);
    }

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const tabBarWidth = entry.contentRect.width;
        const availableForTabs = Math.max(0, tabBarWidth - chevronWidth);
        setContainerWidth(availableForTabs);
      }
    });

    resizeObserver.observe(tabBar);

    return () => {
      resizeObserver.disconnect();
    };
  }, [tabs.length]);

  // Close dropdown when clicking outside and handle positioning
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        chevronButtonRef.current &&
        !chevronButtonRef.current.contains(event.target as Node)
      ) {
        setIsDropdownOpen(false);
      }
    };

    // Position dropdown to prevent clipping
    const positionDropdown = () => {
      if (isDropdownOpen && dropdownRef.current && chevronButtonRef.current) {
        const dropdown = dropdownRef.current;
        const chevronButton = chevronButtonRef.current;

        // Reset position attributes
        dropdown.removeAttribute('data-position');

        // Get chevron button position
        const chevronRect = chevronButton.getBoundingClientRect();
        const dropdownWidth = Math.min(320, Math.max(220, dropdown.offsetWidth)); // Use CSS min/max values

        // Check if dropdown extends beyond right edge of viewport
        if (chevronRect.right - dropdownWidth < 20) {
          // Not enough space on right, position from left
          dropdown.setAttribute('data-position', 'left');
        }
      }
    };

    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      // Position dropdown after it's rendered
      setTimeout(positionDropdown, 0);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }

    // Return undefined for the else case
    return undefined;
  }, [isDropdownOpen]);

  return {
    tabBarRef,
    tabListRef,
    visibleTabs,
    overflowedTabs,
    isDropdownOpen,
    setIsDropdownOpen,
    dropdownRef,
    chevronButtonRef,
    dropdownOpenTimeRef,
  };
}
