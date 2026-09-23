import defaultKiosk from './default-kiosk.json';
import { parseKioskWebUrl, validateKioskOverride } from '../../security/kiosk-url';
import { isAllowedContentUrl, validateInternalNavigationPath } from '../../security/url-validator';

export interface KioskRule {
  title: string;
  url: string;
  description: string;
  type: string;
  /** Grafana instance to open the guide on. Defaults to current origin if omitted. */
  targetUrl?: string;
  page?: string;
}

export interface KioskRulesResponse {
  /** HTML banner rendered at the top of the kiosk overlay */
  banner?: string;
  rules: KioskRule[];
}

export interface KioskData {
  banner: string;
  rules: KioskRule[];
}

export const DEFAULT_BANNER = `
<h2>Learn Grafana</h2>
<p>Explore interactive guides.</p>
`;

export const DEFAULT_KIOSK_URL = 'https://interactive-learning.grafana.net/guides/kiosk/default/rules.json';

export const BUNDLED_KIOSK_RULES: KioskRule[] = defaultKiosk.rules;

function isValidRule(item: unknown): item is KioskRule {
  if (!item || typeof item !== 'object') {
    return false;
  }
  const obj = item as Record<string, unknown>;
  return (
    typeof obj.title === 'string' &&
    typeof obj.url === 'string' &&
    typeof obj.description === 'string' &&
    isAllowedContentUrl(obj.url) &&
    (obj.targetUrl === undefined ||
      (typeof obj.targetUrl === 'string' && parseKioskWebUrl(obj.targetUrl, window.location.origin) !== null)) &&
    (obj.type === undefined || typeof obj.type === 'string') &&
    (obj.page === undefined || (typeof obj.page === 'string' && validateInternalNavigationPath(obj.page) !== null))
  );
}

export async function fetchKioskData(url: string, signal?: AbortSignal): Promise<KioskData> {
  if (!url) {
    return { banner: DEFAULT_BANNER, rules: BUNDLED_KIOSK_RULES };
  }
  const parsed = parseKioskWebUrl(url, window.location.origin);
  if (!parsed) {
    throw new Error('Invalid kiosk URL');
  }
  const response = await fetch(parsed.href, {
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
    credentials: 'omit',
    // Browsers cannot inspect cross-origin redirect targets before following them.
    redirect: 'error',
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data: KioskRulesResponse = await response.json();
  const rules = Array.isArray(data?.rules) ? data.rules : Array.isArray(data) ? data : [];
  const valid = rules.filter(isValidRule).map((rule) => ({ ...rule, type: rule.type || 'guide' }));
  if (valid.length === 0) {
    throw new Error('No valid rules in response');
  }
  return {
    banner: typeof data?.banner === 'string' && data.banner.trim() ? data.banner : DEFAULT_BANNER,
    rules: valid,
  };
}

export async function loadKioskData(
  defaultUrl: string,
  overrideUrl?: string,
  signal?: AbortSignal
): Promise<KioskData & { warning?: string }> {
  let warning: string | undefined;
  const attempted = new Set<string>();
  const override = overrideUrl ? validateKioskOverride(overrideUrl, defaultUrl, window.location.origin) : null;
  if (overrideUrl && !override) {
    warning = 'The requested kiosk could not be loaded. Showing the default kiosk.';
  }
  for (const candidate of [override, defaultUrl, DEFAULT_KIOSK_URL]) {
    if (!candidate) {
      continue;
    }
    const url = parseKioskWebUrl(candidate, window.location.origin)?.href ?? candidate;
    if (attempted.has(url)) {
      continue;
    }
    attempted.add(url);
    signal?.throwIfAborted();
    try {
      return { ...(await fetchKioskData(url, signal)), warning };
    } catch {
      signal?.throwIfAborted();
      warning = 'The requested kiosk could not be loaded. Showing the default kiosk.';
    }
  }
  return {
    banner: DEFAULT_BANNER,
    rules: BUNDLED_KIOSK_RULES,
    warning: warning ? 'The kiosk could not be loaded. Showing bundled guides.' : undefined,
  };
}
