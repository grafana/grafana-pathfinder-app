/**
 * Viewport screenshot helper for AI auto-heal.
 *
 * Captures the current viewport as a JPEG data URL using html2canvas.
 * Used by the AI fix flow to give the assistant a visual snapshot of what
 * the user is seeing when a selector misses.
 *
 * Constraints:
 * - Lazy-imports html2canvas so the dep cost is only paid when an AI fix
 *   is actually invoked.
 * - Caps the output at JPEG quality 0.6 with max dim 1280×720 so we stay
 *   well under the assistant's prompt token budget. Typical payload:
 *   100–300KB base64.
 * - Returns `null` (not throws) on any capture failure so the AI fix flow
 *   can proceed with structured context only.
 *
 * NOTE: html2canvas can't capture cross-origin iframes or Canvas/WebGL
 * panels — Grafana dashboards with those will show blank regions. That's
 * acceptable here; structured context still flows through.
 */

const MAX_WIDTH = 1280;
const MAX_HEIGHT = 720;
const JPEG_QUALITY = 0.6;

export interface ViewportCaptureOptions {
  /**
   * Element to capture. Defaults to `document.body`. Callers can pass a
   * specific container to bound the capture (e.g., the main Grafana panel
   * area, excluding the Pathfinder sidebar itself).
   */
  target?: HTMLElement;
}

/**
 * Capture the current viewport as a `data:image/jpeg;base64,…` URL, or
 * `null` if the capture fails for any reason (dep missing, security
 * restriction, OOM, …).
 */
export async function captureViewport(options: ViewportCaptureOptions = {}): Promise<string | null> {
  if (typeof document === 'undefined') {
    return null;
  }
  const target = options.target ?? document.body;
  try {
    const { default: html2canvas } = await import('html2canvas');
    const canvas = await html2canvas(target, {
      backgroundColor: null,
      logging: false,
      useCORS: true,
      scale: Math.min(1, Math.min(MAX_WIDTH / target.clientWidth, MAX_HEIGHT / target.clientHeight)),
      width: target.clientWidth,
      height: target.clientHeight,
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
    });
    return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  } catch (error) {
    console.warn('[captureViewport] capture failed; AI fix will proceed without screenshot:', error);
    return null;
  }
}
