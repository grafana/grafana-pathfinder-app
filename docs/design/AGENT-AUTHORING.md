# Agent authoring CLI

> Part of the [Pathfinder package design](./PATHFINDER-PACKAGE-DESIGN.md).
> See also: [CLI extensions](./package/cli-extensions.md) · [CLI tools reference](../developer/CLI_TOOLS.md)

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
- [Addressing model](#addressing-model)
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

3. **Append-only.** Blocks are appended sequentially. There is no reordering, insertion at index, or positional addressing. The agent writes blocks in the order they should appear.

4. **ID-based addressing.** Container blocks (sections, conditionals, assistant, multistep, guided, quiz) are addressed by their `id`. Leaf blocks need no ID — they are appended to their parent.

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
  --id <string>                       Guide identifier (required)
  --title <string>                    Guide title (required)
  --type <guide|path|journey>         Package type (default: guide)
  --description <string>              Package description
```

Creates `<dir>/content.json` and `<dir>/manifest.json` with the provided values. The `schemaVersion` is set to `CURRENT_SCHEMA_VERSION` in both files. The `content.json` starts with an empty `blocks` array.

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
  --block <id>                        Show details for a single block
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
  Children: 3 (1 markdown, 2 interactive)
  Requirements: none
```

The `inspect` command performs no mutations and never writes to disk. It is a pure read operation.

---

## Addressing model

The addressing model defines how commands locate where to append content within a guide's block tree.

### Rules

1. **Top-level is the default.** Without `--parent`, blocks are appended to the guide's root `blocks` array.

2. **Container blocks require `id`.** When creating a `section`, `conditional`, `assistant`, `multistep`, `guided`, or `quiz` block, the `--id` flag is required. The CLI enforces this — the command fails if `--id` is omitted for these types.

3. **`--parent <id>` locates a container.** The CLI searches the block tree depth-first for a block with the matching `id`. If not found, the command fails with an error listing available container IDs.

4. **`--branch` disambiguates conditional branches.** When the parent is a `conditional` block, `--branch true` appends to `whenTrue` and `--branch false` appends to `whenFalse`. If the parent is a conditional and `--branch` is omitted, the command fails.

5. **Append-only.** There is no insert-at-index, no reordering, no deletion. Blocks are written sequentially in the order they should appear. This prevents index confusion when agents are tracking positions across multiple commands.

6. **IDs must be unique within the guide.** The CLI enforces ID uniqueness at creation time.

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

This follows the standard "create-if-not-exists" pattern used in idempotent APIs. It applies only to container blocks (which have IDs). Leaf blocks are append-only and have no natural deduplication key.

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
- pathfinder-cli inspect <dir> [--block <id>]

Run any command with --help to see available flags for that block type.
All commands support --quiet (terse output) and --format json (structured output).

Block types: markdown, section, interactive, multistep, guided, quiz, input,
  image, video, html, terminal, terminal-connect, code-block, conditional, assistant

Container types (require --id): section, conditional, assistant, multistep, guided, quiz
Use --parent <id> to append inside a container. Blocks are always appended in order.
Use --if-absent on container blocks to make retries safe.
The CLI validates on every write — invalid output is impossible.
```

This is approximately 15 lines. The agent discovers everything else via `--help` on the specific command it needs.

---

## Implementation plan

### Phase 1: Schema descriptions

Add `.describe()` to Zod schema fields in `json-guide.schema.ts` and `package.schema.ts`. Start with the most commonly used block types: `markdown`, `interactive`, `section`, `multistep`, `guided`, `quiz`. This has no runtime effect on existing code — `.describe()` is metadata only.

### Phase 2: Bridge module

Implement `src/cli/utils/schema-options.ts` — the Zod-to-Commander bridge. This module introspects `z.object()` shapes and generates Commander options. Unit-test the bridge against each Zod field type.

### Phase 3: Block registry and registration

Implement `src/cli/utils/block-registry.ts` with `BLOCK_SCHEMA_MAP`. Add the registry completeness test (keys must match `VALID_BLOCK_TYPES`). Wire up `add-block` subcommand registration loop.

### Phase 4: Package read/write utilities

Implement `src/cli/utils/package-io.ts` — read a package directory into memory, mutate the in-memory model, validate, and write back. This is the validate-on-write core.

### Phase 5: Commands

Implement the six commands: `create`, `add-block`, `add-step`, `add-choice`, `set-manifest`, `inspect`. The five mutation commands follow the read-mutate-validate-write pattern and produce agent-oriented output with next-step hints. The `inspect` command is read-only.

All commands support `--quiet` and `--format json` flags via shared output formatting. The `--if-absent` flag is implemented on `add-block` for container types.

### Phase 6: Tests

- Unit tests for the bridge module (Zod field → Commander option mapping)
- Unit tests for each command (using in-memory fixtures, not subprocess calls, following existing CLI test patterns)
- Integration test: author a complete guide via CLI commands and validate the resulting package
- Registry completeness test: `BLOCK_SCHEMA_MAP` keys === `VALID_BLOCK_TYPES`
- `inspect` command tests: verify output for empty packages, populated packages, and `--block` targeting
- `--if-absent` tests: verify no-op on match, error on conflict, normal create on absence
- `--quiet` and `--format json` tests: verify output shape for success and error cases across commands

### Phase 7: Documentation

- Update `docs/developer/CLI_TOOLS.md` with the new commands
- Update `AGENTS.md` on-demand context table to reference this design doc

---

## Future considerations

### npm publishing

If the CLI is published as a standalone npm package, the version is already coupled to the schema version. A prepublish script can sync `package.json` version to `CURRENT_SCHEMA_VERSION`.

### Removal and reordering

The initial design is append-only. If agents need to restructure guides (remove a block, reorder sections), `remove-block` and `move-block` commands could be added. These would use the same ID-based addressing model. For now, an agent that needs to restructure can regenerate the guide from scratch.

### Edit-in-place

An `edit-block` command could update fields on an existing block by ID, revalidating after the change. This is a natural extension of the addressing model.

### Dry-run mode

A `--dry-run` flag could show what would be written without modifying files. Useful for agent planning and debugging.

### Batch operations

A `pathfinder-cli apply <dir> <commands-file>` command could accept a sequence of commands in a simple line-oriented format, validate once at the end, and write once. A 20-block guide currently requires 20+ separate invocations, each repeating the read/validate/write cycle. Batch mode would cut this to a single cycle with proportional token savings. This trades the incremental-validation safety net for throughput — suited to agents that have already planned the full guide structure and want to execute it in one shot.
