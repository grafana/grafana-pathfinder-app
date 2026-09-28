import { logger } from '../logging';
import { setFaroSessionAttributes } from './faro-adapter';

// Wire schema of the `experiments` session attribute:
// `{ v, cohorts: [{ flag, variant, guideId? }] }` — bump on shape changes.
export const SESSION_EXPERIMENTS_SCHEMA_VERSION = 1;

// Must stay at or below faro-adapter's MAX_ATTRIBUTE_LENGTH (500), or
// stringifyAttributes would slice the JSON mid-document into an unparsable string.
const MAX_SESSION_EXPERIMENTS_LENGTH = 500;

export interface SessionExperimentCohort {
  flag: string;
  variant: string;
  guideId?: string;
}

interface ExperimentEntryLike {
  flag: string;
  variant: string;
  [key: string]: unknown;
}

export function buildSessionExperimentsValue(entries: ExperimentEntryLike[]): string | null {
  if (entries.length === 0) {
    return null;
  }
  const cohorts: SessionExperimentCohort[] = entries.map((entry) => ({
    flag: entry.flag,
    variant: entry.variant,
    ...(typeof entry.guideId === 'string' && entry.guideId ? { guideId: entry.guideId } : {}),
  }));
  const serialized = JSON.stringify({ v: SESSION_EXPERIMENTS_SCHEMA_VERSION, cohorts });
  if (serialized.length > MAX_SESSION_EXPERIMENTS_LENGTH) {
    logger.warn('Session experiments payload exceeds the attribute cap; stamping empty cohorts', {
      length: serialized.length,
    });
    return JSON.stringify({ v: SESSION_EXPERIMENTS_SCHEMA_VERSION, cohorts: [] });
  }
  return serialized;
}

// Fire-and-forget, called by initFaro and again on enrollment. Reads cohorts
// through analytics' late-bound provider rather than utils/experiments, which
// keeps the experiment modules out of this import cycle; the import must stay
// dynamic so the OpenFeature SDK behind that provider never lands in this chunk.
export async function stampSessionExperiments(): Promise<void> {
  try {
    const { getBoundActiveExperiments } = await import('../analytics');
    const value = buildSessionExperimentsValue(getBoundActiveExperiments());
    if (value !== null) {
      setFaroSessionAttributes({ experiments: value });
    }
  } catch {
    // Telemetry must never break the app it's observing.
  }
}
