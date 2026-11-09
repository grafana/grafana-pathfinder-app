import React from 'react';
import {
  reportAppInteraction,
  UserInteraction,
  getContentTypeForAnalytics,
  AnalyticsContentType,
} from '../../lib/analytics';
import { catalogTopic } from '../../lib/catalog-discovery';
import type { Milestone } from '../../types/content.types';
import type { PackageOpenInfo } from '../../types/content-panel.types';
import type { ResolvedAssignment } from '../../types/learning-paths.types';
import { getManifestMilestoneIds, getManifestTracks, type ManifestTrack } from '../../types/package.types';
import type { PublishedGuide } from '../../utils/usePublishedGuides';
import { packageInfoForPath, pathTitle } from '../../utils/custom-guide-launch';
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

/** What a custom path row needs to list its milestones and open any one of them. */
export interface CustomPathMembers {
  /** Progress identity, the same key the path's cover reads completion under. */
  baseUrl: string;
  milestoneIds: string[];
  tracks: ManifestTrack[];
  initialTrackId?: string;
  /** `trackId` is set when `sequence` is one of `tracks`, unset for the Fundamentals sequence. */
  openMilestone: (milestone: Milestone, sequence: Milestone[], trackId?: string) => void | Promise<void>;
}

export interface CustomHubGuide extends HubGuide {
  members?: CustomPathMembers;
}

function toPathMembers(
  guide: PublishedGuide,
  title: string,
  assignment: ResolvedAssignment | undefined,
  openDocsPage: CustomGuidesOptions['openDocsPage']
): CustomPathMembers | undefined {
  const milestoneIds = getManifestMilestoneIds(guide.manifest);
  const tracks = getManifestTracks(guide.manifest);
  if (milestoneIds.length === 0 && tracks.length === 0) {
    return undefined;
  }
  return {
    baseUrl: `backend-guide:${guide.id}`,
    milestoneIds,
    tracks,
    initialTrackId: tracks.some((track) => track.trackId === assignment?.trackId) ? assignment?.trackId : undefined,
    openMilestone: (milestone, sequence, trackId) => {
      // Organization content: no titles, URLs or ids, the same rule as the resume card.
      reportAppInteraction(UserInteraction.JumpIntoMilestoneClick, {
        milestone_number: milestone.number,
        total_milestones: sequence.length,
        interaction_location: 'hub_custom_milestone_list',
      });
      const packageInfo = packageInfoForPath(guide, trackId ? undefined : sequence, trackId);
      // The cover's starting location and fields must not replace the milestone's own.
      const {
        startingLocation: _startingLocation,
        additionalFields: _additionalFields,
        ...memberManifest
      } = packageInfo.packageManifest ?? {};
      return openDocsPage(milestone.url, title, {
        ...packageInfo,
        packageManifest: memberManifest,
        ...(trackId && { trackMilestones: sequence }),
      });
    },
  };
}

/** Same list the Recommended tab showed: paths then loose guides, or every published guide when there are no paths. */
export function toHubCustomGuides({
  guides,
  paths,
  orphanGuides,
  assignments,
  openDocsPage,
}: CustomGuidesOptions): CustomHubGuide[] {
  const toRow = (guide: PublishedGuide, isPath: boolean): CustomHubGuide => {
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
      members: isPath ? toPathMembers(guide, title, assignment, openDocsPage) : undefined,
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
  };

  return paths.length > 0
    ? [...paths.map((guide) => toRow(guide, true)), ...orphanGuides.map((guide) => toRow(guide, false))]
    : guides.filter((guide) => guide.id && guide.title).map((guide) => toRow(guide, false));
}
