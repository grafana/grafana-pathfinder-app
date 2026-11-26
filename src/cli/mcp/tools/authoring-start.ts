/**
 * Contract: mcp-native
 *
 * `pathfinder_authoring_start` — first tool a client should call.
 *
 * Returns a compact context block telling the model what Pathfinder is, what
 * the authoring contract looks like, and which other tools to call to make
 * progress. Sourced from a single typed module here so updates land in one
 * place rather than being copy-pasted into every client's skill file.
 *
 * Session-token mode is taught as the primary workflow: the first
 * mutation mints a sessionToken, mutation responses are acks (not full
 * artifacts), reads are explicit and on-demand, and the full artifact
 * returns only at finalize. Stateless `{artifact}` mode is mentioned once
 * as a fallback for OSS / airgap or multi-instance deployments.
 *
 * `interfaceContract` is the canonical statement of the two directions, and
 * the reason tool descriptions do not restate them:
 *
 * - **Inbound (`parameters`) is ours.** `pathfinder_help` projects Commander's
 *   option surface into the JSON keys a tool accepts. It exists for the
 *   agent's convenience and is the only thing here we author.
 * - **Outbound (`responses`) is the CLI's.** `CommandOutcome` reaches the
 *   agent verbatim, minus argv-shaped hints. When a response reads like
 *   terminal output, that is why — see `tools/result.ts`.
 *
 * Anything agent-facing that is a fact about a command belongs in that
 * command's Commander description, not here, so CLI users get it too.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { CURRENT_SCHEMA_VERSION } from '../../../types/json-guide.schema';
import { BLOCK_TYPES, CONTAINER_BLOCK_TYPES } from '../../utils/block-registry';
import { renderMachineJson } from '../../utils/output';
import { PATHFINDER_DOMAINS, PATHFINDER_NOT_FOR, PATHFINDER_TRIGGER_PHRASES } from '../lib/agent-routing';
import { readOnly } from './annotations';
import { textResult } from './result';

// Derived from the CLI registry so this guidance can't drift from the rule
// pathfinder_manage_block enforces.
const CONTAINER_TYPES_TEXT = BLOCK_TYPES.filter((type) => CONTAINER_BLOCK_TYPES.has(type)).join(', ');

const AUTHORING_CONTEXT = {
  version: CURRENT_SCHEMA_VERSION,
  product:
    'Grafana Pathfinder is a Grafana plugin that runs interactive, contextual guides as a sidebar in Grafana. A guide is a tree of "blocks" — markdown, interactive UI actions, sections, conditionals, multistep, quizzes, and challenges — stored as JSON.',
  workflow: [
    '1. Use the writer the user or conversation names (ask if unclear; defaults to pathfinder-mcp). Call pathfinder_create_package with `title` and `authorName` (`authorTeam` if known). Use its sessionToken; ignore the seed artifact.',
    '2. Decide what kind of guide is being built per `guideShape.decideFirst`.',
    '3. Plan with pathfinder_find_steps: send the independent sub-tasks in one call (up to 8 queries), each Grafana-specific sub-task its own 2-5 word procedure-level query ("create alert rule"), naming third-party products by the Grafana process ("configure contact point"). Gaps and weak matches: see `interactiveRules`.',
    '4. Build with pathfinder_manage_block per `guideShape` and `interactiveRules`: "add-block" | "edit-block" | "remove-block" | "add-step" | "add-choice" | "add-hint". One block per call, addressed by id. Adds append under the parent, so author in display order. Steps, choices and hints are not editable or removable alone: cascade-remove the parent and rebuild.',
    '5. Navigate with the `summary` tree on each ack; read deeper with pathfinder_read_session ("list-blocks" | "get-block" | "get-manifest", {sessionToken}).',
    '6. Last, set guide metadata with pathfinder_manage_guide "set-manifest".',
    '7. Rarely, pathfinder_inspect {sessionToken, opts:{}} pulls the full artifact.',
    '8. Call pathfinder_validate with {sessionToken} before finalize.',
    '9. Call pathfinder_finalize_for_app_platform with {sessionToken}: it returns the artifact and publish handoff, and spends the session.',
  ],
  // Distilled from grafana/interactive-tutorials `.cursor/authoring-guide.mdc`.
  // Curate ruthlessly — every connected client pays this length on every
  // `_start` call. If this list grows past ~20 rules, ship a separate
  // best-practices tool instead of expanding here.
  interactiveRules: [
    'Prefer separate sibling blocks over a `multistep` block. Use `multistep` only when the steps must run in order AND are tightly coupled.',
    'Never write a step with `action: noop` as filler. If there is nothing concrete for the user to do, write a `markdown` block describing what they would do instead.',
    "Never invent a `reftarget`: use only selectors from `pathfinder_find_steps` results or the user. For a known step without one, use `[data-testid=\"TODO-<target>\"]`, start the enclosing block's `content` with `**⚠️ TODO: add the selector for <target>**` (for `multistep`/`guided`, the parent block's), and list each placeholder by section and step at hand-off. A result's selectors exist only on the pages its own steps reach: start from its first navigation step or `navigate` to its `startsOn`, keep each step on the page the procedure has reached there with an `on-page:` requirement for it, adapt names and values but never move a step to another page, and chain sub-tasks by passing `endsOn` as `pageUrl`.",
    "When a result lacks a step you searched for, check its `nextProcedure`/`previousProcedure` and fetch the one that covers it with `procedureId` before using a placeholder. If a group is weak or about another product, search once more in Grafana's UI words; then use placeholders for steps you know, or ask the user about a procedure you do not. Wire in every verified step; keep gaps as placeholders, never plain text for a whole procedure.",
    'If a `multistep` would end up with only one step, replace it with an `interactive` block. Single-step multisteps add overhead with no benefit.',
    "Anchor the user on the first interactive step: add `on-page:/path` to its `requirements`, or use a `navigate` action — the guide can't assume it starts on the right page.",
    "Add contextual `requirements` to every interactive step that touches the DOM. At minimum `on-page:/path`; also `navmenu-open` for nav clicks and `is-admin` (or a role) for admin-only features. Search results omit `on-page:<page>` and `exists-reftarget` from a step's `requirements`, so add them from each step's page (a step without `page` is on the previous step's page; a `navigate` step's `page` is where it goes, so it takes the previous step's page or none).",
    "Use `verify` on actions that change state (save, create, navigate) so the next step can't run against a half-completed action.",
    'Prefer a `grafana:` selector path, then a `data-testid`, over any text-based target: visible text, `aria-label`, `placeholder` and `title` are translated, so a guide anchored to them breaks for users in other locales (the engine flags these `i18n-sensitive`). A `button` step is fine when its label comes from a verified result.',
    'If the target lives in a virtualized list, paginated table, or dashboard row below the fold, use a `guided` block with `lazyRender: true` on the step — a plain `interactive` will fail because `exists-reftarget` waits but cannot scroll.',
    "To type code into a Grafana query or code editor for the reader, use a `code-block`. Its `reftarget` is that editor's selector and follows the `reftarget` rule above. Code the reader only reads or copies is a fenced code block in `markdown` (see `guideShape.formatting`), never a `code-block`.",
  ],
  rules: [
    'Before validating, check the guide against the request: everything the user asked to demonstrate or teach is covered, and nothing extra was copied in.',
    `Block ids: pass an explicit \`id\` whenever \`type\` is a container (${CONTAINER_TYPES_TEXT}) — they are rejected without one. Every other type auto-ids as <type>-<n> when you omit it.`,
    'Append-only: pathfinder_manage_block operation "add-block" always appends to the end of the parent. Author in display order. To reorder, remove-block and add-block in the desired order (there is no move/insert-index on this tool). Removing a populated container requires `cascade: true` and deletes its entire subtree with no undo — read the children first (pathfinder_read_session operation "get-block") if you plan to rebuild them.',
    'Tool scope: pathfinder_manage_block changes one block at a time inside the tree. pathfinder_manage_guide changes the guide as a whole (the manifest). Guide-level fields never go through pathfinder_manage_block, and block fields never go through pathfinder_manage_guide.',
  ],
  // Modeled on the published standalone guides in grafana/interactive-tutorials
  // (git-sync-guide, knowledge-graph-guide, alerting-101).
  guideShape: {
    decideFirst:
      "Before writing blocks, decide what the guide is for — reference, teach, or walkthrough (`guideShape.kinds`). Infer it from the request and each kind's latches; a guide can mix kinds topic by topic. When latches conflict, pick the strongest match.",
    skeleton: [
      'Title: a short title naming the purpose ("Price a Grafana Cloud deal", not "Guide to understanding pricing"). App Platform guides do not render it as a header, so blocks[0] — a top-level `markdown` block, outside any section — opens with a `#` heading: a very brief description of the guide ("Setting up Grafana", "Connecting Prometheus to Grafana", "Objection handling for Datadog"). Word it differently from the title: a heading that starts with the same words as the title fails validation.',
      'Preamble: the rest of that same blocks[0], under the heading — 1-4 sentences on what the guide covers, who it is for, and what the reader will know or have done by the end. Add a short "Before you begin" list only when there are real prerequisites.',
      'Body: the content of the guide. This is where you build the guide based off the kind chosen in `guideShape.decideFirst`. You will use blocks to describe, explain, and guide the reader through the topic, adhering to the formatting rules in `guideShape.formatting`.',
      'Close: a top-level `markdown` block at the end of the guide summarizing what the reader now knows or has done, with next steps, links, or sources where useful.',
    ],
    formatting: [
      'Style content with `markdown`, `section`, `callout`, and `divider` blocks and, inside `markdown`, break up long prose with `##`/`###` headings, lists, tables, block quotes, and **bold** lead-ins. Never write `html` blocks or HTML with CSS classes to style content.',
      'Keep sentences punchy and direct — "Click **Save**" beats "The save button can be clicked."',
      'Cover the topic as deeply as the request asks. A request for detail on a large concept gets a long guide: more `##` topics, each fully explained, not a summary. Length comes from more topics, never from longer paragraphs.',
      'Pick the format the content already has: three or more parallel items (years, tiers, options) → a table; a statement meant to be quoted → a block quote; something the reader must not miss → a `callout`; a change of topic → a `divider`; code the reader reads or copies → a fenced code block inside `markdown`, with a language tag; a recap → a bulleted list.',
      'Keep it restrained: no more than about three plain paragraphs in a row, at most one callout per `##` topic, and at most one italic summary line under a heading.',
      'Never put two visual blocks (callouts, dividers, images, videos) back to back. Where two would touch, write a short `markdown` paragraph between them that moves the guide forward: link the two, sum up what the first one showed, or add the point the reader needs before the next. If nothing worth saying fits, merge or drop one of them rather than writing filler.',
      'Use a `section` only for a set of actionable items the reader completes — it gets a "Mark section as complete" button and completion tracking, which is what it is for. A section needs at least two steps directly inside it besides its lead-in; a single action is a top-level block, not a section. The section numbers its children itself, so a step is never a list: no list markers, and no numbered or bulleted list inside the `markdown` block of a step. Explanations, definitions, and comparisons are top-level `markdown` under `##` headings, never a section. Never number section titles ("Create the dashboard", not "1. Create the dashboard" or "Step 1: Create the dashboard").',
      'Sections cannot contain other sections, directly or through a `conditional` or `assistant` block inside a section. Keep sections as siblings; a `conditional` inside a section is fine.',
      'Tables should show a single concept per column. Do not create multiple columns for the same concept.',
    ],
    kinds: {
      reference:
        'Latches: "how does", "what is", "overview". Comprehensive information the reader reads and reuses (process, definitions, documentation). No interactive blocks. A procedure in it (a process, a prep checklist) is a section whose steps are each their own `markdown` block of plain sentences; a markdown-only section shows a "Mark section as complete" button, which is its completion path.',
      teach:
        'Latches: "teach me about", "learn", "basics of", "intro to", "getting started with", "how do I" about general Grafana ("build a dashboard"). Reusable material the reader should retain. It explains, with hands-on interactive steps per `interactiveRules` where verified steps exist, then end each `##` topic (or the guide, with a closing "Check your knowledge" topic) with a `quiz` that tests only facts the guide itself states.',
      walkthrough:
        'Latches: "how to" for one specific task that cannot be applied in generic fashion, "our", a named tool or resource ("integrate with IdP X"). An ordered procedure done start to finish. Steps in the Grafana UI are interactive blocks per `interactiveRules`; steps in other tools are numbered markdown. Use the `reftarget` placeholder for any target without a verified selector rather than dropping the step.',
    },
  },
  sessionMode: {
    summary:
      'Primary contract. Mint a sessionToken on first mutation, echo it back on every subsequent call. Mutation responses are acks (no artifact body). Reads are explicit. Finalize returns the artifact and deletes the session.',
    ackShape: {
      status: 'ok | error',
      sessionToken: 'string — echo verbatim on the next call',
      generation:
        'number — monotonic; optional `expectedGeneration` on the next call surfaces a CONCURRENT_MODIFICATION error if the session moved underneath you',
      summary: 'compact tree of {path, id, type, hint?, children?} for navigation',
      outcome: 'CommandOutcome shape (status + any code/message/data on error)',
    },
    rules: [
      'Echo `sessionToken` on every subsequent call. Do NOT echo back the artifact body — it is not in the ack and the server already has it.',
      'Use `summary` for navigation. Do not call pathfinder_inspect after every mutation; the summary already tells you what changed.',
      '`expectedGeneration` is optional. Omit it for the common single-agent case (the server retries once on 412 internally). Pass it only if you specifically want to fail-fast on a concurrent edit.',
      'A failed mutation does NOT bump the generation — the session state is unchanged. Re-read with the same generation if you need to recover.',
      'On SESSION_NOT_FOUND (expired or finalized session), start over: call pathfinder_create_package for a fresh token.',
    ],
  },
  statelessModeFallback: {
    appliesWhen:
      'You are running against an MCP server where server-side sessions are unavailable or not durable — stdio transport, OSS / self-hosted deployments, or any host not pinned to a single instance. Every mutation tool also accepts `{artifact}` in place of `{sessionToken}` and returns the full artifact for you to thread to the next call.',
    rules: [
      'Pass {content, manifest} in. Use the {content, manifest} returned in the response for the next call.',
      'Never mix modes — pass EITHER `artifact` OR `sessionToken`, never both. Mixing returns INPUT_MODE_AMBIGUOUS.',
    ],
  },
  interfaceContract: {
    parameters: [
      "JSON in, always. pathfinder_help({ command }) returns the parameter interface for that tool's `opts`. It is the command's own schema rendered as JSON.",
      'Parameter names are camelCase (e.g., `ifAbsent`, `showMe`, `includeVersion`). Values are JSON: booleans are `true`/`false`, repeatables are arrays (one marked `acceptsSingle` also takes a single string), enums are strings.',
      'Positional CLI arguments are republished as ordinary named parameters, so positional order never matters to you.',
      'When help returns `subcommands`, pass your chosen value in `opts` and call help again with that value as `subcommand` to get the full per-subcommand surface.',
      'Parameters a tool owns itself, or cannot honor, are withheld from help and rejected as UNSUPPORTED_PARAMETER. The `exposed` list on that error is authoritative — read it rather than guessing.',
    ],
    responses: [
      "CLI spec out, always. Every tool returns the CLI runner's structured outcome verbatim: `status`, plus `code` and `message` on error, plus `summary` / `details` / `warnings` / `data` on success.",
      'The CLI runners are the sole validator. A `SCHEMA_VALIDATION` error lists every issue at once — fix all of them before retrying.',
      '`warnings` are advisory and non-blocking (composition nudges, unverified selectors, normalized input). They do not fail the call, but they are the CLI telling you the guide will be worse if you ignore them.',
      '`data` is the stable machine payload and `details` is display text — read ids and paths from `data`.',
      'Mutation acks add a `summary` tree ({path, id, type, hint?, children?}). Navigate and address blocks from it instead of re-reading the artifact.',
      'Error messages may reference CLI flag names like `--parent` or `--show-me` for human readers. Map these to camelCase parameter names (`parent`, `showMe`) when reading the message. Ignore any suggestion to run a command — you call tools, not a shell. When a message mentions a withheld parameter, the `exposed` list from UNSUPPORTED_PARAMETER is authoritative.',
    ],
  },
  discovery: [
    "pathfinder_help — the parameter interface for any CLI-backed tool's `opts`; read it per `interfaceContract.parameters`. For pathfinder_manage_block and pathfinder_manage_guide, pass `command` equal to that call's `operation`. Remember the addressing parameters help returns (`parent` for add-step / add-choice / add-hint).",
    'pathfinder_read_session — MCP-native explicit schema. Given a sessionToken and operation list-blocks | get-block | get-manifest (plus blockId for get-block), returns a cheap facet of the session artifact. Use freely.',
    'pathfinder_inspect — escape hatch. Given a sessionToken (or artifact) plus help-derived `opts`, returns the full artifact plus a tree summary.',
    'pathfinder_read_repository — MCP-native explicit schema. Given operation list-packages | get-package | get-manifest plus its documented top-level filters/id, discovers or inspects published CDN packages. Sibling of pathfinder_read_session for published (not session) content.',
    'pathfinder_find_guides — CLI-routed search of the public guide catalog; pass `opts` per pathfinder_help({ command: "find-guides" }). Use it to check whether a guide already exists before authoring a new one, or to answer "is there a guide for this?".',
    'pathfinder_find_steps — CLI-routed search of verified procedures from guides that pass live e2e tests; pass `opts` per pathfinder_help({ command: "find-steps" }). Use it for every Grafana-specific sub-task to find its verified steps and selectors.',
  ],
  // Routing reaffirmation surface. The same constants seed the server-level
  // `instructions` string in `lib/server-instructions.ts`, so an agent that
  // reached this tool via the initialize hint sees consistent vocabulary,
  // and clients that don't render `initialize.instructions` still get the
  // routing signal here.
  triggers: [...PATHFINDER_TRIGGER_PHRASES],
  notFor: [...PATHFINDER_NOT_FOR],
  domains: [...PATHFINDER_DOMAINS],
};

export function registerAuthoringStart(server: McpServer): void {
  // Static orchestration context, not a CLI command.
  server.registerTool(
    'pathfinder_authoring_start',
    {
      description:
        'Use this tool when the user wants to author, create, edit, or publish a Grafana Pathfinder interactive guide, tutorial, or walkthrough. Call this first — once per authoring session before any other Pathfinder tool. Returns Pathfinder authoring context, workflow, guide-shape and interactive rules, and discovery hints.',
      annotations: readOnly('Start Pathfinder authoring'),
      inputSchema: {},
    },
    async () => textResult(renderMachineJson(AUTHORING_CONTEXT))
  );
}
