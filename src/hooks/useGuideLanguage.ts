import { useCallback, useEffect, useSyncExternalStore } from 'react';
import {
  DEFAULT_CANONICAL_LANGUAGE,
  FOLLOW_GRAFANA,
  normalizeCanonicalLanguage,
  normalizeGuideLanguagePreference,
  parseBcp47Tag,
  resolveEffectiveGuideLanguage,
  type GuideLanguagePreference,
} from '../lib/guide-language';
import { StorageKeys } from '../lib/storage-keys';
import { useUserStorage } from '../lib/user-storage';
import { logger } from '../lib/logging';
import {
  clearGuideLanguageOverride,
  getGuideLanguageState,
  observeGuideOpen,
  setGuideLanguageOverride,
  setGuideLanguagePreferred,
  subscribeGuideLanguage,
} from '../global-state/guide-language';
import { getGrafanaUiLocale } from '../utils/grafana-ui-locale';
import { isGuideTranslationsEnabled } from '../utils/guide-translations-enablement';

export interface UseGuideLanguageOptions {
  canonicalLanguage?: string;
  guideKey?: string;
}

export interface GuideLanguage {
  enabled: boolean;
  preferred: GuideLanguagePreference;
  effective: string;
  override: string | null;
  setPreferred: (value: string) => Promise<void>;
  applyOneShotOverride: (language: string, guideKey?: string) => void;
  clearOverride: () => void;
}

export function useGuideLanguage({
  canonicalLanguage = DEFAULT_CANONICAL_LANGUAGE,
  guideKey,
}: UseGuideLanguageOptions = {}): GuideLanguage {
  const enabled = isGuideTranslationsEnabled();
  const { getItem, setItem } = useUserStorage();
  const state = useSyncExternalStore(subscribeGuideLanguage, getGuideLanguageState);
  const { preferredLoaded } = state;

  useEffect(() => {
    if (!enabled || preferredLoaded) {
      return;
    }
    let cancelled = false;
    getItem<unknown>(StorageKeys.GUIDE_LANGUAGE)
      .then((stored) => {
        if (!cancelled && !getGuideLanguageState().preferredLoaded) {
          setGuideLanguagePreferred(normalizeGuideLanguagePreference(stored));
        }
      })
      .catch((error: unknown) => {
        logger.warn('Failed to read the guide language preference', { error });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, preferredLoaded, getItem]);

  useEffect(() => {
    if (enabled && guideKey !== undefined) {
      observeGuideOpen(guideKey);
    }
  }, [enabled, guideKey]);

  const setPreferred = useCallback(
    async (value: string) => {
      const next = value === FOLLOW_GRAFANA ? FOLLOW_GRAFANA : parseBcp47Tag(value);
      if (next === null) {
        return;
      }
      setGuideLanguagePreferred(next);
      try {
        await setItem(StorageKeys.GUIDE_LANGUAGE, next);
      } catch (error) {
        logger.warn('Failed to save the guide language preference', { error });
      }
    },
    [setItem]
  );

  const applyOneShotOverride = useCallback(
    (language: string, forGuideKey?: string) => {
      const tag = parseBcp47Tag(language);
      if (enabled && tag !== null) {
        setGuideLanguageOverride(tag, forGuideKey ?? null);
      }
    },
    [enabled]
  );

  const override = enabled ? (state.override?.language ?? null) : null;
  const effective = enabled
    ? resolveEffectiveGuideLanguage({
        override,
        preferred: state.preferred,
        grafanaUiLocale: getGrafanaUiLocale(),
        canonicalLanguage,
      })
    : normalizeCanonicalLanguage(canonicalLanguage);

  return {
    enabled,
    preferred: state.preferred,
    effective,
    override,
    setPreferred,
    applyOneShotOverride,
    clearOverride: clearGuideLanguageOverride,
  };
}
