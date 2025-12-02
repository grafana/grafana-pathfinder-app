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
import { generateStepId } from './jsonNodeUpdater';

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
 * Insert a sequence section element
 */
function insertSequenceSectionElement(
  editor: Editor,
  attributes: ElementAttributes,
  hasSelection: boolean,
  from: number
): void {
  const insertPos = hasSelection ? from : undefined;

  if (!editor.can().insertContent({ type: 'sequenceSection' })) {
    logError('[editorOperations] Cannot insert sequence section at current position');
    throw new Error('Cannot insert sequence section at current cursor position');
  }

  const normalizedAttrs = buildInteractiveAttributes('sequence', attributes as InteractiveAttributesOutput);
  const sequenceContent = {
    type: 'sequenceSection',
    attrs: normalizedAttrs,
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
    editor.chain().focus().insertContentAt(insertPos, sequenceContent).run();
  } else {
    editor.chain().focus().insertContent(sequenceContent).run();
  }
}

/**
 * Build paragraph content for multistep actions from internal actions and selection.
 * InteractiveSpan nodes are atomic - text is stored in the 'text' attribute.
 */
function buildMultistepParagraphContent(
  editor: Editor,
  internalActions: any[],
  hasSelection: boolean,
  from: number,
  to: number,
  currentListItem: { node: any; pos: number } | null
): any[] {
  const paragraphContent: any[] = [];

  // Add interactive spans for each recorded action
  // Each atomic span has its text stored in the 'text' attribute
  if (internalActions && Array.isArray(internalActions) && internalActions.length > 0) {
    internalActions.forEach((action: any) => {
      const spanAttrs = {
        id: generateStepId(),
        ...buildInteractiveAttributes('span', {
          class: CSS_CLASSES.INTERACTIVE,
          'data-targetaction': action.targetAction,
          'data-reftarget': action.refTarget,
          ...(action.targetValue && { 'data-targetvalue': action.targetValue }),
          ...(action.requirements && { 'data-requirements': action.requirements }),
        }),
        // Atomic node text attribute - use refTarget as display text
        text: action.refTarget || 'Step',
      };

      paragraphContent.push({
        type: 'interactiveSpan',
        attrs: spanAttrs,
      });
    });
  }

  // For multistep, we don't need to extract selection content into spans
  // The selection text is used as the list item description, not span content
  // Add description text if present
  let descriptionText = '';
  if (hasSelection) {
    descriptionText = editor.state.doc.textBetween(from, to, ' ').trim();
  } else if (currentListItem) {
    // Extract text from existing list item, excluding interactive spans
    currentListItem.node.content?.forEach((node: any) => {
      if (node.content && node.content.size > 0) {
        node.content.forEach((inlineNode: any) => {
          if (inlineNode.isText) {
            descriptionText += inlineNode.text || '';
          }
        });
      }
    });
    descriptionText = descriptionText.trim();
  }

  // Add description text after the atomic spans
  if (descriptionText) {
    paragraphContent.push({ type: 'text', text: descriptionText });
  } else if (paragraphContent.length === 0) {
    // Default text if no content at all
    paragraphContent.push({ type: 'text', text: 'Action description' });
  }

  return paragraphContent;
}

/**
 * Insert a multistep action element
 */
function insertMultistepActionElement(
  editor: Editor,
  attributes: ElementAttributes,
  hasSelection: boolean,
  from: number,
  to: number
): void {
  const internalActions = (attributes as any).__internalActions;
  const finalAttributes = { ...attributes };
  delete (finalAttributes as any).__internalActions;

  const normalizedAttrs = {
    id: generateStepId(),
    ...buildInteractiveAttributes('listItem', finalAttributes as InteractiveAttributesOutput),
  };
  const currentListItem = getCurrentNode(editor, 'listItem');

  // If inside a listItem, replace it in place
  if (currentListItem) {
    const { node: listItemNode, pos: listItemPos } = currentListItem;
    const listItemSize = listItemNode.nodeSize;
    const listItemEnd = listItemPos + listItemSize;
    const selectionWithinListItem = !hasSelection || (from >= listItemPos && to <= listItemEnd);

    if (selectionWithinListItem) {
      debug('[editorOperations] Replacing existing listItem with multistep (avoiding nested list)');

      const paragraphContent = buildMultistepParagraphContent(
        editor,
        internalActions,
        hasSelection,
        from,
        to,
        currentListItem
      );

      const paragraphNode = {
        type: 'paragraph',
        content: paragraphContent,
      };

      editor
        .chain()
        .focus()
        .deleteRange({ from: listItemPos, to: listItemPos + listItemSize })
        .insertContentAt(listItemPos, {
          type: 'listItem',
          attrs: normalizedAttrs,
          content: [paragraphNode],
        })
        .run();

      debug('[editorOperations] Successfully replaced listItem with multistep');
      return;
    }
    debug('[editorOperations] Selection spans outside listItem, creating new bulletList');
  }

  // Create new bulletList wrapper
  if (!editor.can().insertContent({ type: 'bulletList' })) {
    logError('[editorOperations] Cannot insert bullet list at current position');
    throw new Error('Cannot insert multistep action at current cursor position');
  }

  const paragraphContent = buildMultistepParagraphContent(editor, internalActions, hasSelection, from, to, null);
  const paragraphNode = {
    type: 'paragraph',
    content: paragraphContent.length > 0 ? paragraphContent : [{ type: 'text', text: 'Action description' }],
  };

  const listItemContent = {
    type: 'bulletList',
    content: [
      {
        type: 'listItem',
        attrs: normalizedAttrs,
        content: [paragraphNode],
      },
    ],
  };

  if (hasSelection) {
    editor.chain().focus().insertContentAt({ from, to }, listItemContent).run();
  } else {
    editor.chain().focus().insertContent(listItemContent).run();
  }
}

/**
 * Insert an inline span element (or convert to list item if inside sequence section)
 * InteractiveSpan is an atomic node - text is stored in the 'text' attribute, not content.
 */
function insertInlineSpanElement(
  editor: Editor,
  attributes: ElementAttributes,
  hasSelection: boolean,
  from: number,
  to: number
): void {
  // Check if we're inside a list item within a sequence section
  if (isInsideSequenceSectionListItem(editor)) {
    debug('[editorOperations] Converting interactive span to list item (inside sequence section)');

    const normalizedAttrs = {
      id: generateStepId(),
      ...buildInteractiveAttributes('listItem', {
        ...attributes,
        class: attributes.class || CSS_CLASSES.INTERACTIVE,
      } as InteractiveAttributesOutput),
    };

    const success = editor.chain().focus().updateAttributes('listItem', normalizedAttrs).run();

    if (!success) {
      logError('[editorOperations] Failed to convert to interactive list item');
      throw new Error('Cannot convert to interactive list item at current position');
    }

    debug('[editorOperations] Successfully converted to interactive list item');
    return;
  }

  // For atomic interactiveSpan, extract text for the text attribute
  let displayText = attributes['data-reftarget'] || 'Interactive action';

  // If there's a selection, extract the text content for the text attribute
  if (hasSelection) {
    const selectedText = editor.state.doc.textBetween(from, to, ' ');
    if (selectedText.trim()) {
      displayText = selectedText.trim();
    }
  }

  // Build attributes including text for the atomic node
  const normalizedAttrs = {
    id: generateStepId(),
    ...buildInteractiveAttributes('span', attributes as InteractiveAttributesOutput),
    text: displayText,
  };

  if (!editor.can().insertContent({ type: 'interactiveSpan' })) {
    logError('[editorOperations] Cannot insert interactive span at current position');
    throw new Error('Cannot insert interactive action at current cursor position');
  }

  // Atomic nodes have no content - text is stored in attrs.text
  if (hasSelection) {
    editor
      .chain()
      .focus()
      .insertContentAt(
        { from, to },
        {
          type: 'interactiveSpan',
          attrs: normalizedAttrs,
        }
      )
      .run();
  } else {
    editor
      .chain()
      .focus()
      .insertContent({
        type: 'interactiveSpan',
        attrs: normalizedAttrs,
      })
      .run();
  }
}

/**
 * Insert a new interactive element into the editor
 * Dispatches to action-specific insertion handlers
 *
 * @param editor - Tiptap editor instance
 * @param attributes - Attributes to apply to the new element
 * @throws Error if insertion fails
 */
/**
 * Insert a quiz element
 */
function insertQuizElement(editor: Editor, attributes: ElementAttributes): void {
  // Extract quiz-specific data
  const question = (attributes as any).__quizQuestion || 'Quiz question';
  const choices = (attributes as any).__quizChoices || [];
  const multiSelect = (attributes as any).__quizMultiSelect || false;
  const completionMode = (attributes as any).__quizCompletionMode || 'correct-only';
  const maxAttempts = (attributes as any).__quizMaxAttempts || 3;
  const skippable = (attributes as any).__quizSkippable || false;
  const requirements = attributes['data-requirements'];

  // Build a visual representation for the editor
  // The actual quiz will be rendered differently when exported/executed
  const choiceTexts = choices
    .map((c: { text: string; correct: boolean }, i: number) => `${i + 1}. ${c.text}${c.correct ? ' ✓' : ''}`)
    .join('\n');

  const quizSummary = `📝 Quiz: ${question}\n${choiceTexts}`;

  // Insert as a styled paragraph block (quiz blocks are block-level)
  const content = {
    type: 'paragraph',
    content: [
      {
        type: 'text',
        text: quizSummary,
      },
    ],
  };

  // Build base attributes
  const baseAttrs = buildInteractiveAttributes('listItem', {
    'data-targetaction': ACTION_TYPES.QUIZ,
    'data-requirements': requirements || '',
    class: CSS_CLASSES.INTERACTIVE,
  });

  // Add quiz-specific attributes (these are stored as data attributes for serialization)
  const normalizedAttrs = {
    id: generateStepId(),
    ...baseAttrs,
    'data-quiz-question': question,
    'data-quiz-multi-select': String(multiSelect),
    'data-quiz-completion-mode': completionMode,
    'data-quiz-max-attempts': String(maxAttempts),
    'data-quiz-skippable': String(skippable),
    // Store choices as JSON in an attribute
    'data-quiz-choices': JSON.stringify(choices),
  };

  const listItemContent = {
    type: 'bulletList',
    content: [
      {
        type: 'listItem',
        attrs: normalizedAttrs,
        content: [content],
      },
    ],
  };

  editor.chain().focus().insertContent(listItemContent).run();
}

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
      insertSequenceSectionElement(editor, attributes, hasSelection, from);
    } else if (actionType === ACTION_TYPES.MULTISTEP || actionType === ACTION_TYPES.GUIDED) {
      insertMultistepActionElement(editor, attributes, hasSelection, from, to);
    } else if (actionType === ACTION_TYPES.QUIZ) {
      insertQuizElement(editor, attributes);
    } else {
      insertInlineSpanElement(editor, attributes, hasSelection, from, to);
    }

    debug('[editorOperations] Element inserted successfully', { actionType, hasSelection });
  } catch (err) {
    logError('[editorOperations] Failed to insert interactive element:', err);
    throw err;
  }
}
