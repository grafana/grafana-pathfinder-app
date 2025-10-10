/**
 * Action Capture System for Collaborative Sessions
 * 
 * Intercepts presenter's interactive tutorial actions (Show Me / Do It clicks)
 * and broadcasts them to all connected attendees via WebRTC data channels.
 */

import type { SessionManager } from './session-manager';
import type { InteractiveStepEvent, InteractiveAction } from '../../types/collaboration.types';

/**
 * Action capture system that intercepts and broadcasts presenter actions
 */
export class ActionCaptureSystem {
  private isCapturing = false;
  private sessionManager: SessionManager;
  private sessionId: string;
  
  // Debounce tracking to prevent duplicate events
  private lastEvent: { type: string; stepId: string; timestamp: number } | null = null;
  private readonly DEBOUNCE_MS = 100;
  
  constructor(sessionManager: SessionManager, sessionId: string) {
    this.sessionManager = sessionManager;
    this.sessionId = sessionId;
  }
  
  /**
   * Start capturing interactive actions
   */
  startCapture(): void {
    if (this.isCapturing) {
      console.warn('[ActionCapture] Already capturing');
      return;
    }
    
    this.isCapturing = true;
    this.setupCaptureHandlers();
    console.log('[ActionCapture] Started capturing presenter actions');
  }
  
  /**
   * Stop capturing actions and restore original behavior
   */
  stopCapture(): void {
    if (!this.isCapturing) {
      return;
    }
    
    this.isCapturing = false;
    this.restoreOriginalHandlers();
    console.log('[ActionCapture] Stopped capturing');
  }
  
  /**
   * Set up capture handlers for Show Me and Do It buttons
   */
  private setupCaptureHandlers(): void {
    // Use event delegation on the document to capture all button clicks
    document.addEventListener('click', this.handleButtonClick, true);
    
    console.log('[ActionCapture] Capture handlers set up');
  }
  
  /**
   * Handle button clicks to intercept Show Me / Do It actions
   */
  private handleButtonClick = (event: MouseEvent): void => {
    if (!this.isCapturing) {
      return;
    }
    
    const target = event.target as HTMLElement;
    
    // Check if this is a Show Me or Do It button
    const button = this.findInteractiveButton(target);
    if (!button) {
      return;
    }
    
    const buttonType = this.getButtonType(button);
    if (!buttonType) {
      return;
    }
    
    // Get the interactive step element
    const stepElement = this.findInteractiveStepElement(button);
    if (!stepElement) {
      console.warn('[ActionCapture] Could not find interactive step element');
      return;
    }
    
    // Extract action details
    const action = this.extractActionFromElement(stepElement);
    if (!action) {
      console.warn('[ActionCapture] Could not extract action details');
      return;
    }
    
    const stepId = stepElement.getAttribute('data-step-id') || this.generateStepId(stepElement);
    
    // Check for duplicate events (debounce)
    if (this.isDuplicateEvent(buttonType, stepId)) {
      console.log('[ActionCapture] Skipping duplicate event');
      return;
    }
    
    // Get screen coordinates for positioning
    const coordinates = {
      x: event.clientX,
      y: event.clientY
    };
    
    // Create and broadcast event
    const sessionEvent: InteractiveStepEvent = {
      type: buttonType,
      sessionId: this.sessionId,
      timestamp: Date.now(),
      senderId: 'presenter',
      stepId,
      action,
      coordinates
    };
    
    this.sessionManager.broadcastEvent(sessionEvent);
    console.log(`[ActionCapture] Broadcasted ${buttonType} event for step: ${stepId}`);
    
    // Update last event for debouncing
    this.lastEvent = {
      type: buttonType,
      stepId,
      timestamp: Date.now()
    };
    
    // Don't prevent default - let the original action execute for presenter
  };
  
  /**
   * Find the interactive button element (Show Me or Do It)
   */
  private findInteractiveButton(element: HTMLElement): HTMLElement | null {
    // Check if element itself is the button
    if (this.isInteractiveButton(element)) {
      return element;
    }
    
    // Check parent elements (in case click was on icon or text inside button)
    let current = element.parentElement;
    let depth = 0;
    while (current && depth < 5) {
      if (this.isInteractiveButton(current)) {
        return current;
      }
      current = current.parentElement;
      depth++;
    }
    
    return null;
  }
  
  /**
   * Check if element is an interactive button
   */
  private isInteractiveButton(element: HTMLElement): boolean {
    const text = element.textContent?.toLowerCase() || '';
    const ariaLabel = element.getAttribute('aria-label')?.toLowerCase() || '';
    
    return (
      (text.includes('show me') || text.includes('do it') ||
       ariaLabel.includes('show me') || ariaLabel.includes('do it')) &&
      (element.tagName === 'BUTTON' || element.getAttribute('role') === 'button')
    );
  }
  
  /**
   * Determine button type (show_me or do_it)
   */
  private getButtonType(button: HTMLElement): 'show_me' | 'do_it' | null {
    const text = button.textContent?.toLowerCase() || '';
    const ariaLabel = button.getAttribute('aria-label')?.toLowerCase() || '';
    const combined = text + ' ' + ariaLabel;
    
    if (combined.includes('show me')) {
      return 'show_me';
    } else if (combined.includes('do it')) {
      return 'do_it';
    }
    
    return null;
  }
  
  /**
   * Find the parent interactive step element
   */
  private findInteractiveStepElement(button: HTMLElement): HTMLElement | null {
    let current: HTMLElement | null = button;
    let depth = 0;
    
    while (current && depth < 10) {
      // Look for interactive step markers (the actual classes used in the codebase)
      if (
        current.classList.contains('interactive-step') ||
        current.classList.contains('interactive-guided') ||
        current.classList.contains('interactive-multi-step') ||
        current.hasAttribute('data-targetaction') ||
        current.hasAttribute('data-reftarget')
      ) {
        return current;
      }
      current = current.parentElement;
      depth++;
    }
    
    return null;
  }
  
  /**
   * Extract action details from interactive element
   */
  private extractActionFromElement(element: HTMLElement): InteractiveAction | null {
    const targetAction = element.getAttribute('data-targetaction');
    const refTarget = element.getAttribute('data-reftarget');
    const targetValue = element.getAttribute('data-targetvalue');
    const targetComment = element.getAttribute('data-targetcomment');
    
    if (!targetAction || !refTarget) {
      return null;
    }
    
    return {
      targetAction: targetAction as any,
      refTarget,
      targetValue: targetValue || undefined,
      targetComment: targetComment || undefined
    };
  }
  
  /**
   * Generate a unique step ID from element
   */
  private generateStepId(element: HTMLElement): string {
    // Try to use existing ID
    const existingId = element.id || element.getAttribute('data-step-id');
    if (existingId) {
      return existingId;
    }
    
    // Generate ID based on action and selector
    const action = element.getAttribute('data-targetaction') || 'unknown';
    const target = element.getAttribute('data-reftarget') || 'unknown';
    const hash = this.simpleHash(action + target);
    
    return `step-${hash}`;
  }
  
  /**
   * Simple hash function for generating IDs
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }
  
  /**
   * Check if this is a duplicate event (debouncing)
   */
  private isDuplicateEvent(type: string, stepId: string): boolean {
    if (!this.lastEvent) {
      return false;
    }
    
    const timeSinceLastEvent = Date.now() - this.lastEvent.timestamp;
    
    return (
      this.lastEvent.type === type &&
      this.lastEvent.stepId === stepId &&
      timeSinceLastEvent < this.DEBOUNCE_MS
    );
  }
  
  /**
   * Restore original handlers (cleanup)
   */
  private restoreOriginalHandlers(): void {
    document.removeEventListener('click', this.handleButtonClick, true);
  }
  
  /**
   * Check if currently capturing
   */
  isActive(): boolean {
    return this.isCapturing;
  }
}

