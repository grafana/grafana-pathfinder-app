export const CLAIM_FIELDS = [
  'finding_id',
  'concern_id',
  'kind',
  'title',
  'evidence',
  'why_it_matters',
  'applies_to_files',
  'origin',
  'impact',
  'reversibility',
  'scope_effect',
  'breaks_shipped_path',
  'induced',
];
const CLAIM_TEXT_FIELDS = ['title', 'why_it_matters'];

const COUNT = String.raw`(?:\d+|two|three|four|five|six|seven|eight|nine|ten|several|multiple|many|all|both|every|each)`;
// Review-role nouns only: "worker", "observer", and "agent" are common code nouns and are left out on purpose.
const REVIEWER = String.raw`(?:reviewers?|skeptics?|specialists?|producers?|verifiers?)`;
const REPORTED = String.raw`(?:reported|flagged|found|raised|confirmed|identified|noted|corroborated)`;

const META_CLAIM_PATTERNS = [
  new RegExp(String.raw`\b(?:independently|separately)\s+${REPORTED}\b`, 'i'),
  new RegExp(String.raw`\b${REPORTED}\s+(?:independently|separately)\b`, 'i'),
  new RegExp(String.raw`\b${COUNT}\s+(?:of\s+(?:the\s+)?(?:\d+\s+)?)?(?:independent\s+|other\s+)?${REVIEWER}\b`, 'i'),
  new RegExp(
    String.raw`\b(?:${REVIEWER}|workers?|agents?|observers?|subagents?)\s+(?:all\s+)?(?:agree|agreed|concur|concurred)\b`,
    'i'
  ),
  new RegExp(
    String.raw`\b${REPORTED}\s+by\s+(?:both|all|several|multiple|\d+|two|three|four|five)\s+(?:of\s+the\s+)?(?:${REVIEWER}|workers?|agents?|observers?|subagents?)\b`,
    'i'
  ),
  /\b(?:reached|reach|by|in)\s+consensus\b|\bconsensus\s+(?:among|of|between|across)\b|\bconsensus\s+(?:finding|view|verdict|that)\b|\bunanimous(?:ly)?\b/i,
  /\broot\s+(?:dedupe|dedup|synthesis|recommends?|recommended|suggests?|believes|thinks|considers|concluded|judges?)\b/i,
  new RegExp(
    String.raw`\b${REVIEWER}\s+(?:reported|flagged|recommends?|recommended|says|said|believes|concluded|rated)\b`,
    'i'
  ),
  /\bother\s+(?:skeptic|reviewer|verifier)s?\b/i,
  /\b(?:everyone|everybody|all|each)\s+(?:who|that)\s+(?:reviewed|looked)\b/i,
  /\balready\s+(?:been\s+)?(?:verified|confirmed)\b/i,
  /\bnote\s+to\s+(?:the\s+)?(?:verifier|skeptic|reviewer)\b|\bexpected\s+verdict\b/i,
  /\brecommend(?:s|ed|ing)?\s+(?:blocking|approval|approving|merging|requesting changes)\b/i,
  /\b(?:should|must)\s+(?:block\s+(?:the\s+)?(?:merge|pr)|be\s+(?:a\s+)?(?:merge[- ])?blocker|request\s+changes)\b/i,
  /\b(?:merge|release)[- ]blocker\b/i,
];

function claimTexts(claim) {
  const texts = CLAIM_TEXT_FIELDS.filter((field) => typeof claim[field] === 'string').map((field) => [
    field,
    claim[field],
  ]);
  (claim.evidence ?? []).forEach((entry, index) => texts.push([`evidence[${index}]`, entry]));
  if (claim.clearance_contradiction) {
    texts.push(['clearance_contradiction.claim', claim.clearance_contradiction.claim]);
    texts.push(['clearance_contradiction.new_evidence', claim.clearance_contradiction.new_evidence]);
  }
  return texts;
}

export function metaClaims(claim) {
  return claimTexts(claim).flatMap(([field, text]) => {
    const match = META_CLAIM_PATTERNS.map((pattern) => text.match(pattern)).find(Boolean);
    return match ? [{ field, quote: match[0] }] : [];
  });
}

export function assertNoMetaClaims(claim, label, remedy) {
  const [found] = metaClaims(claim);
  if (found) {
    throw new Error(
      `${label}.${found.field} states something about the review, not the code ("${found.quote}"). A skeptic sees only claims about the code: who reported a finding, how many agreed, merged duplicates, and recommendations are provenance. ${remedy}`
    );
  }
}

export function skepticClaim(observation) {
  const claim = Object.fromEntries(
    CLAIM_FIELDS.filter((field) => field in observation).map((field) => [field, structuredClone(observation[field])])
  );
  if (observation.clearance_contradiction) {
    const { claim: cleared, new_evidence: newEvidence } = observation.clearance_contradiction;
    claim.clearance_contradiction = { claim: cleared, new_evidence: newEvidence };
  }
  return claim;
}

export function withheldFields(observation) {
  const withheld = Object.fromEntries(
    Object.entries(observation).filter(
      ([field]) => !CLAIM_FIELDS.includes(field) && field !== 'clearance_contradiction'
    )
  );
  if (observation.clearance_contradiction) {
    withheld.clearance_contradiction_prior_reason = observation.clearance_contradiction.prior_reason;
  }
  return withheld;
}
