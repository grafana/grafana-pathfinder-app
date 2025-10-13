/**
 * Action Replay System for Collaborative Sessions
 * 
 * Receives events from presenter and replays them on attendee's screen.
 * Handles both Guided mode (highlights only) and Follow mode (execute actions).
 */

import type { NavigationManager } from '../navigation-manager';
import type {
  AttendeeMode,
  AnySessionEvent,
  InteractiveStepEvent,
  NavigationEvent
} from '../../types/collaboration.types';

/**
 * Action replay system for attendees
 */
export class ActionReplaySystem {
  private mode: AttendeeMode;
  private navigationManager: NavigationManager;
  
  // Track last replayed event to avoid duplicates
  private lastEvent: { type: string; stepId: string; timestamp: number } | null = null;
  
  constructor(mode: AttendeeMode, navigationManager: NavigationManager) {
    this.mode = mode;
    this.navigationManager = navigationManager;
  }
  
  /**
   * Update attendee mode
   */
  setMode(mode: AttendeeMode): void {
    console.log(`[ActionReplay] Mode changed: ${this.mode} → ${mode}`);
    this.mode = mode;
  }
  
  /**
   * Get current mode
   */
  getMode(): AttendeeMode {
    return this.mode;
  }
  
  /**
   * Handle incoming event from presenter
   */
  async handleEvent(event: AnySessionEvent): Promise<void> {
    try {
      console.log(`[ActionReplay] Handling ${event.type} in ${this.mode} mode`);
      
      switch (event.type) {
        case 'show_me':
          await this.handleShowMe(event as InteractiveStepEvent);
          break;
          
        case 'do_it':
          await this.handleDoIt(event as InteractiveStepEvent);
          break;
          
        case 'navigation':
          await this.handleNavigation(event as NavigationEvent);
          break;
          
        case 'session_end':
          console.log('[ActionReplay] Session ended by presenter');
          // Session end is handled at the UI level, just log it here
          break;
          
        default:
          console.log(`[ActionReplay] Unhandled event type: ${event.type}`);
      }
    } catch (error) {
      console.error(`[ActionReplay] Error handling ${event.type}:`, error);
      // Don't throw - gracefully handle errors
    }
  }
  
  /**
   * Handle Show Me event (both modes show highlights)
   */
  private async handleShowMe(event: InteractiveStepEvent): Promise<void> {
    // Check for duplicate
    if (this.isDuplicateEvent('show_me', event.stepId, event.timestamp)) {
      console.log('[ActionReplay] Skipping duplicate show_me event');
      return;
    }
    
    await this.showHighlight(event);
    
    // Update last event
    this.lastEvent = {
      type: 'show_me',
      stepId: event.stepId,
      timestamp: event.timestamp
    };
  }
  
  /**
   * Handle Do It event (behavior depends on mode)
   */
  private async handleDoIt(event: InteractiveStepEvent): Promise<void> {
    // Check for duplicate
    if (this.isDuplicateEvent('do_it', event.stepId, event.timestamp)) {
      console.log('[ActionReplay] Skipping duplicate do_it event');
      return;
    }
    
    if (this.mode === 'guided') {
      // In Guided mode: Show highlight only, don't execute
      await this.showHighlight(event);
      console.log('[ActionReplay] Guided mode: Showing highlight only for Do It');
    } else if (this.mode === 'follow') {
      // In Follow mode: Execute the action
      await this.executeAction(event);
      console.log('[ActionReplay] Follow mode: Executed action');
    }
    
    // Update last event
    this.lastEvent = {
      type: 'do_it',
      stepId: event.stepId,
      timestamp: event.timestamp
    };
  }
  
  /**
   * Handle navigation event
   */
  private async handleNavigation(event: NavigationEvent): Promise<void> {
    console.log(`[ActionReplay] Navigation to: ${event.tutorialUrl}`);
    
    // TODO: Implement tutorial navigation
    // This will sync attendees to the same tutorial/step as presenter
    // For now, just log
    
    console.log(`[ActionReplay] TODO: Navigate to ${event.tutorialUrl}, step ${event.stepNumber}`);
  }
  
  /**
   * Show highlight for an action
   */
  private async showHighlight(event: InteractiveStepEvent): Promise<void> {
    try {
      const { action } = event;
      
      // Find the target element
      const elements = this.findElements(action.refTarget, action.targetAction);
      
      if (elements.length === 0) {
        console.warn(`[ActionReplay] Element not found: ${action.refTarget}`);
        this.showNotification(`Element not found: ${action.refTarget}`, 'warning');
        return;
      }
      
      // Use first matching element
      const element = elements[0];
      
      // Show highlight with comment
      // Pass false for enableAutoCleanup to keep highlight persistent until next action
      await this.navigationManager.highlightWithComment(
        element,
        action.targetComment || 'Presenter is highlighting this',
        false // Keep highlight persistent
      );
      
      console.log(`[ActionReplay] Highlighted element: ${action.refTarget}`);
    } catch (error) {
      console.error('[ActionReplay] Error showing highlight:', error);
      this.showNotification('Failed to show highlight', 'error');
    }
  }
  
  /**
   * Execute an action (Follow mode only)
   */
  private async executeAction(event: InteractiveStepEvent): Promise<void> {
    try {
      const { action } = event;
      
      console.log(`[ActionReplay] Executing ${action.targetAction} on ${action.refTarget}`);
      
      // TODO: Implement action execution using InteractiveStateManager
      // For now, just show the highlight
      await this.showHighlight(event);
      
      this.showNotification('Action executed', 'success');
    } catch (error) {
      console.error('[ActionReplay] Error executing action:', error);
      this.showNotification('Failed to execute action', 'error');
    }
  }
  
  /**
   * Find elements matching the selector/text
   */
  private findElements(refTarget: string, targetAction: string): HTMLElement[] {
    try {
      if (targetAction === 'button') {
        // For button actions, search by text content
        return this.findButtonsByText(refTarget);
      } else {
        // For other actions, use CSS selector
        const elements = document.querySelectorAll<HTMLElement>(refTarget);
        return Array.from(elements);
      }
    } catch (error) {
      console.error(`[ActionReplay] Error finding elements:`, error);
      return [];
    }
  }
  
  /**
   * Find buttons by text content
   */
  private findButtonsByText(text: string): HTMLElement[] {
    const buttons = document.querySelectorAll<HTMLElement>('button, [role="button"]');
    const matches: HTMLElement[] = [];
    
    for (const button of buttons) {
      const buttonText = button.textContent?.trim() || '';
      const ariaLabel = button.getAttribute('aria-label') || '';
      
      if (buttonText.includes(text) || ariaLabel.includes(text)) {
        matches.push(button);
      }
    }
    
    return matches;
  }
  
  /**
   * Check if event is duplicate
   */
  private isDuplicateEvent(type: string, stepId: string, timestamp: number): boolean {
    if (!this.lastEvent) {
      return false;
    }
    
    // Consider duplicate if same type/step and within 500ms
    return (
      this.lastEvent.type === type &&
      this.lastEvent.stepId === stepId &&
      Math.abs(timestamp - this.lastEvent.timestamp) < 500
    );
  }
  
  /**
   * Show notification to user
   */
  private showNotification(message: string, type: 'success' | 'warning' | 'error'): void {
    // TODO: Integrate with Grafana's notification system
    console.log(`[ActionReplay] ${type.toUpperCase()}: ${message}`);
  }
}

