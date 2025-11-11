/**
 * Attribute Builder Service
 * Centralizes logic for building interactive element attributes
 */

import type { InteractiveElementType, InteractiveAttributesOutput } from '../types';
import { CSS_CLASSES, NODE_TYPES } from '../../../constants/editor-config';

/**
 * Prepare attributes for HTML output, filtering out null/undefined values
 */
export function prepareHTMLAttributes(attributes: InteractiveAttributesOutput): Record<string, string> {
  const result: Record<string, string> = {};

  Object.entries(attributes).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') {
      result[key] = String(value);
    }
  });

  // Ensure class attribute is set
  if (!result.class) {
    result.class = CSS_CLASSES.INTERACTIVE;
  }

  return result;
}

/**
 * Build attributes for a specific element type
 */
export function buildInteractiveAttributes(
  elementType: InteractiveElementType,
  attributes: InteractiveAttributesOutput
): Record<string, string> {
  const baseAttrs = prepareHTMLAttributes(attributes);

  switch (elementType) {
    case 'listItem':
      return buildListItemAttributes(baseAttrs);

    case 'span':
      return buildSpanAttributes(baseAttrs);

    case 'comment':
      return buildCommentAttributes(baseAttrs);

    case 'sequence':
      return buildSequenceAttributes(baseAttrs);

    default:
      return baseAttrs;
  }
}

/**
 * Build attributes for interactive list items
 */
function buildListItemAttributes(attrs: Record<string, string>): Record<string, string> {
  return {
    class: attrs.class || CSS_CLASSES.INTERACTIVE,
    ...(attrs['data-targetaction'] && { 'data-targetaction': attrs['data-targetaction'] }),
    ...(attrs['data-reftarget'] && { 'data-reftarget': attrs['data-reftarget'] }),
    ...(attrs['data-requirements'] && { 'data-requirements': attrs['data-requirements'] }),
    ...(attrs['data-doit'] && { 'data-doit': attrs['data-doit'] }),
    ...(attrs.id && { id: attrs.id }),
  };
}

/**
 * Build attributes for interactive spans
 */
function buildSpanAttributes(attrs: Record<string, string>): Record<string, string> {
  return {
    class: attrs.class || CSS_CLASSES.INTERACTIVE,
    ...(attrs.id && { id: attrs.id }),
    ...(attrs['data-targetaction'] && { 'data-targetaction': attrs['data-targetaction'] }),
    ...(attrs['data-reftarget'] && { 'data-reftarget': attrs['data-reftarget'] }),
    ...(attrs['data-requirements'] && { 'data-requirements': attrs['data-requirements'] }),
  };
}

/**
 * Build attributes for interactive comments
 */
function buildCommentAttributes(attrs: Record<string, string>): Record<string, string> {
  return {
    class: attrs.class || CSS_CLASSES.INTERACTIVE_COMMENT,
  };
}

/**
 * Build attributes for sequence sections
 */
function buildSequenceAttributes(attrs: Record<string, string>): Record<string, string> {
  return {
    class: attrs.class || CSS_CLASSES.INTERACTIVE,
    ...(attrs.id && { id: attrs.id }),
    ...(attrs['data-targetaction'] && { 'data-targetaction': attrs['data-targetaction'] }),
    ...(attrs['data-reftarget'] && { 'data-reftarget': attrs['data-reftarget'] }),
    ...(attrs['data-requirements'] && { 'data-requirements': attrs['data-requirements'] }),
  };
}

/**
 * Get the Tiptap node type name for an element type
 */
export function getNodeTypeName(elementType: InteractiveElementType): string {
  switch (elementType) {
    case 'listItem':
      return NODE_TYPES.LIST_ITEM;
    case 'span':
      return NODE_TYPES.INTERACTIVE_SPAN;
    case 'comment':
      return NODE_TYPES.INTERACTIVE_COMMENT;
    case 'sequence':
      return NODE_TYPES.SEQUENCE_SECTION;
    default:
      return NODE_TYPES.LIST_ITEM;
  }
}
