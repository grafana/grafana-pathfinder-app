/**
 * Helper functions for InteractiveClickHandler
 * Extracted from complex click handling logic for better maintainability
 */

import type { EditorView } from '@tiptap/pm/view';
import type { InteractiveElementType } from '../../types';
import { CSS_CLASSES, NODE_TYPES } from '../../../../constants/editor-config';
import { ACTION_TYPES } from '../../../../constants/interactive-config';
import { error as logError } from '../../utils/logger';

/**
 * Result of element type determination
 */
export interface ElementTypeResult {
  type: InteractiveElementType | null;
  element: HTMLElement;
}

/**
 * Result of attribute extraction
 */
export interface AttributeResult {
  attrs: Record<string, string>;
  pos: number;
}

/**
 * Determine the type of interactive element from a DOM element
 */
export function determineInteractiveElementType(element: HTMLElement): ElementTypeResult | null {
  // Check for interactive list item
  if (element.tagName === 'LI' && element.classList.contains(CSS_CLASSES.INTERACTIVE)) {
    return { type: 'listItem', element };
  }

  // Check for sequence section
  if (element.tagName === 'SPAN' && element.getAttribute('data-targetaction') === ACTION_TYPES.SEQUENCE) {
    return { type: 'sequence', element };
  }

  // Check for interactive span
  if (element.tagName === 'SPAN' && element.classList.contains(CSS_CLASSES.INTERACTIVE)) {
    return { type: 'span', element };
  }

  // Check for interactive comment
  if (element.tagName === 'SPAN' && element.classList.contains(CSS_CLASSES.INTERACTIVE_COMMENT)) {
    return { type: 'comment', element };
  }

  return null;
}

/**
 * Extract attributes from a DOM element
 */
export function extractElementAttributes(element: HTMLElement): Record<string, string> {
  const attrs: Record<string, string> = {};

  // Extract all relevant attributes
  const attrNames = ['class', 'id', 'data-targetaction', 'data-reftarget', 'data-requirements', 'data-doit'];

  attrNames.forEach((attrName) => {
    const value = element.getAttribute(attrName);
    if (value) {
      attrs[attrName] = value;
    }
  });

  return attrs;
}

/**
 * Find a node at a position in the editor
 * Used for inline nodes like interactive spans and comments
 */
export function findNodeAtPosition(view: EditorView, pos: number, nodeType: string): { node: any; pos: number } | null {
  let result: { node: any; pos: number } | null = null;

  view.state.doc.nodesBetween(pos, pos + 1, (node, nodePos) => {
    if (node.type.name === nodeType) {
      result = { node, pos: nodePos };
      return false; // stop iteration
    }
    return true; // continue iteration
  });

  return result;
}

/**
 * Handle click on interactive list item
 */
export function handleListItemClick(
  element: HTMLElement,
  pos: number,
  callback: (attrs: Record<string, string>, pos: number) => void
): boolean {
  const attrs = extractElementAttributes(element);
  callback(attrs, pos);
  return true;
}

/**
 * Handle click on sequence section
 */
export function handleSequenceSectionClick(
  element: HTMLElement,
  pos: number,
  callback: (attrs: Record<string, string>, pos: number) => void
): boolean {
  const attrs = extractElementAttributes(element);
  callback(attrs, pos);
  return true;
}

/**
 * Handle click on interactive span
 */
export function handleInteractiveSpanClick(
  view: EditorView,
  pos: number,
  callback: (attrs: Record<string, string>, pos: number) => void
): boolean {
  const nodeInfo = findNodeAtPosition(view, pos, NODE_TYPES.INTERACTIVE_SPAN);
  if (nodeInfo) {
    callback(nodeInfo.node.attrs, nodeInfo.pos);
    return true;
  }
  logError('[handleInteractiveSpanClick] Could not find node at position:', pos);
  return false;
}

/**
 * Extract text content from a TipTap node
 * Recursively extracts all text nodes from the node's content
 */
export function extractTextFromNode(node: any): string {
  let text = '';

  if (node.content) {
    node.content.forEach((child: any) => {
      if (child.type.name === 'text') {
        text += child.text || '';
      } else if (child.content) {
        // Recursively extract from nested nodes
        text += extractTextFromNode(child);
      }
    });
  }

  return text.trim();
}

/**
 * Handle click on interactive comment
 */
export function handleInteractiveCommentClick(
  view: EditorView,
  pos: number,
  callback: (attrs: Record<string, string>, pos: number, text?: string) => void
): boolean {
  const nodeInfo = findNodeAtPosition(view, pos, NODE_TYPES.INTERACTIVE_COMMENT);
  if (nodeInfo) {
    // Extract text content from the comment node
    const commentText = extractTextFromNode(nodeInfo.node);
    callback(nodeInfo.node.attrs, nodeInfo.pos, commentText);
    return true;
  }
  logError('[handleInteractiveCommentClick] Could not find node at position:', pos);
  return false;
}
