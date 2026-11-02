import { useEffect, useRef, useState } from 'react';
import { t } from '@grafana/i18n';
import type { CatalogPackage } from '../../types/package-catalog.types';
import type { CatalogProgress } from '../../learning-paths';
import { AppPlatformPackageResolver } from '../../package-engine';
import { beginGuideLoad, finishGuideLoad } from '../../lib/telemetry/guide-load';
import type { GuideLoadContext } from '../../types/guide-diagnostics.types';
import { prepareGuideLaunch, type PreparedGuideLaunch } from '../docs-panel/utils/prepare-guide-launch';
import { openGuideInSidebar } from '../docs-panel/utils/open-prepared-guide';
import { AnalyticsContentType, reportAppInteraction, UserInteraction } from '../../lib/analytics';

type CatalogInteractionLocation =
  'package_browser' | 'my_learning_discover_more' | 'my_learning_continue' | 'content_completion_panel';

interface CatalogLaunchOptions {
  onOpenGuide?: (launch: PreparedGuideLaunch) => void;
  onAcceptedLaunch?: (item: CatalogPackage) => void;
  interactionLocation?: CatalogInteractionLocation;
}

export function useCatalogLaunch(
  items: CatalogPackage[],
  scope: string,
  progress: Map<string, CatalogProgress>,
  options: CatalogLaunchOptions = {}
) {
  const mounted = useRef(true);
  const currentScope = useRef(scope);
  const lock = useRef(false);
  const preparingLoad = useRef<GuideLoadContext | undefined>(undefined);
  const [pending, setPending] = useState<{ scope: string; key: string } | null>(null);
  const [error, setError] = useState<{ scope: string; key: string; message: string } | null>(null);
  useEffect(() => {
    mounted.current = true;
    currentScope.current = scope;
    return () => {
      mounted.current = false;
      finishGuideLoad(preparingLoad.current, 'cancelled');
      preparingLoad.current = undefined;
    };
  }, [scope]);

  const launch = async (
    item: CatalogPackage,
    interactionLocation: CatalogInteractionLocation = options.interactionLocation ?? 'my_learning_continue'
  ) => {
    if (lock.current) {
      return;
    }
    lock.current = true;
    setPending({ scope, key: item.key });
    setError(null);
    const stillCurrent = () => mounted.current && currentScope.current === scope;
    try {
      options.onAcceptedLaunch?.(item);
      reportAppInteraction(UserInteraction.OpenResourceClick, {
        interaction_location: interactionLocation,
        content_type:
          item.format === 'path' ? AnalyticsContentType.LearningJourney : AnalyticsContentType.InteractiveGuide,
        ...(item.source === 'grafana' ? { content_title: item.title, content_url: item.url } : {}),
      });
      let url = item.url;
      let title = item.title;
      let packageInfo = item.packageInfo;
      if (item.source === 'organization') {
        const result = await new AppPlatformPackageResolver().resolve(item.id, { loadContent: 'metadata-only' });
        if (!result.ok) {
          throw new Error('unavailable');
        }
        packageInfo = { packageId: item.id, packageManifest: result.manifest, repository: 'app-platform' };
      }
      if (item.curatedPath && !url) {
        const nextId = progress.get(item.key)?.nextId ?? item.memberIds?.[0];
        const member = items.find(
          (candidate) => candidate.id === nextId && candidate.source === 'grafana' && candidate.format === 'guide'
        );
        if (!member) {
          throw new Error('unavailable');
        }
        url = member.url;
        title = member.title;
        packageInfo = member.packageInfo;
      }
      if (!stillCurrent()) {
        return;
      }
      const loadContext = beginGuideLoad(url);
      preparingLoad.current = loadContext;
      const result = await prepareGuideLaunch(url, { title, source: 'package_browser', packageInfo, loadContext });
      if (!stillCurrent()) {
        return;
      }
      preparingLoad.current = undefined;
      if (!result.ok) {
        throw new Error('unavailable');
      }
      (options.onOpenGuide ?? openGuideInSidebar)(result.launch);
    } catch {
      finishGuideLoad(preparingLoad.current, 'cancelled');
      preparingLoad.current = undefined;
      if (stillCurrent()) {
        setError({
          scope,
          key: item.key,
          message: t(
            'packageBrowser.launchError',
            'Could not open this guide. It may have been removed or unpublished. Try again.'
          ),
        });
      }
    } finally {
      lock.current = false;
      if (stillCurrent()) {
        setPending(null);
      }
    }
  };

  return {
    launch,
    launchingKey: pending?.scope === scope ? pending.key : null,
    launchError: error?.scope === scope ? error : null,
  };
}
