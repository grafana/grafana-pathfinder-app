import { useEffect, useRef } from 'react';
import { getBackendSrv } from '@grafana/runtime';
import { sidebarState } from '../global-state/sidebar';

const PLUGIN_ID = 'grafana-pathfinder-app';
const POLL_INTERVAL_MS = 5000;
const RESOURCE_BASE = `/api/plugins/${PLUGIN_ID}/resources/mcp`;

/**
 * Polls the Go backend for a pending guide launch queued by the MCP launch_guide tool.
 *
 * When Grafana Assistant (or any MCP client) calls launch_guide, the backend stores
 * the request keyed by the Grafana user. This hook polls that endpoint every 5 s and,
 * when a pending launch is found, opens the Pathfinder sidebar and navigates to the guide.
 *
 * Must be called from a component that is mounted for the lifetime of the Pathfinder
 * sidebar (e.g. the ContextSidebar component in module.tsx).
 */
export function usePendingGuideLaunch(): void {
  const isLaunching = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      if (cancelled || isLaunching.current) {
        return;
      }

      try {
        const response = await getBackendSrv().get<{ guideId?: string }>(`${RESOURCE_BASE}/pending-launch`);

        if (cancelled) {
          return;
        }

        if (response?.guideId) {
          isLaunching.current = true;

          try {
            // Clear the pending state before launching to avoid re-trigger
            try {
              await getBackendSrv().post(`${RESOURCE_BASE}/pending-launch/clear`, {});
            } catch {
              // Non-fatal: proceed with launch even if clear fails
            }

            sidebarState.openWithGuide(response.guideId);
          } finally {
            isLaunching.current = false;
          }
        }
      } catch {
        // Network errors are expected during startup or when backend is unavailable
        // Silently ignore — the poll will retry on the next interval
      }
    };

    poll();
    const intervalId = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, []);
}
