export const FOLLOW_GRAFANA = 'follow-grafana';
export const DEFAULT_CANONICAL_LANGUAGE = 'en';

export type GuideLanguagePreference = typeof FOLLOW_GRAFANA | string;

const PRIMARY_LANGUAGE = /^[a-z]{2,3}$/;

export function parseBcp47Tag(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  try {
    const [canonical] = Intl.getCanonicalLocales(value.trim());
    return canonical !== undefined && PRIMARY_LANGUAGE.test(canonical.split('-')[0]!.toLowerCase()) ? canonical : null;
  } catch {
    return null;
  }
}

export function normalizeCanonicalLanguage(value: unknown): string {
  return parseBcp47Tag(value) ?? DEFAULT_CANONICAL_LANGUAGE;
}

export function normalizeGuideLanguagePreference(value: unknown): GuideLanguagePreference {
  return parseBcp47Tag(value) ?? FOLLOW_GRAFANA;
}

function withoutExtensions(tag: string): string {
  const subtags = tag.split('-');
  const extensionStart = subtags.findIndex((subtag, index) => index > 0 && subtag.length === 1);
  return (extensionStart === -1 ? subtags : subtags.slice(0, extensionStart)).join('-');
}

export function buildLocaleChain(effective: string, canonicalLanguage: string): string[] {
  const canonical = normalizeCanonicalLanguage(canonicalLanguage);
  const requested = parseBcp47Tag(effective);
  const chain: string[] = [];
  if (requested !== null) {
    const subtags = withoutExtensions(requested).split('-');
    for (let length = subtags.length; length > 0; length--) {
      const tag = subtags.slice(0, length).join('-');
      if (tag === canonical) {
        break;
      }
      chain.push(tag);
    }
  }
  return [...chain, canonical];
}

export function resolveEffectiveGuideLanguage(input: {
  override: string | null;
  preferred: GuideLanguagePreference;
  grafanaUiLocale: string | undefined;
  canonicalLanguage: string;
}): string {
  const { override, preferred, grafanaUiLocale, canonicalLanguage } = input;
  const canonical = normalizeCanonicalLanguage(canonicalLanguage);
  return override ?? (preferred !== FOLLOW_GRAFANA ? preferred : grafanaUiLocale) ?? canonical;
}
