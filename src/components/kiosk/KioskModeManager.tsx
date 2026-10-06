import React, { useEffect, useCallback, useSyncExternalStore, useState } from 'react';
import { ThemeContext } from '@grafana/data';
import { config } from '@grafana/runtime';
import { LoadingPlaceholder } from '@grafana/ui';
import { createTranslatedComponent } from '../App/TranslatedComponent';
import { reportPathfinderSurface, reportPathfinderSurfaceClosed } from '../../lib/telemetry/surface';
import { sidebarState } from '../../global-state/sidebar';
import { kioskState, type KioskLaunch } from '../../global-state/kiosk';
import type { PreparedKioskData } from './kiosk-rules';
import { retryChunkImport } from '../../lib/retry-chunk-import';
import { clearKioskLaunchParams } from '../../utils/kiosk-navigation';

const KioskOverlay = createTranslatedComponent(async () => ({
  default: (await import('./KioskOverlay')).KioskOverlay,
}));

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
  const [catalog, setCatalog] = useState<{
    launch: KioskLaunch;
    rulesUrl: string;
    promise: Promise<PreparedKioskData>;
  }>();

  useEffect(() => {
    if (!launch) {
      return;
    }
    const controller = new AbortController();
    const parser = retryChunkImport(() => import('./kiosk-rules'));
    const promise = parser.then(({ prepareKioskData }) =>
      prepareKioskData(rulesUrl, launch.rulesUrl, controller.signal)
    );
    // The view may still be loading when cancellation rejects the catalog request.
    void promise.catch(() => {});
    const publish = () => {
      if (!controller.signal.aborted) {
        setCatalog({ launch, rulesUrl, promise });
      }
    };
    void parser.then(publish, publish);
    return () => controller.abort();
  }, [launch, rulesUrl]);

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
  if (catalog?.launch !== launch || catalog.rulesUrl !== rulesUrl) {
    return <LoadingPlaceholder text="Loading interactive learning" />;
  }

  return (
    <ThemeContext.Provider value={theme}>
      <KioskOverlay
        catalog={catalog.promise}
        rulesUrl={rulesUrl}
        overrideUrl={launch.rulesUrl}
        mode={launch.source === 'url' ? 'instance' : 'presentation'}
        onClose={handleClose}
        onLaunch={() => kioskState.set(null)}
      />
    </ThemeContext.Provider>
  );
};
