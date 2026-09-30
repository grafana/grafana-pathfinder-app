import type { LearningJourneyTab } from '../../../types/content-panel.types';
import type { JsonGuide } from '../../../types/json-guide.types';
import { canCopyPublicGuide } from './private-guide-eligibility';
import { inlineSnippetRefsInGuideWithStatus, type SnippetResolver } from '../../../snippet-engine';
import { parseAndValidateGuide } from '../../block-editor/utils/block-import';
import { preserveGuideUrls } from '../../block-editor/utils/preserve-guide-urls';

export async function preparePrivateGuideCopy(tab: LearningJourneyTab, resolver?: SnippetResolver): Promise<JsonGuide> {
  if (!canCopyPublicGuide(tab, true) || !tab.content) {
    throw new Error('Only standalone public JSON guides can be copied.');
  }
  const source = tab.content.countingSource;
  if (source?.kind === 'unavailable') {
    throw new Error('Reload this guide before copying it. Its original content is unavailable.');
  }
  const parsed = parseAndValidateGuide(source?.kind === 'pre-inlining' ? source.guideJson : tab.content.content, {
    allowDuplicateHeading: true,
  });
  if (!parsed.isValid || !parsed.guide) {
    throw new Error('This guide could not be imported. Reload it and try again.');
  }
  const expanded = await inlineSnippetRefsInGuideWithStatus(parsed.guide, resolver);
  if (expanded.unresolvedSnippetIds.length) {
    throw new Error(
      'Some shared content could not be loaded. Reload the guide and try again. Your draft is unchanged.'
    );
  }
  const copy = preserveGuideUrls(JSON.parse(JSON.stringify(expanded.guide)) as JsonGuide, tab.content.url);
  return { ...copy, id: `private-${crypto.randomUUID()}`, title: `${copy.title} (copy)` };
}
