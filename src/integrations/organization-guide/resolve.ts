import { AppPlatformPackageResolver } from '../../package-engine';
import { buildBackendGuideContent, type BackendGuideResource } from '../../docs-retrieval';
import { inlineSnippetRefsInGuideWithStatus } from '../../snippet-engine';
import { createPreparedContent } from '../../lib/guide-counting-source';
import { logger } from '../../lib/logging';
import type { PreparedRawContent } from '../../types/content.types';
import type { JsonGuide } from '../../types/json-guide.types';

export interface OrganizationGuide {
  resourceName: string;
  guideId: string;
  title: string;
  url: string;
  content: PreparedRawContent;
}

export async function resolveOrganizationGuide(resourceName: string): Promise<OrganizationGuide | null> {
  try {
    const resolution = await new AppPlatformPackageResolver().resolve(resourceName, { verifyPublished: true });
    if (!resolution.ok || !resolution.probedResource) {
      logger.warn('Organization guide unavailable', { reason: 'not-published-or-unavailable' });
      return null;
    }
    const resource = resolution.probedResource as BackendGuideResource;
    const result = buildBackendGuideContent(resource, resolution.contentUrl, resourceName);
    const manifest = result.content?.metadata.packageManifest;
    if (!result.content || manifest?.type !== 'guide' || typeof manifest.id !== 'string' || !manifest.id) {
      logger.warn('Organization guide unavailable', { reason: 'invalid-guide' });
      return null;
    }
    const guide = JSON.parse(result.content.content) as JsonGuide;
    const expanded = await inlineSnippetRefsInGuideWithStatus(guide);
    if (expanded.unresolvedSnippetIds.length > 0) {
      logger.warn('Organization guide unavailable', { reason: 'unresolved-snippets' });
      return null;
    }
    return {
      resourceName,
      guideId: manifest.id,
      url: resolution.contentUrl,
      title: result.content.metadata.title,
      content: createPreparedContent({ fetched: result.content, countingGuide: guide, expandedGuide: expanded.guide }),
    };
  } catch {
    logger.warn('Organization guide unavailable', { reason: 'resolution-failed' });
    return null;
  }
}
