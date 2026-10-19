import React from 'react';
import {
  reportAppInteraction,
  UserInteraction,
  getContentTypeForAnalytics,
  AnalyticsContentType,
} from '../../lib/analytics';
import { catalogTopic } from '../../lib/catalog-discovery';
import type { PackageOpenInfo } from '../../types/content-panel.types';
import type { ResolvedAssignment } from '../../types/learning-paths.types';
import type { PublishedGuide } from '../../utils/usePublishedGuides';
import { packageInfoForPath, pathTitle } from '../docs-panel/CustomGuidesSection';
import { learningEffort } from '../LearningContentCard/learning-effort';
import { AssignmentBadges } from '../LearningPaths/AssignmentBadges';
import type { HubGuide } from './GuideRow';

interface CustomGuidesOptions {
  guides: PublishedGuide[];
  paths: PublishedGuide[];
  orphanGuides: PublishedGuide[];
  assignments: ResolvedAssignment[];
  openDocsPage: (url: string, title: string, packageInfo?: PackageOpenInfo) => void | Promise<void>;
}

/** Same list the Recommended tab shows: paths then loose guides, or every published guide when there are no paths. */
export function toHubCustomGuides({
  guides,
  paths,
  orphanGuides,
  assignments,
  openDocsPage,
}: CustomGuidesOptions): HubGuide[] {
  const entries = paths.length > 0 ? [...paths, ...orphanGuides] : guides.filter((guide) => guide.id && guide.title);

  return entries.map((guide) => {
    const isPath = paths.includes(guide);
    const kind = isPath ? 'path' : 'guide';
    const title = pathTitle(guide);
    const assignment = isPath ? assignments.find((candidate) => candidate.targetId === guide.id) : undefined;
    return {
      key: `custom:${guide.id}`,
      title,
      topic: catalogTopic({ id: guide.id, title, category: guide.manifest?.category }),
      kind,
      effort: learningEffort(guide.manifest as unknown as Record<string, unknown>, kind),
      organization: true,
      badges: assignment && <AssignmentBadges assignment={assignment} />,
      onLaunch: () => {
        const guideUrl = `backend-guide:${guide.id}`;
        reportAppInteraction(UserInteraction.OpenResourceClick, {
          content_title: title,
          content_url: guideUrl,
          content_type: getContentTypeForAnalytics(guideUrl, AnalyticsContentType.InteractiveGuide),
          interaction_location: 'hub_custom_guides',
        });
        return openDocsPage(
          guideUrl,
          title,
          isPath ? packageInfoForPath(guide, undefined, assignment?.trackId) : undefined
        );
      },
    };
  });
}
