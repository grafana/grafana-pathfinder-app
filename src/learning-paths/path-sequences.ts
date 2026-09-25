/**
 * Splits a path's members into the separate sequences Path Tracks declares,
 * shared by every "is this path done" consumer (`learning-paths.hook.ts`'s
 * display rollup, `badges.ts`'s completion-badge trigger) so they cannot
 * drift on what a path's sequences are, even if they still differ on how a
 * sequence's own completeness is judged.
 */
import type { LearningPath } from '../types/learning-paths.types';
import { getManifestMilestoneIds, getManifestTracks } from '../types/package.types';

/**
 * A path's own Foundations milestones, plus each Path Tracks entry, as
 * separate ordered id lists — a track is a presentation ordering over a
 * subset/superset of guides, never a second completion authority
 * (COMPLETION-MODEL.md decision 10), so each sequence rolls up on its own
 * rather than being flattened into one list first.
 *
 * Filtered against `path.guides` (already the published-only member set —
 * see `app-platform-paths.ts`), so an unpublished milestone/track guide
 * drops out the same way it already does for the pre-tracks flat rollup.
 * `path.manifest` is unset for a URL-based path (no tracks concept there —
 * `path.guides` alone is that path's one and only sequence).
 *
 * Tracks are gated on `manifest.type === 'path'` specifically (RFC §6.1 /
 * schema Rule 3), the same guard `fetchPackageContent` applies: that rule
 * only runs in superRefine, which runtime loaders skip, so a journey
 * manifest that still carries a stray `tracks` array must not grow an
 * extra scored sequence here either.
 */
export function pathSequences(path: LearningPath): string[][] {
  const guideIds = new Set(path.guides);
  const foundations = path.manifest
    ? getManifestMilestoneIds(path.manifest).filter((id) => guideIds.has(id))
    : path.guides;
  const tracks =
    path.manifest?.type === 'path'
      ? getManifestTracks(path.manifest).map((track) => track.guides.filter((id) => guideIds.has(id)))
      : [];
  return [foundations, ...tracks].filter((sequence) => sequence.length > 0);
}
