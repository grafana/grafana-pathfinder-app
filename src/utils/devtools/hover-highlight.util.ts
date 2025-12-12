/**
 * Utilities for managing hover highlights during element inspection
 */

const HOVER_HIGHLIGHT_CLASS = 'interactive-hover-highlight-outline';
const HOVER_HIGHLIGHT_ID = 'dev-tools-hover-highlight';

/**
 * Create a hover highlight overlay element
 * @param element - The element to highlight
 * @returns The highlight overlay element
 */
export function createHoverHighlight(element: HTMLElement): HTMLElement {
  // Check if highlight already exists, remove it
  const existing = document.getElementById(HOVER_HIGHLIGHT_ID);
  if (existing) {
    existing.remove();
  }

  const highlight = document.createElement('div');
  highlight.id = HOVER_HIGHLIGHT_ID;
  highlight.className = HOVER_HIGHLIGHT_CLASS;

  // Position the highlight
  updateHoverHighlight(highlight, element);

  // Add to body
  document.body.appendChild(highlight);

  return highlight;
}

/**
 * Update the position of an existing hover highlight
 * @param highlight - The highlight element to update
 * @param element - The element being highlighted
 */
export function updateHoverHighlight(highlight: HTMLElement, element: HTMLElement): void {
  const rect = element.getBoundingClientRect();
  const scrollTop = window.scrollY || document.documentElement.scrollTop;
  const scrollLeft = window.scrollX || document.documentElement.scrollLeft;

  // Set CSS custom properties for positioning
  highlight.style.setProperty('--highlight-top', `${rect.top + scrollTop}px`);
  highlight.style.setProperty('--highlight-left', `${rect.left + scrollLeft}px`);
  highlight.style.setProperty('--highlight-width', `${rect.width}px`);
  highlight.style.setProperty('--highlight-height', `${rect.height}px`);
}

/**
 * Remove the hover highlight from the DOM
 * @param highlight - The highlight element to remove (or null)
 */
export function removeHoverHighlight(highlight: HTMLElement | null): void {
  if (highlight && highlight.parentNode) {
    highlight.remove();
  }

  // Also check by ID in case reference was lost
  const existing = document.getElementById(HOVER_HIGHLIGHT_ID);
  if (existing) {
    existing.remove();
  }
}
