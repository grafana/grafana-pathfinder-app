import { getGuideProgress } from './completion-store';
import { getContentKey } from './content-key';

export interface ActiveJourneyContext {
  journeyUrl: string;
  milestoneNumber: number;
  totalMilestones: number;
  /** Slug of the milestone currently rendered; must be derived with getMilestoneSlug like markMilestoneDone's writes. */
  activeMilestoneSlug?: string;
  /** Roster of all milestone slugs, same derivation; intersected against the completed set. */
  milestoneSlugs?: string[];
}

let activeJourneyContext: ActiveJourneyContext | null = null;

const completedMilestonesByJourney = new Map<string, Set<string>>();

function normalizeJourneyUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

export function setActiveJourneyContext(context: ActiveJourneyContext | null): void {
  activeJourneyContext = context;
}

export function getActiveJourneyContext(): ActiveJourneyContext | null {
  return activeJourneyContext;
}

/** Union-merge: an async prime resolving late must never drop a synchronously noted slug. */
export function primeJourneyCompletedMilestones(journeyUrl: string, slugs: Iterable<string>): void {
  const key = normalizeJourneyUrl(journeyUrl);
  const existing = completedMilestonesByJourney.get(key) ?? new Set<string>();
  for (const slug of slugs) {
    existing.add(slug);
  }
  completedMilestonesByJourney.set(key, existing);
}

export function noteMilestoneCompleted(journeyUrl: string, slug: string): void {
  primeJourneyCompletedMilestones(journeyUrl, [slug]);
}

export function clearJourneyCompletedMilestonesCache(journeyUrl?: string): void {
  if (journeyUrl === undefined) {
    completedMilestonesByJourney.clear();
    return;
  }
  completedMilestonesByJourney.delete(normalizeJourneyUrl(journeyUrl));
}

function completionFromCache(
  journeyUrl: string,
  milestoneSlugs: string[] | undefined,
  totalMilestones: number,
  activeFraction: number
): number {
  if (totalMilestones <= 0) {
    return 0;
  }
  const set = completedMilestonesByJourney.get(normalizeJourneyUrl(journeyUrl)) ?? new Set<string>();
  const roster = milestoneSlugs ?? [];
  // Roster intersection clamps stale slugs and the step-less cover-page wart
  // (a forward arrow on the cover writes the journey's own slug into the set).
  const completed =
    roster.length > 0 ? roster.filter((slug) => set.has(slug)).length : Math.min(set.size, totalMilestones);
  return Math.min(100, Math.max(0, Math.round(((completed + activeFraction) / totalMilestones) * 100)));
}

/**
 * Step-driven completion for the active journey: completed milestones plus
 * the active milestone's live completed-steps fraction, over the total.
 * A milestone counts as completed via its steps (onGuideComplete) or, when
 * it has no steps, via navigate-past — both recorded through markMilestoneDone.
 */
export function getActiveJourneyCompletionPercentage(): number | null {
  const ctx = activeJourneyContext;
  if (!ctx) {
    return null;
  }
  if (ctx.totalMilestones <= 0) {
    return 0;
  }

  const set = completedMilestonesByJourney.get(normalizeJourneyUrl(ctx.journeyUrl)) ?? new Set<string>();
  const roster = ctx.milestoneSlugs ?? [];
  const activeIsUncompletedMilestone =
    !!ctx.activeMilestoneSlug &&
    ctx.milestoneNumber >= 1 &&
    (roster.length === 0 || roster.includes(ctx.activeMilestoneSlug)) &&
    !set.has(ctx.activeMilestoneSlug);
  const fraction = activeIsUncompletedMilestone ? getGuideProgress(getContentKey()).percentage / 100 : 0;

  return completionFromCache(ctx.journeyUrl, ctx.milestoneSlugs, ctx.totalMilestones, fraction);
}

/**
 * Completion for a specific journey, safe for background tabs. Delegates to
 * the live active supplier when the journey is the active one; otherwise
 * milestone-level only (no step fraction — only the rendered document's
 * steps are registered). Returns null when nothing is cached so callers can
 * omit the property instead of reporting a false 0.
 */
export function getJourneyCompletionPercentageFor(
  journeyUrl: string,
  milestoneSlugs: string[] | undefined,
  totalMilestones: number
): number | null {
  const key = normalizeJourneyUrl(journeyUrl);
  if (activeJourneyContext && normalizeJourneyUrl(activeJourneyContext.journeyUrl) === key) {
    return getActiveJourneyCompletionPercentage();
  }
  if (!completedMilestonesByJourney.has(key)) {
    return null;
  }
  return completionFromCache(journeyUrl, milestoneSlugs, totalMilestones, 0);
}

export function resetJourneyContextForTests(): void {
  activeJourneyContext = null;
  completedMilestonesByJourney.clear();
}
