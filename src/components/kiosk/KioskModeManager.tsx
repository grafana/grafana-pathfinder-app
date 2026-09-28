import React, { useEffect, useCallback, useSyncExternalStore, useState } from 'react';
import { ThemeContext } from '@grafana/data';
import { config } from '@grafana/runtime';
import { KioskOverlay } from './KioskOverlay';
import { reportPathfinderSurface, reportPathfinderSurfaceClosed } from '../../lib/telemetry/surface';
import { sidebarState } from '../../global-state/sidebar';
import { kioskState } from '../../global-state/kiosk';
import { clearKioskLaunchParams } from '../../utils/kiosk-navigation';

interface KioskModeManagerProps {
  rulesUrl: string;
}

export const KioskModeManager: React.FC<KioskModeManagerProps> = ({ rulesUrl }) => {
  const [theme, setTheme] = useState(() => config.theme2);
  useEffect(() => {
    // This standalone React root sits outside Grafana's theme provider.
    const observer = new MutationObserver(() => setTheme(config.theme2));
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  const launch = useSyncExternalStore(kioskState.subscribe, kioskState.getSnapshot);
  const isOpen = launch !== null;

  const handleClose = useCallback(() => {
    clearKioskLaunchParams();
    kioskState.set(null);
  }, []);

  useEffect(() => {
    const handleOpen = () => {
      clearKioskLaunchParams();
      kioskState.set({ source: 'sidebar' });
    };
    document.addEventListener('pathfinder-open-kiosk', handleOpen);
    return () => document.removeEventListener('pathfinder-open-kiosk', handleOpen);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    reportPathfinderSurface('kiosk');
    return () => {
      if (sidebarState.getIsSidebarMounted()) {
        reportPathfinderSurface('sidebar');
      } else {
        reportPathfinderSurfaceClosed('kiosk');
      }
    };
  }, [isOpen]);

  if (!launch) {
    return null;
  }

  return (
    <ThemeContext.Provider value={theme}>
      <KioskOverlay
        rulesUrl={rulesUrl}
        overrideUrl={launch.rulesUrl}
        mode={launch.source === 'url' ? 'instance' : 'presentation'}
        onClose={handleClose}
      />
    </ThemeContext.Provider>
  );
};
