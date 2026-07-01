import { createLatchedBroadcast } from '../lib/latched-broadcast';

// Detail payload of an auto-launch-tutorial request, consumed by the panel
// surfaces via `useAutoLaunchTutorial`. `type` and `source` are untyped here —
// they arrive from producers and are narrowed inside the hook.
export interface AutoLaunchTutorialDetail {
  url: string;
  title: string;
  type?: string;
  source?: string;
}

// Shared channel carrying auto-launch-tutorial requests from producers (the
// highlighted-guide orchestrator, the ?doc= deep-link handler, navigate
// actions) to whichever panel surface is active. It latches so a request
// emitted before the lazy-loaded panel has attached its listener is still
// delivered once the listener mounts.
export const autoLaunchChannel = createLatchedBroadcast<AutoLaunchTutorialDetail>({ ttlMs: 30_000 });
