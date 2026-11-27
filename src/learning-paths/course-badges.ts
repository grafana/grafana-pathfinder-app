import { BADGES } from './badges';
import { findPathByUrl } from './paths-data';

export function getCourseCompletionBadges({
  pathId,
  baseUrl,
  organization = false,
}: {
  pathId?: string;
  baseUrl: string;
  organization?: boolean;
}) {
  if (organization) {
    return [];
  }
  const courseId = pathId ?? findPathByUrl(baseUrl)?.id;
  return BADGES.filter((badge) => badge.trigger.type === 'path-completed' && badge.trigger.pathId === courseId);
}
