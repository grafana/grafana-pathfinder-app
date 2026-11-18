import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { usePluginUserStorage } from '@grafana/runtime';
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
import { logger } from '../lib/logging';
import type { GrafanaUserStorage } from '../types/storage.types';
import {
  clearGuideLanguageOverride,
  getGuideLanguageState,
  observeGuideClose,
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
  // Account-scoped storage only: the shared-origin localStorage mirror would leak one reader's choice to the next.
  const accountStorage: GrafanaUserStorage | undefined = usePluginUserStorage();
  const state = useSyncExternalStore(subscribeGuideLanguage, getGuideLanguageState);
  const { preferredLoaded } = state;

  useEffect(() => {
    if (!enabled || preferredLoaded || !accountStorage) {
      return;
    }
    let cancelled = false;
    accountStorage
      .getItem(StorageKeys.GUIDE_LANGUAGE)
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
  }, [enabled, preferredLoaded, accountStorage]);

  useEffect(() => {
    if (!enabled || guideKey === undefined) {
      return;
    }
    observeGuideOpen(guideKey);
    return () => observeGuideClose(guideKey);
  }, [enabled, guideKey]);

  const setPreferred = useCallback(
    async (value: string) => {
      const next = value === FOLLOW_GRAFANA ? FOLLOW_GRAFANA : parseBcp47Tag(value);
      if (!enabled || next === null) {
        return;
      }
      setGuideLanguagePreferred(next);
      try {
        await accountStorage?.setItem(StorageKeys.GUIDE_LANGUAGE, next);
      } catch (error) {
        logger.warn('Failed to save the guide language preference', { error });
      }
    },
    [enabled, accountStorage]
  );

  const applyOneShotOverride = useCallback(
    (language: string, forGuideKey?: string) => {
      const tag = parseBcp47Tag(language);
      if (enabled && tag !== null) {
        setGuideLanguageOverride(tag, forGuideKey);
      }
    },
    [enabled]
  );

  const override = enabled && state.override?.guideKey === (guideKey ?? null) ? state.override.language : null;
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
