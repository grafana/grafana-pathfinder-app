export interface ActiveJourneyContext {
  journeyUrl: string;
  milestoneNumber: number;
  totalMilestones: number;
}

let activeJourneyContext: ActiveJourneyContext | null = null;

export function setActiveJourneyContext(context: ActiveJourneyContext | null): void {
  activeJourneyContext = context;
}

export function getActiveJourneyContext(): ActiveJourneyContext | null {
  return activeJourneyContext;
}

export function resetJourneyContextForTests(): void {
  activeJourneyContext = null;
}
