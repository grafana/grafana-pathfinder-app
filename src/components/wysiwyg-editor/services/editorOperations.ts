/**
 * Editor Operations Service
 * Encapsulates complex editor manipulations for interactive elements
 * Centralizes logic previously scattered across components and extensions
 */

import type { Editor } from '@tiptap/react';
import type { InteractiveElementType, InteractiveAttributesOutput } from '../types';
import { buildInteractiveAttributes, getNodeTypeName } from './attributeBuilder';
import { ACTION_TYPES } from '../../../constants/interactive-config';
import { CSS_CLASSES } from '../../../constants/editor-config';
import { debug, error as logError } from '../utils/logger';

/**
 * Attributes that can be applied to interactive elements
 * Can be InteractiveAttributesOutput or a plain record for flexibility
 */
export type ElementAttributes = InteractiveAttributesOutput | Record<string, string>;

/**
 * Apply interactive attributes to an element
 * Handles both creating new elements and updating existing ones
 *
 * @param editor - Tiptap editor instance
 * @param elementType - Type of interactive element
 * @param attributes - Attributes to apply
 * @param options - Additional options
 */
export function applyInteractiveAttributes(
  editor: Editor,
  elementType: InteractiveElementType,
  attributes: InteractiveAttributesOutput,
  options: { isEditing?: boolean } = {}
): boolean {
  const elementAttributes = buildInteractiveAttributes(elementType, attributes);

  if (options.isEditing) {
    // Update existing element
    const nodeType = getNodeTypeName(elementType);
    return editor.chain().focus().updateAttributes(nodeType, elementAttributes).run();
  } else {
    // Create new element (default to list item)
    return editor.chain().focus().convertToInteractiveListItem(elementAttributes).run();
  }
}

/**
 * Convert current selection to an interactive list item
 * Creates a bullet list if not already in one, then applies attributes
 *
 * @param editor - Tiptap editor instance
 * @param attributes - Attributes to apply
 */
export function convertToInteractiveListItem(editor: Editor, attributes: ElementAttributes): boolean {
  const state = editor.state;
  const { selection } = state;
  const { $from } = selection;

  // Check if we're already in a list item
  let isInListItem = false;
  for (let i = $from.depth; i > 0; i--) {
    if ($from.node(i).type.name === 'listItem') {
      isInListItem = true;
      break;
    }
  }

  // If not in a list item, convert current block to list item
  if (!isInListItem) {
    const converted = editor.chain().focus().clearNodes().toggleBulletList().run();

    if (!converted) {
      return false;
    }
  }

  // Now apply the interactive attributes
  return editor.chain().focus().updateAttributes('listItem', attributes).run();
}

/**
 * Update attributes of a specific node type
 *
 * @param editor - Tiptap editor instance
 * @param nodeType - Type of node to update
 * @param attributes - Attributes to set
 */
export function updateElementAttributes(editor: Editor, nodeType: string, attributes: ElementAttributes): boolean {
  return editor.chain().focus().updateAttributes(nodeType, attributes).run();
}

/**
 * Find all existing sequence section IDs in the document
 *
 * @param editor - Tiptap editor instance
 * @returns Set of existing sequence section IDs
 */
export function findExistingSequenceIds(editor: Editor): Set<string> {
  const existingIds = new Set<string>();
  const { doc } = editor.state;

  doc.descendants((node) => {
    if (node.type.name === 'sequenceSection' && node.attrs.id) {
      existingIds.add(node.attrs.id);
    }
  });

  return existingIds;
}

/**
 * Generate a unique sequence section ID
 *
 * @param editor - Tiptap editor instance
 * @param baseId - Base ID to use (default: 'section')
 * @returns Unique ID that doesn't exist in the document
 */
export function generateUniqueSequenceId(editor: Editor, baseId = 'section'): string {
  const existingIds = findExistingSequenceIds(editor);
  let candidateId = baseId;
  let counter = 1;

  // If baseId is unique, use it
  if (!existingIds.has(candidateId)) {
    return candidateId;
  }

  // Otherwise, append a number until we find a unique one
  while (existingIds.has(candidateId)) {
    candidateId = `${baseId}-${counter}`;
    counter++;
  }

  return candidateId;
}

/**
 * Insert a sequence section at the current position
 *
 * @param editor - Tiptap editor instance
 * @param sectionId - Unique ID for the section
 * @param requirements - Optional requirements string
 */
export function insertSequenceSection(editor: Editor, sectionId: string, requirements?: string): boolean {
  const attrs: Record<string, string> = {
    id: sectionId,
    class: CSS_CLASSES.INTERACTIVE,
    'data-targetaction': ACTION_TYPES.SEQUENCE,
    'data-reftarget': `span#${sectionId}`,
  };

  if (requirements) {
    attrs['data-requirements'] = requirements;
  }

  return editor.chain().focus().insertSequenceSection(attrs).run();
}

/**
 * Update a sequence section's attributes
 *
 * @param editor - Tiptap editor instance
 * @param sectionId - New section ID
 * @param requirements - Optional requirements string
 */
export function updateSequenceSection(editor: Editor, sectionId: string, requirements?: string): boolean {
  const attrs: Record<string, string> = {
    id: sectionId,
    class: CSS_CLASSES.INTERACTIVE,
    'data-targetaction': ACTION_TYPES.SEQUENCE,
    'data-reftarget': `span#${sectionId}`,
  };

  if (requirements) {
    attrs['data-requirements'] = requirements;
  }

  return editor.chain().focus().updateAttributes('sequenceSection', attrs).run();
}

/**
 * Check if the current selection is inside a specific node type
 *
 * @param editor - Tiptap editor instance
 * @param nodeType - Type of node to check for
 */
export function isInsideNodeType(editor: Editor, nodeType: string): boolean {
  const { $from } = editor.state.selection;

  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === nodeType) {
      return true;
    }
  }

  return false;
}

/**
 * Get the current node of a specific type if cursor is inside it
 *
 * @param editor - Tiptap editor instance
 * @param nodeType - Type of node to find
 */
export function getCurrentNode(editor: Editor, nodeType: string): { node: any; pos: number } | null {
  const { $from } = editor.state.selection;

  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === nodeType) {
      return {
        node,
        pos: $from.before(depth),
      };
    }
  }

  return null;
}

/**
 * Check if the current selection is inside a list item within a sequence section
 * This is used to automatically convert interactive spans to interactive list items
 * when they're created inside sequence sections, ensuring proper HTML structure.
 *
 * @param editor - Tiptap editor instance
 * @returns true if cursor is in a list item that's inside a sequence section
 */
export function isInsideSequenceSectionListItem(editor: Editor): boolean {
  const { $from } = editor.state.selection;
  let foundListItem = false;
  let foundSequenceSection = false;

  // Walk up the node hierarchy
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    const nodeType = node.type.name;

    // First, check if we're inside a list item
    if (nodeType === 'listItem') {
      foundListItem = true;
    }

    // Then check if we're inside a sequence section
    if (nodeType === 'sequenceSection') {
      foundSequenceSection = true;
    }

    // If we found both, we're in the right context
    if (foundListItem && foundSequenceSection) {
      return true;
    }
  }

  return false;
}

/**
 * Insert a new interactive element into the editor
 * Handles sequence sections, multistep actions, and inline spans
 *
 * @param editor - Tiptap editor instance
 * @param attributes - Attributes to apply to the new element
 * @throws Error if insertion fails
 */
export function insertNewInteractiveElement(editor: Editor, attributes: ElementAttributes): void {
  const actionType = attributes['data-targetaction'];
  const { from, to } = editor.state.selection;
  const hasSelection = from !== to;

  debug('[editorOperations] Inserting interactive element', {
    actionType,
    attributes,
    hasSelection,
    selectionRange: { from, to },
  });

  try {
    if (actionType === ACTION_TYPES.SEQUENCE) {
      // Sequence sections: Insert BEFORE selection without destroying it
      const insertPos = hasSelection ? from : undefined;

      if (!editor.can().insertContent({ type: 'sequenceSection' })) {
        logError('[editorOperations] Cannot insert sequence section at current position');
        throw new Error('Cannot insert sequence section at current cursor position');
      }

      const sequenceContent = {
        type: 'sequenceSection',
        attrs: attributes,
        content: [
          {
            type: 'heading',
            attrs: { level: 3 },
            content: [{ type: 'text', text: 'Section Title' }],
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Add content here...' }],
          },
        ],
      };

      if (insertPos !== undefined) {
        // Insert before selection
        editor.chain().focus().insertContentAt(insertPos, sequenceContent).run();
      } else {
        // Insert at cursor
        editor.chain().focus().insertContent(sequenceContent).run();
      }
    } else if (actionType === ACTION_TYPES.MULTISTEP) {
      // Extract internal actions and strip from final attributes
      const internalActions = (attributes as any).__internalActions;
      const finalAttributes = { ...attributes };
      delete (finalAttributes as any).__internalActions;

      // Build paragraph content: spans (inline) + text (inline)
      // TipTap's listItem requires block content, so we wrap everything in a paragraph
      const paragraphContent: any[] = [];

      // Add interactive spans for each recorded action (inline nodes)
      if (internalActions && Array.isArray(internalActions) && internalActions.length > 0) {
        internalActions.forEach((action: any) => {
          const spanAttrs: Record<string, string> = {
            class: CSS_CLASSES.INTERACTIVE,
            'data-targetaction': action.targetAction,
            'data-reftarget': action.refTarget,
          };
          if (action.targetValue) {
            spanAttrs['data-targetvalue'] = action.targetValue;
          }
          if (action.requirements) {
            spanAttrs['data-requirements'] = action.requirements;
          }
          paragraphContent.push({
            type: 'interactiveSpan',
            attrs: spanAttrs,
          });
        });
      }

      // Check if we're already inside a listItem
      const currentListItem = getCurrentNode(editor, 'listItem');

      if (currentListItem) {
        // We're inside an existing listItem - replace it in place instead of creating nested list
        debug('[editorOperations] Replacing existing listItem with multistep (avoiding nested list)');

        const { node: listItemNode, pos: listItemPos } = currentListItem;
        const listItemSize = listItemNode.nodeSize;
        const listItemEnd = listItemPos + listItemSize;

        // Verify selection is entirely within the listItem (if there's a selection)
        const selectionWithinListItem = !hasSelection || (from >= listItemPos && to <= listItemEnd);

        if (selectionWithinListItem) {
          // Extract text content from selection or existing listItem content
          if (hasSelection) {
            const selectedContent = editor.state.doc.slice(from, to).content.toJSON();
            // Extract inline content from selected content (could be paragraph, heading, etc.)
            if (selectedContent && Array.isArray(selectedContent)) {
              selectedContent.forEach((node: any) => {
                // If it's a paragraph or other block node, extract its inline content
                if (node.content && Array.isArray(node.content)) {
                  paragraphContent.push(...node.content);
                } else if (node.type === 'text') {
                  paragraphContent.push(node);
                }
              });
            }
          } else {
            // Extract text from existing listItem content
            const existingContent = listItemNode.content;
            if (existingContent && existingContent.size > 0) {
              existingContent.forEach((node: any) => {
                // Extract inline content from paragraphs or other block nodes
                if (node.content && node.content.size > 0) {
                  node.content.forEach((inlineNode: any) => {
                    paragraphContent.push(inlineNode.toJSON());
                  });
                }
              });
            }
          }

          // If no content was extracted, add default text
          if (paragraphContent.length === 0) {
            paragraphContent.push({ type: 'text', text: 'Action description' });
          }

          // Create paragraph with all content
          const paragraphNode = {
            type: 'paragraph',
            content: paragraphContent,
          };

          // Replace the listItem: delete it and insert new one with updated attributes and content
          editor
            .chain()
            .focus()
            .deleteRange({ from: listItemPos, to: listItemPos + listItemSize })
            .insertContentAt(listItemPos, {
              type: 'listItem',
              attrs: finalAttributes,
              content: [paragraphNode],
            })
            .run();

          debug('[editorOperations] Successfully replaced listItem with multistep');
          return;
        }
        // If selection spans outside listItem, fall through to create new bulletList
        debug('[editorOperations] Selection spans outside listItem, creating new bulletList');
      }

      // Not inside a listItem - create new bulletList wrapper (existing behavior)
      if (!editor.can().insertContent({ type: 'bulletList' })) {
        logError('[editorOperations] Cannot insert bullet list at current position');
        throw new Error('Cannot insert multistep action at current cursor position');
      }

      // Add text content to the paragraph (either from selection or default)
      if (hasSelection) {
        const selectedContent = editor.state.doc.slice(from, to).content.toJSON();
        // Extract inline content from selected content (could be paragraph, heading, etc.)
        if (selectedContent && Array.isArray(selectedContent)) {
          selectedContent.forEach((node: any) => {
            // If it's a paragraph or other block node, extract its inline content
            if (node.content && Array.isArray(node.content)) {
              paragraphContent.push(...node.content);
            } else if (node.type === 'text') {
              paragraphContent.push(node);
            }
          });
        }
      } else {
        // Default text content
        paragraphContent.push({ type: 'text', text: 'Action description' });
      }

      // Create a single paragraph containing all inline content (spans + text)
      const paragraphNode = {
        type: 'paragraph',
        content: paragraphContent.length > 0 ? paragraphContent : [{ type: 'text', text: 'Action description' }],
      };

      // listItem contains block content (the paragraph)
      const listItemContent = [paragraphNode];

      if (hasSelection) {
        // Replace selection with bulletList containing the paragraph with spans
        editor
          .chain()
          .focus()
          .insertContentAt(
            { from, to },
            {
              type: 'bulletList',
              content: [
                {
                  type: 'listItem',
                  attrs: finalAttributes,
                  content: listItemContent,
                },
              ],
            }
          )
          .run();
      } else {
        // Insert at cursor with paragraph containing spans and text
        editor
          .chain()
          .focus()
          .insertContent({
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                attrs: finalAttributes,
                content: listItemContent,
              },
            ],
          })
          .run();
      }
    } else {
      // Inline spans: Check if we're inside a list item within a sequence section
      // If so, convert to interactive list item instead of creating a span
      if (isInsideSequenceSectionListItem(editor)) {
        debug('[editorOperations] Converting interactive span to list item (inside sequence section)');

        // Apply attributes directly to the list item
        // Ensure class="interactive" is included
        const listItemAttributes = {
          ...attributes,
          class: attributes.class || CSS_CLASSES.INTERACTIVE,
        };

        const success = editor.chain().focus().updateAttributes('listItem', listItemAttributes).run();

        if (!success) {
          logError('[editorOperations] Failed to convert to interactive list item');
          throw new Error('Cannot convert to interactive list item at current position');
        }

        debug('[editorOperations] Successfully converted to interactive list item');
        return;
      }

      // Normal inline span behavior (not in sequence section)
      const displayText = attributes['data-reftarget'] || 'Interactive action';

      if (!editor.can().insertContent({ type: 'interactiveSpan' })) {
        logError('[editorOperations] Cannot insert interactive span at current position');
        throw new Error('Cannot insert interactive action at current cursor position');
      }

      if (hasSelection) {
        // Wrap selected content in interactiveSpan
        const selectedContent = editor.state.doc.slice(from, to).content.toJSON();
        editor
          .chain()
          .focus()
          .insertContentAt(
            { from, to },
            {
              type: 'interactiveSpan',
              attrs: attributes,
              content: selectedContent,
            }
          )
          .run();
      } else {
        // Insert with default text at cursor
        editor
          .chain()
          .focus()
          .insertContent({
            type: 'interactiveSpan',
            attrs: attributes,
            content: [{ type: 'text', text: displayText }],
          })
          .run();
      }
    }

    debug('[editorOperations] Element inserted successfully', { actionType, hasSelection });
  } catch (err) {
    logError('[editorOperations] Failed to insert interactive element:', err);
    throw err;
  }
}
