import { useCallback, useEffect, useMemo, useState } from 'react';
import { config } from '@grafana/runtime';
import bundledRepository from '../bundled-interactives/repository.json';
import type { RepositoryJson } from '../types/package.types';
import type { CatalogPackage } from '../types/package-catalog.types';
import {
  bundledCatalog,
  curatedCatalog,
  mergeCatalog,
  onlineCatalog,
  organizationCatalog,
} from '../lib/package-catalog';
import { fetchOnlinePackageRecommendations } from '../lib/package-recommendations-client';
import { fetchCustomGuideCatalogue } from '../lib/custom-guide-repository-client';
import { getPathsData } from './paths-data';

export function usePackageCatalog() {
  const namespace = config.namespace || '';
  const scope = `${namespace}:${config.bootData?.user?.orgId ?? ''}:${config.bootData?.user?.id ?? ''}`;
  const local = useMemo(() => {
    const data = getPathsData();
    return {
      bundled: bundledCatalog(bundledRepository as RepositoryJson, data.guideMetadata),
      curated: curatedCatalog(data.paths),
    };
  }, []);
  const [revision, setRevision] = useState(0);
  const [remote, setRemote] = useState<{
    scope: string;
    online: CatalogPackage[];
    organization: CatalogPackage[];
    loading: boolean;
    publicUnavailable: boolean;
    privateUnavailable: boolean;
  }>({
    scope,
    online: [],
    organization: [],
    loading: true,
    publicUnavailable: false,
    privateUnavailable: false,
  });

  useEffect(() => {
    let cancelled = false;
    const publicRequest = fetchOnlinePackageRecommendations({ refresh: revision > 0 }).then((response) => {
      if (!cancelled) {
        setRemote((current) => ({
          ...(current.scope === scope
            ? current
            : {
                scope,
                online: [],
                organization: [],
                loading: true,
                publicUnavailable: false,
                privateUnavailable: false,
              }),
          scope,
          online: onlineCatalog(response),
          publicUnavailable: response.available === false,
        }));
      }
    });
    const privateRequest = fetchCustomGuideCatalogue(namespace, { refresh: revision > 0 }).then((response) => {
      if (!cancelled) {
        setRemote((current) => ({
          ...(current.scope === scope
            ? current
            : {
                scope,
                online: [],
                organization: [],
                loading: true,
                publicUnavailable: false,
                privateUnavailable: false,
              }),
          scope,
          organization: organizationCatalog(response.entries),
          privateUnavailable: response.available === false && response.reason !== 'unsupported',
        }));
      }
    });
    void Promise.allSettled([publicRequest, privateRequest]).then(() => {
      if (!cancelled) {
        setRemote((current) => ({ ...current, scope, loading: false }));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [namespace, scope, revision]);

  const current = remote.scope === scope ? remote : undefined;
  const retry = useCallback(() => {
    setRemote((current) => ({ ...current, loading: true }));
    setRevision((value) => value + 1);
  }, []);
  const items = useMemo(
    () => mergeCatalog(local.bundled, current?.online ?? [], local.curated, current?.organization ?? []),
    [local, current]
  );
  return {
    scope,
    items,
    loading: current?.loading ?? true,
    publicUnavailable: current?.publicUnavailable ?? false,
    privateUnavailable: current?.privateUnavailable ?? false,
    retry,
  };
}
