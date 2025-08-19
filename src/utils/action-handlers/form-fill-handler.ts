import { InteractiveStateManager } from '../interactive-state-manager';
import { NavigationManager } from '../navigation-manager';
import { InteractiveElementData } from '../../types/interactive.types';
import { INTERACTIVE_CONFIG } from '../../constants/interactive-config';
import { resetValueTracker } from '../dom-utils';

export class FormFillHandler {
  constructor(
    private stateManager: InteractiveStateManager,
    private navigationManager: NavigationManager,
    private waitForReactUpdates: () => Promise<void>
  ) {}

  async execute(data: InteractiveElementData, fillForm: boolean): Promise<void> {
    this.stateManager.setState(data, 'running');

    try {
      const targetElement = await this.findTargetElement(data.reftarget);
      await this.prepareElement(targetElement);

      if (!fillForm) {
        await this.handleShowMode(targetElement);
        // Mark show actions as completed too for proper state cleanup
        await this.markAsCompleted(data);
        return;
      }

      await this.handleDoMode(targetElement, data);
    } catch (error) {
      this.stateManager.handleError(error as Error, 'FormFillHandler', data, false);
    }
  }

  private async findTargetElement(selector: string): Promise<HTMLElement> {
    console.warn(`🔍 FormFill: Searching for selector: ${selector}`);
    const targetElements = document.querySelectorAll(selector);

    console.warn(`🔍 FormFill: Found ${targetElements.length} elements matching selector`);
    if (targetElements.length === 0) {
      throw new Error(`No elements found matching selector: ${selector}`);
    }

    if (targetElements.length > 1) {
      console.warn(`⚠️ Multiple elements found matching selector: ${selector}`);
    }

    const targetElement = targetElements[0] as HTMLElement;
    console.warn(`🎯 FormFill: Target element found:`, targetElement);
    return targetElement;
  }

  private async prepareElement(targetElement: HTMLElement): Promise<void> {
    await this.navigationManager.ensureNavigationOpen(targetElement);
    await this.navigationManager.ensureElementVisible(targetElement);
  }

  private async handleShowMode(targetElement: HTMLElement): Promise<void> {
    await this.navigationManager.highlight(targetElement);
  }

  private async handleDoMode(targetElement: HTMLElement, data: InteractiveElementData): Promise<void> {
    const value = data.targetvalue || '';
    const tagName = targetElement.tagName.toLowerCase();
    const inputType = this.getInputType(targetElement);
    const isMonacoEditor = this.isMonacoEditor(targetElement);

    // Special handling for Grafana's combobox label filter inputs
    const isCombobox = this.isAriaCombobox(targetElement);
    if (isCombobox) {
      console.warn('🎛️ FormFill: Detected ARIA combobox, using staged entry sequence');
      await this.fillComboboxStaged(targetElement, value);
      // Combobox flow handles its own events/enters; still dispatch final blur/change to settle state
      await this.dispatchEvents(targetElement, tagName, false);
      await this.markAsCompleted(data);
      return;
    }

    await this.setElementValue(targetElement, value, tagName, inputType, isMonacoEditor);
    await this.dispatchEvents(targetElement, tagName, isMonacoEditor);
    await this.markAsCompleted(data);
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
    // Prefer ARIA role detection as it is stable across themes/classes
    return role === 'combobox' && (ariaAutocomplete === 'list' || ariaAutocomplete === 'both');
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
    } else if (tagName === 'textarea') {
      await this.setTextareaValue(element, value, isMonacoEditor);
    } else if (tagName === 'select') {
      await this.setSelectValue(element, value);
    } else {
      await this.setTextContent(element, value);
    }
  }

  private async fillComboboxStaged(element: HTMLElement, fullValue: string): Promise<void> {
    // Tokenization strategy:
    // 1) If spaces exist, split on spaces but keep quoted substrings intact.
    // 2) If no spaces, split by common operators (!=, =~, !~, =) into [key, op, value].
    // 3) Otherwise, treat as a single token.

    const stripQuotes = (s: string) =>
      (s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))
        ? s.substring(1, s.length - 1)
        : s;

    const hasWhitespace = /\s/.test(fullValue);

    let tokens: string[] = [];

    if (hasWhitespace) {
      // Split by whitespace while preserving quoted strings
      const regex = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\S+/g;
      const matches = fullValue.match(regex) || [];
      // Preserve quotes as typed by author to better match UI parsing
      tokens = matches;
    } else {
      // Try to split by operator if present
      const opMatch = fullValue.match(/^(.*?)(!=|=~|!~|=)(.*)$/);
      if (opMatch) {
        const key = opMatch[1].trim();
        const op = opMatch[2].trim();
        const val = stripQuotes(opMatch[3].trim());
        tokens = [key, op, val].filter(Boolean);
      } else {
        tokens = [stripQuotes(fullValue.trim())];
      }
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

    // Ensure focused
    element.focus();
    element.dispatchEvent(new Event('focus', { bubbles: true }));

    // Clear any existing text
    this.setNativeInputValue(element, '');
    element.dispatchEvent(new Event('input', { bubbles: true }));

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
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
        await sleep(50);
      }
      element.dispatchEvent(new Event('change', { bubbles: true }));
    };

    // Stage through tokens: enter token/op -> delay -> Enter -> delay
    for (const token of tokens) {
      if (!token) {
        continue;
      }
      const tokenToType = stripQuotes(token);
      console.warn(`⌨️ Combobox stage token -> ${tokenToType}`);
      if (isOperatorToken(tokenToType)) {
        await typeOperator(tokenToType);
      } else {
        setAndInput(tokenToType);
      }
      await sleep(stageDelay);
      pressEnter();
      await sleep(stageDelay);
    }

    // Defocus: send Escape to close any menus, then blur
    console.warn('🧹 Combobox finalize: ESC + blur');
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', bubbles: true }));
    await sleep(stageDelay);
    element.blur();
    element.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  private async setInputValue(element: HTMLElement, value: string, inputType: string): Promise<void> {
    if (inputType === 'checkbox' || inputType === 'radio') {
      (element as HTMLInputElement).checked = value !== 'false' && value !== '0' && value !== '';
    } else {
      this.setNativeInputValue(element, value);
    }
  }

  private async setTextareaValue(element: HTMLElement, value: string, isMonacoEditor: boolean): Promise<void> {
    if (isMonacoEditor) {
      await this.setMonacoEditorValue(element, value);
    } else {
      this.setNativeTextareaValue(element, value);
    }
  }

  private async setMonacoEditorValue(element: HTMLElement, value: string): Promise<void> {
    console.warn('🎯 Detected Monaco editor, using enhanced approach for value setting');

    element.focus();
    await this.clearMonacoEditor(element);
    this.setNativeTextareaValue(element, value);
    await this.triggerMonacoEvents(element, value);
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

    await new Promise((resolve) => setTimeout(resolve, INTERACTIVE_CONFIG.delays.technical.monacoClear));
  }

  private async triggerMonacoEvents(element: HTMLElement, value: string): Promise<void> {
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));

    const lastChar = value.slice(-1);
    if (lastChar) {
      element.dispatchEvent(new KeyboardEvent('keydown', { key: lastChar, bubbles: true }));
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
    await this.waitForReactUpdates();
    this.stateManager.setState(data, 'completed');
  }
}
