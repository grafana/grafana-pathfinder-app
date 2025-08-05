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

    await this.setElementValue(targetElement, value, tagName, inputType, isMonacoEditor);
    await this.dispatchEvents(targetElement, tagName, isMonacoEditor);
    await this.markAsCompleted(data);
  }

  private getInputType(element: HTMLElement): string {
    return (element as HTMLInputElement).type ? (element as HTMLInputElement).type.toLowerCase() : '';
  }

  private isMonacoEditor(element: HTMLElement): boolean {
    return element.classList.contains('inputarea') && 
           element.classList.contains('monaco-mouse-cursor-text');
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
    element.dispatchEvent(new KeyboardEvent('keydown', { 
      key: 'a', code: 'KeyA', ctrlKey: true, bubbles: true 
    }));
    element.dispatchEvent(new KeyboardEvent('keydown', { 
      key: 'Delete', code: 'Delete', bubbles: true 
    }));
    
    await new Promise(resolve => setTimeout(resolve, INTERACTIVE_CONFIG.delays.technical.monacoClear));
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
