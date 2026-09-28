import { sleep } from '../../lib/async-utils';
import { InteractiveStateManager } from '../interactive-state-manager';
import { NavigationManager } from '../navigation-manager';
import { InteractiveElementData, ActionExecutionResult } from '../../types/interactive.types';
import { INTERACTIVE_CONFIG, CLEAR_COMMAND } from '../../constants/interactive-config';
import { describeElement, resetValueTracker, isElementVisible } from '../../lib/dom';
import { logger } from '../../lib/logging';
import { resolveWithRetry } from '../../lib/dom/selector-retry';
import { trySetMonacoModelValue } from './code-block-handler';

export class FormFillHandler {
  constructor(
    private stateManager: InteractiveStateManager,
    private navigationManager: NavigationManager,
    private waitForReactUpdates: () => Promise<void>,
    private context?: InteractiveElementData
  ) {}

  async execute(data: InteractiveElementData, fillForm: boolean): Promise<ActionExecutionResult> {
    if (data !== this.context && (data.signal || data.lazyRender)) {
      return new FormFillHandler(this.stateManager, this.navigationManager, this.waitForReactUpdates, data).execute(
        data,
        fillForm
      );
    }
    this.stateManager.setState(data, 'running');

    try {
      this.context?.signal?.throwIfAborted();
      const targetElement = await this.findTargetElement(data.refTarget);
      this.context?.signal?.throwIfAborted();
      if (!targetElement) {
        return { outcome: 'error', reason: 'target_missing' };
      }
      await this.prepareElement(targetElement);
      this.context?.signal?.throwIfAborted();

      if (!fillForm) {
        await this.handleShowMode(targetElement, data.targetComment);
        this.context?.signal?.throwIfAborted();
        // Mark show actions as completed too for proper state cleanup
        await this.markAsCompleted(data);
        this.context?.signal?.throwIfAborted();
        return { outcome: 'ok' };
      }

      await this.handleDoMode(targetElement, data);
      this.context?.signal?.throwIfAborted();
      return { outcome: 'ok' };
    } catch (error) {
      if (this.context?.signal?.aborted) {
        return { outcome: 'cancelled' };
      }
      this.stateManager.handleError(error as Error, 'FormFillHandler', data, false);
      return { outcome: 'error', reason: 'action_failed' };
    }
  }

  private async findTargetElement(selector: string): Promise<HTMLElement | null> {
    const resolved = await resolveWithRetry(
      selector,
      'formfill',
      ...(this.context ? ([this.context] as const) : ([] as const))
    );
    this.context?.signal?.throwIfAborted();

    if (!resolved) {
      return null;
    }

    if (resolved.elements.length > 1) {
      logger.warn(`Multiple elements found matching selector: ${selector}`);
    }

    return resolved.element;
  }

  private async prepareElement(targetElement: HTMLElement): Promise<void> {
    // Validate visibility before interaction
    if (!isElementVisible(targetElement)) {
      logger.warn('Target element is not visible', { targetElement: describeElement(targetElement) });
      // Continue anyway (non-breaking)
    }

    await this.navigationManager.ensureNavigationOpen(targetElement);
    this.context?.signal?.throwIfAborted();
    await this.navigationManager.ensureElementVisible(targetElement);
    this.context?.signal?.throwIfAborted();
  }

  private async handleShowMode(targetElement: HTMLElement, comment?: string): Promise<void> {
    await (this.context?.signal
      ? this.navigationManager.highlightWithComment(
          targetElement,
          comment,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          { signal: this.context.signal }
        )
      : this.navigationManager.highlightWithComment(targetElement, comment));
    this.context?.signal?.throwIfAborted();
  }

  private async handleDoMode(targetElement: HTMLElement, data: InteractiveElementData): Promise<void> {
    // Clear any existing highlights before performing action
    this.navigationManager.clearAllHighlights();

    // Refine target: if the user selected a wrapper (e.g. div), try to find the actual input inside
    const refinedElement = this.descendToFormElement(targetElement);

    const value = data.targetValue || '';
    const { shouldClear, remainingValue } = this.parseClearCommand(value);

    const tagName = refinedElement.tagName.toLowerCase();
    const inputType = this.getInputType(refinedElement);
    const isMonacoEditor = this.isMonacoEditor(refinedElement);

    // Detect combobox early so clear logic can branch on it
    const isCombobox = this.isAriaCombobox(refinedElement);

    // Clear element if command detected
    if (shouldClear) {
      if (isCombobox) {
        await this.clearComboboxPills(refinedElement);
        this.context?.signal?.throwIfAborted();
      }
      await this.clearElement(refinedElement, tagName, isMonacoEditor);
      this.context?.signal?.throwIfAborted();
    }
    if (isCombobox) {
      await this.fillComboboxStaged(refinedElement, remainingValue);
      this.context?.signal?.throwIfAborted();
      await this.markAsCompleted(data);
      this.context?.signal?.throwIfAborted();
      return;
    }

    // For non-combobox elements, set value and dispatch events
    // Always dispatch events even if remainingValue is empty to maintain backward compatibility
    await this.setElementValue(refinedElement, remainingValue, tagName, inputType, isMonacoEditor);
    this.context?.signal?.throwIfAborted();
    // Checkboxes and radios are driven by a real click, which already fired
    // onChange; re-dispatching would toggle twice on toggle-style handlers.
    if (inputType !== 'checkbox' && inputType !== 'radio') {
      await this.dispatchEvents(refinedElement, tagName, isMonacoEditor);
      this.context?.signal?.throwIfAborted();
    }
    await this.markAsCompleted(data);
    this.context?.signal?.throwIfAborted();
  }

  /**
   * Helper to find the best actionable element.
   * If the target is a wrapper (div, span), it looks for a nested input/textarea/select.
   */
  private descendToFormElement(element: HTMLElement): HTMLElement {
    const tagName = element.tagName.toLowerCase();

    // 1. If it's already a supported form element, return it
    if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
      return element;
    }

    // 2. If it's a Monaco editor (special class detection), return it
    if (this.isMonacoEditor(element)) {
      return element;
    }

    // 3. If it's contenteditable, it accepts input directly
    if (element.isContentEditable) {
      return element;
    }

    // 4. Try to find a nested form element
    // We exclude hidden inputs to avoid targeting metadata fields
    const nestedInput = element.querySelector('input:not([type="hidden"]), textarea, select');
    if (nestedInput instanceof HTMLElement) {
      return nestedInput;
    }

    // 5. Fallback: return the original element (e.g. for div-based custom inputs we don't recognize)
    return element;
  }

  private getInputType(element: HTMLElement): string {
    return (element as HTMLInputElement).type ? (element as HTMLInputElement).type.toLowerCase() : '';
  }

  private isMonacoEditor(element: HTMLElement): boolean {
    return element.classList.contains('inputarea') && element.classList.contains('monaco-mouse-cursor-text');
  }

  private isAriaCombobox(element: HTMLElement): boolean {
    const role = element.getAttribute('role');
    const ariaAutocomplete = element.getAttribute('aria-autocomplete');

    // Primary: ARIA role detection (most reliable)
    // Check element itself OR its parent (if we descended into an input inside a combobox wrapper)
    // Some libraries put role="combobox" on the wrapper div
    if (role === 'combobox' && (ariaAutocomplete === 'list' || ariaAutocomplete === 'both')) {
      return true;
    }

    const parentElement = element.parentElement;
    if (parentElement && parentElement.getAttribute('role') === 'combobox') {
      return true;
    }

    // Secondary: Check for Grafana's custom combobox pattern
    // Many Grafana inputs have dropdown suffix but lack role="combobox"
    // Look for parent wrapper with SVG dropdown icon (chevron-down)
    const parent = element.parentElement;
    if (parent && element.tagName.toLowerCase() === 'input') {
      // Check if parent contains an SVG with a chevron-down path (dropdown indicator)
      // This is more stable than CSS class names which are auto-generated
      const svg = parent.querySelector('svg');
      if (svg) {
        // Look for the characteristic chevron-down path used in Grafana dropdowns
        const path = svg.querySelector('path[d*="17,9.17"]');
        if (path) {
          return true;
        }
      }
    }

    return false;
  }

  private parseClearCommand(value: string): { shouldClear: boolean; remainingValue: string } {
    const trimmedValue = value.trim();

    if (trimmedValue === CLEAR_COMMAND) {
      return { shouldClear: true, remainingValue: '' };
    }

    if (trimmedValue.startsWith(CLEAR_COMMAND)) {
      const remaining = trimmedValue.slice(CLEAR_COMMAND.length).trim();
      return { shouldClear: true, remainingValue: remaining };
    }

    return { shouldClear: false, remainingValue: value };
  }

  private async clearElement(element: HTMLElement, tagName: string, isMonacoEditor: boolean): Promise<void> {
    if (isMonacoEditor) {
      await this.clearMonacoEditor(element);
      this.context?.signal?.throwIfAborted();
      return;
    }

    if (tagName === 'input' || tagName === 'textarea') {
      // Clear using native setter to ensure React detects the change
      if (tagName === 'input') {
        this.setNativeInputValue(element, '');
      } else {
        this.setNativeTextareaValue(element, '');
      }
      // Fire events to notify frameworks
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (tagName === 'select') {
      (element as HTMLSelectElement).selectedIndex = 0;
      element.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      element.textContent = '';
    }
  }

  /**
   * Clear existing filter pills/chips in a combobox container.
   * Traverses up from the input to find remove buttons by their stable aria-label,
   * then clicks each one sequentially, re-querying after each click since React re-renders the DOM.
   */
  private async clearComboboxPills(comboboxInput: HTMLElement): Promise<void> {
    let container: HTMLElement | null = comboboxInput.parentElement;
    const maxDepth = 5;
    let depth = 0;

    while (container && depth < maxDepth) {
      const removeButtons = container.querySelectorAll<HTMLButtonElement>('button[aria-label^="Remove filter"]');
      if (removeButtons.length > 0) {
        const delay = INTERACTIVE_CONFIG.delays.debouncing.stateSettling;

        let safetyLimit = 50;
        while (safetyLimit > 0) {
          const currentButtons = container.querySelectorAll<HTMLButtonElement>('button[aria-label^="Remove filter"]');
          if (currentButtons.length === 0) {
            break;
          }
          currentButtons[0]!.click();
          await sleep(delay, this.context?.signal);
          this.context?.signal?.throwIfAborted();
          safetyLimit--;
        }
        return;
      }
      container = container.parentElement;
      depth++;
    }
  }

  private async setElementValue(
    element: HTMLElement,
    value: string,
    tagName: string,
    inputType: string,
    isMonacoEditor: boolean
  ): Promise<void> {
    if (tagName === 'input') {
      await this.setInputValue(element, value, inputType);
      this.context?.signal?.throwIfAborted();
    } else if (tagName === 'textarea') {
      await this.setTextareaValue(element, value, isMonacoEditor);
      this.context?.signal?.throwIfAborted();
    } else if (tagName === 'select') {
      await this.setSelectValue(element, value);
      this.context?.signal?.throwIfAborted();
    } else {
      await this.setTextContent(element, value);
      this.context?.signal?.throwIfAborted();
    }
  }

  private async fillComboboxStaged(element: HTMLElement, fullValue: string): Promise<void> {
    // Ensure focused and dropdown is open.
    // Comboboxes (e.g. downshift-based Grafana Combobox) don't open on programmatic
    // focus + input events alone — they require a user-like click to trigger the menu.
    element.focus();
    element.dispatchEvent(new Event('focus', { bubbles: true }));
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // Clear any existing text
    this.setNativeInputValue(element, '');
    element.dispatchEvent(new Event('input', { bubbles: true }));

    // If no value to fill, just clear and exit
    if (!fullValue || fullValue.trim() === '') {
      element.blur();
      element.dispatchEvent(new Event('blur', { bubbles: true }));
      return;
    }

    // SECURITY: Prevent ReDoS attacks with length limit
    if (fullValue.length > 1000) {
      logger.warn('Input too long for combobox, truncating to 1000 chars');
      fullValue = fullValue.substring(0, 1000);
    }

    // Tokenization strategy:
    // 1) If value contains operators (!=, =~, !~, =), split into [key, op, value] tokens.
    // 2) If value has whitespace AND contains operators, split by whitespace preserving quoted strings.
    // 3) Otherwise, treat the entire value as a single token (e.g., "New York" stays as one token).

    const stripQuotes = (s: string) =>
      (s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))
        ? s.substring(1, s.length - 1)
        : s;

    // Check if value contains label-style operators
    const hasOperator = /!=|=~|!~|=/.test(fullValue);
    const hasWhitespace = /\s/.test(fullValue);

    let tokens: string[] = [];

    if (hasWhitespace && hasOperator) {
      // Split by whitespace while preserving quoted strings (for multi-part label queries)
      const regex = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\S+/g;
      const matches = fullValue.match(regex) || [];
      // Preserve quotes as typed by author to better match UI parsing
      tokens = matches;
    } else if (hasOperator) {
      // Try to split by operator if present (for single label expressions like "walker=jack")
      // SECURITY: Safe regex - [^!=~]* prevents backtracking (no nested quantifiers)
      const opMatch = fullValue.match(/^([^!=~]*)(!=|=~|!~|=)(.*)$/);
      if (opMatch) {
        const key = opMatch[1]!.trim();
        const op = opMatch[2]!.trim();
        const val = stripQuotes(opMatch[3]!.trim());
        tokens = [key, op, val].filter(Boolean);
      } else {
        tokens = [stripQuotes(fullValue.trim())];
      }
    } else {
      // No operators - treat entire value as a single token (e.g., "New York" for dropdown selection)
      tokens = [stripQuotes(fullValue.trim())];
    }

    // Helper to set value and fire input event
    const setAndInput = (v: string) => {
      this.setNativeInputValue(element, v);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    };

    const pressEnter = () => {
      element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      element.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    };

    const stageDelay = INTERACTIVE_CONFIG.delays.perceptual.base;

    const isOperatorToken = (t: string) => ['!=', '=~', '!~', '='].includes(t);
    const typeOperator = async (op: string) => {
      for (const ch of op.split('')) {
        element.dispatchEvent(
          new KeyboardEvent('keydown', { key: ch, code: ch === '=' ? 'Equal' : undefined, bubbles: true })
        );
        element.dispatchEvent(
          new KeyboardEvent('keyup', { key: ch, code: ch === '=' ? 'Equal' : undefined, bubbles: true })
        );
        await sleep(INTERACTIVE_CONFIG.delays.formFill.keystrokeDelay, this.context?.signal);
        this.context?.signal?.throwIfAborted();
      }
      element.dispatchEvent(new Event('change', { bubbles: true }));
    };

    // Stage through tokens: enter token/op -> delay -> Enter -> delay
    for (const token of tokens) {
      if (!token) {
        continue;
      }
      const tokenToType = stripQuotes(token);
      if (isOperatorToken(tokenToType)) {
        await typeOperator(tokenToType);
        this.context?.signal?.throwIfAborted();
      } else {
        setAndInput(tokenToType);
      }
      await sleep(stageDelay, this.context?.signal);
      this.context?.signal?.throwIfAborted();
      pressEnter();
      await sleep(stageDelay, this.context?.signal);
      this.context?.signal?.throwIfAborted();
    }

    // Defocus: close dropdown menu and blur
    // CRITICAL FIX: Avoid dispatching Escape events that bubble to parent modals
    // When formfill runs inside a modal (e.g., "Add to dashboard" modal), a bubbling
    // Escape event would close the modal before the next multi-step action can execute.
    //
    // Strategy: Most modern dropdowns (including Grafana UI components) close on blur.
    // We dispatch a non-bubbling Escape directly to the element (for components that
    // listen on the element itself), then rely on blur for the rest.
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: false }));
    element.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', bubbles: false }));

    await sleep(stageDelay, this.context?.signal);
    this.context?.signal?.throwIfAborted();

    // Blur triggers dropdown close on most components and properly defocuses the field
    element.blur();
    element.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  private async setInputValue(element: HTMLElement, value: string, inputType: string): Promise<void> {
    if (inputType === 'checkbox' || inputType === 'radio') {
      const input = element as HTMLInputElement;
      const desired = value !== 'false' && value !== '0' && value !== '';

      if (inputType === 'radio' && !desired) {
        logger.warn('Cannot uncheck a radio button; select a sibling option instead', {
          element: describeElement(element),
        });
        return;
      }

      // Assigning `.checked` updates React's own value tracker, so the change
      // event we would dispatch afterwards reads as a no-op and onChange never
      // fires. React wires onChange for checkbox/radio to `click`.
      if (input.checked !== desired) {
        input.click();
      }
      return;
    }

    this.setNativeInputValue(element, value);
  }

  private async setTextareaValue(element: HTMLElement, value: string, isMonacoEditor: boolean): Promise<void> {
    if (isMonacoEditor) {
      await this.setMonacoEditorValue(element, value);
      this.context?.signal?.throwIfAborted();
    } else {
      this.setNativeTextareaValue(element, value);
    }
  }

  private async setMonacoEditorValue(element: HTMLElement, value: string): Promise<void> {
    if (trySetMonacoModelValue(element, value)) {
      return;
    }
    element.focus();
    await this.clearMonacoEditor(element);
    this.context?.signal?.throwIfAborted();
    this.setNativeTextareaValue(element, value);
    await this.triggerMonacoEvents(element, value);
    this.context?.signal?.throwIfAborted();
  }

  private async clearMonacoEditor(element: HTMLElement): Promise<void> {
    element.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'a',
        code: 'KeyA',
        ctrlKey: true,
        bubbles: true,
      })
    );
    element.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Delete',
        code: 'Delete',
        bubbles: true,
      })
    );

    await sleep(INTERACTIVE_CONFIG.delays.technical.monacoClear, this.context?.signal);
    this.context?.signal?.throwIfAborted();
  }

  private async triggerMonacoEvents(element: HTMLElement, value: string): Promise<void> {
    // Fire input event first
    element.dispatchEvent(new Event('input', { bubbles: true }));

    // Wait before firing change to avoid recursive decorations
    await sleep(INTERACTIVE_CONFIG.delays.formFill.monacoEventDelay, this.context?.signal);
    this.context?.signal?.throwIfAborted();

    element.dispatchEvent(new Event('change', { bubbles: true }));

    // Wait again before firing keyboard events
    await sleep(INTERACTIVE_CONFIG.delays.formFill.monacoEventDelay, this.context?.signal);
    this.context?.signal?.throwIfAborted();

    // Only fire keyboard events if there's a last character
    const lastChar = value.slice(-1);
    if (lastChar) {
      element.dispatchEvent(new KeyboardEvent('keydown', { key: lastChar, bubbles: true }));

      // Small delay between keydown and keyup
      await sleep(INTERACTIVE_CONFIG.delays.formFill.monacoKeyEventDelay, this.context?.signal);
      this.context?.signal?.throwIfAborted();

      element.dispatchEvent(new KeyboardEvent('keyup', { key: lastChar, bubbles: true }));
    }
  }

  private setNativeInputValue(element: HTMLElement, value: string): void {
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (nativeSetter) {
      nativeSetter.call(element, value);
      resetValueTracker(element);
    } else {
      (element as HTMLInputElement).value = value;
    }
  }

  private setNativeTextareaValue(element: HTMLElement, value: string): void {
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    if (nativeSetter) {
      nativeSetter.call(element, value);
      resetValueTracker(element);
    } else {
      (element as HTMLTextAreaElement).value = value;
    }
  }

  private setSelectValue(element: HTMLElement, value: string): void {
    (element as HTMLSelectElement).value = value;
  }

  private setTextContent(element: HTMLElement, value: string): void {
    element.textContent = value;
  }

  private async dispatchEvents(element: HTMLElement, tagName: string, isMonacoEditor: boolean): Promise<void> {
    element.focus();
    element.dispatchEvent(new Event('focus', { bubbles: true }));

    if ((tagName === 'input' || tagName === 'textarea' || tagName === 'select') && !isMonacoEditor) {
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }

    element.blur();
    element.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  private async markAsCompleted(data: InteractiveElementData): Promise<void> {
    // Wait for React to process all form events and state updates
    await this.waitForReactUpdates();
    this.context?.signal?.throwIfAborted();

    // Additional settling time for complex form operations and reactive checks
    // This ensures the sequential requirements system has time to:
    // 1. Process form state changes
    // 2. Re-evaluate next step requirements
    // 3. Trigger component re-renders and unlock the next step
    await sleep(INTERACTIVE_CONFIG.delays.debouncing.reactiveCheck, this.context?.signal);
    this.context?.signal?.throwIfAborted();

    // Mark as completed after state has settled
    this.stateManager.setState(data, 'completed');

    // Final wait to ensure completion state propagates
    await this.waitForReactUpdates();
    this.context?.signal?.throwIfAborted();
  }
}
