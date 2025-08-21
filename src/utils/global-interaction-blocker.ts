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
  private modalStateDebounceTimer: number | null = null;
  private modalPollingInterval: number | null = null;
  private lastKnownModalState = false;
  private headerOverlay: HTMLElement | null = null;
  private fullScreenOverlay: HTMLElement | null = null;

  static getInstance(): GlobalInteractionBlocker {
    if (!GlobalInteractionBlocker.instance) {
      GlobalInteractionBlocker.instance = new GlobalInteractionBlocker();
    }
    return GlobalInteractionBlocker.instance;
  }

  private constructor() {}

  /**
   * Create multiple blocking overlays: main content, header, and full-screen modal blocker
   * This provides comprehensive interaction blocking while preserving docs plugin functionality
   */
  private createBlockingOverlay(data: InteractiveElementData): void {
    if (this.blockingOverlay) {
      return;
    }

    // Create main content overlay
    this.createMainContentOverlay(data);
    
    // Create header overlay  
    this.createHeaderOverlay();
    
    // Create full screen overlay (initially hidden)
    this.createFullScreenOverlay();

    // Setup modal observation and resize handling
    this.setupOverlayManagement();

    // Add initial status indicator to main overlay
    this.addStatusIndicator(data);
  }

  /**
   * Create overlay for main page content area
   */
  private createMainContentOverlay(data: InteractiveElementData): void {
    const pageContent = document.getElementById('pageContent');
    
    this.blockingOverlay = document.createElement('div');
    this.blockingOverlay.id = 'interactive-blocking-overlay';

    if (pageContent) {
      this.positionOverlayToElement(this.blockingOverlay, pageContent);
    } else {
      // Fallback positioning if pageContent not found
      this.blockingOverlay.style.cssText = `
        position: fixed;
        top: 60px;
        left: 0;
        width: 100vw;
        height: calc(100vh - 60px);
        background: transparent;
        z-index: 9999;
        pointer-events: auto;
      `;
    }
    
    document.body.appendChild(this.blockingOverlay);
  }

  /**
   * Create overlay for top navigation header
   */
  private createHeaderOverlay(): void {
    const header = document.querySelector('header.css-1ef5w88') as HTMLElement;
    
    if (!header) {
      return; // No header found, skip
    }

    this.headerOverlay = document.createElement('div');
    this.headerOverlay.id = 'interactive-header-overlay';
    this.positionOverlayToElement(this.headerOverlay, header);
    
    // Header overlay has no cancel button - it's purely blocking
    this.headerOverlay.style.cursor = 'not-allowed';
    this.addBlockingHandlers(this.headerOverlay);
    
    document.body.appendChild(this.headerOverlay);
  }

  /**
   * Create full-screen overlay for modal blocking (initially hidden)
   */
  private createFullScreenOverlay(): void {
    this.fullScreenOverlay = document.createElement('div');
    this.fullScreenOverlay.id = 'interactive-fullscreen-overlay';
    this.fullScreenOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: transparent;
      z-index: 10000;
      pointer-events: auto;
      cursor: not-allowed;
      display: none;
    `;
    
    // Full-screen overlay gets basic blocking (the cancel button from main overlay will still work)
    this.addBlockingHandlers(this.fullScreenOverlay);
    document.body.appendChild(this.fullScreenOverlay);
  }

  /**
   * Position an overlay to exactly match a target element
   */
  private positionOverlayToElement(overlay: HTMLElement, targetElement: HTMLElement): void {
    const applyRect = () => {
      const rect = targetElement.getBoundingClientRect();
      overlay.style.position = 'fixed';
      overlay.style.top = `${rect.top}px`;
      overlay.style.left = `${rect.left}px`;
      overlay.style.width = `${rect.width}px`;
      overlay.style.height = `${rect.height}px`;
      overlay.style.background = 'transparent';
      overlay.style.zIndex = '9999';
      overlay.style.pointerEvents = 'auto';
    };
    
    applyRect();
    
    // Store the update function for later use
    if (!this.windowResizeHandler) {
      this.windowResizeHandler = () => {
        applyRect();
        // Also update header overlay if it exists
        if (this.headerOverlay) {
          const header = document.querySelector('header.css-1ef5w88') as HTMLElement;
          if (header) {
            this.positionOverlayToElement(this.headerOverlay, header);
          }
        }
      };
      this.windowScrollHandler = this.windowResizeHandler;
      
      window.addEventListener('resize', this.windowResizeHandler, { passive: true });
      window.addEventListener('scroll', this.windowScrollHandler, { passive: true });
    }
    
    // Observe size changes for the target element
    if ('ResizeObserver' in window && !this.resizeObserver) {
      this.resizeObserver = new ResizeObserver(() => {
        applyRect();
        if (this.headerOverlay) {
          const header = document.querySelector('header.css-1ef5w88') as HTMLElement;
          if (header) {
            this.positionOverlayToElement(this.headerOverlay, header);
          }
        }
      });
      this.resizeObserver.observe(targetElement);
    }
  }

  /**
   * Setup modal observation and overlay management
   */
  private setupOverlayManagement(): void {
    this.setupModalObserver();
    this.updateOverlayModalState(); // Initial state check
  }

  /**
   * Add blocking interaction handlers to an overlay
   */
  private addBlockingHandlers(overlay: HTMLElement): void {
    const handleBlockedInteraction = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      // Only show warning for click events to avoid spam
      if (e.type === 'click') {
        // User tried to interact while section is running - no logging needed
      }
    };

    // Block all major interaction events
    ['click', 'mousedown', 'mouseup', 'keydown', 'keyup', 'touchstart', 'touchend'].forEach((eventType) => {
      overlay.addEventListener(eventType, handleBlockedInteraction, {
        capture: true,
        passive: false,
      });
    });
  }

  /**
   * Add status indicator and cancel button to main overlay
   */
  private addStatusIndicator(data: InteractiveElementData): void {
    if (!this.blockingOverlay) {
      return;
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

    // Set cursor to indicate blocking and add interaction handlers
    this.blockingOverlay.style.cursor = 'not-allowed';
    this.addBlockingHandlersWithCancelException(this.blockingOverlay);
  }

  /**
   * Add blocking handlers that allow cancel button interactions
   */
  private addBlockingHandlersWithCancelException(overlay: HTMLElement): void {
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
        // User tried to interact while section is running - no logging needed
      }
    };

    // Add event listeners for various interaction types
    ['click', 'wheel', 'scroll', 'touchstart', 'touchmove', 'keydown'].forEach((eventType) => {
      overlay.addEventListener(eventType, handleBlockedInteraction);
    });

    // Add global keyboard shortcut handler for Ctrl+C
    this.addGlobalKeyboardHandler();
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
   * Remove all blocking overlays and clean up all associated resources
   */
  private removeBlockingOverlay(): void {
    // Remove main content overlay
    if (this.blockingOverlay) {
      this.blockingOverlay.remove();
      this.blockingOverlay = null;
    }

    // Remove header overlay
    if (this.headerOverlay) {
      this.headerOverlay.remove();
      this.headerOverlay = null;
    }

    // Remove full-screen overlay
    if (this.fullScreenOverlay) {
      this.fullScreenOverlay.remove();
      this.fullScreenOverlay = null;
    }

    // Remove global keyboard handler when overlays are removed
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
    
    // Clean up modal detection resources
    if (this.modalObserver) {
      this.modalObserver.disconnect();
      this.modalObserver = null;
    }
    if (this.modalStateDebounceTimer) {
      window.clearTimeout(this.modalStateDebounceTimer);
      this.modalStateDebounceTimer = null;
    }
    if (this.modalPollingInterval) {
      window.clearInterval(this.modalPollingInterval);
      this.modalPollingInterval = null;
    }
    
    // Reset state tracking
    this.lastKnownModalState = false;
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
    
    // Initialize modal state tracking with current state
    this.lastKnownModalState = this.isModalActive();
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
    this.removeBlockingOverlay(); // This now handles all cleanup including timers
  }

  /**
   * Setup comprehensive modal observation
   */
  private setupModalObserver(): void {
    // Debounced update function to prevent rapid-fire calls
    const debouncedUpdate = () => {
      if (this.modalStateDebounceTimer) {
        window.clearTimeout(this.modalStateDebounceTimer);
      }
      this.modalStateDebounceTimer = window.setTimeout(() => {
        this.updateOverlayModalState();
        this.modalStateDebounceTimer = null;
      }, 50); // 50ms debounce
    };

    // Set up mutation observer with comprehensive options
    this.modalObserver = new MutationObserver(debouncedUpdate);
    this.modalObserver.observe(document.body, {
      childList: true,    // Watch for added/removed nodes
      subtree: true,      // Watch all descendants
      attributes: true,   // Watch for attribute changes
      attributeFilter: ['class', 'style', 'role', 'aria-hidden', 'data-modal'], // Focus on modal-related attributes
      characterData: false // Don't need text changes
    });

    // Also set up a polling fallback to catch any edge cases
    this.modalPollingInterval = window.setInterval(() => {
      const currentModalState = this.isModalActive();
      if (currentModalState !== this.lastKnownModalState) {
        this.updateOverlayModalState();
      }
    }, 500); // Check every 500ms as fallback
  }

  /**
   * Smart modal detection - detect modals that should trigger full-screen blocking
   * Includes ARIA dialogs (like save modal) but excludes navigation drawers
   */
  private isModalActive(): boolean {
    // 1. Detect our own image modal (we control this)
    const ourModal = document.querySelector('.journey-image-modal');
    if (ourModal) {
      const style = window.getComputedStyle(ourModal);
      if (style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0) {
        return true;
      }
    }

    // 2. Detect standard ARIA dialogs (like save modal, settings modal, etc.)
    const ariaDialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
    for (const dialog of ariaDialogs) {
      const style = window.getComputedStyle(dialog);
      if (style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0) {
        // Check if this is a navigation drawer (these should NOT trigger full-screen mode)
        const isNavigationDrawer = dialog.closest('[class*="nav-"]') || 
                                   dialog.querySelector('[aria-label*="navigation"]') ||
                                   dialog.querySelector('[data-testid*="nav"]') ||
                                   (dialog.textContent || '').toLowerCase().includes('navigation menu');
        
        if (!isNavigationDrawer) {
          return true; // This is a real modal (save, settings, etc.)
        }
      }
    }

    return false;
  }

  /**
   * Handle modal state changes - switch between normal targeted overlays and full-screen mode
   */
  private updateOverlayModalState(): void {
    if (!this.blockingOverlay || !this.fullScreenOverlay) {
      return;
    }
    
    const modalActive = this.isModalActive();
    
    // Only update if modal state has changed to avoid unnecessary DOM manipulation
    if (modalActive !== this.lastKnownModalState) {
      this.lastKnownModalState = modalActive;
      
      if (modalActive) {
        // Modal is active: Hide targeted overlays and show full-screen overlay
        // Hide normal overlays
        this.blockingOverlay.style.display = 'none';
        if (this.headerOverlay) {
          this.headerOverlay.style.display = 'none';
        }
        
        // Show full-screen overlay to block modal interaction
        this.fullScreenOverlay.style.display = 'block';
        
      } else {
        // Modal is gone: Show targeted overlays and hide full-screen overlay
        // Hide full-screen overlay
        this.fullScreenOverlay.style.display = 'none';
        
        // Restore normal overlays
        this.blockingOverlay.style.display = 'block';
        if (this.headerOverlay) {
          this.headerOverlay.style.display = 'block';
        }
      }
    }
  }
}

export default GlobalInteractionBlocker;
