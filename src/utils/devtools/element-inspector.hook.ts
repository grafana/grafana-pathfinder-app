/**
 * Hook for inspecting elements on hover (Inspector Mode)
 * Shows element highlights and DOM paths during watch/record mode
 */

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { createHoverHighlight, updateHoverHighlight, removeHoverHighlight } from './hover-highlight.util';

export interface UseElementInspectorOptions {
  isActive: boolean;
  excludeSelectors?: string[];
  onHover?: (element: HTMLElement, domPath: string) => void;
}

export interface UseElementInspectorReturn {
  hoveredElement: HTMLElement | null;
  domPath: string | null;
  cursorPosition: { x: number; y: number } | null;
}

/**
 * Generate full DOM path from body to element
 * Includes all classes (including runtime-generated), IDs, and attributes
 *
 * @param element - The element to generate path for
 * @returns Full DOM path string (e.g., "body > div.css-abc123 > button[data-testid='save']")
 */
export function generateFullDomPath(element: HTMLElement): string {
  const path: string[] = [];
  let current: HTMLElement | null = element;

  while (current && current !== document.body.parentElement) {
    let selector = current.tagName.toLowerCase();

    // Add ID if present
    if (current.id) {
      selector += `#${current.id}`;
    }

    // Add all classes (including runtime-generated ones)
    if (current.className && typeof current.className === 'string') {
      const classes = current.className
        .split(/\s+/)
        .filter(Boolean)
        .map((cls) => `.${cls}`)
        .join('');
      selector += classes;
    }

    // Add key data attributes for context
    const dataAttrs: string[] = [];
    Array.from(current.attributes).forEach((attr) => {
      if (
        attr.name.startsWith('data-testid') ||
        attr.name.startsWith('data-cy') ||
        attr.name.startsWith('data-test-id') ||
        attr.name === 'aria-label' ||
        attr.name === 'role' ||
        attr.name === 'type' ||
        attr.name === 'name'
      ) {
        dataAttrs.push(`[${attr.name}="${attr.value}"]`);
      }
    });
    selector += dataAttrs.join('');

    path.unshift(selector);

    current = current.parentElement;
  }

  return path.join(' > ');
}

/**
 * Hook for inspecting elements on hover
 * Highlights hovered element and generates DOM path
 *
 * @param options - Configuration options
 * @returns Hovered element info and cursor position
 *
 * @example
 * ```typescript
 * const { hoveredElement, domPath, cursorPosition } = useElementInspector({
 *   isActive: true,
 *   excludeSelectors: ['.debug-panel'],
 *   onHover: (element, path) => console.log('Hovering:', path)
 * });
 * ```
 */
export function useElementInspector(options: UseElementInspectorOptions): UseElementInspectorReturn {
  const { isActive, excludeSelectors = [], onHover } = options;

  const [hoveredElement, setHoveredElement] = useState<HTMLElement | null>(null);
  const [domPath, setDomPath] = useState<string | null>(null);
  const [cursorPosition, setCursorPosition] = useState<{ x: number; y: number } | null>(null);

  const highlightRef = useRef<HTMLElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastElementRef = useRef<HTMLElement | null>(null);
  const lastCursorPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Cleanup function
  const cleanup = useCallback(() => {
    if (highlightRef.current) {
      removeHoverHighlight(highlightRef.current);
      highlightRef.current = null;
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setHoveredElement(null);
    setDomPath(null);
    setCursorPosition(null);
    lastElementRef.current = null;
    lastCursorPosRef.current = { x: 0, y: 0 };
  }, []);

  useEffect(() => {
    if (!isActive) {
      cleanup();
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      // Cancel previous RAF if still pending
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }

      // Use RAF for smooth updates
      rafRef.current = requestAnimationFrame(() => {
        const x = event.clientX;
        const y = event.clientY;

        // Temporarily hide the highlight to get the element underneath
        // (elementFromPoint doesn't respect pointer-events: none)
        let wasHighlightVisible = false;
        if (highlightRef.current) {
          wasHighlightVisible = highlightRef.current.style.display !== 'none';
          highlightRef.current.style.display = 'none';
        }

        // Get element under cursor
        const element = document.elementFromPoint(x, y);

        // Restore highlight visibility
        if (highlightRef.current && wasHighlightVisible) {
          highlightRef.current.style.display = '';
        }

        if (!(element instanceof HTMLElement)) {
          cleanup();
          return;
        }

        // Skip if element is our own tooltip/highlight (keep current state)
        if (element.id === 'dev-tools-hover-highlight' || element.closest('[data-inspector-tooltip]') !== null) {
          // Don't cleanup, just skip this frame
          return;
        }

        // Check if element should be excluded from user's excludeSelectors
        const shouldExclude = excludeSelectors.some((selector) => {
          try {
            return element.closest(selector);
          } catch {
            return false;
          }
        });

        if (shouldExclude) {
          cleanup();
          return;
        }

        // If same element as before, just update highlight position and cursor
        if (element === lastElementRef.current && highlightRef.current) {
          updateHoverHighlight(highlightRef.current, element);
          // Update cursor position for tooltip movement (throttle by distance)
          const distanceMoved = Math.abs(x - lastCursorPosRef.current.x) + Math.abs(y - lastCursorPosRef.current.y);
          if (distanceMoved > 5) {
            // Only update if moved more than 5px
            lastCursorPosRef.current = { x, y };
            setCursorPosition({ x, y });
          }
          return;
        }

        // New element - generate DOM path and create/update highlight
        lastElementRef.current = element;
        lastCursorPosRef.current = { x, y };
        const path = generateFullDomPath(element);

        setHoveredElement(element);
        setDomPath(path);
        setCursorPosition({ x, y });

        // Create or update highlight
        if (highlightRef.current) {
          updateHoverHighlight(highlightRef.current, element);
        } else {
          highlightRef.current = createHoverHighlight(element);
        }

        // Call onHover callback
        if (onHover) {
          onHover(element, path);
        }
      });
    };

    // Add mousemove listener
    document.addEventListener('mousemove', handleMouseMove, { passive: true });

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      cleanup();
    };
  }, [isActive, excludeSelectors, onHover]); // Don't include cleanup - it's stable and causes re-render loop

  // Memoize return value to prevent causing re-renders in parent
  return useMemo(
    () => ({
      hoveredElement,
      domPath,
      cursorPosition,
    }),
    [hoveredElement, domPath, cursorPosition]
  );
}

