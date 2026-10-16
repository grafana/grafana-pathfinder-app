import { autoLaunchChannel } from '../../../global-state/auto-launch';
import { sidebarState } from '../../../global-state/sidebar';
import type { DocPage } from '../../find-doc-page';

// Emits once on whichever surface mounts first: the floating panel can race the sidebar.
export function installAutoLaunchOnMount(docPage: DocPage): void {
  let autoLaunched = false;
  const dispatch = () => {
    if (autoLaunched) {
      return;
    }
    autoLaunched = true;
    window.removeEventListener('pathfinder-sidebar-mounted', dispatch);
    document.removeEventListener('pathfinder-panel-mounted', dispatch);

    // Synchronous, so the floating panel's empty-state fallback doesn't race the incoming guide.
    document.dispatchEvent(new CustomEvent('pathfinder-auto-launch-pending'));

    setTimeout(() => {
      // The channel latches, so an emit after unmount would replay on a later manual open.
      if (!sidebarState.getIsSidebarMounted()) {
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

  window.addEventListener('pathfinder-sidebar-mounted', dispatch, { once: true });
  document.addEventListener('pathfinder-panel-mounted', dispatch, { once: true });

  if (sidebarState.getIsSidebarMounted()) {
    dispatch();
  }
}
