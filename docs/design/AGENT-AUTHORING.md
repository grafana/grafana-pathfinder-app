# Agent authoring CLI

> Part of the [Pathfinder package design](./PATHFINDER-PACKAGE-DESIGN.md).
> See also: [Pathfinder AI authoring](./PATHFINDER-AI-AUTHORING.md) · [CLI extensions](./package/cli-extensions.md) · [CLI tools reference](../developer/CLI_TOOLS.md)

---

## Table of contents

- [Motivation](#motivation)
- [Design principles](#design-principles)
- [Command surface](#command-surface)
  - [create](#create)
  - [add-block](#add-block)
  - [add-step](#add-step)
  - [add-choice](#add-choice)
  - [set-manifest](#set-manifest)
  - [inspect](#inspect)
  - [edit-block](#edit-block)
  - [remove-block](#remove-block)
- [Addressing model](#addressing-model)
  - [Auto-assignment of IDs](#auto-assignment-of-ids)
  - [Idempotent retries with `--if-absent`](#idempotent-retries-with---if-absent)
- [Schema-driven option generation](#schema-driven-option-generation)
  - [The bridge module](#the-bridge-module)
  - [Field descriptions via `.describe()`](#field-descriptions-via-describe)
  - [Block schema registry](#block-schema-registry)
- [Validate-on-write](#validate-on-write)
- [Agent-oriented output](#agent-oriented-output)
  - [Success output](#success-output)
  - [Quiet mode (`--quiet`)](#quiet-mode---quiet)
  - [Structured output (`--format json`)](#structured-output---format-json)
  - [Error output](#error-output)
  - [Help output](#help-output)
- [Version coupling](#version-coupling)
- [Schema coupling guarantees](#schema-coupling-guarantees)
- [Architectural layering](#architectural-layering)
- [Distribution](#distribution)
- [Agent usage example](#agent-usage-example)
- [Agent context injection](#agent-context-injection)
- [Implementation plan](#implementation-plan)
- [Future considerations](#future-considerations)

---

## Motivation

AI agents authoring Pathfinder guides face a fundamental context window problem. When given the full JSON schema, block type catalog, requirement vocabulary, and authoring guidelines as markdown context, agents frequently disregard large portions of it because it exceeds what they can reliably attend to. The result is structurally invalid guides that fail validation.

The current workflow — inject schema context, let the agent write raw JSON, then validate afterward — has three problems:

### Context overload

The complete authoring specification spans thousands of tokens across schema definitions, block type documentation, requirement enums, and style guidelines. Agents cannot reliably hold all of this in working memory while also reasoning about guide content.

### Late failure

Validation happens after the agent has already committed to a structural approach. When validation fails, the agent must re-read error messages, correlate them back to the schema, and restructure — often making new errors in the process.

### No progressive discovery

An agent must understand the entire schema upfront to write any part of a guide. There is no way to learn incrementally — for example, discovering what fields an `interactive` block accepts only when you need to create one.

### The CLI as authoring interface

Instead of asking agents to understand the schema and produce raw JSON, we give them a CLI that **embodies** the schema. Each command accepts only valid options for the block type being created. Help text provides field-level documentation on demand. Validation runs on every write. The agent needs only ~15 lines of context to begin authoring — everything else is discoverable via `--help`.

---

## Design principles

1. **Schema-driven.** CLI flags are generated at runtime by introspecting Zod schemas. When a field is added to a schema, it automatically appears as a CLI flag. No manual Commander.js code is needed for new fields.

2. **Impossible to produce invalid output.** Every mutation validates the full package (both `content.json` and `manifest.json`) before writing. If validation fails, the file is not modified and the error is printed.

3. **Append-first.** New blocks are appended sequentially. There is no insert-at-index and no reordering. The agent writes blocks in the order they should appear. Existing blocks can be updated in place via `edit-block` or removed via `remove-block` using their ID.

4. **ID-based addressing.** All blocks have an `id`. Container blocks (sections, conditionals, assistant, multistep, guided, quiz) require an author-supplied `--id`. Leaf blocks are auto-assigned an ID by the CLI when none is provided. All IDs are stored in `content.json` — the guide file is the source of truth for block identity and is durable across sessions.

5. **Progressive discovery.** An agent runs `add-block <dir> interactive --help` and gets exactly the fields, types, constraints, and valid values for an interactive block. No upfront schema study required.

6. **Agent-first output.** Every command response is designed for an agent consumer. Success messages confirm what was done and suggest what the agent might do next. Error messages include the specific constraint that was violated. Help output is terse and structured.

7. **Version = schema version.** The CLI version always matches `CURRENT_SCHEMA_VERSION`. When the schema evolves, the CLI version evolves automatically.

---

## Command surface

All authoring commands operate on a **package directory** — a directory containing `content.json` and `manifest.json`. The directory is the unit of authoring.

### `create`

Create a new guide package.

```
pathfinder-cli create <dir>
  --title <string>                    Guide title (required)
  --id <kebab-string>                 Guide identifier (optional, kebab-case)
  --type <guide|path|journey>         Package type (default: guide)
  --description <string>              Package description
```

Creates `<dir>/content.json` and `<dir>/manifest.json` with the provided values. The `schemaVersion` is set to `CURRENT_SCHEMA_VERSION` in both files. The `content.json` starts with an empty `blocks` array.

**ID generation.** When `--id` is omitted, the CLI generates a default of the form `<kebab-of-title>-<random-suffix>`, where the suffix is 6 characters of base32 entropy (e.g., `loki-setup-x7q2k1`). The suffix makes ID collisions in the target App Platform namespace statistically negligible without any pre-publish lookup, so the agent never has to coordinate naming with a remote registry. If the agent intentionally wants to overwrite an existing guide, it can pass an explicit `--id` matching the existing resource name; that path is the only one where the publish step needs the "GET-before-POST" overwrite check.

When `--id` is provided explicitly, it must match `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$` — lowercase alphanumeric and hyphens, must start and end with an alphanumeric character, max 253 chars (Kubernetes resource-name limit). Auto-generated IDs satisfy this regex by construction. This is the canonical package identifier and is used unchanged as the App Platform resource name (`metadata.name`) and the viewer deep link key when the package is published.

**Output on success:**

```
Created package: my-guide/
  content.json  (id: my-guide, title: "Getting started with Loki")
  manifest.json (type: guide, schemaVersion: 1.1.0)

Add blocks with: pathfinder-cli add-block my-guide/ <type>
Block types: markdown, section, interactive, multistep, guided, quiz, input,
  image, video, html, terminal, terminal-connect, code-block, conditional, assistant
```

### `add-block`

Append a block to the guide. Each block type is a subcommand with its own flags derived from the corresponding Zod schema.

```
pathfinder-cli add-block <dir> <type> [flags]
  --parent <id>                       Append inside container with this id
  --branch <true|false>               Target branch of a conditional block
```

The `--parent` flag targets a container block by its `id`. Without `--parent`, the block is appended to the top-level `blocks` array. When the parent is a `conditional` block, `--branch true` or `--branch false` selects the target branch.

Container block types (`section`, `conditional`, `assistant`, `multistep`, `guided`, `quiz`) require `--id` so they can be targeted by subsequent commands.

**Example — adding a section:**

```
pathfinder-cli add-block my-guide/ section --id setup --title "Set up your environment"
```

**Output on success:**

```
Added section "Set up your environment" (id: setup) to my-guide/
  Position: blocks[3]
  Package valid: yes

Add content to this section with: pathfinder-cli add-block my-guide/ <type> --parent setup
```

**Example — adding an interactive block inside a section:**

```
pathfinder-cli add-block my-guide/ interactive \
  --parent setup \
  --action navigate \
  --reftarget '[data-testid="nav-item-connections"]' \
  --content "Navigate to **Connections** in the sidebar."
```

**Output on success:**

```
Added interactive block (action: navigate) to section "setup" in my-guide/
  Position: blocks[3].blocks[1]
  Package valid: yes

Continue adding blocks with: pathfinder-cli add-block my-guide/ <type> --parent setup
Or add a new top-level block with: pathfinder-cli add-block my-guide/ <type>
```

### `add-step`

Append a step to a `multistep` or `guided` block.

```
pathfinder-cli add-step <dir> --parent <id> [flags]
```

Flags are derived from `JsonStepSchema`. The `--parent` flag is required and must reference a block of type `multistep` or `guided`.

**Output on success:**

```
Added step (action: button) to guided block "install-steps" in my-guide/
  Step index: 2 (of 3)
  Package valid: yes

Add another step with: pathfinder-cli add-step my-guide/ --parent install-steps --action <action>
Or finalize and add the next block with: pathfinder-cli add-block my-guide/ <type>
```

### `add-choice`

Append a choice to a `quiz` block.

```
pathfinder-cli add-choice <dir> --parent <id> [flags]
```

Flags are derived from `JsonQuizChoiceSchema`. The `--parent` flag is required and must reference a block of type `quiz`.

**Output on success:**

```
Added choice "b" to quiz block "check-understanding" in my-guide/
  Choices: 2 (1 correct)
  Package valid: yes

Add another choice with: pathfinder-cli add-choice my-guide/ --parent check-understanding --id c --text "..."
```

### `set-manifest`

Update manifest fields.

```
pathfinder-cli set-manifest <dir> [flags]
```

Flags are derived from `ManifestJsonObjectSchema`. Only the provided flags are updated; unmentioned fields are preserved.

**Output on success:**

```
Updated manifest for my-guide/
  Changed: description, depends, provides
  Package valid: yes

View manifest with: cat my-guide/manifest.json
```

### `inspect`

Query the current state of a package. Agents need to verify state after errors, retries, or when resuming an interrupted session. Without a read command, the only alternative is parsing raw JSON — which reintroduces the context overload problem the CLI exists to solve.

```
pathfinder-cli inspect <dir>
  --block <id>                        Show details for a single block by ID
  --at <jsonpath>                     Show details for the block at a JSONPath (e.g., blocks[2].blocks[1])
  --format <text|json>                Output format (default: text)
```

**Output (no flags):**

```
Package: my-guide/
  Title: "Getting started with Loki"
  Schema version: 1.1.0
  Blocks: 5 (2 sections, 1 quiz, 2 interactive)
  Containers: intro (section, 3 children), check-1 (quiz, 2 choices)
  Package valid: yes
```

**Output (`--block setup`):**

```
Block: setup (section)
  Title: "Set up your environment"
  Position: blocks[1]
  Children: markdown-1 (markdown), interactive-1 (interactive), interactive-2 (interactive)
  Requirements: none
```

`--block <id>` and `--at <jsonpath>` are two lookup directions for the same information — use whichever handle you have. `--at` is most useful when reading raw JSON and needing to find a block's addressable ID.

The `inspect` command performs no mutations and never writes to disk. It is a pure read operation.

### `edit-block`

Update fields on an existing block by ID. Flags are derived from the same Zod schema as the corresponding `add-block <type>` subcommand.

```
pathfinder-cli edit-block <dir> <id> [flags]
```

**Semantics:**

- **Scalar fields** use merge semantics — only the flags provided change; unspecified fields are preserved.
- **Array fields** (e.g., `--requirements`, `--objectives`) use replace semantics — the new value replaces the existing array entirely.
- **`--type` is not accepted.** Changing a block's type is not supported. Remove and re-add the block if a different type is needed.
- **Structural fields** (`blocks`, `whenTrue`, `whenFalse`, `steps`) cannot be edited via this command — they are managed by `add-block`, `add-step`, and `add-choice`.

**Example:**

```
pathfinder-cli edit-block my-guide/ interactive-1 \
  --reftarget '[data-testid="new-target"]' \
  --content "Updated instruction text."
```

**Output on success:**

```
Updated interactive block "interactive-1" in my-guide/
  Changed: reftarget, content
  Package valid: yes
```

**Error — block has no ID:**

```
Error: Block at blocks[2].blocks[0] has no ID and is not addressable.
  Re-add the block with --id to make it editable.
```

### `remove-block`

Remove a block by ID. Validates the package after removal.

```
pathfinder-cli remove-block <dir> <id>
  --cascade                           Also remove all child blocks (required for non-empty containers)
```

Without `--cascade`, the command fails if the block is a container with children. This prevents accidental loss of content authored inside a container.

**Output on success (leaf block):**

```
Removed interactive block "interactive-1" from my-guide/
  Package valid: yes
```

**Output on success (container with --cascade):**

```
Removed section "setup" (and 3 children) from my-guide/
  Package valid: yes
```

**Error — non-empty container without --cascade:**

```
Error: Section "setup" has 3 children and cannot be removed without --cascade.
  Use: pathfinder-cli remove-block my-guide/ setup --cascade
  Or inspect first: pathfinder-cli inspect my-guide/ --block setup
```

---

## Addressing model

The addressing model defines how commands locate where to append content within a guide's block tree.

### Rules

1. **Top-level is the default.** Without `--parent`, blocks are appended to the guide's root `blocks` array.

2. **Container blocks require `id`.** When creating a `section`, `conditional`, `assistant`, `multistep`, `guided`, or `quiz` block, the `--id` flag is required. The CLI enforces this — the command fails if `--id` is omitted for these types. All other block types accept an optional `--id`; if omitted, the CLI auto-assigns one (see [Auto-assignment of IDs](#auto-assignment-of-ids)).

3. **`--parent <id>` locates a container.** The CLI searches the block tree depth-first for a block with the matching `id`. If not found, the command fails with an error listing available container IDs.

4. **`--branch` disambiguates conditional branches.** When the parent is a `conditional` block, `--branch true` appends to `whenTrue` and `--branch false` appends to `whenFalse`. If the parent is a conditional and `--branch` is omitted, the command fails.

5. **No positional mutation.** There is no insert-at-index and no reordering. New blocks are always appended. `edit-block` and `remove-block` operate on existing blocks by ID without touching positions of other blocks.

6. **IDs must be unique within the guide.** The CLI enforces ID uniqueness at creation time.

### Auto-assignment of IDs

When `add-block` creates a leaf block and no `--id` is provided, the CLI auto-assigns a stable ID using the pattern `<type>-<n>` where `n` is a per-type counter scoped to the guide (e.g., `markdown-1`, `interactive-3`). The assigned ID is written into `content.json` and appears in the success output.

```
Added markdown block (id: markdown-1) to section "intro" in my-guide/
  Position: blocks[0].blocks[0]
  Package valid: yes
```

Auto-assigned IDs are durable — they survive across CLI sessions, MCP reconnects, and conversation restarts. Any future `edit-block` or `remove-block` call can use them without re-inspection. The guide file is the source of truth; there is no separate ID mapping to maintain or lose.

Leaf blocks in guides authored before this feature have no IDs and are not addressable by `edit-block` or `remove-block`. This is intentional — the change is additive and backward-compatible. Existing guides are unaffected. IDs can be added to specific blocks in those guides on demand if needed.

### Idempotent retries with `--if-absent`

Agents retry. If an `add-block` call succeeds but the process crashes before the success message is printed, the agent has no way to know whether the block was written. Re-running the same command fails with "ID already exists" — leaving the agent stuck.

The `--if-absent` flag makes container creation idempotent:

```
pathfinder-cli add-block my-guide/ section --id setup --title "Set up your environment" --if-absent
```

Behavior:

- If `setup` does not exist → create it normally.
- If `setup` exists and matches the provided flags → return success (no-op).
- If `setup` exists but differs → return an error explaining the conflict.

This follows the standard "create-if-not-exists" pattern used in idempotent APIs. It applies only to container blocks (which have author-supplied IDs). Leaf blocks are append-only and auto-assigned IDs are not deterministic across retries, so `--if-absent` is not applicable to them.

For agents that need to verify state before retrying, `inspect` provides a lightweight alternative to parsing raw JSON.

### Addressing error examples

```
Error: Container "setup" not found in my-guide/
  Available containers: intro (section), check-1 (quiz)
```

```
Error: Parent "feature-gate" is a conditional block — specify --branch true or --branch false
```

```
Error: Block type "section" requires --id flag
```

```
Error: ID "setup" already exists in my-guide/ (section at blocks[1])
  Choose a different --id value.
```

---

## Schema-driven option generation

The central design challenge is keeping CLI flags tightly coupled to the Zod schema so that schema evolution automatically updates the CLI. This is achieved by generating Commander.js options from Zod schema introspection at runtime.

### The bridge module

A new module `src/cli/utils/schema-options.ts` provides the Zod-to-Commander bridge.

```typescript
// Conceptual interface — not the final API
function zodFieldToOption(name: string, field: z.ZodType): commander.Option | null;

function registerSchemaOptions(cmd: Command, schema: z.ZodObject): Command;
```

The bridge walks the `.shape` of a `z.object()` schema and generates a Commander option for each field:

| Zod type                  | Commander option             | Help display                 |
| ------------------------- | ---------------------------- | ---------------------------- |
| `z.string()`              | `--name <string>`            | `--name <string>`            |
| `z.string().optional()`   | `--name <string>` (optional) | `--name <string>`            |
| `z.boolean().optional()`  | `--name` (flag)              | `--name`                     |
| `z.enum(['a', 'b', 'c'])` | `--name <a\|b\|c>`           | `--name <a\|b\|c>`           |
| `z.array(z.string())`     | `--name <item>` (repeatable) | `--name <item> (repeatable)` |
| `z.number()`              | `--name <number>`            | `--name <number>`            |
| `z.literal(...)`          | skipped                      | —                            |

For array fields like `requirements` and `objectives`, options are repeatable: `--requirements on-page:/dashboards --requirements is-admin`.

Fields named `type` are skipped — the block type is the subcommand name. Fields named `blocks`, `whenTrue`, `whenFalse`, and `steps` are skipped — these are populated by subcommands (`add-block`, `add-step`), not flags.

### Field descriptions via `.describe()`

Zod v4 supports `.describe()` on any schema field. The bridge reads these descriptions and passes them to Commander as option descriptions. This makes the Zod schema file the single source of truth for both validation and CLI help text.

```typescript
// In json-guide.schema.ts
export const JsonInteractiveBlockSchema = z.object({
  type: z.literal('interactive'),
  action: JsonInteractiveActionSchema.describe('Action to perform on target element'),
  reftarget: z
    .string()
    .optional()
    .describe('CSS selector or data-testid for the target element (required for non-noop actions)'),
  content: z.string().min(1).describe('Instructional text shown to user (markdown)'),
  tooltip: z.string().optional().describe('Tooltip shown on highlighted element'),
  requirements: z
    .array(z.string())
    .optional()
    .describe('Prerequisite conditions (e.g., on-page:/dashboards, is-admin)'),
  objectives: z.array(z.string()).optional().describe('Learning objectives this block addresses'),
  skippable: z.boolean().optional().describe('Allow user to skip this block'),
  hint: z.string().optional().describe('Hint text shown if user is stuck'),
  formHint: z.string().optional().describe('Placeholder text for formfill input fields'),
  validateInput: z.boolean().optional().describe('Strictly validate formfill input against targetvalue'),
  showMe: z.boolean().optional().describe('Enable "Show me" button (highlights target without acting)'),
  doIt: z.boolean().optional().describe('Enable "Do it" button (performs action automatically)'),
  completeEarly: z.boolean().optional().describe('Allow completion before all steps done'),
  verify: z.string().optional().describe('CSS selector to check for verification after action'),
  lazyRender: z.boolean().optional().describe('Wait for target to appear in DOM (virtual scroll support)'),
  scrollContainer: z.string().optional().describe('CSS selector of scroll container for lazy-rendered targets'),
  openGuide: z.string().optional().describe('Guide ID to open when this block completes'),
  ...AssistantPropsSchema.shape,
});
```

Fields without `.describe()` fall back to a generic description derived from the field name and type (e.g., `"scrollContainer (string, optional)"`). Descriptions should be added incrementally — start with the most commonly used block types and expand over time.

### Block schema registry

A `BLOCK_SCHEMA_MAP` maps block type names to their individual Zod schemas:

```typescript
// src/cli/utils/block-registry.ts
import {
  JsonMarkdownBlockSchema,
  JsonInteractiveBlockSchema,
  JsonSectionBlockSchema /* ... */,
} from '../../types/json-guide.schema';

export const BLOCK_SCHEMA_MAP: Record<string, z.ZodObject<any>> = {
  markdown: JsonMarkdownBlockSchema,
  html: JsonHtmlBlockSchema,
  image: JsonImageBlockSchema,
  video: JsonVideoBlockSchema,
  interactive: JsonInteractiveBlockSchema,
  multistep: JsonMultistepBlockSchema,
  guided: JsonGuidedBlockSchema,
  section: JsonSectionBlockSchema,
  conditional: JsonConditionalBlockSchema,
  quiz: JsonQuizBlockSchema,
  input: JsonInputBlockSchema,
  assistant: JsonAssistantBlockSchema,
  terminal: JsonTerminalBlockSchema,
  'terminal-connect': JsonTerminalConnectBlockSchema,
  'code-block': JsonCodeBlockBlockSchema,
};
```

At CLI startup, the `add-block` command iterates `BLOCK_SCHEMA_MAP` and registers a subcommand for each block type with options generated from the schema. A test asserts that the keys of `BLOCK_SCHEMA_MAP` exactly match `VALID_BLOCK_TYPES` — forgetting to register a new block type fails CI.

---

## Validate-on-write

Every mutation command follows this sequence:

1. **Read** — Parse `content.json` and `manifest.json` from the package directory. Fail if either is missing or malformed.
2. **Mutate** — Apply the change in memory (append block, append step, update manifest fields).
3. **Validate** — Run the full `validatePackage()` pipeline against the in-memory state. This includes Zod schema validation, cross-file ID consistency, nesting depth limits, and condition syntax validation.
4. **Write** — Only if validation passes, write the updated files back to disk.
5. **Report** — Print success with next-step hints, or print validation errors and exit non-zero.

This means the CLI **cannot produce an invalid package**. Even if the schema-to-option bridge has a bug that allows an unexpected value through as a flag, the Zod validation at step 3 catches it before anything is written.

The validate command (`pathfinder-cli validate`) remains available for read-only inspection of existing packages, but it is never needed as a "final check" after authoring — every write has already validated.

---

## Agent-oriented output

All command output is designed for agent consumption. The key principle: **every response tells the agent what happened and what it can do next.**

### Success output

Success messages follow this structure:

```
<what happened> in <which package>/
  <relevant details>
  Package valid: yes

<what you can do next>: pathfinder-cli <suggested command>
```

Details are minimal — just enough for the agent to confirm intent (block type, action, parent, position). The "what you can do next" line is contextual:

- After `create` → suggest `add-block`
- After `add-block` to a section → suggest adding more blocks to the same section, or a new top-level block
- After `add-step` → suggest adding another step, or moving on to the next block
- After `add-choice` → suggest adding another choice

### Quiet mode (`--quiet`)

A 20-block guide means 20+ command outputs in the agent's context window. Each success message is 4–6 lines with next-step hints, accumulating 80–120 lines of tool output that competes for the model's attention budget. Research on "context rot" shows that LLM reasoning quality degrades as the context window fills with low-value content.

The `--quiet` flag (or `-q`) reduces output to a single confirmation line:

```
ok section "setup" (id: setup) at blocks[3]
```

```
ok interactive (action: navigate) at blocks[3].blocks[1]
```

```
err: Container "setup" not found (available: intro, check-1)
```

Quiet mode omits next-step hints and detail lines. Agents that know the workflow don't need discovery on every call — they can opt into verbose output when stuck and opt out when executing a known plan. Error output in quiet mode retains the constraint violated but omits the "how to fix" line.

### Structured output (`--format json`)

All commands accept `--format json` to produce machine-parseable output:

```json
{
  "status": "ok",
  "type": "section",
  "id": "setup",
  "position": "blocks[3]",
  "valid": true
}
```

```json
{
  "status": "error",
  "code": "CONTAINER_NOT_FOUND",
  "message": "Container \"setup\" not found",
  "available": ["intro", "check-1"]
}
```

The default text format is optimized for direct LLM consumption — terse, readable, and token-efficient. JSON mode exists for two reasons:

1. **MCP integration.** Exposing the CLI as an MCP tool server requires structured responses that the MCP harness can route and inspect programmatically.
2. **Programmatic chaining.** Agents using structured tool-use APIs (OpenAI function calling, Anthropic tool use) can parse JSON responses natively without regex.

Text output costs roughly half the tokens of equivalent JSON. Agents should prefer the default text format unless they have a specific integration reason to use JSON.

### Error output

Error messages are actionable and specific:

```
Error: <what went wrong>
  <specific constraint violated>
  <how to fix it>
```

Examples:

```
Error: Non-noop actions require --reftarget
  Action "navigate" must have a target element.
  Add: --reftarget '<selector>'
```

```
Error: formfill with --validate-input requires --targetvalue
  When input validation is enabled, the expected value must be specified.
  Add: --targetvalue '<expected>'
```

```
Error: --parent "setup" not found in my-guide/
  Available containers: intro (section), check-1 (quiz)
```

### Help output

Help output is terse and structured for agent parsing. When an agent runs `--help` on a block type subcommand:

```
$ pathfinder-cli add-block my-guide/ interactive --help

Add an interactive block

Required:
  --action <highlight|button|formfill|navigate|hover|noop>
                                    Action to perform on target element
  --content <string>                Instructional text shown to user (markdown)

Optional:
  --reftarget <string>              CSS selector or data-testid for the target element
                                    (required for non-noop actions)
  --targetvalue <string>            Value for formfill actions
  --tooltip <string>                Tooltip shown on highlighted element
  --requirements <item> (repeatable)
                                    Prerequisite conditions (e.g., on-page:/dashboards)
  --objectives <item> (repeatable)  Learning objectives this block addresses
  --skippable                       Allow user to skip this block
  --hint <string>                   Hint text shown if user is stuck
  --show-me                         Enable "Show me" button
  --do-it                           Enable "Do it" button
  --complete-early                  Allow completion before all steps done
  --verify <string>                 CSS selector for post-action verification
  --open-guide <string>             Guide ID to open when block completes

Constraints:
  - Non-noop actions require --reftarget
  - formfill with --validate-input requires --targetvalue

Addressing:
  --parent <id>                     Append inside container with this id
  --id <string>                     ID for this block (required for container types)
```

Note what is absent: no verbose paragraphs, no full schema dumps, no JSON examples. An agent gets exactly the flag names, types, descriptions, and constraints. This is the minimum viable context for correct usage.

The help also includes a summary of valid values for common repeatable fields. For `--requirements`:

```
Common requirements:
  Fixed: exists-reftarget, navmenu-open, has-datasources, is-admin, is-logged-in,
    is-editor, dashboard-exists, form-valid, is-terminal-active
  Parameterized: on-page:<path>, has-datasource:<type>, has-plugin:<id>,
    min-version:<ver>, section-completed:<id>, has-role:<role>,
    has-permission:<perm>, var-<name>:<value>, renderer:<type>
```

### `--help --format json` is a stability contract

The Pathfinder authoring MCP exposes a `pathfinder_help` tool that returns the output of `pathfinder-cli <command> [<subcommand>] --help --format json` directly to the calling agent (see [Pathfinder authoring MCP service — Core tools](./HOSTED-AUTHORING-MCP.md#core-tools)). This makes the JSON shape of `--help` part of the public contract:

- The top-level keys (e.g., `command`, `summary`, `required`, `optional`, `constraints`, `addressing`) are stable. New keys may be added as additive fields. Existing keys are not renamed or removed within a major version.
- Per-flag entries have stable keys (`name`, `valueType`, `enum`, `repeatable`, `description`, `default`).
- Removing or renaming a flag is a breaking change and rides the schema version.

Agents call `pathfinder_help` instead of carrying field-level guidance locally; promoting `--help --format json` to a contract is what lets the MCP layer be a thin pass-through with no schema knowledge of its own.

---

## Version coupling

The CLI version is derived directly from the schema version constant:

```typescript
// src/cli/index.ts
import { CURRENT_SCHEMA_VERSION } from '../types/json-guide.schema';

program.name('pathfinder-cli').version(CURRENT_SCHEMA_VERSION);
```

This creates a hard coupling: when the schema version bumps (e.g., `1.1.0` → `1.2.0`), the CLI version bumps automatically. There is no separate version to maintain.

If the CLI is later published to npm, `npm install pathfinder-cli@1.2.0` means "supports schema 1.2.0." The version in `package.json` would also be set to match `CURRENT_SCHEMA_VERSION` via a build step or prepublish script.

The `create` command stamps `schemaVersion: CURRENT_SCHEMA_VERSION` into both `content.json` and `manifest.json`, ensuring packages are tagged with the version of the CLI that created them.

---

## Schema coupling guarantees

The coupling between schema and CLI is maintained at three levels:

| Level               | Mechanism                                                  | What it catches                                                          |
| ------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Compile-time**    | `BLOCK_SCHEMA_MAP` keys tested against `VALID_BLOCK_TYPES` | Forgetting to register a new block type                                  |
| **Runtime (help)**  | `registerSchemaOptions()` walks `schema.shape` dynamically | New fields automatically appear in `--help` and are accepted as flags    |
| **Runtime (write)** | `validatePackage()` on every mutation                      | Any bug in option parsing, schema introspection, or flag-to-JSON mapping |
| **Version**         | `program.version(CURRENT_SCHEMA_VERSION)`                  | Version drift between CLI and schema                                     |

The only thing that requires manual maintenance is `.describe()` text on Zod fields. Fields without descriptions get a generic fallback. This is intentional — descriptions are documentation, not structural coupling, and can be added incrementally without breaking anything.

---

## Architectural layering

The `cli/` directory is excluded from the project's tier-based import enforcement (see `EXCLUDED_TOP_LEVEL` in `src/validation/import-graph.ts`). The CLI already imports from `types/` (tier 0) and `validation/` (tier 1). The authoring commands follow the same pattern — they depend on schemas and validation, never the reverse.

```
types/ (tier 0)          ← schema definitions, .describe() text
  ↑
validation/ (tier 1)     ← validatePackage(), validateGuide()
  ↑
cli/ (excluded from tiers) ← schema-options bridge, authoring commands
```

No changes to the tier model or architectural tests are needed.

---

## Distribution

The CLI is shipped as **two artifacts built from the same TypeScript source**, both pinned to `CURRENT_SCHEMA_VERSION`:

1. **Docker image** — published to a container registry on every build. This is the distribution channel for human authors, CI pipelines, and any environment where a Docker daemon is available. Usage is the standard "Docker as CLI" pattern: `docker run --rm grafana/pathfinder-cli:<version> add-block ...`.

2. **Single-file Node binary** — bundled inside the Pathfinder plugin tarball at a known path (e.g., `<plugin-dir>/cli/pathfinder-cli`). Built via `pkg` (Vercel) or Node's Single Executable Applications feature. This binary is what the plugin's Go MCP endpoint invokes via `exec.Command` when serving authoring tool calls (see [Pathfinder authoring MCP service](./HOSTED-AUTHORING-MCP.md)). Bundling avoids any requirement that Node be installed on the host running Grafana, and it avoids requiring Docker access from the plugin's process — which is unavailable in most Grafana deployments.

### Supported platforms

The bundled binary is built for the platforms on which the plugin actually runs:

- `linux/amd64`
- `linux/arm64`
- `darwin` (local-developer support; arch covers Apple Silicon, with `darwin/amd64` produced if the build matrix and Pathfinder's own backend matrix already cover Intel Macs)

Windows is not in scope for the bundled binary in MVP. The Docker image remains the cross-platform path for any environment outside those three.

### Build pipeline

The CLI binaries are produced by GitHub Actions:

- **Every merge to `main`**: build the binaries for all three target platforms and upload them as workflow artifacts. These are transient — they cover spot-checking and CI integration but are not durable distribution.
- **Tagged releases**: build the binaries for all three target platforms and attach them to the GitHub Release as durable assets, alongside the Docker image push.

Plugin tarball assembly (driven by `mage`) pulls the matching CLI binary into `<plugin-dir>/cli/pathfinder-cli` for each backend platform variant the tarball is built for. The mage targets that build the Go backend (`mage build:linux`, `mage build:linuxARM64`, `mage build:darwinARM64`, etc.) gain a step that copies in the CLI binary for the same platform.

Both artifacts execute identical authoring logic. The Go MCP performs no schema validation of its own; it serializes the in-flight artifact to a temporary directory, invokes the bundled CLI binary, and returns the structured CLI response to the caller. This is what makes the design's core property hold end-to-end: **schema-illegal output is impossible because it is impossible in the CLI**, and the CLI is the only place schema knowledge lives.

Per-call cost is dominated by Node startup (~100-200ms cold-start). For a 20-block guide this accumulates to a few seconds across the authoring session, which is acceptable for the MVP. The escape hatch when this becomes a problem is [batch operations](#batch-operations), which collapse N mutations into a single CLI invocation. A long-lived Node sidecar (one process per plugin, JSON-RPC over stdio) is a known follow-up optimization if the per-call cost becomes a measured bottleneck — but it is intentionally **not** the MVP because per-call `exec.Command` is simpler and more robust under failure.

---

## Agent usage example

A complete authoring session for a simple guide:

```bash
# Create the package
pathfinder-cli create my-guide/ --id my-guide --title "Getting started with Loki"

# Add an introduction section
pathfinder-cli add-block my-guide/ section --id intro --title "Introduction"

# Add markdown inside the section
pathfinder-cli add-block my-guide/ markdown \
  --parent intro \
  --content "In this guide you will learn how to send logs to **Loki** and query them in Grafana."

# Add an interactive navigation step
pathfinder-cli add-block my-guide/ interactive \
  --parent intro \
  --action navigate \
  --reftarget '[data-testid="nav-item-connections"]' \
  --content "Open the **Connections** page from the sidebar." \
  --requirements on-page:/ \
  --show-me

# Add a guided block with multiple steps
pathfinder-cli add-block my-guide/ guided \
  --id add-loki \
  --parent intro \
  --content "Add Loki as a data source."

pathfinder-cli add-step my-guide/ --parent add-loki \
  --action button \
  --reftarget '[data-testid="add-datasource-button"]' \
  --description "Click **Add data source**."

pathfinder-cli add-step my-guide/ --parent add-loki \
  --action formfill \
  --reftarget '[data-testid="datasource-search"]' \
  --targetvalue "Loki" \
  --description "Search for Loki."

# Add a quiz
pathfinder-cli add-block my-guide/ quiz \
  --id check-understanding \
  --question "Which query language does Loki use?" \
  --requirements section-completed:intro

pathfinder-cli add-choice my-guide/ --parent check-understanding \
  --id a --text "PromQL" --hint "PromQL is used by Prometheus, not Loki."

pathfinder-cli add-choice my-guide/ --parent check-understanding \
  --id b --text "LogQL" --correct

pathfinder-cli add-choice my-guide/ --parent check-understanding \
  --id c --text "SQL" --hint "Loki uses its own query language, not SQL."

# Set manifest metadata
pathfinder-cli set-manifest my-guide/ \
  --description "Learn to send logs to Loki and query them in Grafana" \
  --provides loki-basics \
  --recommends first-dashboard
```

Each command succeeds or fails immediately. The agent never holds a partial, invalid guide in memory. Every step is validated before being written.

---

## Agent context injection

The complete context an agent needs to begin authoring:

```
Use `pathfinder-cli` to author Pathfinder guides. Commands:

- pathfinder-cli create <dir> --id <id> --title <title>
- pathfinder-cli add-block <dir> <type> [--parent <id>] [--branch true|false]
- pathfinder-cli add-step <dir> --parent <id> --action <action> [flags]
- pathfinder-cli add-choice <dir> --parent <id> --id <id> --text <text> [flags]
- pathfinder-cli set-manifest <dir> [flags]
- pathfinder-cli inspect <dir> [--block <id>] [--at <jsonpath>]
- pathfinder-cli edit-block <dir> <id> [flags]
- pathfinder-cli remove-block <dir> <id> [--cascade]

Run any command with --help to see available flags for that block type.
All commands support --quiet (terse output) and --format json (structured output).

Block types: markdown, section, interactive, multistep, guided, quiz, input,
  image, video, html, terminal, terminal-connect, code-block, conditional, assistant

Container types (require --id): section, conditional, assistant, multistep, guided, quiz
Leaf blocks are auto-assigned an ID (e.g., markdown-1) if --id is not provided.
Use --parent <id> to append inside a container. New blocks are always appended in order.
Use --if-absent on container blocks to make retries safe.
Use inspect to discover block IDs before calling edit-block or remove-block.
The CLI validates on every write — invalid output is impossible.
```

This is approximately 20 lines. The agent discovers everything else via `--help` on the specific command it needs.

---

## Implementation plan

### Phase 1: Schema descriptions, leaf block IDs, and canonical ID format

Add `.describe()` to Zod schema fields in `json-guide.schema.ts` and `package.schema.ts`. Start with the most commonly used block types: `markdown`, `interactive`, `section`, `multistep`, `guided`, `quiz`. This has no runtime effect on existing code — `.describe()` is metadata only.

Also add an optional `id` field to all leaf block schemas that do not already have one. This is a purely additive schema change — existing guides without leaf-block IDs remain valid.

Tighten the package-level `id` field on `ContentJsonSchema` and `ManifestJsonObjectSchema` to enforce kebab-case: `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`, with a maximum length compatible with Kubernetes resource names (253 chars). This brings the canonical TS schema into agreement with the Go-side validation regex (`pkg/plugin/mcp.go`) and with what the App Platform `InteractiveGuide` CRD requires for `metadata.name`. The package `id` becomes the single canonical identifier used as content ID, manifest ID, package directory name, App Platform resource name, and viewer deep link key — with no transformation at any boundary.

This is a tightening rather than additive change. Before merging, audit existing guides in `src/bundled-interactives/` and the `interactive-tutorials` repository for non-kebab IDs. If any are found, normalize them in the same change set; if none are found, the tightening is free.

### Phase 2: Bridge module

Implement `src/cli/utils/schema-options.ts` — the Zod-to-Commander bridge. This module introspects `z.object()` shapes and generates Commander options. Unit-test the bridge against each Zod field type.

### Phase 3: Block registry and registration

Implement `src/cli/utils/block-registry.ts` with `BLOCK_SCHEMA_MAP`. Add the registry completeness test (keys must match `VALID_BLOCK_TYPES`). Wire up `add-block` subcommand registration loop.

### Phase 4: Package read/write utilities

Implement `src/cli/utils/package-io.ts` — read a package directory into memory, mutate the in-memory model, validate, and write back. This is the validate-on-write core.

### Phase 5: Commands

Implement the eight commands: `create`, `add-block`, `add-step`, `add-choice`, `set-manifest`, `inspect`, `edit-block`, `remove-block`. The six mutation commands follow the read-mutate-validate-write pattern and produce agent-oriented output with next-step hints. The `inspect` command is read-only.

All commands support `--quiet` and `--format json` flags via shared output formatting. The `--if-absent` flag is implemented on `add-block` for container types. Auto-ID assignment is implemented in the `add-block` write path — when no `--id` is provided for a leaf block, a `<type>-<n>` ID is generated before the write.

The `create` command's auto-generated package `id` (when `--id` is omitted) takes the form `<kebab-of-title>-<6-char-base32-suffix>`, so collision in any target App Platform namespace is statistically negligible without a remote check.

### Phase 6: Tests

- Unit tests for the bridge module (Zod field → Commander option mapping)
- Unit tests for each command (using in-memory fixtures, not subprocess calls, following existing CLI test patterns)
- Integration test: author a complete guide via CLI commands and validate the resulting package
- Registry completeness test: `BLOCK_SCHEMA_MAP` keys === `VALID_BLOCK_TYPES`
- `inspect` command tests: verify output for empty packages, populated packages, `--block` targeting, and `--at` JSONPath targeting
- `--if-absent` tests: verify no-op on match, error on conflict, normal create on absence
- `--quiet` and `--format json` tests: verify output shape for success and error cases across commands
- Auto-assignment tests: verify leaf blocks without `--id` receive auto-assigned IDs; verify counter increments correctly per type; verify IDs appear in success output and are present in written `content.json`
- `edit-block` tests: scalar merge semantics, array replace semantics, error on unknown ID, error on `--type` flag, error on structural fields, validate-on-write
- `remove-block` tests: successful leaf removal, error on non-empty container without `--cascade`, successful cascade removal, validate-on-write

### Phase 7: Build pipeline and binary distribution

- Add a build target that produces single-file Node binaries for `linux/amd64`, `linux/arm64`, and `darwin` from the same TypeScript source as the Docker image.
- GitHub Actions: on every merge to `main`, build all three binaries and upload as workflow artifacts.
- GitHub Actions: on tagged releases, build all three binaries and attach them to the GitHub Release as durable assets.
- Plugin tarball: extend the per-platform `mage build:*` targets to copy the matching CLI binary into `<plugin-dir>/cli/pathfinder-cli` so the bundled binary ships alongside the Go backend.
- Smoke test: after each tarball assembly, verify `<plugin-dir>/cli/pathfinder-cli --version` returns the expected schema version.

### Phase 8: Documentation

- Update `docs/developer/CLI_TOOLS.md` with the new commands
- Update `AGENTS.md` on-demand context table to reference this design doc

---

## Future considerations

### npm publishing

If the CLI is published as a standalone npm package, the version is already coupled to the schema version. A prepublish script can sync `package.json` version to `CURRENT_SCHEMA_VERSION`.

### Reordering

Block reordering (`move-block`) is intentionally excluded. Moving blocks creates positional instability that is difficult for agents to reason about correctly. If structure needs to be substantially rearranged, removing and re-adding blocks in the correct order is the supported path.

### Dry-run mode

A `--dry-run` flag could show what would be written without modifying files. Useful for agent planning and debugging.

### Batch operations

A `pathfinder-cli apply <dir> <commands-file>` command could accept a sequence of commands in a simple line-oriented format, validate once at the end, and write once. A 20-block guide currently requires 20+ separate invocations, each repeating the read/validate/write cycle. Batch mode would cut this to a single cycle with proportional token savings. This trades the incremental-validation safety net for throughput — suited to agents that have already planned the full guide structure and want to execute it in one shot.
