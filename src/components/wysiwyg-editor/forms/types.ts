import { Editor } from '@tiptap/react';

/**
 * Shared interface for all interactive form components
 */
export interface InteractiveFormProps {
  editor: Editor;
  onApply: (attributes: InteractiveAttributesOutput) => void;
  onCancel: () => void;
  initialValues?: Partial<InteractiveAttributesInput>;
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

// Re-export from constants for backward compatibility
export { COMMON_REQUIREMENTS } from '../../../constants/interactive-config';
export type { ActionType, CommonRequirement } from '../../../constants/interactive-config';

