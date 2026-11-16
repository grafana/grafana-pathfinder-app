import { useCallback, useEffect, useMemo, useState } from 'react';
import { config } from '@grafana/runtime';
import bundledRepository from '../bundled-interactives/repository.json';
import type { RepositoryJson } from '../types/package.types';
import type { CatalogPackage } from '../types/package-catalog.types';
import {
  bundledCatalog,
  curatedCatalog,
  eligibleDiscoveryCatalog,
  mergeCatalog,
  onlineCatalog,
  organizationCatalog,
} from '../lib/package-catalog';
import { fetchOnlinePackageRecommendations } from '../lib/package-recommendations-client';
import { fetchEligibleCatalog } from '../lib/eligible-catalog-client';
import { getRecommenderStackContext } from '../lib/recommender-context';
import { fetchCustomGuideCatalogue } from '../lib/custom-guide-repository-client';
import { getPathsData } from './paths-data';

const ABSENT_ORGANIZATION_CAPABILITIES = new Set([
  'unsupported',
  'feature-toggle-disabled',
  'obo-unavailable',
  'identity-unavailable',
  'identity-unverifiable',
]);

export function usePackageCatalog(
  options: {
    enabled?: boolean;
    publicOnly?: boolean;
    discovery?: { enabled: boolean; serviceUrl: string };
  } = {}
) {
  const { enabled = true, publicOnly = false, discovery } = options;
  const namespace = config.namespace || '';
  const scope = `${namespace}:${config.bootData?.user?.orgId ?? ''}:${config.bootData?.user?.id ?? ''}`;
  const isDiscovery = discovery !== undefined;
  const serviceUrl = discovery?.serviceUrl ?? '';
  const publicEnabled = enabled && (!isDiscovery || discovery.enabled);
  const stack = getRecommenderStackContext();
  const publicKey = JSON.stringify([scope, isDiscovery, serviceUrl, publicEnabled, stack.source, stack.platform]);
  const local = useMemo(() => {
    const data = getPathsData();
    return {
      bundled: bundledCatalog(bundledRepository as RepositoryJson, data.guideMetadata),
      curated: curatedCatalog(data.paths),
    };
  }, []);
  const [revision, setRevision] = useState(0);
  const [online, setOnline] = useState<{
    key: string;
    items: CatalogPackage[];
    loading: boolean;
    unavailable: boolean;
  }>();
  const [organization, setOrganization] = useState<{
    scope: string;
    items: CatalogPackage[];
    loading: boolean;
    unavailable: boolean;
  }>();

  useEffect(() => {
    if (!publicEnabled) {
      return;
    }
    let cancelled = false;
    const request = isDiscovery
      ? fetchEligibleCatalog(serviceUrl, scope, { refresh: revision > 0 })
      : fetchOnlinePackageRecommendations({ refresh: revision > 0 }).then((response) => ({
          items: onlineCatalog(response),
          available: response.available !== false,
        }));
    void request
      .then((response) => {
        if (!cancelled) {
          setOnline({ key: publicKey, items: response.items, loading: false, unavailable: !response.available });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOnline((current) =>
            current?.key === publicKey
              ? { ...current, loading: false }
              : { key: publicKey, items: [], loading: false, unavailable: true }
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [publicEnabled, isDiscovery, serviceUrl, scope, publicKey, revision]);

  useEffect(() => {
    if (!enabled || publicOnly) {
      return;
    }
    let cancelled = false;
    void fetchCustomGuideCatalogue(namespace, { refresh: revision > 0 })
      .then((response) => {
        if (!cancelled) {
          setOrganization({
            scope,
            items: organizationCatalog(response.entries),
            loading: false,
            unavailable: response.available === false && !ABSENT_ORGANIZATION_CAPABILITIES.has(response.reason ?? ''),
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOrganization((current) => ({
            scope,
            items: current?.scope === scope ? current.items : [],
            loading: false,
            unavailable: true,
          }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, publicOnly, namespace, scope, revision]);

  const currentPublic = publicEnabled && online?.key === publicKey ? online : undefined;
  const currentPrivate = enabled && !publicOnly && organization?.scope === scope ? organization : undefined;
  const retry = useCallback(() => {
    setOnline((current) => (current ? { ...current, loading: true } : current));
    setOrganization((current) => (current ? { ...current, loading: true } : current));
    setRevision((value) => value + 1);
  }, []);
  const items = useMemo(() => {
    if (!enabled) {
      return [];
    }
    const official = isDiscovery
      ? eligibleDiscoveryCatalog(local.bundled, currentPublic?.items ?? [], local.curated)
      : mergeCatalog(local.bundled, currentPublic?.items ?? [], local.curated);
    return mergeCatalog(official, currentPrivate?.items ?? []);
  }, [enabled, isDiscovery, local, currentPublic, currentPrivate]);
  return {
    scope,
    items,
    loading:
      (publicEnabled && (currentPublic?.loading ?? true)) ||
      (enabled && !publicOnly && (currentPrivate?.loading ?? true)),
    publicUnavailable: currentPublic?.unavailable ?? false,
    privateUnavailable: currentPrivate?.unavailable ?? false,
    retry,
  };
}
