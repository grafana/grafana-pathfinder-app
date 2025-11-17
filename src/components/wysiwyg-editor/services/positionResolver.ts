/**
 * Position Resolution Service
 * Handles complex position resolution logic for interactive element clicks
 * Provides multiple fallback strategies to reliably find element positions
 */

import type { EditorView } from '@tiptap/pm/view';
import type { InteractiveElementType } from '../types';
import { error as logError } from '../utils/logger';
import { determineInteractiveElementType } from '../extensions/shared/clickHandlerHelpers';

/**
 * Result of position resolution
 */
export interface PositionResolutionResult {
  success: boolean;
  position: number | null;
  error?: string;
}

/**
 * Resolve the position of an interactive element in the editor document
 * Uses multiple fallback strategies to reliably find the position
 *
 * @param view - ProseMirror editor view
 * @param element - DOM element that was clicked
 * @param elementType - Type of interactive element (optional, will be determined if not provided)
 * @returns Position resolution result with position or error
 */
export function resolveElementPosition(
  view: EditorView,
  element: HTMLElement,
  elementType?: InteractiveElementType
): PositionResolutionResult {
  // Determine element type if not provided
  if (!elementType) {
    const elementTypeResult = determineInteractiveElementType(element);
    if (!elementTypeResult || !elementTypeResult.type) {
      return {
        success: false,
        position: null,
        error: 'Could not determine element type',
      };
    }
    elementType = elementTypeResult.type;
  }

  let pos: number | null | undefined = null;

  // Strategy 1: Try getting position from the element directly
  pos = view.posAtDOM(element, 0);

  // Strategy 2: If that fails, try with the first child (content wrapper)
  if (pos === null || pos === undefined || pos < 0) {
    const contentWrapper = element.querySelector('[style*="display"]');
    if (contentWrapper) {
      pos = view.posAtDOM(contentWrapper as HTMLElement, 0);
    }
  }

  // Strategy 3: Try finding the node by walking the document
  if (pos === null || pos === undefined || pos < 0) {
    let foundPos: number | null = null;
    view.state.doc.descendants((node, position) => {
      const domNode = view.nodeDOM(position);
      if (domNode === element) {
        foundPos = position;
        return false; // stop iteration
      }
      return true; // continue iteration
    });
    if (foundPos !== null) {
      pos = foundPos;
    }
  }

  // Strategy 4: For sequence sections, try finding by comparing attributes
  if ((pos === null || pos === undefined || pos < 0) && elementType === 'sequence') {
    const elementId = element.getAttribute('id');
    const elementAction = element.getAttribute('data-targetaction');

    view.state.doc.descendants((node, position) => {
      if (node.type.name === 'sequenceSection') {
        const nodeId = node.attrs.id;
        const nodeAction = node.attrs['data-targetaction'];
        if ((nodeId && nodeId === elementId) || (nodeAction === elementAction && nodeAction === 'sequence')) {
          pos = position;
          return false;
        }
      }
      return true; // continue iteration
    });
  }

  if (pos === null || pos === undefined || pos < 0) {
    logError(
      '[positionResolver] Could not determine valid position for element. All position resolution strategies failed.'
    );
    return {
      success: false,
      position: null,
      error: 'All position resolution strategies failed',
    };
  }

  return {
    success: true,
    position: pos,
  };
}
