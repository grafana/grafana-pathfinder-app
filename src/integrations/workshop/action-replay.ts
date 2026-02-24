/**
 * Action Replay System for Collaborative Sessions
 *
 * Receives events from presenter and replays them on attendee's screen.
 * Handles both Guided mode (highlights only) and Follow mode (execute actions).
 */

import { getAppEvents } from '@grafana/runtime';
import type { NavigationManager } from '../../interactive-engine';
import type {
  AttendeeMode,
  AnySessionEvent,
  InteractiveStepEvent,
  NavigationEvent,
  InteractiveAction,
} from '../../types/collaboration.types';
import { isCssSelector } from '../../lib/dom/selector-detector';
import { querySelectorAllEnhanced } from '../../lib/dom/enhanced-selector';

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
    if (this.mode !== mode) {
      console.log(`[ActionReplay] Mode changed: ${this.mode} → ${mode}`);
      this.mode = mode;
    }
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
      console.log(`[ActionReplay] 📨 Received event:`, {
        type: event.type,
        mode: this.mode,
        sessionId: event.sessionId,
        timestamp: event.timestamp,
      });

      // Log detailed info for interactive events
      if (event.type === 'show_me' || event.type === 'do_it') {
        const stepEvent = event as InteractiveStepEvent;
        console.log(`[ActionReplay] 🎯 Interactive event details:`, {
          stepId: stepEvent.stepId,
          actionType: stepEvent.action?.targetAction,
          refTarget: stepEvent.action?.refTarget,
          targetValue: stepEvent.action?.targetValue,
        });
      }

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
      timestamp: event.timestamp,
    };
  }

  /**
   * Handle Do It event (behavior depends on mode)
   */
  private async handleDoIt(event: InteractiveStepEvent): Promise<void> {
    console.log(`[ActionReplay] handleDoIt called - Current mode: ${this.mode}`);

    // Check for duplicate
    if (this.isDuplicateEvent('do_it', event.stepId, event.timestamp)) {
      console.log('[ActionReplay] Skipping duplicate do_it event');
      return;
    }

    if (this.mode === 'guided') {
      // In Guided mode: Handle multistep actions specially
      if (event.action?.targetAction === 'multistep') {
        console.log('[ActionReplay] Guided mode: Multistep action detected');
        this.showNotification(
          'The presenter is performing a multi-step action. You can follow along manually or click "Do It" yourself when ready.',
          'success'
        );
      } else {
        // For non-multistep: Show highlight
        console.log('[ActionReplay] Guided mode: Showing highlight only for Do It');
        await this.showHighlight(event);
      }
    } else if (this.mode === 'follow') {
      // In Follow mode: Execute the action
      console.log('[ActionReplay] Follow mode: Executing action');
      await this.executeAction(event);
    } else {
      console.warn(`[ActionReplay] Unknown mode: ${this.mode}`);
    }

    // Update last event
    this.lastEvent = {
      type: 'do_it',
      stepId: event.stepId,
      timestamp: event.timestamp,
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
      const element = elements[0]!;

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

      console.log(`[ActionReplay] ⚡ Starting execution:`, {
        targetAction: action.targetAction,
        refTarget: action.refTarget,
        targetValue: action.targetValue,
        stepId: event.stepId,
      });

      // Find the interactive step element on this page
      const stepElement = this.findStepElement(event.stepId, action);

      if (!stepElement) {
        console.error('[ActionReplay] ❌ Step element not found:', {
          stepId: event.stepId,
          actionType: action.targetAction,
          refTarget: action.refTarget,
        });
        console.warn('[ActionReplay] Attendee may be on different page');
        this.showNotification(
          'Unable to execute action - please ensure you are on the same page as presenter',
          'warning'
        );
        return;
      }

      console.log('[ActionReplay] ✅ Found step element:', stepElement);

      // Special handling for multistep actions
      if (action.targetAction === 'multistep') {
        console.log(`[ActionReplay] Executing multistep with ${action.internalActions?.length || 0} internal actions`);
      }

      // Find and click the "Do It" button - this triggers the normal interactive flow
      // Note: attendees render the same HTML, so data-targetvalue is already correct
      const doItButton = this.findDoItButton(stepElement);

      if (doItButton) {
        console.log('[ActionReplay] 🖱️ Clicking Do It button');
        doItButton.click();
        console.log('[ActionReplay] ✅ Do It button clicked');
      } else {
        // Fallback: should rarely happen
        console.warn('[ActionReplay] ❌ Do It button not found');
      }
    } catch (error) {
      console.error('[ActionReplay] Error executing action:', error);
      this.showNotification('Failed to execute action', 'error');
    }
  }

  /**
   * Find the interactive step element matching the captured action
   */
  private findStepElement(stepId: string, action: InteractiveAction): HTMLElement | null {
    // Try by step ID first
    const byId = document.querySelector(`[data-step-id="${stepId}"]`) as HTMLElement;
    if (byId) {
      return byId;
    }

    // Try by action attributes
    const byAttributes = document.querySelector(
      `[data-targetaction="${action.targetAction}"][data-reftarget="${action.refTarget}"]`
    ) as HTMLElement;

    return byAttributes;
  }

  /**
   * Find the "Do It" button within a step element
   */
  private findDoItButton(stepElement: HTMLElement): HTMLButtonElement | null {
    // Look for buttons with text "Do it" or "Do It"
    const buttons = stepElement.querySelectorAll('button');
    for (const button of buttons) {
      const text = button.textContent?.trim().toLowerCase() || '';
      if (text.includes('do it') && !text.includes('show')) {
        return button;
      }
    }
    return null;
  }

  /**
   * Find elements matching the selector/text
   */
  private findElements(refTarget: string, targetAction: string): HTMLElement[] {
    try {
      if (targetAction === 'button') {
        // Try selector first if it looks like CSS
        if (isCssSelector(refTarget)) {
          const result = querySelectorAllEnhanced(refTarget);
          const buttons = result.elements.filter(
            (el) => el.tagName === 'BUTTON' || el.getAttribute('role') === 'button'
          );
          if (buttons.length > 0) {
            return buttons;
          }
        }

        // Fall back to text matching
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
    const eventType = type === 'success' ? 'alert-success' : type === 'warning' ? 'alert-warning' : 'alert-error';
    getAppEvents().publish({
      type: eventType,
      payload: ['Live Session', message],
    });
  }
}
