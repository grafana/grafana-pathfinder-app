import { canonicalLocaleTag } from './guide-content-file';

export const FOLLOW_GRAFANA = 'follow-grafana';
export const DEFAULT_CANONICAL_LANGUAGE = 'en';

export type GuideLanguagePreference = typeof FOLLOW_GRAFANA | string;

export function parseBcp47Tag(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  return canonicalLocaleTag(value.trim()) ?? null;
}

export function normalizeCanonicalLanguage(value: unknown): string {
  return parseBcp47Tag(value) ?? DEFAULT_CANONICAL_LANGUAGE;
}

export function normalizeGuideLanguagePreference(value: unknown): GuideLanguagePreference {
  return parseBcp47Tag(value) ?? FOLLOW_GRAFANA;
}

export function buildLocaleChain(effective: string, canonicalLanguage: string): string[] {
  const canonical = normalizeCanonicalLanguage(canonicalLanguage);
  const requested = parseBcp47Tag(effective);
  const chain: string[] = [];
  if (requested !== null) {
    const subtags = requested.split('-');
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
