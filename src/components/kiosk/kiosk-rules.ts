import { KioskCatalogSchema, type KioskPage } from '../../types/kiosk-page.schema';
import { logger } from '../../lib/logging';
import { recordKioskCatalogLoaded, type KioskCatalogTier } from '../../lib/telemetry';
import defaultKiosk from './default-kiosk.json';
import { parseKioskWebUrl, validateKioskOverride } from '../../security/kiosk-url';
import { isAllowedContentUrl, validateInternalNavigationPath } from '../../security/url-validator';

export interface KioskRule {
  id?: string;
  title: string;
  url: string;
  description: string;
  type: string;
  targetUrl?: string;
  page?: string;
}

export interface KioskRulesResponse {
  banner?: string;
  page?: KioskPage;
  rules: KioskRule[];
}

export interface KioskData {
  banner: string;
  page?: KioskPage;
  rules: KioskRule[];
}

export const DEFAULT_BANNER = `
<h2>Learn Grafana</h2>
<p>Explore interactive guides.</p>
`;

export const DEFAULT_KIOSK_URL = 'https://interactive-learning.grafana.net/guides/kiosk/default/rules.json';

export const BUNDLED_KIOSK_RULES: KioskRule[] = defaultKiosk.rules;

type CatalogFailureReason = 'invalid_url' | 'http' | 'invalid_rules' | 'invalid_json' | 'timeout' | 'network';

class CatalogError extends Error {
  constructor(readonly reason: CatalogFailureReason) {
    super(reason);
  }
}

function invalidRuleField(item: unknown): string | undefined {
  if (!item || typeof item !== 'object') {
    return 'rule';
  }
  const obj = item as Record<string, unknown>;
  for (const field of ['title', 'url', 'description'] as const) {
    if (typeof obj[field] !== 'string') {
      return field;
    }
  }
  if (!isAllowedContentUrl(obj.url as string)) {
    return 'url';
  }
  if (
    obj.targetUrl !== undefined &&
    (typeof obj.targetUrl !== 'string' || !parseKioskWebUrl(obj.targetUrl, window.location.origin))
  ) {
    return 'targetUrl';
  }
  if (obj.type !== undefined && typeof obj.type !== 'string') {
    return 'type';
  }
  if (obj.page !== undefined && (typeof obj.page !== 'string' || validateInternalNavigationPath(obj.page) === null)) {
    return 'page';
  }
  return undefined;
}

function catalogFailureReason(error: unknown): CatalogFailureReason {
  if (error instanceof CatalogError) {
    return error.reason;
  }
  if (error instanceof SyntaxError) {
    return 'invalid_json';
  }
  return error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network';
}

export async function fetchKioskData(
  url: string,
  signal?: AbortSignal,
  tier: KioskCatalogTier = 'configured'
): Promise<KioskData> {
  if (!url) {
    return { banner: DEFAULT_BANNER, rules: BUNDLED_KIOSK_RULES };
  }
  const parsed = parseKioskWebUrl(url, window.location.origin);
  if (!parsed) {
    throw new CatalogError('invalid_url');
  }
  const response = await fetch(parsed.href, {
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
    credentials: 'omit',
    // Browsers cannot inspect cross-origin redirect targets before following them.
    redirect: 'error',
  });
  if (!response.ok) {
    throw new CatalogError('http');
  }

  const data: KioskRulesResponse = await response.json();
  if (data && Object.hasOwn(data, 'page') && !KioskCatalogSchema.safeParse(data).success) {
    throw new CatalogError('invalid_rules');
  }
  const rules = Array.isArray(data?.rules) ? data.rules : Array.isArray(data) ? data : [];
  const valid = rules
    .filter((rule: unknown): rule is KioskRule => {
      const field = invalidRuleField(rule);
      if (field) {
        logger.warn('Kiosk catalog rule rejected', { tier, field });
        return false;
      }
      return true;
    })
    .map((rule) => ({ ...rule, type: rule.type || 'guide' }));
  if (valid.length === 0 || (data?.page && valid.length !== rules.length)) {
    throw new CatalogError('invalid_rules');
  }
  return {
    banner: typeof data?.banner === 'string' && data.banner.trim() ? data.banner : DEFAULT_BANNER,
    rules: valid,
    ...(data?.page && { page: data.page }),
  };
}

export async function loadKioskData(
  defaultUrl: string,
  overrideUrl?: string,
  signal?: AbortSignal
): Promise<KioskData & { warning?: string }> {
  signal?.throwIfAborted();
  const failed = new Set<KioskCatalogTier>();
  const attempted = new Set<string>();
  const override = overrideUrl ? validateKioskOverride(overrideUrl, defaultUrl, window.location.origin) : null;
  const reject = (tier: KioskCatalogTier, reason: CatalogFailureReason) => {
    failed.add(tier);
    logger.warn('Kiosk catalog load failed', { tier, reason });
  };
  const finish = (data: KioskData, tier: KioskCatalogTier) => {
    signal?.throwIfAborted();
    recordKioskCatalogLoaded(tier, failed.size > 0);
    if (failed.size === 0) {
      return data;
    }
    const failure = failed.has('configured')
      ? 'The configured kiosk could not be loaded.'
      : 'The requested kiosk could not be loaded.';
    const showing =
      tier === 'configured'
        ? 'Showing the configured default kiosk.'
        : tier === 'generic'
          ? 'Showing the generic learning kiosk.'
          : 'Showing bundled guides.';
    return { ...data, warning: `${failure} ${showing}` };
  };
  if (overrideUrl && !override) {
    reject('override', 'invalid_url');
  }
  const candidates: Array<[KioskCatalogTier, string | null]> = [
    ['override', override],
    ['configured', defaultUrl],
    ['generic', defaultUrl ? DEFAULT_KIOSK_URL : null],
  ];
  for (const [tier, candidate] of candidates) {
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
      return finish(await fetchKioskData(url, signal, tier), tier);
    } catch (error) {
      signal?.throwIfAborted();
      reject(tier, catalogFailureReason(error));
    }
  }
  return finish({ banner: DEFAULT_BANNER, rules: BUNDLED_KIOSK_RULES }, 'bundled');
}
