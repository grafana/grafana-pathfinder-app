/**
 * Guide generation utilities
 *
 * Builders and helpers for "Generate guide with AI" — the flow that asks the
 * Grafana Assistant to produce a JSON guide from a natural-language prompt.
 *
 * The system prompt intentionally encodes our JSON guide schema and selector
 * best practices as plain text so the model does not need to infer structure.
 * If the schema evolves, update GUIDE_SCHEMA_SUMMARY alongside the type/schema
 * files (see .cursor/rules/schema-coupling.mdc).
 */

export const SELECTOR_PLACEHOLDER = 'REPLACE_WITH_SELECTOR';

/**
 * Condensed summary of the JsonGuide schema.
 * Kept as a single string so the prompt stays deterministic and easy to tune.
 * A unit test asserts that all required top-level JsonGuide fields are mentioned.
 */
export const GUIDE_SCHEMA_SUMMARY = `JSON guide shape (top-level):
{
  "schemaVersion": "1.1.0",
  "id": "kebab-case-id",
  "title": "Human readable title",
  "blocks": [ /* array of block objects */ ]
}

Block types (use the exact "type" discriminant):
- markdown: { type: "markdown", content: "# markdown text" }
- html: { type: "html", content: "<p>raw html</p>" } (prefer markdown)
- section: { type: "section", title?, blocks: [...], requirements?, objectives? }
- conditional: { type: "conditional", conditions: ["has-datasource:prometheus"], whenTrue: [...], whenFalse: [...], reftarget? }
- interactive: { type: "interactive", action, reftarget?, targetvalue?, content, tooltip?, requirements?, skippable?, showMe?, doIt? }
- multistep: { type: "multistep", content, steps: JsonStep[], requirements?, skippable? }
- guided: { type: "guided", content, steps: JsonStep[], stepTimeout?, requirements?, skippable? }
- image: { type: "image", src, alt?, width?, height? }
- video: { type: "video", src, provider?: "youtube"|"native", title?, start?, end? }
- quiz: { type: "quiz", question, choices: [{id, text, correct?, hint?}], multiSelect?, completionMode? }
- input: { type: "input", prompt, inputType: "text"|"boolean"|"datasource", variableName, placeholder?, required? }
- terminal: { type: "terminal", command, content, requirements?, skippable? }
- terminal-connect: { type: "terminal-connect", content, buttonText?, vmTemplate? }
- code-block: { type: "code-block", reftarget, code, language?, content? }

Interactive action enum: "highlight" | "button" | "formfill" | "navigate" | "hover" | "noop"
- highlight: draws a pulse around an element; needs reftarget
- button: clicks a button; reftarget can be a selector OR the visible button text
- formfill: types targetvalue into an input; needs reftarget + targetvalue
- navigate: reftarget is a Grafana URL path like "/explore" or "/d/abc"
- hover: hovers an element; needs reftarget
- noop: no action; useful for placeholder steps without a known selector

JsonStep shape (used inside multistep/guided):
{ action, reftarget?, targetvalue?, requirements?, tooltip?, description?, skippable? }

Requirement strings are machine-evaluated condition types, NOT human sentences.
The same syntax applies to both "requirements" and "objectives".

Fixed conditions (no argument):
- "exists-reftarget"       // the block's reftarget resolves in the DOM
- "navmenu-open"           // the Grafana nav menu is open
- "has-datasources"        // at least one datasource is configured
- "is-admin" | "is-editor" | "is-logged-in"
- "dashboard-exists"
- "form-valid"
- "is-terminal-active"

Parameterized conditions (prefix + argument):
- "has-datasource:prometheus"         // PREFERRED: has a datasource of this type (cheap)
- "datasource-configured:prometheus"  // AVOID unless the guide truly needs a live
                                      //   connection test. This POSTs /test to every
                                      //   matching datasource on every re-check and
                                      //   can spam the Grafana API.
- "has-plugin:grafana-pyroscope-app"  // plugin id installed
- "plugin-enabled:grafana-pyroscope-app"
- "has-permission:datasources:create"
- "has-role:admin" | "has-role:editor" | "has-role:viewer"
- "on-page:/explore"                  // user is on this URL path
- "has-feature:publicDashboards"      // feature toggle is enabled
- "has-dashboard-named:My Dashboard"
- "in-environment:cloud" | "in-environment:oss"
- "min-version:11.0.0"
- "section-completed:<section-id>"
- "var-<variableName>:<value>"        // guide input variable equals value
- "renderer:pathfinder" | "renderer:website"

Never put free-form English (e.g. "Open the Explore page") in "requirements" or
"objectives". If you are not sure which condition applies, OMIT the field
entirely rather than guessing.`;

/**
 * Selector best practices, inlined into the system prompt so the model picks
 * stable selectors rather than brittle nth-based ones.
 */
export const SELECTOR_BEST_PRACTICES = `Selector priority for reftarget (highest to lowest stability):
1. data-testid attributes: button[data-testid='data-source-save']
2. Semantic attributes: role, aria-label, name, href, placeholder, title
3. Role with visible text: button:contains('Save') or a:contains('Explore')
4. Stable id (NOT auto-generated, NOT containing hashes/uuids)
5. Compound with a stable ancestor: [data-testid='header'] button[aria-label='Close']
6. Plain text matching for buttons (string equal to visible label)
Avoid: auto-generated class names (css-xyz, css-1abc), nth-child, nth-of-type,
deeply nested structural selectors, and attribute values containing hashes.`;

export interface BuildGuideSystemPromptOptions {
  /** Optional previous validation errors to steer a retry. */
  previousErrors?: string[];
}

/**
 * Build the system prompt used when asking the assistant to generate a guide.
 */
export function buildGuideSystemPrompt(options: BuildGuideSystemPromptOptions = {}): string {
  const { previousErrors } = options;

  const retrySection =
    previousErrors && previousErrors.length > 0
      ? `\n\nThe previous attempt failed validation with these errors. Fix them in the next response:\n${previousErrors
          .slice(0, 10)
          .map((e, i) => `${i + 1}. ${e}`)
          .join('\n')}`
      : '';

  return `You are an expert author of Grafana Pathfinder interactive guides.
Your job is to produce a single JSON object matching the JSON guide schema
described below, using the user's request as the narrative outline.

${GUIDE_SCHEMA_SUMMARY}

${SELECTOR_BEST_PRACTICES}

Authoring rules:
- Start with a short markdown block that introduces the guide.
- Break the guide into sections when helpful; each section should have a title.
- Prefer "interactive" blocks for individual actions. Reach for "multistep" only
  when several actions chain into a single demonstration, and "guided" when the
  user should perform the actions themselves.
- Always provide a "content" string for interactive / multistep / guided blocks.
- If you do not know the exact selector for an interactive step, use the string
  "${SELECTOR_PLACEHOLDER}" for reftarget and set action to "noop". This keeps
  the guide valid and signals to the author that the selector needs to be picked.
- Use sentence case for all titles, button labels, and tooltips.
- Do not invent data source names, URLs, or metric names unless the user
  supplied them.
- "id" should be a short kebab-case slug derived from the title.
- NEVER put free-form English in "requirements" or "objectives". Only use the
  condition types listed above. If unsure, OMIT the field entirely.
- Put shared prerequisites ONCE on the enclosing "section" block (or the
  top-level "multistep" / "guided" block) rather than repeating them on every
  step. Duplicate requirements are re-evaluated on every render and can cause
  unnecessary API calls.
- Prefer "has-datasource:<type>" over "datasource-configured:<type>". The
  configured variant hits the datasource /test endpoint and should only be
  used sparingly (at most once per guide, typically on the first relevant
  section).

Choosing the right interactive pattern:
- Single click on a visible button: { type: "interactive", action: "button", reftarget: "button text" | selector }.
- Open a dropdown / combobox and pick an item: use { type: "multistep" } with two steps.
  First step is a "button" (or "hover" if the trigger only reveals on hover) on the
  dropdown trigger. Second step targets the menu item; scope its reftarget with
  [role='listbox'] or [role='menu'] because dropdowns often render in a portal
  outside the trigger, e.g. "[role='listbox'] div:contains('Prometheus')".
- Open a modal and fill a field: a "multistep" with "button" (opens modal) -> "formfill"
  (scoped with [role='dialog'] or [aria-modal='true']) -> "button" (save / confirm).
- Radio or toggle groups (Builder/Code style): prefer a "button" action with a reftarget
  that uses the visible label ("label:contains('Builder')") or the input's value attribute
  ("input[value='builder']") rather than targeting the hidden <input> directly.
- Tooltips or menus that only appear on hover: emit a "hover" action first, then a
  "button" action for the click. Keep the tooltip's reftarget scoped under [role='tooltip'].
- User-led walkthroughs where the user performs each action: use { type: "guided" } so
  the user drives and the guide verifies each step.
- Automated demos where the user just watches: use { type: "multistep" }.
- Queries, URLs, or configuration values that should adapt to the user's environment:
  place them inside a markdown block wrapped in
  <assistant data-assistant-id="..." data-assistant-type="query|code|config|text"> ... </assistant>
  so the user can customise them via Grafana Assistant.
- When unsure whether the target is inside a modal, dropdown, or popover, prefix the
  reftarget with [role='dialog'], [role='menu'], [role='listbox'], or [role='tooltip']
  so the selector only matches the visible popover.
- Prefer short visible label text wrapped with :contains(...) over dynamic ids / classes
  when the label is short and unique on the page.

Output format:
- Respond with the JSON object ONLY.
- No markdown, no code fences, no commentary before or after.
- The response must be valid JSON parseable by JSON.parse.${retrySection}`;
}

/**
 * Extract a single JSON object from an assistant response. Handles code fences,
 * leading prose, and trailing whitespace. Returns null if nothing JSON-shaped
 * is found.
 */
export function extractJsonFromResponse(raw: string): string | null {
  if (!raw) {
    return null;
  }

  let text = raw.trim();

  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch && fenceMatch[1]) {
    text = fenceMatch[1].trim();
  }

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    return null;
  }

  return text.slice(firstBrace, lastBrace + 1);
}
