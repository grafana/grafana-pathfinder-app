import React, { useEffect, useCallback, useMemo, useRef, useSyncExternalStore, useState } from 'react';
import { ThemeContext } from '@grafana/data';
import { config } from '@grafana/runtime';
import { createTranslatedComponent } from '../App/TranslatedComponent';
import { reportPathfinderSurface, reportPathfinderSurfaceClosed } from '../../lib/telemetry/surface';
import { sidebarState } from '../../global-state/sidebar';
import { kioskState, type KioskLaunch } from '../../global-state/kiosk';
import type { PreparedKioskData } from './kiosk-rules';
import { retryChunkImport } from '../../lib/retry-chunk-import';
import { clearKioskLaunchParams } from '../../utils/kiosk-navigation';
import { getKioskLoadingFrameStyles } from './kiosk-mode.styles';

const KioskOverlay = createTranslatedComponent(
  async () => ({
    default: (await import('./KioskOverlay')).KioskOverlay,
  }),
  { dismiss: ({ onClose }) => onClose() }
);

const pendingCatalogs = new WeakMap<KioskLaunch, Promise<PreparedKioskData>>();

function pendingCatalogFor(launch: KioskLaunch): Promise<PreparedKioskData> {
  let pending = pendingCatalogs.get(launch);
  if (!pending) {
    pending = new Promise<PreparedKioskData>(() => {});
    pendingCatalogs.set(launch, pending);
  }
  return pending;
}

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
  const loadingFrame = useMemo(() => getKioskLoadingFrameStyles(theme), [theme]);
  const frameRef = useRef<HTMLDivElement>(null);
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
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setCatalog({ launch, rulesUrl, promise });
      }
    });
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
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && frameRef.current?.hasChildNodes()) {
        handleClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, handleClose]);

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
      <div ref={frameRef} className={loadingFrame}>
        <KioskOverlay
          catalog={
            catalog?.launch === launch && catalog.rulesUrl === rulesUrl ? catalog.promise : pendingCatalogFor(launch)
          }
          rulesUrl={rulesUrl}
          overrideUrl={launch.rulesUrl}
          mode={launch.source === 'url' ? 'instance' : 'presentation'}
          onClose={handleClose}
          onLaunch={() => kioskState.set(null)}
        />
      </div>
    </ThemeContext.Provider>
  );
};
