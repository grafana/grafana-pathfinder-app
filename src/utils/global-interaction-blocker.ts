import { InteractiveElementData } from '../types/interactive.types';

/**
 * Global interaction blocking state (singleton pattern)
 * Provides a safe way to block user interactions with Grafana while interactive sections are running
 */
class GlobalInteractionBlocker {
  private static instance: GlobalInteractionBlocker;
  private blockingOverlay: HTMLElement | null = null;
  private sectionBlockingActive = false; // Track section-level blocking
  private cancelCallback: (() => void) | null = null; // Callback to cancel running section
  private keyboardHandler: ((e: KeyboardEvent) => void) | null = null; // Global keyboard handler
  private resizeObserver: ResizeObserver | null = null;
  private windowResizeHandler: (() => void) | null = null;
  private windowScrollHandler: (() => void) | null = null;
  private modalObserver: MutationObserver | null = null;

  static getInstance(): GlobalInteractionBlocker {
    if (!GlobalInteractionBlocker.instance) {
      GlobalInteractionBlocker.instance = new GlobalInteractionBlocker();
    }
    return GlobalInteractionBlocker.instance;
  }

  private constructor() {}

  /**
   * Create a targeted blocking overlay that covers only the main Grafana content area
   * This naturally allows all interactions within the docs plugin while blocking main UI
   */
  private createBlockingOverlay(data: InteractiveElementData): void {
    if (this.blockingOverlay) {
      return;
    }

    // Find the main page content container
    const pageContent = document.getElementById('pageContent');

    this.blockingOverlay = document.createElement('div');
    this.blockingOverlay.id = 'interactive-blocking-overlay';

    if (pageContent) {
      // Position overlay to match the pageContent container exactly and keep it in sync
      const applyRect = () => {
        const rect = pageContent.getBoundingClientRect();
        this.blockingOverlay!.style.position = 'fixed';
        this.blockingOverlay!.style.top = `${rect.top}px`;
        this.blockingOverlay!.style.left = `${rect.left}px`;
        this.blockingOverlay!.style.width = `${rect.width}px`;
        this.blockingOverlay!.style.height = `${rect.height}px`;
        this.blockingOverlay!.style.background = 'transparent';
        // zIndex may be adjusted if a modal is present
        if (!this.isModalActive()) {
          this.blockingOverlay!.style.zIndex = '9999';
        }
        this.blockingOverlay!.style.pointerEvents = 'auto';
        this.updateOverlayModalState();
      };
      applyRect();
      // Observe size/position changes
      if ('ResizeObserver' in window) {
        this.resizeObserver = new ResizeObserver(() => applyRect());
        this.resizeObserver.observe(pageContent);
      }
      this.windowResizeHandler = () => applyRect();
      this.windowScrollHandler = () => applyRect();
      window.addEventListener('resize', this.windowResizeHandler, { passive: true });
      window.addEventListener('scroll', this.windowScrollHandler, { passive: true });
      // Watch for modal/drawer presence to adjust visuals
      this.modalObserver = new MutationObserver(() => this.updateOverlayModalState());
      this.modalObserver.observe(document.body, { childList: true, subtree: true });
    } else {
      // Fallback to full screen if pageContent not found
      this.blockingOverlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: transparent;
        z-index: 9999;
        pointer-events: auto;
      `;
    }

    // Create a small, unobtrusive status indicator at the bottom of the screen
    const statusIndicator = document.createElement('div');
    statusIndicator.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--grafana-background-primary, #1f1f23);
      color: var(--grafana-text-primary, #ffffff);
      padding: 12px 20px;
      border-radius: 8px;
      border: 1px solid var(--grafana-border-medium, #404040);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      font-family: var(--grafana-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 8px;
      pointer-events: none;
      z-index: 10000;
    `;

    statusIndicator.innerHTML = `
      <div style="
        width: 16px;
        height: 16px;
        border: 2px solid var(--grafana-text-secondary, #8e8e8e);
        border-top: 2px solid var(--grafana-text-primary, #ffffff);
        border-radius: 50%;
        animation: spin 1s linear infinite;
      "></div>
      Interactive step running...
      <button id="cancel-section-btn" style="
        background: var(--grafana-background-secondary, #2d2d31);
        border: 1px solid var(--grafana-border-medium, #404040);
        color: var(--grafana-text-primary, #ffffff);
        border-radius: 4px;
        padding: 4px 8px;
        margin-left: 8px;
        cursor: pointer;
        font-size: 12px;
        display: flex;
        align-items: center;
        gap: 4px;
        pointer-events: auto;
        z-index: 10001;
        position: relative;
      " title="Cancel section (Ctrl+C)">
        ✕ Cancel
      </button>
    `;

    this.blockingOverlay.appendChild(statusIndicator);

    // Add cancel button click handler
    const cancelButton = statusIndicator.querySelector('#cancel-section-btn');
    if (cancelButton) {
      cancelButton.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.cancelSection();
      });
    }

    // Set cursor to indicate blocking
    this.blockingOverlay.style.cursor = 'not-allowed';

    // Add simple event handler to block all interactions within the covered area
    const handleBlockedInteraction = (e: Event) => {
      // Allow clicks on the cancel button
      const target = e.target as HTMLElement;
      const isCancelButton = target.id === 'cancel-section-btn' || target.closest('#cancel-section-btn');

      if (isCancelButton) {
        // Let the cancel button handle its own click
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      // Only show warning for click events to avoid spam
      if (e.type === 'click') {
        console.warn('🚫 Please wait for the current interactive step to complete before continuing');
      }
    };

    // Add event listeners for various interaction types
    ['click', 'wheel', 'scroll', 'touchstart', 'touchmove', 'keydown'].forEach((eventType) => {
      this.blockingOverlay!.addEventListener(eventType, handleBlockedInteraction);
    });

    // Add global keyboard shortcut handler for Ctrl+C
    this.addGlobalKeyboardHandler();

    // All overlay styling and animations are provided by addGlobalInteractiveStyles() in interactive.styles.ts

    document.body.appendChild(this.blockingOverlay);
  }

  /**
   * Add global keyboard handler for section cancellation
   */
  private addGlobalKeyboardHandler(): void {
    if (this.keyboardHandler) {
      return; // Already added
    }

    this.keyboardHandler = (e: KeyboardEvent) => {
      // Ctrl/Cmd + C to cancel running section
      if ((e.ctrlKey || e.metaKey) && e.key === 'c' && this.sectionBlockingActive && this.cancelCallback) {
        // Only prevent default if not in an input field
        const target = e.target as HTMLElement;
        const isInputField =
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.contentEditable === 'true' ||
          target.isContentEditable;

        if (!isInputField) {
          e.preventDefault();
          e.stopPropagation();
          console.warn('🔥 Ctrl+C pressed - cancelling running section via global handler');
          this.cancelSection();
        }
      }
    };

    document.addEventListener('keydown', this.keyboardHandler, true); // Use capture phase
  }

  /**
   * Remove global keyboard handler
   */
  private removeGlobalKeyboardHandler(): void {
    if (this.keyboardHandler) {
      document.removeEventListener('keydown', this.keyboardHandler, true);
      this.keyboardHandler = null;
    }
  }

  /**
   * Remove the blocking overlay
   */
  private removeBlockingOverlay(): void {
    if (this.blockingOverlay) {
      this.blockingOverlay.remove();
      this.blockingOverlay = null;
    }

    // Remove global keyboard handler when overlay is removed
    this.removeGlobalKeyboardHandler();
    // Remove position sync listeners/observers
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.windowResizeHandler) {
      window.removeEventListener('resize', this.windowResizeHandler);
      this.windowResizeHandler = null;
    }
    if (this.windowScrollHandler) {
      window.removeEventListener('scroll', this.windowScrollHandler);
      this.windowScrollHandler = null;
    }
    if (this.modalObserver) {
      this.modalObserver.disconnect();
      this.modalObserver = null;
    }
  }

  /**
   * Start blocking for an entire section (persists until section completes)
   */
  startSectionBlocking(sectionId: string, data: InteractiveElementData, cancelCallback?: () => void): void {
    if (this.sectionBlockingActive) {
      return;
    }

    this.sectionBlockingActive = true;
    this.cancelCallback = cancelCallback || null;
    this.createBlockingOverlay(data);
  }

  /**
   * Stop section blocking (removes overlay)
   */
  stopSectionBlocking(sectionId: string): void {
    if (!this.sectionBlockingActive) {
      return;
    }

    this.sectionBlockingActive = false;
    this.cancelCallback = null;
    this.removeBlockingOverlay();
  }

  /**
   * Cancel the currently running section
   */
  cancelSection(): void {
    if (!this.sectionBlockingActive || !this.cancelCallback) {
      return;
    }

    console.warn(`🛑 Cancelling running section...`);
    this.cancelCallback();
    // Note: stopSectionBlocking will be called by the section handler after cleanup
  }

  /**
   * Check if section blocking is active
   */
  isSectionBlocking(): boolean {
    return this.sectionBlockingActive;
  }

  /**
   * Emergency cleanup method
   */
  forceUnblock(): void {
    this.sectionBlockingActive = false;
    this.cancelCallback = null;
    this.removeGlobalKeyboardHandler();
    this.removeBlockingOverlay();
  }

  // Detect if a modal/drawer is currently active in Grafana UI
  private isModalActive(): boolean {
    // Look for elements commonly used by Grafana for drawers/modals
    const modalSelectors = [
      '[role="dialog"]',
      '.journey-image-modal',
      '.gf-modal',
      '.css-yt5niv', // overlay role=presentation (Grafana drawer backdrop)
    ];
    return modalSelectors.some((sel) => document.querySelector(sel) !== null);
  }

  // Adjust overlay visuals when modal is present
  private updateOverlayModalState(): void {
    if (!this.blockingOverlay) {
      return;
    }
    const modalActive = this.isModalActive();
    if (modalActive) {
      // While a modal is present, hide overlay visuals and interactions entirely
      this.blockingOverlay.style.zIndex = '0';
      this.blockingOverlay.style.pointerEvents = 'none';
      this.blockingOverlay.classList.add('no-breathe');
      this.blockingOverlay.style.visibility = 'hidden';
    } else {
      this.blockingOverlay.style.zIndex = '9999';
      this.blockingOverlay.style.pointerEvents = 'auto';
      this.blockingOverlay.classList.remove('no-breathe');
      this.blockingOverlay.style.visibility = 'visible';
    }
  }
}

export default GlobalInteractionBlocker;
