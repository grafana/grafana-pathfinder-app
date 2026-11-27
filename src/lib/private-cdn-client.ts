import { getBackendSrv } from '@grafana/runtime';
import { firstValueFrom } from 'rxjs';
import { backendRoute } from './backend-routes';
import { CANONICAL_CONTENT_FILE } from './guide-content-file';

export const PRIVATE_CDN_GUIDE = 'builders-observability-foundations';
export const PRIVATE_CDN_REF = `private-cdn:${PRIVATE_CDN_GUIDE}`;
const CDN_ORIGIN = 'https://interactive-learning-private.grafana-dev.net';

export interface PrivateCDNEntry {
  id: string;
  title: string;
  source: 'private-cdn';
}

export async function fetchPrivateCDNCatalogue(): Promise<PrivateCDNEntry[]> {
  try {
    const response = await firstValueFrom(
      getBackendSrv().fetch<{ entries: unknown }>({
        url: backendRoute('private-cdn/catalogue'),
        showErrorAlert: false,
      })
    );
    const entries = response.data?.entries;
    if (!Array.isArray(entries)) {
      return [];
    }
    return entries.filter(
      (entry): entry is PrivateCDNEntry =>
        entry?.id === PRIVATE_CDN_GUIDE &&
        typeof entry.title === 'string' &&
        entry.title.trim().length > 0 &&
        entry.source === 'private-cdn'
    );
  } catch {
    return [];
  }
}

export async function fetchPrivateCDNContent(): Promise<string> {
  const response = await firstValueFrom(
    getBackendSrv().fetch<{ url: string; expiresAt: number; source: string }>({
      url: backendRoute('private-cdn/sign'),
      method: 'POST',
      data: { guide: PRIVATE_CDN_GUIDE, asset: 'content.json' },
      showErrorAlert: false,
    })
  );
  const signed = response.data;
  if (
    signed?.source !== 'private-cdn' ||
    !Number.isInteger(signed.expiresAt) ||
    signed.expiresAt * 1000 <= Date.now()
  ) {
    throw new Error('Private guide is unavailable');
  }
  let url: URL;
  try {
    url = new URL(signed.url);
  } catch {
    throw new Error('Private guide is unavailable');
  }
  if (
    url.origin !== CDN_ORIGIN ||
    url.pathname !== `/internal/packages/${PRIVATE_CDN_GUIDE}/${CANONICAL_CONTENT_FILE}` ||
    url.username ||
    url.password ||
    url.hash ||
    [...url.searchParams.keys()].sort().join(',') !== 'e,k,s' ||
    url.searchParams.get('e') !== String(signed.expiresAt) ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(url.searchParams.get('k') ?? '') ||
    !/^[a-f0-9]{64}$/.test(url.searchParams.get('s') ?? '')
  ) {
    throw new Error('Private guide is unavailable');
  }
  const asset = await fetch(url.href, {
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
  });
  if (!asset.ok) {
    throw new Error('Private guide is unavailable');
  }
  return asset.text();
}
