/**
 * Type definitions for the WYSIWYG Editor
 * Consolidated from editor.ts, editorOperations.ts, and forms/types.ts
 */

import type { Editor } from '@tiptap/react';

/**
 * Type of interactive element being edited
 */
export type InteractiveElementType = 'listItem' | 'sequence' | 'span' | 'comment';

/**
 * State representing an interactive element being edited
 * All fields are required when state exists; use null for no edit state
 */
export interface EditState {
  type: InteractiveElementType;
  attributes: Record<string, string>;
  pos: number;
  commentText?: string; // Optional text content for comment editing
}

/**
 * Edit state that may be null when no element is being edited
 */
export type EditStateOrNull = EditState | null;

/**
 * Attribute update operation
 */
export interface AttributeUpdateOperation {
  nodeType: string;
  attributes: InteractiveAttributesOutput;
  pos?: number;
}

/**
 * TipTap node content structure
 */
export type TipTapNodeContent = Array<{
  type: string;
  attrs?: Record<string, unknown>;
  content?: TipTapNodeContent | Array<{ type: string; text?: string }>;
  text?: string;
}>;

/**
 * Node creation operation
 */
export interface NodeCreationOperation {
  nodeType: string;
  attributes: InteractiveAttributesOutput;
  content?: TipTapNodeContent;
}

/**
 * Result of an editor command
 */
export interface CommandResult {
  success: boolean;
  error?: string;
}

/**
 * Parameters for applying interactive attributes
 */
export interface ApplyAttributesParams {
  editor: Editor;
  elementType: InteractiveElementType;
  attributes: InteractiveAttributesOutput;
  pos?: number;
}

/**
 * Parameters for converting to interactive element
 */
export interface ConvertToInteractiveParams {
  editor: Editor;
  targetType: InteractiveElementType;
  attributes: InteractiveAttributesOutput;
}

/**
 * Parameters for updating element attributes
 */
export interface UpdateAttributesParams {
  editor: Editor;
  nodeType: string;
  attributes: InteractiveAttributesOutput | Record<string, string>;
  pos?: number;
}

/**
 * Interactive attributes as used in form inputs (with booleans)
 */
export interface InteractiveAttributesInput {
  'data-targetaction': string;
  'data-reftarget': string;
  'data-requirements': string;
  'data-doit': boolean; // boolean in UI
  class: string;
  id: string;
}

/**
 * Interactive attributes as output to HTML (all strings or null)
 */
export interface InteractiveAttributesOutput {
  'data-targetaction'?: string;
  'data-reftarget'?: string;
  'data-requirements'?: string;
  'data-doit'?: 'false' | null; // string 'false' or null in HTML
  class?: string;
  id?: string;
}

/**
 * Shared interface for all interactive form components
 */
export interface InteractiveFormProps {
  editor: Editor;
  onApply: (attributes: InteractiveAttributesOutput) => void;
  onCancel: () => void;
  initialValues?: Partial<InteractiveAttributesInput>;
  onSwitchType?: () => void;
}

// Re-export types from constants for convenience
export type { ActionType, CommonRequirement } from '../../constants/interactive-config';
