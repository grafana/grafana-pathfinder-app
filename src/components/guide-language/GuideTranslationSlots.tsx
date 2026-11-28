export interface GuideTranslationAnnotation {
  language: string;
  canonicalLanguage: string;
  canonicalTitle: string;
  staleBlockIds: readonly string[];
  fallbackBlockIds: readonly string[];
}

export interface GuideTranslationSlotProps {
  guideUrl?: string;
  guideTitle?: string;
  availableTranslations?: readonly string[];
  translation?: GuideTranslationAnnotation;
}

export function GuideLanguageSlot(_props: GuideTranslationSlotProps): null {
  return null;
}

export function TranslationNoticeSlot(_props: GuideTranslationSlotProps): null {
  return null;
}
