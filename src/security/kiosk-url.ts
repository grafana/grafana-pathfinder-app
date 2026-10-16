import { isLocalhostUrl, parseUrlSafely } from './url-validator';

export function parseKioskWebUrl(value: string, currentOrigin: string): URL | null {
  const url = parseUrlSafely(value);
  if (!url || url.username || url.password) {
    return null;
  }
  const localDevelopment = url.origin === currentOrigin && isLocalhostUrl(url.href);
  return url.protocol === 'https:' || localDevelopment ? url : null;
}

export function validateKioskOverride(value: string, defaultUrl: string, currentOrigin: string): string | null {
  const url = parseKioskWebUrl(value, currentOrigin);
  const configured = parseKioskWebUrl(defaultUrl, currentOrigin);
  const trustedOrigins = new Set(['https://interactive-learning.grafana.net', currentOrigin]);
  if (configured) {
    trustedOrigins.add(configured.origin);
  }
  return url && trustedOrigins.has(url.origin) ? url.href : null;
}
