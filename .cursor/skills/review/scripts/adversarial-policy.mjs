const VERDICTS = new Set(['confirmed', 'refuted', 'uncertain']);

function resolved(lane, status) {
  return { lane, dispatch: { role: null, count: 0 }, status };
}

function awaiting(lane, role, count) {
  return { lane, dispatch: { role, count }, status: 'needs_verification' };
}

function validateVerdicts(verdicts) {
  if (!Array.isArray(verdicts)) {
    throw new Error('verdicts must be an array');
  }
  for (const verdict of verdicts) {
    if (!verdict || typeof verdict !== 'object' || !VERDICTS.has(verdict.verdict)) {
      throw new Error(`Unknown verdict: ${verdict?.verdict}`);
    }
    const keys = Object.keys(verdict).sort();
    if (keys.length !== 2 || keys[0] !== 'reason' || keys[1] !== 'verdict') {
      throw new Error('Each verdict must contain only verdict and reason');
    }
    if (typeof verdict.reason !== 'string' || verdict.reason.trim().length === 0) {
      throw new Error('Each verdict must cite a non-empty reason');
    }
  }
}

export function deriveVerificationLane(observation, provisionallyBlocking) {
  if (observation.kind !== 'defect') {
    return 'unverified';
  }
  if (observation.severity === 'critical' || observation.severity === 'high' || provisionallyBlocking) {
    return 'high_risk';
  }
  return observation.severity === 'medium' ? 'advisory' : 'unverified';
}

export function decideVerification(observation, verdicts = [], provisionallyBlocking = false) {
  validateVerdicts(verdicts);
  const lane = deriveVerificationLane(observation, provisionallyBlocking);
  const refuted = verdicts.filter(({ verdict }) => verdict === 'refuted').length;
  const confirmed = verdicts.filter(({ verdict }) => verdict === 'confirmed').length;
  const seen = verdicts.length;

  if (lane === 'unverified') {
    if (seen > 0) {
      throw new Error('An unverified observation passes without skeptic verdicts');
    }
    return resolved(lane, 'established');
  }

  if (lane === 'high_risk') {
    if (seen === 0) {
      return awaiting(lane, 'skeptic', 2);
    }
    if (seen === 1) {
      return awaiting(lane, null, 0);
    }
    if (seen === 2) {
      if (refuted === 2) {
        return resolved(lane, 'dropped');
      }
      if (confirmed === 2) {
        return resolved(lane, 'established');
      }
      return awaiting(lane, 'tiebreaker', 1);
    }
    if (seen === 3) {
      return resolved(lane, refuted >= 2 ? 'dropped' : 'established');
    }
    throw new Error('A high-risk defect takes at most three skeptic verdicts');
  }

  if (seen === 0) {
    return awaiting(lane, 'skeptic', 1);
  }
  if (seen === 1) {
    return confirmed === 1 ? resolved(lane, 'established') : awaiting(lane, 'adjudicator', 1);
  }
  if (seen === 2) {
    return resolved(lane, verdicts[1].verdict === 'refuted' ? 'dropped' : 'established');
  }
  throw new Error('A medium defect takes at most one skeptic and one adjudicator');
}
