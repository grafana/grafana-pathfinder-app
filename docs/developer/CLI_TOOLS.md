# Pathfinder CLI tools

The `pathfinder-cli` is a command-line interface for working with interactive JSON guides and packages in the Grafana Pathfinder application. It provides these commands:

- **validate** — Validates guide definitions and package directories against schemas and best practices
- **build-repository** — Generates `repository.json` from a package tree
- **build-stats** — Writes the computed completion block stats into every package's `manifest.json`
- **build-graph** — Generates a D3-compatible dependency graph from repository indexes
- **build-snippets** — Generates a snippet catalog (`index.json`) from a directory of snippet bodies
- **schema** — Exports Zod validation schemas as JSON Schema for cross-language consumers
- **e2e** — Runs end-to-end tests on guides in a live Grafana instance (see [E2E testing](./E2E_TESTING.md))

This document covers the `validate`, `build-repository`, `build-stats`, `build-graph`, `build-snippets`, and `schema` commands. For e2e testing, see the dedicated [E2E testing guide](./E2E_TESTING.md). For the package format itself, see the [package authoring guide](./package-authoring.md).

---

## Validate command

The validate command ensures that guide definitions and package directories adhere to the required schemas and best practices. It supports three modes: single-file guide validation, single package directory validation, and recursive package tree validation.

## Setup

The CLI is built from the source code within this repository. To set it up:

1.  **Install dependencies**:

    ```bash
    npm install
    ```

2.  **Build the CLI**:
    ```bash
    npm run build:cli
    ```

This compiles the TypeScript source in `src/cli` to `dist/cli`.

### Distribution: GHCR Docker image

The CLI ships as a Docker image at `ghcr.io/grafana/pathfinder-cli`, rebuilt and pushed on every merge to `main`. The CLI's `--version` is pinned to `CURRENT_SCHEMA_VERSION` from `src/types/json-guide.schema.ts`, so the CLI version and the guide schema version cannot drift.

Run from GHCR:

```bash
docker run --rm ghcr.io/grafana/pathfinder-cli:latest --version
docker run --rm -v "$PWD:/workspace" ghcr.io/grafana/pathfinder-cli:latest create my-guide --title "My guide"

# Pin to a specific main commit for reproducible CI / deploys
docker run --rm ghcr.io/grafana/pathfinder-cli:main-abc1234 --version
```

The image's first positional argument selects the entrypoint: the default is `pathfinder-cli`; `mcp` routes to `pathfinder-cli mcp` (the authoring MCP server — see [`docs/developer/MCP_SERVER.md`](./MCP_SERVER.md) and [`docs/design/AI-AUTHORING-IMPLEMENTATION.md`](../design/AI-AUTHORING-IMPLEMENTATION.md)).

Build and run locally without going to the registry:

```bash
npm run build:cli                                             # compile dist/cli/
docker build -f Dockerfile.cli -t pathfinder-cli:local .      # produce the image
docker run --rm pathfinder-cli:local --version
```

The publish flow is documented in [`RELEASE_PROCESS.md`](./RELEASE_PROCESS.md#cli-and-mcp-continuous-publish).

## Usage

You can run the CLI directly using Node.js after building it.

### Basic Syntax

```bash
node dist/cli/cli/index.js validate [options] [files...]
```

### Options

- `--bundled`: Validate all bundled guides located in `src/bundled-interactives/`. Discovery works in two modes: subdirectories containing `content.json` are validated as package guides (e.g. `first-dashboard/content.json`); flat JSON files at the root level are also loaded as legacy guides (excluding `index.json` and `repository.json`). The `static-links/` subdirectory is always skipped. The path is resolved relative to the current working directory, so when run in another repository it will look for `src/bundled-interactives/` in that repository's directory structure.
- `--stdin`: Read a single JSON guide from stdin instead of files. Mutually exclusive with `--bundled`, `--package`, `--packages`, and file arguments.
- `--strict`: Treat warnings as errors. The command will exit with a non-zero status code if any warnings are found.
- `--format <format>`: Output format. Options are `text` (default) or `json`.
- `--package <dir>`: Validate a single package directory (expects `content.json` and optionally `manifest.json`).
- `--packages <dir>`: Validate a tree of package directories recursively.
- File arguments accept explicit paths to JSON guide files.

### Examples

**Validate all bundled guides (default script):**

This project includes a helper script for this common task:

```bash
npm run validate
# Equivalent to: node dist/cli/cli/index.js validate --bundled
```

**Validate specific guide files:**

```bash
node dist/cli/cli/index.js validate my-new-guide.json another-guide.json
```

**Note:** You can use shell glob expansion if needed:

```bash
# Shell expands *.json before passing to CLI
node dist/cli/cli/index.js validate guides/*.json

# Or use find for recursive matching
node dist/cli/cli/index.js validate $(find guides -name "*.json")
```

**Validate with strict mode (fail on warnings):**

```bash
npm run validate:strict
# Equivalent to: node dist/cli/cli/index.js validate --bundled --strict
```

**Get JSON output for CI integration:**

```bash
node dist/cli/cli/index.js validate --bundled --format json
```

**Validate from stdin (for programmatic use):**

```bash
echo '{"id":"my-guide","title":"My guide","blocks":[{"type":"markdown","content":"# Hello"}]}' \
  | node dist/cli/cli/index.js validate --stdin
```

**Validate from stdin with JSON output (machine-readable):**

```bash
cat my-guide.json | node dist/cli/cli/index.js validate --stdin --format json
```

This is useful for cross-language consumers (e.g. Go) that generate guide JSON and want to validate it against the full Zod pipeline including refinement rules.

### Validation checks

The validator performs these checks in order:

1. **JSON structure** - Valid JSON with required fields
2. **Schema compliance** - Types, nesting depth, field names
3. **Unknown fields** - Warns on unrecognized fields (forward compatibility)
4. **Condition syntax** - Validates requirements/objectives mini-grammar

Example output with condition warnings:

```
✓ my-guide.json
  Warning: blocks[2].requirements[0]: Unknown condition type 'typo-requirement'
  Warning: blocks[5].objectives[0]: 'has-datasource:' requires an argument
```

In strict mode (`--strict`), warnings become errors and cause the command to fail.

### Package validation

**Validate a single package directory:**

```bash
node dist/cli/cli/index.js validate --package prometheus-grafana-101
```

This validates the `content.json` and `manifest.json` within the directory, including:

- JSON structure and schema compliance for both files
- Cross-file ID consistency (`content.json` `id` must match `manifest.json` `id`)
- Asset reference validation (warns if `content.json` references `./assets/*` files that don't exist)
- Severity-based messages: ERROR for required fields, WARN for recommended fields, INFO for defaulted fields
- `testEnvironment` validation (warns on unrecognized tier values, invalid semver in `minVersion`)

**Validate a tree of package directories:**

```bash
node dist/cli/cli/index.js validate --packages src/bundled-interactives
```

This recursively discovers all package directories (any directory containing `manifest.json`) under the given root and validates each one. There is a convenience npm script for this:

```bash
npm run validate:packages
```

## GitHub Actions integration

You can use the CLI in a GitHub Actions workflow to automatically validate guides on every push or pull request. Since this CLI is internal to the repo, the workflow builds it from source.

Here is a succinct example workflow:

```yaml
name: Validate Guides

on: [push, pull_request]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: 'npm'

      - name: Install Dependencies
        run: npm ci

      - name: Build CLI
        run: npm run build:cli

      - name: Validate Guides
        run: npm run validate:strict
```

For package validation with repository freshness checks, see the [CI workflow example](#ci-workflow-example-with-package-validation) below.

---

## Build-repository command

Scans a package tree for `manifest.json` files, reads each package's `content.json` and `manifest.json`, and emits a denormalized `repository.json` mapping bare IDs to entry metadata.

### Basic syntax

```bash
node dist/cli/cli/index.js build-repository <root> [options]
```

### Arguments

- `<root>` (required): Root directory containing package directories.

### Options

- `-o, --output <file>`: Output file path. If omitted, writes to stdout.
- `-e, --exclude <paths...>`: Path(s) to exclude from the scan, relative to `<root>`. Excluded trees are not descended into. Use this when the root contains another repo (e.g. pathfinder-app) and you want to index only your packages.

### Examples

**Build and write to file:**

```bash
node dist/cli/cli/index.js build-repository src/bundled-interactives -o src/bundled-interactives/repository.json
```

**Build and pipe to stdout:**

```bash
node dist/cli/cli/index.js build-repository src/bundled-interactives
```

**Exclude a subtree (e.g. when running from a repo that has pathfinder-app checked out):**

```bash
node pathfinder-app/dist/cli/cli/index.js build-repository . -e pathfinder-app -o repository.json
```

There are convenience npm scripts:

```bash
npm run repository:build   # Build and write to the bundled repository.json
npm run repository:check   # Rebuild to temp file and diff — fails if committed file is stale
```

### How discovery works

The command walks the directory tree starting at `<root>`. Any subdirectory at any depth containing `manifest.json` is treated as a package. The `assets/` subtree is skipped during traversal. Directories without `manifest.json` are not packages. If `--exclude` is used, any path equal to or under an excluded path is not descended into, so packages inside excluded trees are not discovered.

### Output format

The output is a JSON object mapping bare package IDs to `RepositoryEntry` objects. Each entry contains the package path and denormalized metadata from `manifest.json` (type, description, category, author, dependencies, targeting, testEnvironment, etc.). The output is formatted with Prettier using the project's configuration.

---

## Build-stats command

Computes the block stats that completion tracking uses as its denominator and writes them into each package's `manifest.json` under a `stats` key. Authors never assert these numbers, so they cannot be wrong.

The arithmetic is not implemented here. It lives in `src/lib/guide-stats` (Tier 1, pure, dependency-free) so the CLI, an upload script, the plugin frontend, and a Go port all inherit one rule. This command is argument parsing, file IO, and ordering.

### Basic syntax

```bash
node dist/cli/cli/index.js build-stats <root> [options]
```

### Arguments

- `<root>` (required): Root directory containing package directories. Discovery is identical to `build-repository`.

### Options

- `-e, --exclude <paths...>`: Path(s) to exclude from the scan, relative to `<root>`. Excluded trees are not descended into.
- `--check`: Report packages whose committed stats have drifted from their content and exit non-zero. Writes nothing.

### Examples

**Stamp every manifest under a package tree, then index it:**

```bash
node dist/cli/cli/index.js build-stats packages/
node dist/cli/cli/index.js build-repository packages/ -o dist/repository.json
```

Run `build-stats` first. Today the ordering is inert: `build-repository` builds each `RepositoryEntry` field by field and never assigns `stats`, so `repository.json` carries none either way. It becomes load-bearing once the manifest-extension passthrough of PR #1662 lands, after which `build-repository` forwards unknown top-level manifest keys — `stats` among them — into `repository.json`, and an index built before the manifests are stamped omits stats for every package. Ordering the two this way now costs nothing and is already correct for after.

**Fail CI when a committed manifest is stale:**

```bash
node dist/cli/cli/index.js build-stats packages/ --check
```

### What gets counted

- Every block counts once, except containers (`section`, `assistant`, `collapsible`), which contribute their contents and nothing of their own. A section holding five blocks contributes five, not six.
- `multistep` and `guided` count as exactly one block each. Their inner steps are deliberately outside the denominator.
- `conditional` counts as one block, and neither branch is descended into. Descending into both would put blocks in the denominator the reader can never see.
- `snippet-ref` counts as one block, and its resolved contents inherit that single position. `src/snippet-engine/inline-refs.ts` splices the resolved blocks in before the parser sees the guide, so the stamped denominator is the **pre-inlining** count and a consumer must index the pre-inlining tree. Mapping an inlined block back to its ref is not an option today: the splice carries no provenance, so there is nothing to map back from.
- Completion is `n / total` with no special case. A "Do it" yields 100% only when its block is the guide's last counted one — `finalCompletablePosition === blockCount`. Anything less means the guide needs a "Mark as complete" button at its foot, and that field is the signal for it.
- A `path` or `journey` rolls up as its own body followed by its milestones in declared order. Milestones are measured before their parents.

### Strictness

A milestone missing from the tree, and a manifest that fails schema validation, both abort the run with a non-zero exit and nothing written. That is knowingly stricter than the sibling tooling — `build-graph` warns on an unresolvable milestone, `build-repository` degrades a manifest schema failure to a warning, and `docs-retrieval`'s package content keeps an unresolvable milestone as a locked placeholder. Those tolerate a partial tree at read time; this command's whole purpose is to produce a denominator that is never wrong, and a rollup silently missing a milestone would publish one that is. No manifest is written until every package in the tree has resolved, so a failed run leaves the tree completely unstamped rather than half-stamped.

One consequence worth knowing before putting `build-stats` ahead of `build-repository` in a pipeline that uses `--exclude`. This one is true today, independently of #1662: if an excluded subtree holds a package that a path lists as a milestone, that milestone is missing from the tree, so `build-stats` aborts and leaves _unrelated_ packages unstamped too. `build-repository` with the same `--exclude` omits the entry and succeeds. The strictness is deliberate, but it converts a tree shape the sibling tolerates into a hard stop.

A duplicated milestone, and a milestone reachable through two parents, are both errors as well. Summing a package twice inflates the denominator, and because positions are first-occurrence-wins the second copy's blocks can never be evidenced — so the reader would be permanently stuck below 100%.

### `stats.blockCount` is not `inspect`'s `blockCount`

`pathfinder-cli inspect --format json` also emits a `blockCount`, counted over the whole tree — containers included, conditional branches descended. `manifest.stats.blockCount` is the completion denominator and counts neither. The two therefore disagree by design on the same guide: `inspect` answers "how many blocks are in this file", `stats` answers "what is the reader measured against".

### Determinism

Re-running on unchanged content is a byte-for-byte no-op: the command compares the computed stats against what is on disk and skips the write when they match. Stats keys are emitted in a fixed order and carry no timestamps. An existing `stats` key is replaced in place, so a manifest's authored key order survives a rewrite.

Output is formatted with Prettier using the project's configuration wherever Prettier resolves — a repo checkout, or any environment that has it installed. The published CLI image does not: Prettier is a devDependency and is absent from `RUNTIME_DEPS`, so the command degrades to two-space `JSON.stringify` output with a trailing newline rather than failing. Both forms are valid JSON and `--check` compares stats field by field, so neither reads as drift against the other; a tree stamped from the image and then re-stamped locally will show a formatting-only diff, though.

The run that first stamps a manifest can re-expand nested objects an author had collapsed onto one line — both forms are Prettier-clean, and the file is stable from that run onward.

---

## Build-graph command

Reads one or more `repository.json` files, constructs an in-memory dependency graph, performs lint checks, and outputs D3-compatible JSON.

### Basic syntax

```bash
node dist/cli/cli/index.js build-graph <repositories...> [options]
```

### Arguments

- `<repositories...>` (required): One or more repository entries in `name:path` format.

The `name` is a label for the repository (used in graph node metadata). The `path` is the filesystem path to a `repository.json` file.

### Options

- `-o, --output <file>`: Output file path. If omitted, writes to stdout.
- `--lint` / `--no-lint`: Enable or suppress lint output. Lint is enabled by default.

### Examples

**Build graph from the bundled repository:**

```bash
node dist/cli/cli/index.js build-graph bundled:src/bundled-interactives/repository.json
```

**Build graph from multiple repositories:**

```bash
node dist/cli/cli/index.js build-graph \
  bundled:src/bundled-interactives/repository.json \
  tutorials:../interactive-tutorials/repository.json \
  -o graph.json
```

### Lint checks

When lint is enabled (the default), the command checks for:

- **Broken references**: dependency targets that don't exist as real packages or virtual capabilities
- **Broken steps**: `steps` entries that don't resolve to existing packages
- **Cycles**: detected via DFS in `depends` (error), `recommends` (warning), and `steps` (error) edge types
- **Orphaned packages**: packages with no incoming or outgoing edges
- **Missing metadata**: packages without `description` or `category`

Lint messages are printed to stderr. The graph JSON is written to stdout or the output file.

### Output format

The output is a D3-compatible JSON object with `nodes`, `edges`, and `metadata`:

- **Nodes** contain full manifest metadata plus `id`, `repository`, and an optional `virtual: true` flag for capability nodes
- **Edges** have `source`, `target`, and `type` (`depends`, `recommends`, `suggests`, `provides`, `conflicts`, `replaces`, `steps`)
- **Metadata** includes `generatedAt` timestamp, repository names, and node/edge counts

---

## Build-snippets command

Generates a snippet catalog (`index.json`) from a directory of snippet bodies. Snippet bodies (`<id>.json`) are the source of truth; the catalog is always regenerated, never hand-edited. The catalog is consumed by the snippet engine, which resolves `snippet-ref` blocks by fetching `<id>.json` at parse time.

### Basic syntax

```bash
node dist/cli/cli/index.js build-snippets <dir> [options]
```

### Arguments

- `<dir>` (required): Directory containing snippet bodies, one JSON file per snippet named `<id>.json`.

### Options

- `-o, --output <file>`: Output file path. Defaults to `<dir>/index.json`.

### How it works

The command reads every `*.json` file in `<dir>` except `index.json`, validates each against the snippet schema, and builds a catalog mapping each snippet `id` to its `id`, `title`, `description`, and optional `category`, `tags`, and `schemaVersion`. It enforces two rules: each file name must equal the `id` inside it (the resolver fetches `<id>.json`), and ids must be unique. If any body fails validation, a file name does not match its id, or an id is duplicated, no output is written and the command exits non-zero.

Snippet bodies live in the content repository alongside package content, not in this plugin repo. A convenience npm script wraps the command — append the snippet directory:

```bash
npm run snippets:build -- <dir>
```

---

## Schema command

Exports Zod validation schemas as JSON Schema, enabling cross-language consumers (e.g. Go) to couple to the CLI binary rather than maintaining duplicate schemas.

### Basic syntax

```bash
node dist/cli/cli/index.js schema <name> [options]
```

### Arguments

- `<name>` (optional): Name of the schema to export. Required unless `--list` or `--all` is used.

### Options

- `--list`: List available schema names with descriptions.
- `--all`: Export all schemas as a single JSON object keyed by name.
- `--include-version`: Include `CURRENT_SCHEMA_VERSION` in output metadata as `x-schema-version`.

### Available schemas

| Name               | Description                                                                 |
| ------------------ | --------------------------------------------------------------------------- |
| `guide`            | Root JSON guide schema (strict, no extra fields)                            |
| `block`            | Union of all block types with depth-limited nesting                         |
| `content`          | Content JSON schema (`content.json` in two-file packages)                   |
| `manifest`         | Manifest JSON schema (`manifest.json`, without cross-field refinement)      |
| `repository`       | Repository index schema (`repository.json`)                                 |
| `graph`            | Dependency graph schema (D3-compatible output)                              |
| `e2e-report`       | E2E single-guide test report (open-world: no `additionalProperties: false`) |
| `e2e-multi-report` | E2E multi-guide aggregate test report (open-world)                          |

### Examples

**Export a single schema:**

```bash
node dist/cli/cli/index.js schema guide > guide-schema.json
```

**List all available schemas:**

```bash
node dist/cli/cli/index.js schema --list
```

**Export all schemas to a single file:**

```bash
node dist/cli/cli/index.js schema --all > all-schemas.json
```

**Export with version metadata:**

```bash
node dist/cli/cli/index.js schema guide --include-version
```

There is a convenience npm script for exporting all schemas:

```bash
npm run schema:export
```

### Refinement annotations

Since Zod `.refine()` calls cannot be expressed in JSON Schema, the output includes an `x-refinements` extension property that documents cross-field rules as human-readable strings. For example:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "x-refinements": [
    "Non-noop actions require 'reftarget' (step and interactive blocks)",
    "formfill with validateInput requires 'targetvalue' (step and interactive blocks)"
  ]
}
```

Consumers in other languages should reimplement these rules in their own validation logic.

---

## CI workflow example with package validation

This GitHub Actions snippet validates packages and checks `repository.json` freshness — the pattern used in this repository's `.github/workflows/ci.yml`:

```yaml
validate-packages:
  name: Validate packages
  runs-on: ubuntu-latest
  timeout-minutes: 5
  steps:
    - uses: actions/checkout@v4

    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: '24'
        cache: 'npm'

    - name: Install dependencies
      run: npm ci

    - name: Build CLI
      run: npm run build:cli

    - name: Validate bundled packages
      run: npm run validate:packages

    - name: Check repository.json freshness
      run: npm run repository:check
```

The `repository:check` script rebuilds `repository.json` to a temp file and diffs it against the committed version. If the committed file is stale (a manifest was changed without rebuilding), the diff fails and CI reports an error.
