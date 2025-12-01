/**
 * JSON Node Updater
 *
 * Utilities for updating nodes in TipTap's JSON document format.
 * Uses unique IDs to identify nodes - simple and reliable.
 */

import { JSONContent } from '@tiptap/react';
import { ACTION_TYPES } from '../../../constants/interactive-config';
import { debug, error as logError } from '../utils/logger';

/**
 * Generate a unique ID for interactive elements.
 * Format: step-{timestamp}-{random}
 */
export function generateStepId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `step-${timestamp}-${random}`;
}

/**
 * Data for updating an interactive span
 */
export interface SpanUpdateData {
  actionType: string;
  refTarget: string;
  targetValue?: string;
  requirements?: string;
  text?: string;
  tooltip?: string;
}

/**
 * Data for updating a list item (including multistep/guided)
 */
export interface ListItemUpdateData {
  actionType: string;
  refTarget?: string;
  targetValue?: string;
  requirements?: string;
  description?: string;
  nestedSteps?: NestedStepUpdate[];
}

/**
 * Data for a nested step within multistep/guided
 */
export interface NestedStepUpdate {
  actionType: string;
  refTarget: string;
  targetValue?: string;
  requirements?: string;
  text?: string;
  tooltip?: string;
  id?: string;
}

/**
 * Deep clone a JSON object
 */
function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Find and update a node in the JSON tree by ID.
 * Returns true if a node was found and updated.
 */
function findAndUpdateNodeById(json: JSONContent, targetId: string, updateFn: (node: JSONContent) => void): boolean {
  let found = false;

  function walk(node: JSONContent): void {
    if (found) {
      return;
    }

    // Check if this node has the target ID
    if (node.attrs?.id === targetId) {
      updateFn(node);
      found = true;
      return;
    }

    // Walk children
    if (node.content) {
      for (const child of node.content) {
        walk(child);
        if (found) {
          break;
        }
      }
    }
  }

  walk(json);
  return found;
}

/**
 * Update an interactive span node in the JSON document by ID.
 */
export function updateInteractiveSpanInJson(
  json: JSONContent,
  targetId: string,
  updateData: SpanUpdateData
): JSONContent {
  const newJson = deepClone(json);

  const found = findAndUpdateNodeById(newJson, targetId, (node) => {
    node.attrs = {
      ...node.attrs,
      'data-targetaction': updateData.actionType,
      'data-reftarget': updateData.refTarget,
      'data-targetvalue': updateData.targetValue || '',
      'data-requirements': updateData.requirements || '',
      text: updateData.text || '',
      tooltip: updateData.tooltip || '',
      class: 'interactive',
    };
    debug('[jsonNodeUpdater] Updated interactiveSpan by ID', { targetId, newAttrs: node.attrs });
  });

  if (!found) {
    logError('[jsonNodeUpdater] Could not find interactiveSpan with ID:', targetId);
    return json;
  }

  return newJson;
}

/**
 * Update a list item node in the JSON document by ID.
 */
export function updateListItemInJson(json: JSONContent, targetId: string, updateData: ListItemUpdateData): JSONContent {
  const newJson = deepClone(json);

  const found = findAndUpdateNodeById(newJson, targetId, (node) => {
    // Update attributes
    node.attrs = {
      ...node.attrs,
      'data-targetaction': updateData.actionType,
      'data-reftarget': updateData.refTarget || '',
      'data-targetvalue': updateData.targetValue || '',
      'data-requirements': updateData.requirements || '',
      class: 'interactive',
    };

    // Handle description update
    if (updateData.description !== undefined && node.content) {
      updateListItemDescription(node, updateData);
    }

    // Handle nested steps for multistep/guided
    if (
      updateData.nestedSteps &&
      (updateData.actionType === ACTION_TYPES.MULTISTEP || updateData.actionType === ACTION_TYPES.GUIDED)
    ) {
      updateNestedStepsInListItem(node, updateData.nestedSteps);
    }

    debug('[jsonNodeUpdater] Updated listItem by ID', { targetId, newAttrs: node.attrs });
  });

  if (!found) {
    logError('[jsonNodeUpdater] Could not find listItem with ID:', targetId);
    return json;
  }

  return newJson;
}

/**
 * Update the description text in a list item
 */
function updateListItemDescription(node: JSONContent, updateData: ListItemUpdateData): void {
  if (!node.content) {
    return;
  }

  // Find paragraph and update text
  for (const child of node.content) {
    if (child.type === 'paragraph') {
      // Build new paragraph content
      const newContent: JSONContent[] = [];
      let descriptionAdded = false;

      // For multistep/guided, we need to preserve nested spans but update text
      const isMultistepOrGuided =
        updateData.actionType === ACTION_TYPES.MULTISTEP || updateData.actionType === ACTION_TYPES.GUIDED;

      if (child.content) {
        for (const innerChild of child.content) {
          if (innerChild.type === 'interactiveSpan') {
            // Keep interactive spans
            newContent.push(innerChild);
          } else if (innerChild.type === 'text' && !descriptionAdded) {
            // Replace first text with new description
            if (updateData.description && updateData.description.trim()) {
              newContent.push({ type: 'text', text: updateData.description.trim() });
              descriptionAdded = true;
            }
          }
          // Skip other text nodes (we replace them with the new description)
        }
      }

      // If no description was added yet and we have one, add it
      if (!descriptionAdded && updateData.description && updateData.description.trim()) {
        // For multistep/guided, add at the beginning
        if (isMultistepOrGuided && newContent.length > 0) {
          newContent.unshift({ type: 'text', text: updateData.description.trim() + ' ' });
        } else {
          newContent.push({ type: 'text', text: updateData.description.trim() });
        }
      }

      // Update paragraph content
      child.content = newContent.length > 0 ? newContent : undefined;
      break;
    }
  }
}

/**
 * Update nested steps within a multistep/guided list item
 */
function updateNestedStepsInListItem(listItemNode: JSONContent, nestedSteps: NestedStepUpdate[]): void {
  if (!listItemNode.content) {
    return;
  }

  // Find the paragraph containing the nested spans
  for (const child of listItemNode.content) {
    if (child.type === 'paragraph' && child.content) {
      // Collect other content (text nodes) but not interactive spans
      const otherContent: JSONContent[] = [];
      let existingSpanCount = 0;

      for (const innerChild of child.content) {
        if (innerChild.type === 'interactiveSpan') {
          const actionType = innerChild.attrs?.['data-targetaction'];
          // Count non-multistep/guided spans (these are the nested steps)
          if (actionType !== ACTION_TYPES.MULTISTEP && actionType !== ACTION_TYPES.GUIDED) {
            existingSpanCount++;
          }
        } else {
          otherContent.push(innerChild);
        }
      }

      // Build new spans from the update data
      const newSpans: JSONContent[] = nestedSteps.map((step) => ({
        type: 'interactiveSpan',
        attrs: {
          id: step.id || generateStepId(),
          'data-targetaction': step.actionType,
          'data-reftarget': step.refTarget,
          'data-targetvalue': step.targetValue || '',
          'data-requirements': step.requirements || '',
          text: step.text || step.refTarget,
          tooltip: step.tooltip || '',
          class: 'interactive',
        },
      }));

      // Rebuild content: other content first, then new spans
      child.content = [...otherContent, ...newSpans];

      debug('[jsonNodeUpdater] Updated nested steps', {
        previousCount: existingSpanCount,
        newCount: newSpans.length,
      });
      break;
    }
  }
}

/**
 * Apply updates to the editor using JSON manipulation.
 * Simple and reliable - just find by ID and update.
 */
export function applyJsonUpdate(
  editor: any,
  editType: 'span' | 'listItem',
  targetPos: number,
  updateData: SpanUpdateData | ListItemUpdateData
): boolean {
  try {
    // First, get the node's ID from ProseMirror
    const { doc } = editor.state;
    const nodeTypeName = editType === 'span' ? 'interactiveSpan' : 'listItem';
    let targetId: string | null = null;

    // Find the node at the position to get its ID
    doc.nodesBetween(targetPos, targetPos + 1, (node: any) => {
      if (node.type.name === nodeTypeName && node.attrs?.id) {
        targetId = node.attrs.id;
        return false;
      }
      return true;
    });

    if (!targetId) {
      logError('[jsonNodeUpdater] Node has no ID at position:', targetPos, 'type:', nodeTypeName);
      // Fall back: try to assign an ID and update
      return applyJsonUpdateWithoutId(editor, editType, targetPos, updateData);
    }

    debug('[jsonNodeUpdater] Found node with ID:', targetId);

    // Get current document as JSON
    const currentJson = editor.getJSON();

    // Apply update based on type
    let updatedJson: JSONContent;
    if (editType === 'span') {
      updatedJson = updateInteractiveSpanInJson(currentJson, targetId, updateData as SpanUpdateData);
    } else {
      updatedJson = updateListItemInJson(currentJson, targetId, updateData as ListItemUpdateData);
    }

    // Check if update was successful (JSON changed)
    if (JSON.stringify(currentJson) === JSON.stringify(updatedJson)) {
      logError('[jsonNodeUpdater] No changes detected - node may not have been found');
      return false;
    }

    // Replace editor content with updated JSON
    editor.commands.setContent(updatedJson);

    debug('[jsonNodeUpdater] Successfully applied JSON update');
    return true;
  } catch (error) {
    logError('[jsonNodeUpdater] Failed to apply JSON update:', error);
    return false;
  }
}

/**
 * Fallback: For nodes without ID, assign one and update.
 * This handles legacy content that was created before IDs were added.
 */
function applyJsonUpdateWithoutId(
  editor: any,
  editType: 'span' | 'listItem',
  targetPos: number,
  updateData: SpanUpdateData | ListItemUpdateData
): boolean {
  try {
    const { doc } = editor.state;
    const nodeTypeName = editType === 'span' ? 'interactiveSpan' : 'listItem';

    // First, assign an ID to the node in ProseMirror
    const newId = generateStepId();
    let nodeFound = false;

    doc.nodesBetween(targetPos, targetPos + 1, (node: any, pos: number) => {
      if (node.type.name === nodeTypeName) {
        // Update the node with a new ID
        editor.commands.command(({ tr }: { tr: any }) => {
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, id: newId });
          return true;
        });
        nodeFound = true;
        return false;
      }
      return true;
    });

    if (!nodeFound) {
      logError('[jsonNodeUpdater] Could not find node at position:', targetPos);
      return false;
    }

    debug('[jsonNodeUpdater] Assigned new ID:', newId);

    // Now get the updated JSON and apply the update
    const currentJson = editor.getJSON();

    let updatedJson: JSONContent;
    if (editType === 'span') {
      updatedJson = updateInteractiveSpanInJson(currentJson, newId, updateData as SpanUpdateData);
    } else {
      updatedJson = updateListItemInJson(currentJson, newId, updateData as ListItemUpdateData);
    }

    if (JSON.stringify(currentJson) === JSON.stringify(updatedJson)) {
      logError('[jsonNodeUpdater] No changes detected after assigning ID');
      return false;
    }

    editor.commands.setContent(updatedJson);
    debug('[jsonNodeUpdater] Successfully applied JSON update (with ID migration)');
    return true;
  } catch (error) {
    logError('[jsonNodeUpdater] Failed fallback update:', error);
    return false;
  }
}
