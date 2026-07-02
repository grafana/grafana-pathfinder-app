/**
 * CodeBlockHandler
 *
 * Handles inserting code into Monaco editors by:
 * 1. Finding the Monaco editor container from the refTarget selector
 * 2. Locating the Monaco instance or textarea inside
 * 3. Clearing existing content and inserting new code
 */

import { INTERACTIVE_CONFIG } from '../../constants/interactive-config';
import { resetValueTracker } from '../../lib/dom';
import { resolveWithRetry } from '../../lib/dom/selector-retry';

declare global {
  interface Window {
    monaco?: {
      editor: {
        getModels(): Array<{ uri: { toString(): string }; setValue(value: string): void }>;
        getEditors(): Array<{
          getModel(): { uri: { toString(): string } } | null;
          setValue(value: string): void;
          focus(): void;
        }>;
      };
    };
  }
}

export interface CodeBlockInsertResult {
  success: boolean;
  error?: string;
}

export async function clearAndInsertCode(refTarget: string, code: string): Promise<CodeBlockInsertResult> {
  try {
    const resolved = await resolveWithRetry(refTarget, 'codeblock');

    if (!resolved) {
      return { success: false, error: `Code editor container not found: ${refTarget}` };
    }

    const container = resolved.element;

    // Strategy 1: Try Monaco API (if available)
    const monacoResult = await tryMonacoApi(container, code);
    if (monacoResult.success) {
      return monacoResult;
    }

    // Strategy 2: Fall back to textarea/keyboard approach
    const textareaResult = await tryTextareaApproach(container, code);
    return textareaResult;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error inserting code',
    };
  }
}

// Writes `value` via the Monaco model API (not the hidden textarea) for the
// editor owning `element`, so it lands even on a backgrounded tab — e.g. the
// two-tab controller driving a non-focused live tab. Returns false when the
// API/model isn't found so callers fall back to synthetic textarea events.
export function trySetMonacoModelValue(element: HTMLElement, value: string): boolean {
  if (!window.monaco?.editor) {
    return false;
  }
  const monacoEl = element.closest('[data-uri]') ?? element.querySelector('[data-uri]');
  const dataUri = monacoEl?.getAttribute('data-uri');
  if (!dataUri) {
    return false;
  }
  for (const editor of window.monaco.editor.getEditors()) {
    const model = editor.getModel();
    if (model && model.uri.toString() === dataUri) {
      editor.setValue(value);
      editor.focus();
      return true;
    }
  }
  for (const model of window.monaco.editor.getModels()) {
    if (model.uri.toString() === dataUri) {
      model.setValue(value);
      return true;
    }
  }
  return false;
}

async function tryMonacoApi(container: HTMLElement, code: string): Promise<CodeBlockInsertResult> {
  return trySetMonacoModelValue(container, code)
    ? { success: true }
    : { success: false, error: 'Monaco editor instance not found' };
}

async function tryTextareaApproach(container: HTMLElement, code: string): Promise<CodeBlockInsertResult> {
  // Find the Monaco textarea (inputarea)
  const textarea = container.querySelector('textarea.inputarea') as HTMLTextAreaElement | null;
  if (!textarea) {
    return { success: false, error: 'Monaco textarea not found' };
  }

  // Focus the textarea
  textarea.focus();
  textarea.dispatchEvent(new Event('focus', { bubbles: true }));

  // Clear existing content using Ctrl+A + Delete (same as form-fill handler)
  textarea.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'a',
      code: 'KeyA',
      ctrlKey: true,
      metaKey: true,
      bubbles: true,
    })
  );
  textarea.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Delete',
      code: 'Delete',
      bubbles: true,
    })
  );

  await new Promise((resolve) => setTimeout(resolve, INTERACTIVE_CONFIG.delays.technical.monacoClear));

  // Set the value using native setter
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  if (nativeSetter) {
    nativeSetter.call(textarea, code);
    resetValueTracker(textarea);
  } else {
    textarea.value = code;
  }

  // Trigger Monaco events
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, INTERACTIVE_CONFIG.delays.formFill.monacoEventDelay));

  textarea.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, INTERACTIVE_CONFIG.delays.formFill.monacoEventDelay));

  // Fire keydown/keyup for last character to trigger Monaco processing
  const lastChar = code.slice(-1);
  if (lastChar) {
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: lastChar, bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, INTERACTIVE_CONFIG.delays.formFill.monacoKeyEventDelay));
    textarea.dispatchEvent(new KeyboardEvent('keyup', { key: lastChar, bubbles: true }));
  }

  // Blur to finalize
  textarea.blur();
  textarea.dispatchEvent(new Event('blur', { bubbles: true }));

  return { success: true };
}
