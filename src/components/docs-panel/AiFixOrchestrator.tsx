/**
 * AiFixOrchestrator — glue between the "Ask AI to fix" button in interactive
 * steps and the docs-panel Scene model.
 *
 * Listens for `pathfinder-ai-fix-request` events emitted by
 * `interactive-step.tsx` / `interactive-guided.tsx` when a user invokes the
 * AI fallback. On a request:
 *   1. Read the active tab's guide JSON.
 *   2. Start the global ad-hoc blocker so the user can't race the assistant.
 *   3. Optionally capture a viewport screenshot.
 *   4. Call the Grafana Assistant via `useAiFixGeneration`.
 *   5. On a validated patch, apply it to the tab content and `setState`.
 *      ContentRenderer's existing memoization on `content.content` causes
 *      the failing step to remount and re-check.
 *   6. Stop the blocker; report success/failure analytics.
 *
 * Renders nothing.
 */

import { useEffect, useRef } from 'react';

import { AppEvents } from '@grafana/data';
import { getAppEvents } from '@grafana/runtime';

import { reportAppInteraction, UserInteraction } from '../../lib/analytics';
import { useAiFixGeneration } from '../../integrations/assistant-integration/useAiFixGeneration.hook';
import type { AiFixPatch } from '../../integrations/assistant-integration/ai-fix-patch.schema';
import { applyPatchToGuide } from '../../integrations/assistant-integration/apply-ai-fix-patch';
import { synthesizeStepIdsInJson } from '../../docs-retrieval';
import { GlobalInteractionBlocker } from '../../interactive-engine';
import { querySelectorAllEnhanced, resolveSelector } from '../../lib/dom';
import type { LearningJourneyTab } from '../../types/content-panel.types';

/**
 * Surface a Grafana toast so the user sees that the AI auto-heal cycle
 * actually did something (or couldn't). Without this, a successful patch
 * with a still-failing selector is indistinguishable from a no-op to the
 * user — they keep clicking with no signal that anything changed.
 */
function publishToast(severity: 'success' | 'warning', title: string, body?: string) {
  try {
    const event = severity === 'success' ? AppEvents.alertSuccess : AppEvents.alertWarning;
    getAppEvents().publish({ type: event.name, payload: body ? [title, body] : [title] });
  } catch {
    // Defensive: getAppEvents can throw in non-Grafana hosts (jest jsdom).
  }
}

interface AiFixRequestDetail {
  stepId?: string;
  renderedStepId?: string;
  refTarget?: string;
  action?: string;
  /**
   * Container address for sub-step failures (multistep / guided containers).
   * When present the orchestrator forwards a `containerInfo` payload to the
   * assistant so it picks the `substep-selector-patch` variant.
   */
  containerInfo?: {
    containerId: string;
    containerKind: 'multistep' | 'guided';
    subStepIndex: number;
  };
}

interface AiFixOrchestratorProps {
  /** The currently-active tab whose guide JSON we'll patch on success. */
  activeTab: LearningJourneyTab | null;
  /** Callback to write the patched guide JSON back into the active tab. */
  onPatchApplied: (tabId: string, newGuideJson: string) => void;
}

/**
 * Format a single DOM element as `"text" [data-testid="…", aria-label="…"]`
 * so the assistant has actual attributes to compose selectors from. The
 * model is instructed to prefer data-testid; without sending the testids
 * it had to guess (and got it wrong — see runtime audit logs).
 */
function describeElement(el: Element, maxText = 60): string | null {
  const text = (el.textContent ?? '').trim().slice(0, maxText);
  const testId = el.getAttribute('data-testid');
  const ariaLabel = el.getAttribute('aria-label');
  const id = el.getAttribute('id');
  const role = el.getAttribute('role');
  if (!text && !testId && !ariaLabel && !id) {
    return null;
  }
  const attrs: string[] = [];
  if (testId) {
    attrs.push(`data-testid="${testId}"`);
  }
  if (ariaLabel) {
    attrs.push(`aria-label="${ariaLabel}"`);
  }
  if (id) {
    attrs.push(`id="${id}"`);
  }
  if (role && el.tagName.toLowerCase() !== role.toLowerCase()) {
    attrs.push(`role="${role}"`);
  }
  const tag = el.tagName.toLowerCase();
  return `<${tag}> "${text}" [${attrs.join(', ')}]`;
}

/**
 * Pull tokens out of the failing selector that we can fuzzy-search against
 * live DOM attributes. Returns short distinct strings — ignoring tag names,
 * generic attribute keys, and pseudo-selectors. Tokens drive the
 * "near-matches" probe below.
 */
function tokensFromSelector(selector: string): string[] {
  const tokens = new Set<string>();
  const stringMatches = selector.matchAll(/"([^"]+)"|'([^']+)'/g);
  for (const m of stringMatches) {
    const raw = (m[1] ?? m[2] ?? '').trim();
    if (raw) {
      tokens.add(raw);
      // Also add the trailing word (e.g. "data-testid Panel menu New Panel" → "Panel" → "menu" → "New" → "Panel").
      raw.split(/\s+/).forEach((word) => {
        if (word.length >= 3) {
          tokens.add(word);
        }
      });
    }
  }
  // Fallback: the bare token form `#foo` / `.bar` if no strings were present.
  if (tokens.size === 0) {
    selector.split(/[\s>+~,]/).forEach((part) => {
      const cleaned = part.replace(/^[.#]/, '').trim();
      if (cleaned.length >= 3) {
        tokens.add(cleaned);
      }
    });
  }
  return Array.from(tokens).slice(0, 6);
}

/**
 * Tokens that always appear in selectors but carry no semantic signal
 * about WHAT the selector targets — these get filtered out before the
 * confidence overlap comparison so two selectors aren't deemed "related"
 * just because both contain the literal word "data-testid".
 */
const SELECTOR_NOISE_TOKENS: ReadonlySet<string> = new Set([
  'data-testid',
  'data-test',
  'aria-label',
  'aria-labelledby',
  'aria-describedby',
  'role',
  'class',
  'id',
  'name',
  'type',
  'div',
  'span',
  'button',
  'input',
]);

/**
 * Confidence verdict for an AI-proposed patch.
 *
 * `ok: true` means we trust the patch enough to apply it:
 *   - Its proposed selector resolves to ≥ 1 element in the live DOM
 *     (so the requirement re-check has a real target), and
 *   - For selector swaps, its meaningful tokens overlap with the
 *     original failing selector's tokens (so it's clearly the same
 *     concept, just spelled differently — this is the gate that
 *     catches "Bar chart → Bar gauge" hallucinations).
 *
 * `ok: false` short-circuits the apply path and surfaces a warning
 * toast — same UX the existing "no confident fix" sentinel produces.
 */
type ConfidenceResult = { ok: true } | { ok: false; reason: string };

function meaningfulTokens(selector: string): string[] {
  return tokensFromSelector(selector)
    .map((t) => t.toLowerCase())
    .filter((t) => !SELECTOR_NOISE_TOKENS.has(t))
    .filter((t) => !t.includes(' ')); // drop the joined-string entries; only word-level tokens
}

function evaluatePatchConfidence(patch: AiFixPatch, originalReftarget: string): ConfidenceResult {
  // Identify the selector this patch wants the runtime to act on next.
  // For prepend-step, that's the inserted step's reftarget (it has to
  // resolve in the CURRENT page state, since it runs first).
  const proposedSelector = patch.type === 'prepend-step' ? (patch.newStep.reftarget ?? '') : patch.newReftarget;

  // Noop / popout prepend-steps without a reftarget are purely
  // instructional — there's no DOM target to verify, so we accept them.
  if (patch.type === 'prepend-step' && !proposedSelector) {
    return { ok: true };
  }

  if (!proposedSelector) {
    return { ok: false, reason: 'patch has no selector to verify' };
  }

  if (typeof document === 'undefined') {
    // Server / test context — skip verification rather than reject.
    return { ok: true };
  }

  // Use the same DOM-resolution pipeline the interactive-engine uses at
  // execution time, so the confidence check matches what the runtime
  // actually does on re-check:
  //   - resolveSelector handles `grafana:components.X.Y` and `panel:Title`
  //     prefixes and turns them into composite CSS selectors (often with
  //     `:has(…)` pseudo-classes).
  //   - querySelectorAllEnhanced handles `:has()`, `:contains()`, and
  //     other selectors that native querySelectorAll can't parse.
  // Falling back to native here would under-count for any patch the
  // engine would actually have resolved successfully.
  const resolved = resolveSelector(proposedSelector);
  let matchCount = 0;
  try {
    matchCount = querySelectorAllEnhanced(resolved).elements.length;
  } catch {
    return { ok: false, reason: 'proposed selector is not valid CSS' };
  }
  if (matchCount === 0) {
    return { ok: false, reason: 'proposed selector does not match any element on the current page' };
  }

  // Token overlap is meaningful for selector swaps (the new selector
  // should target the SAME concept as the failing one). Skip for
  // prepend-step — by design it targets a different element to set up
  // the missing UI state.
  if (patch.type !== 'prepend-step') {
    const originalTokens = new Set(meaningfulTokens(originalReftarget));
    const newTokens = meaningfulTokens(proposedSelector);
    if (originalTokens.size > 0 && newTokens.length > 0) {
      const hasOverlap = newTokens.some((t) => originalTokens.has(t));
      if (!hasOverlap) {
        return {
          ok: false,
          reason:
            'proposed selector shares no meaningful tokens with the original — likely targets an unrelated element',
        };
      }
    }
  }

  return { ok: true };
}

/**
 * Probe the live DOM for elements whose data-testid / aria-label / id
 * fuzzy-matches the failing selector's tokens. The LLM gets the resulting
 * candidates as a compact list — this is the highest-signal section of
 * the prompt because the answer is usually here verbatim.
 */
function nearMatches(failingReftarget: string): Array<{ attr: string; value: string; text: string }> {
  if (!failingReftarget || typeof document === 'undefined') {
    return [];
  }
  const tokens = tokensFromSelector(failingReftarget);
  const seen = new Set<string>();
  const candidates: Array<{ attr: string; value: string; text: string }> = [];
  const tryQuery = (attr: 'data-testid' | 'aria-label' | 'id', token: string) => {
    let escaped: string;
    try {
      escaped = (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(token) : token).replace(/"/g, '\\"');
    } catch {
      escaped = token.replace(/"/g, '\\"');
    }
    let matches: NodeListOf<Element>;
    try {
      matches = document.querySelectorAll(`[${attr}*="${escaped}"]`);
    } catch {
      return;
    }
    for (const el of Array.from(matches).slice(0, 4)) {
      const value = el.getAttribute(attr) ?? '';
      const key = `${attr}=${value}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      candidates.push({ attr, value, text: (el.textContent ?? '').trim().slice(0, 60) });
      if (candidates.length >= 12) {
        return;
      }
    }
  };
  for (const token of tokens) {
    if (candidates.length >= 12) {
      break;
    }
    tryQuery('data-testid', token);
    tryQuery('aria-label', token);
    tryQuery('id', token);
  }
  return candidates;
}

/**
 * Predicate: should this element be excluded from the candidates list as
 * navigation-sidebar pollution? The Grafana nav menu floods the first ~30
 * elements in document order with items that are virtually never the
 * target of a tutorial selector — see runtime audit logs where every
 * `Interactive candidates` section was dominated by `Nav menu item`,
 * `Bookmark X`, `Collapse section: X`. Filtering them frees the prompt
 * slots for actual page content (panel editor, viz picker, etc.).
 */
function isNavPollution(el: Element): boolean {
  const testId = el.getAttribute('data-testid') ?? '';
  const ariaLabel = el.getAttribute('aria-label') ?? '';
  if (
    /^(?:data-testid )?Nav menu /i.test(testId) ||
    /navigation mega-menu/i.test(testId) ||
    /breadcrumb/i.test(testId) ||
    /^icon-/i.test(testId)
  ) {
    return true;
  }
  if (/^Bookmark /i.test(ariaLabel) || /^Collapse section:/i.test(ariaLabel) || /^Expand section:/i.test(ariaLabel)) {
    return true;
  }
  if (el.tagName.toLowerCase() === 'svg') {
    return true;
  }
  return false;
}

/**
 * Score a candidate by overlap with tokens extracted from the failing
 * selector. Used to push relevant elements above unrelated ones when we
 * have to truncate the candidate list. Plus a small bonus for elements
 * that carry a `data-testid` (the prompt-preferred attribute).
 */
function scoreCandidate(el: Element, tokens: string[]): number {
  const haystack =
    `${el.getAttribute('data-testid') ?? ''} ${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('id') ?? ''} ${(el.textContent ?? '').slice(0, 120)}`.toLowerCase();
  let score = 0;
  for (const tok of tokens) {
    if (tok.length < 3) {
      continue;
    }
    if (haystack.includes(tok.toLowerCase())) {
      score += 5;
    }
  }
  if (el.hasAttribute('data-testid')) {
    score += 1;
  }
  return score;
}

/**
 * Collect a structured DOM context for the assistant prompt. Bounded but
 * meaningfully richer than the prior text-only hint:
 *   - Page section (route + title) — narrows the selector space.
 *   - Near-match section — fuzzy probe results from `failingReftarget`;
 *     usually the answer is sitting here verbatim.
 *   - Visible tabs / toggles — controls that gate which content is
 *     currently shown. The LLM uses these to propose `prepend-step`
 *     patches that activate a hidden subset (e.g. clicking the "All
 *     visualizations" tab before selecting "Bar chart").
 *   - Interactive candidates with attributes — filtered to remove nav
 *     sidebar pollution and ranked by token overlap with the failing
 *     selector so relevant elements survive the cap.
 *   - Headings — short orientation strip.
 */
function collectDomContext(failingReftarget: string): string {
  if (typeof document === 'undefined') {
    return '';
  }
  const sections: string[] = [];
  sections.push(`Page: ${window.location.pathname}`);
  if (document.title) {
    sections.push(`Title: ${document.title}`);
  }

  const candidates = nearMatches(failingReftarget);
  if (candidates.length > 0) {
    const lines = candidates.map((c) => `- ${c.attr}="${c.value}"${c.text ? ` (text: "${c.text}")` : ''}`);
    sections.push(`Near-matches in live DOM for failing selector:\n${lines.join('\n')}`);
  } else {
    sections.push('Near-matches in live DOM for failing selector: (none — failing tokens not found)');
  }

  const toggleSelector = '[role="tab"], [aria-selected], [aria-pressed], [aria-expanded], select, [data-testid*="tab"]';
  const toggleSeen = new Set<string>();
  const toggles: string[] = [];
  for (const el of Array.from(document.querySelectorAll(toggleSelector))) {
    if (isNavPollution(el)) {
      continue;
    }
    const line = describeElement(el);
    if (!line || toggleSeen.has(line)) {
      continue;
    }
    toggleSeen.add(line);
    toggles.push(line);
    if (toggles.length >= 12) {
      break;
    }
  }
  if (toggles.length > 0) {
    sections.push(
      `Visible tabs / toggles (activate one of these via "prepend-step" if it could reveal the missing target):\n${toggles.join('\n')}`
    );
  }

  const tokens = tokensFromSelector(failingReftarget);
  const interactiveSelector = 'button, [role="button"], a[href], input:not([type="hidden"]), [data-testid]';
  const seenSig = new Set<string>();
  const ranked: Array<{ score: number; line: string }> = [];
  for (const el of Array.from(document.querySelectorAll(interactiveSelector))) {
    if (isNavPollution(el)) {
      continue;
    }
    if (!el.hasAttribute('data-testid') && !el.hasAttribute('aria-label') && !el.hasAttribute('id')) {
      continue;
    }
    const line = describeElement(el);
    if (!line || seenSig.has(line)) {
      continue;
    }
    seenSig.add(line);
    ranked.push({ score: scoreCandidate(el, tokens), line });
  }
  ranked.sort((a, b) => b.score - a.score);
  const described = ranked.slice(0, 35).map((r) => r.line);
  if (described.length > 0) {
    sections.push(`Interactive candidates (text + attributes, ranked by relevance):\n${described.join('\n')}`);
  }

  const headings = Array.from(document.querySelectorAll('h1,h2,h3'))
    .map((el) => (el.textContent ?? '').trim())
    .filter(Boolean)
    .slice(0, 8);
  if (headings.length > 0) {
    sections.push(`Headings: ${headings.join(' | ')}`);
  }

  return sections.join('\n\n');
}

function AiFixOrchestrator({ activeTab, onPatchApplied }: AiFixOrchestratorProps): null {
  const contentKey = activeTab?.id ?? 'pathfinder-ai-fix-orchestrator';
  const { generate, patch, error, reset, isAssistantAvailable } = useAiFixGeneration(contentKey);

  // The active request we're servicing. Cleared when patch lands or errors.
  const pendingRequestRef = useRef<AiFixRequestDetail | null>(null);
  // Keep the latest tab in a ref so the request handler can read it without
  // re-binding the listener on every render (which would drop in-flight
  // requests). Sync the ref in an effect — never during render.
  const activeTabRef = useRef<LearningJourneyTab | null>(activeTab);
  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  // Listen for AI fix requests.
  useEffect(() => {
    const handler = async (e: Event) => {
      const detail = (e as CustomEvent<AiFixRequestDetail>).detail;
      const tab = activeTabRef.current;
      if (!tab?.content?.content) {
        return;
      }
      if (!isAssistantAvailable) {
        reportAppInteraction(UserInteraction.AiFixFailed, { reason: 'assistant_unavailable' });
        return;
      }
      if (pendingRequestRef.current) {
        return;
      }
      pendingRequestRef.current = detail;
      reportAppInteraction(UserInteraction.AiFixOffered, {
        step_id: detail.stepId ?? '',
        rendered_step_id: detail.renderedStepId ?? '',
      });

      GlobalInteractionBlocker.getInstance().startAdHocBlocking('Asking Grafana Assistant for a fix…');

      // The renderer's `parseJsonGuide` synthesized runtime ids on its
      // in-memory tree, so dispatched event ids already reference the
      // augmented form. Re-run synthesis on the raw `tab.content.content`
      // string so the assistant + apply path see the same ids.
      const augmentedJson = synthesizeStepIdsInJson(tab.content.content);
      const domHint = collectDomContext(detail.refTarget ?? '');

      // NOTE: screenshot capture is intentionally disabled in v1. Embedding
      // a base64 image in the prompt was causing the assistant streaming
      // call to fail ("No final output received from streaming response") —
      // the SDK doesn't read markdown data-URLs as images anyway. The
      // structured context (guide JSON + DOM hint + URL via
      // useProvidePageContext) is enough signal for the model.
      await generate({
        guideJson: augmentedJson,
        failingStepId: detail.stepId ?? '',
        failingReftarget: detail.refTarget ?? '',
        failingAction: detail.action ?? '',
        domHint,
        containerInfo: detail.containerInfo,
      });
    };

    window.addEventListener('pathfinder-ai-fix-request', handler);
    return () => window.removeEventListener('pathfinder-ai-fix-request', handler);
  }, [generate, isAssistantAvailable]);

  // Apply a successfully-validated patch.
  useEffect(() => {
    if (!patch) {
      return;
    }
    const tab = activeTabRef.current;
    const request = pendingRequestRef.current;
    if (!tab?.content?.content || !request) {
      pendingRequestRef.current = null;
      GlobalInteractionBlocker.getInstance().stopAdHocBlocking();
      reset();
      return;
    }

    // Confidence gate: only apply patches whose proposed selector
    // resolves on the current page AND (for selector swaps) shares
    // meaningful tokens with the original. Hallucinated swaps to
    // unrelated elements (e.g. Bar chart → Bar gauge) get rejected
    // here before they can be written into the guide.
    const confidence = evaluatePatchConfidence(patch, request.refTarget ?? '');
    if (!confidence.ok) {
      reportAppInteraction(UserInteraction.AiFixFailed, {
        step_id: request.stepId ?? '',
        reason: `low-confidence: ${confidence.reason}`,
      });
      publishToast('warning', "AI couldn't find a confident fix", confidence.reason);
      pendingRequestRef.current = null;
      GlobalInteractionBlocker.getInstance().stopAdHocBlocking();
      reset();
      return;
    }

    // Apply against the synthesized form so the patch's ids resolve.
    const result = applyPatchToGuide(synthesizeStepIdsInJson(tab.content.content), patch);
    if (result.ok) {
      onPatchApplied(tab.id, result.newGuideJson);
      reportAppInteraction(UserInteraction.AiFixApplied, {
        step_id: request.stepId ?? '',
        patch_type: patch.type,
      });
      publishToast(
        'success',
        'AI updated this step',
        patch.rationale ? patch.rationale : 'A new selector was applied; the requirement will re-check now.'
      );
    } else {
      reportAppInteraction(UserInteraction.AiFixFailed, {
        step_id: request.stepId ?? '',
        reason: result.error,
      });
      publishToast('warning', "AI couldn't update this step", result.error);
    }

    pendingRequestRef.current = null;
    GlobalInteractionBlocker.getInstance().stopAdHocBlocking();
    reset();
  }, [patch, onPatchApplied, reset]);

  // Handle assistant / parse errors.
  useEffect(() => {
    if (!error) {
      return;
    }
    const request = pendingRequestRef.current;
    reportAppInteraction(UserInteraction.AiFixFailed, {
      step_id: request?.stepId ?? '',
      reason: error.message.slice(0, 200),
    });
    publishToast('warning', "AI couldn't fix this step", error.message.slice(0, 200));
    pendingRequestRef.current = null;
    GlobalInteractionBlocker.getInstance().stopAdHocBlocking();
    reset();
  }, [error, reset]);

  return null;
}

// Default export for `React.lazy` consumption from docs-panel. The lazy
// import is what keeps `@grafana/assistant` out of the docs-panel module
// init chain — important for jest, where the assistant package's runtime
// initialization throws "Class extends value undefined".
export default AiFixOrchestrator;
