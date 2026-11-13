import { autoLaunchChannel } from '../../../global-state/auto-launch';
import { sidebarState } from '../../../global-state/sidebar';
import { onPathfinderSurfaceChange } from '../../../lib/telemetry/surface';
import type { DocPage } from '../../find-doc-page';

// Emits once on whichever surface mounts first: the floating panel can race the sidebar.
export function installAutoLaunchOnMount(docPage: DocPage, isStillEligible: () => boolean = () => true): () => void {
  let autoLaunched = false;
  let mounted = false;
  let unsubscribeSurface = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    autoLaunched = true;
    clearTimeout(timer);
    unsubscribeSurface();
    window.removeEventListener('pathfinder-sidebar-mounted', dispatch);
    document.removeEventListener('pathfinder-panel-mounted', dispatch);
  };
  const dispatch = () => {
    if (autoLaunched) {
      return;
    }
    autoLaunched = true;
    window.removeEventListener('pathfinder-sidebar-mounted', dispatch);
    document.removeEventListener('pathfinder-panel-mounted', dispatch);

    if (!isStillEligible()) {
      cancel();
      return;
    }

    mounted = true;

    // Synchronous, so the floating panel's empty-state fallback doesn't race the incoming guide.
    document.dispatchEvent(new CustomEvent('pathfinder-auto-launch-pending'));

    timer = setTimeout(() => {
      unsubscribeSurface();
      // The channel latches, so an emit after unmount would replay on a later manual open.
      if (!sidebarState.getIsSidebarMounted() || !isStillEligible()) {
        return;
      }
      autoLaunchChannel.emit({
        url: docPage.url,
        title: docPage.title,
        type: docPage.type,
        source: 'auto_open_guide_experiment',
      });
    }, 500);
  };

  unsubscribeSurface = onPathfinderSurfaceChange((surface) => {
    if (mounted && surface === 'closed') {
      cancel();
    }
  });
  window.addEventListener('pathfinder-sidebar-mounted', dispatch, { once: true });
  document.addEventListener('pathfinder-panel-mounted', dispatch, { once: true });

  if (sidebarState.getIsSidebarMounted()) {
    dispatch();
  }
  return cancel;
}
