import { locationService } from '@grafana/runtime';
import { logger } from '../lib/logging';
import { retryChunkImport } from '../lib/retry-chunk-import';
import { hasAnyPathfinderParam } from './pathfinder-search-params';
import type { DeepLinkHandlerDeps } from './pathfinder-deep-link-handler';

// Entry-bundle shim: registration stays synchronous, the handler chunk loads only when a Pathfinder param is present.
export function handlePathfinderDeepLink(deps: DeepLinkHandlerDeps): void {
  if (!hasAnyPathfinderParam(window.location.search)) {
    return;
  }
  void retryChunkImport(() => import('./pathfinder-deep-link-handler'))
    .then(({ handlePathfinderDeepLink: handle }) => handle(deps))
    .catch((error) => logger.error('[Pathfinder] Failed to load deep-link handler', { error }));
}

export function installDeepLinkNavListener(deps: DeepLinkHandlerDeps): void {
  const handler = () => handlePathfinderDeepLink(deps);

  try {
    const history = locationService.getHistory();
    if (history) {
      const unlisten = history.listen(handler);
      window.__pathfinderDeepLinkNavUnlisten = unlisten;
    }
  } catch {
    window.addEventListener('popstate', handler);
  }
}
