/**
 * Pure milestone-sequence resolution — no side-effecting imports (storage,
 * analytics, `@grafana/runtime`), so consumers that only need this logic
 * (tests included) can pull it in without dragging in the rest of
 * `learning-journey-helpers.ts`.
 */
import { RawContent, Milestone } from '../types/content.types';

/**
 * The milestone sequence Next/Previous should traverse. On the cover page,
 * a selected track redirects to that track's guides via this content's own
 * fresh `tracks` field, not the caller's persisted `activeTrackMilestones`
 * snapshot (see `LearningJourneyTab.activeTrackMilestones`), which can go
 * stale. Past the cover, `tracks` is never populated, so staying
 * track-aware there requires that persisted snapshot instead, matched
 * against this content's own URL. Falls through to Foundations when the
 * current guide isn't part of the active track.
 *
 * The match runs even with no `learningJourney` at all, since a track-only
 * guide carries none — gating on it would leave such a guide's Next/Previous
 * permanently disabled once opened.
 */
export function resolveActiveMilestoneSequence(
  content: RawContent,
  activeTrackId?: string | null,
  activeTrackMilestones?: readonly Milestone[] | null
): { currentMilestone: number; milestones: Milestone[] } | null {
  const lj = content.type === 'learning-journey' ? content.metadata.learningJourney : undefined;

  if (activeTrackId) {
    if (lj?.currentMilestone === 0) {
      const track = lj.tracks?.find((t) => t.trackId === activeTrackId);
      if (track) {
        return { currentMilestone: 0, milestones: [...track.milestones] };
      }
    } else if (activeTrackMilestones) {
      const current = activeTrackMilestones.find((m) => m.url === content.url);
      if (current) {
        return { currentMilestone: current.number, milestones: [...activeTrackMilestones] };
      }
    }
  }

  return lj ? { currentMilestone: lj.currentMilestone, milestones: lj.milestones } : null;
}

/** Everything `LearningJourneyMilestoneToolbar` needs to render one sequence. */
export interface ActiveMilestoneToolbarContext {
  currentMilestone: number;
  totalMilestones: number;
  milestones: Milestone[];
  /** Progress-storage identity for `journeyMilestonePercentages` — the journey's own `baseUrl` for a base-milestone guide, the owning path's `trackMemberBaseUrl` for a track-only one. */
  baseUrl: string;
  websiteUrl?: string;
}

/**
 * The toolbar's nav/label/progress-bar data for whichever sequence
 * {@link resolveActiveMilestoneSequence} resolves — base Foundations or the
 * reader's active track — so the toolbar always agrees with where
 * Next/Previous actually go, instead of gating on `learningJourney` alone
 * (which a track-only guide never carries). `null` when this content has no
 * navigable sequence at all: neither a real `learningJourney` nor an active
 * track membership, nor a `trackMemberBaseUrl` to key progress against.
 */
export function resolveActiveMilestoneToolbarContext(
  content: RawContent,
  activeTrackId?: string | null,
  activeTrackMilestones?: readonly Milestone[] | null
): ActiveMilestoneToolbarContext | null {
  const sequence = resolveActiveMilestoneSequence(content, activeTrackId, activeTrackMilestones);
  if (!sequence) {
    return null;
  }

  const lj = content.type === 'learning-journey' ? content.metadata.learningJourney : undefined;
  const baseUrl = lj?.baseUrl ?? content.metadata.trackMemberBaseUrl;
  if (!baseUrl) {
    return null;
  }

  return {
    currentMilestone: sequence.currentMilestone,
    totalMilestones: sequence.milestones.length,
    milestones: sequence.milestones,
    baseUrl,
    websiteUrl: lj?.websiteUrl,
  };
}
