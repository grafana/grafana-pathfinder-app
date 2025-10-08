import { useEffect } from 'react';
import { reportAppInteraction, UserInteraction } from '../lib/analytics';

interface GlobalLinkInterceptorProps {
  onOpenDocsLink: (url: string, title: string) => void;
  enabled?: boolean;
}

/**
 * Determines if a URL is a supported Grafana docs link that can be opened in Pathfinder
 */
function isSupportedDocsUrl(url: string): boolean {
  try {
    // Check if it's a Grafana docs, tutorial, or learning journey URL
    if (
      url.includes('grafana.com/docs/') ||
      url.includes('grafana.com/tutorials/') ||
      url.includes('grafana.com/learning-journeys/')
    ) {
      return true;
    }

    // Also support relative paths that might be Grafana docs
    if (url.startsWith('/docs/') || url.startsWith('/tutorials/') || url.startsWith('/learning-journeys/')) {
      return true;
    }

    return false;
  } catch (error) {
    console.warn('Error checking if URL is supported:', error);
    return false;
  }
}

/**
 * Global link interceptor that catches documentation links across all of Grafana
 * and opens them in Pathfinder instead of a new browser tab.
 *
 * Features:
 * - Respects user intent (Ctrl/Cmd+Click opens in new tab)
 * - Only intercepts supported docs URLs
 * - Avoids double-handling of links inside Pathfinder content
 * - Opt-in feature (disabled by default)
 *
 * @param onOpenDocsLink - Callback to open docs link in Pathfinder
 * @param enabled - Whether to enable global link interception (default: false)
 */
export function useGlobalLinkInterceptor({ onOpenDocsLink, enabled = false }: GlobalLinkInterceptorProps) {
  useEffect(() => {
    // Feature is disabled, don't attach listener
    if (!enabled) {
      return;
    }

    const handleGlobalClick = (event: MouseEvent) => {
      // Only intercept if it's a left-click without modifiers
      // Allow Ctrl/Cmd+Click, Shift+Click, Alt+Click and middle-click to open in new tab as normal
      if (
        event.button !== 0 || // Not a left-click
        event.ctrlKey || // Ctrl+Click (Windows/Linux)
        event.metaKey || // Cmd+Click (Mac)
        event.shiftKey || // Shift+Click
        event.altKey // Alt+Click
      ) {
        return;
      }

      const target = event.target as HTMLElement;
      const anchor = target.closest('a[href]') as HTMLAnchorElement;

      if (!anchor) {
        return;
      }

      const href = anchor.getAttribute('href');
      if (!href) {
        return;
      }

      // Skip if the link is already inside Pathfinder plugin content
      // This prevents double-handling of links that are already managed by useLinkClickHandler
      if (anchor.closest('[data-pathfinder-content]')) {
        return;
      }

      // Resolve relative URLs to full URLs
      let fullUrl: string;
      try {
        if (href.startsWith('http://') || href.startsWith('https://')) {
          // Already a full URL
          fullUrl = href;
        } else if (href.startsWith('/')) {
          // Absolute path - assume it's on grafana.com domain
          fullUrl = `https://grafana.com${href}`;
        } else if (href.startsWith('#')) {
          // Fragment link - skip it (let browser handle)
          return;
        } else {
          // Relative path - resolve against current location
          fullUrl = new URL(href, window.location.href).href;
        }
      } catch (error) {
        console.warn('Failed to resolve URL:', href, error);
        return;
      }

      // Check if this is a supported docs URL
      if (isSupportedDocsUrl(fullUrl)) {
        // CRITICAL: Prevent default navigation IMMEDIATELY and stop all propagation
        // This must happen before anything else to block the link from opening
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        // Also remove target="_blank" to prevent new tab opening
        if (anchor.hasAttribute('target')) {
          anchor.removeAttribute('target');
        }

        // Extract link text for tab title
        const linkText = anchor.textContent?.trim() || anchor.getAttribute('aria-label') || 'Documentation';

        // Track analytics for intercepted link
        reportAppInteraction(UserInteraction.GlobalDocsLinkIntercepted, {
          content_url: fullUrl,
          link_text: linkText,
          source_location: 'global',
          timestamp: Date.now(),
        });

        // Open in Pathfinder
        onOpenDocsLink(fullUrl, linkText);
      }
    };

    // Add listener in capture phase to catch events before they bubble
    // This ensures we intercept the click before any other handlers
    document.addEventListener('click', handleGlobalClick, { capture: true });

    // Cleanup on unmount
    return () => {
      document.removeEventListener('click', handleGlobalClick, { capture: true });
    };
  }, [onOpenDocsLink, enabled]);
}
