import { usageError } from './errors.mjs';
import { ENVELOPE_SCHEMA_VERSION, findConcern } from './registry.mjs';
import { pathSelectorDisplay, selectorSetOf, semanticSelectorDisplay } from './selectors.mjs';

export const SHOW_VIEWS = ['full', 'routing', 'review', 'worker', 'plan'];

function withLocator(text, locator) {
  return locator === undefined ? text : `${text} (${locator})`;
}

function documentDisplay(source) {
  return withLocator(source.path, source.locator);
}

function codeDisplay(source) {
  if (source.kind === 'code_glob') {
    return withLocator(source.pattern, source.locator);
  }
  if (source.kind === 'literal_code_path') {
    return withLocator(source.path, source.locator);
  }
  return source.instruction;
}

function verificationDisplay(step) {
  if (step.kind === 'command') {
    return step.command;
  }
  if (step.kind === 'test_path') {
    return step.path;
  }
  if (step.kind === 'test_glob') {
    return step.pattern;
  }
  return step.text;
}

function contractAnchor(concern) {
  const record = concern.contract_records.find((entry) => entry.kind === 'established');
  return record ? { evidence: record.evidence.display_text, contract: record.statements.join(' ') } : null;
}

function preContractCandidate(concern) {
  const record = concern.contract_records.find((entry) => entry.kind === 'candidate');
  return record ? { evidence: record.evidence.display_text, proposed_owner: record.proposed_owner } : null;
}

function routingPacket(concern) {
  const selectors = selectorSetOf(concern);
  return {
    id: concern.id,
    name: concern.name,
    category: concern.activation.category,
    activation: {
      kind: concern.activation.kind,
      mode: concern.activation.mode,
      min_signals: concern.activation.minimum_signals,
      max_context_files: concern.context_budget.max_context_files,
      rationale: concern.activation.rationale,
    },
    selectors,
    trigger_paths: selectors.paths.map(pathSelectorDisplay),
    trigger_keywords: selectors.semantics.map(semanticSelectorDisplay),
    dispatch: concern.dispatch,
  };
}

function reviewPacket(concern) {
  return {
    id: concern.id,
    name: concern.name,
    max_context_files: concern.context_budget.max_context_files,
    purpose: concern.guidance.purpose,
    load: { documents: concern.guidance.load_documents, code: concern.guidance.load_code },
    load_docs: concern.guidance.load_documents.map(documentDisplay),
    load_code: concern.guidance.load_code.map(codeDisplay),
    review_questions: concern.guidance.review_questions,
    one_way_doors: concern.guidance.one_way_doors,
    verification: concern.guidance.verification.map(verificationDisplay),
    verification_steps: concern.guidance.verification,
    related: concern.related,
    output_policy: concern.output_policy ?? null,
    contract_anchor: contractAnchor(concern),
    named_invariants: concern.named_invariants,
    pre_contract_candidate: preContractCandidate(concern),
  };
}

// The bounded packet a review worker receives. Its field set matches what the
// Markdown-era extractor emits under `--worker`, so a Phase 3 parity check has
// something to compare against.
function workerPacket(concern) {
  const review = reviewPacket(concern);
  return {
    id: review.id,
    purpose: review.purpose,
    review_questions: review.review_questions,
    one_way_doors: review.one_way_doors,
    verification: review.verification,
    contract_anchor: review.contract_anchor,
    named_invariants: review.named_invariants,
  };
}

function planPacket(registry, concern) {
  const gate = registry.dispatch_policy.contract_evolution_gate;
  const eligible =
    gate.applies_to_categories.includes(concern.activation.category) &&
    (!gate.skips_always_on || concern.activation.kind !== 'always') &&
    (!gate.requires_concrete_path_selectors ||
      selectorSetOf(concern).paths.some((selector) => selector.kind !== 'all_changed_files'));
  return {
    id: concern.id,
    specialist: concern.dispatch.kind === 'specialist' ? concern.dispatch.specialist_skill : null,
    dispatch: concern.dispatch,
    max_context_files: concern.context_budget.max_context_files,
    always_on: concern.activation.kind === 'always',
    never_suppressed: registry.classification_policy.never_suppressed_concerns.includes(concern.id),
    contract_evolution_eligible: eligible,
  };
}

export function showConcern({ registry, id, view = 'full' }) {
  const concern = findConcern(registry, id);
  if (!concern) {
    throw usageError(`Concern ${id} is not in the registry. Run "concerns list" for the concern ids.`);
  }
  if (!SHOW_VIEWS.includes(view)) {
    throw usageError(`Unknown view ${view}. Expected one of: ${SHOW_VIEWS.join(', ')}.`);
  }
  if (view === 'routing') {
    return { schema_version: ENVELOPE_SCHEMA_VERSION, view, concern: routingPacket(concern) };
  }
  if (view === 'review') {
    return { schema_version: ENVELOPE_SCHEMA_VERSION, view, concern: reviewPacket(concern) };
  }
  if (view === 'worker') {
    return { schema_version: ENVELOPE_SCHEMA_VERSION, view, concern: workerPacket(concern) };
  }
  if (view === 'plan') {
    return { schema_version: ENVELOPE_SCHEMA_VERSION, view, concern: planPacket(registry, concern) };
  }
  return {
    schema_version: ENVELOPE_SCHEMA_VERSION,
    view,
    concern: { ...routingPacket(concern), ...reviewPacket(concern), plan: planPacket(registry, concern) },
  };
}

export function listConcerns({ registry }) {
  return {
    schema_version: ENVELOPE_SCHEMA_VERSION,
    concerns: registry.concerns.map((concern) => ({
      id: concern.id,
      name: concern.name,
      category: concern.activation.category,
      activation_kind: concern.activation.kind,
      mode: concern.activation.mode,
      min_signals: concern.activation.minimum_signals,
      max_context_files: concern.context_budget.max_context_files,
      dispatch: concern.dispatch.kind,
      purpose: concern.guidance.purpose,
    })),
  };
}
