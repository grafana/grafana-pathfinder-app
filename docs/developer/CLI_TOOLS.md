# Pathfinder CLI tools

The `pathfinder-cli` is a command-line interface for working with interactive JSON guides and packages in the Grafana Pathfinder application. It provides these commands:

- **validate** — Validates guide definitions and package directories against schemas and best practices
- **build-repository** — Generates `repository.json` from a package tree
- **build-graph** — Generates a D3-compatible dependency graph from repository indexes
- **schema** — Exports Zod validation schemas as JSON Schema for cross-language consumers
- **e2e** — Runs end-to-end tests on guides in a live Grafana instance (see [E2E testing](./E2E_TESTING.md))

This document covers the `validate`, `build-repository`, `build-graph`, and `schema` commands. For e2e testing, see the dedicated [E2E testing guide](./E2E_TESTING.md). For the package format itself, see the [package authoring guide](./package-authoring.md).

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

## Usage

You can run the CLI directly using Node.js after building it.

### Basic Syntax

```bash
node dist/cli/cli/index.js validate [options] [files...]
```

### Options

- `--bundled`: Validate all bundled guides located in `src/bundled-interactives/`. This option automatically discovers all JSON files in the directory (excluding `index.json`) relative to the current working directory where the command is executed. When run in another repository, it will look for `src/bundled-interactives/` in that repository's directory structure.
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
          node-version: '22'
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

| Name         | Description                                                            |
| ------------ | ---------------------------------------------------------------------- |
| `guide`      | Root JSON guide schema (strict, no extra fields)                       |
| `block`      | Union of all block types with depth-limited nesting                    |
| `content`    | Content JSON schema (`content.json` in two-file packages)              |
| `manifest`   | Manifest JSON schema (`manifest.json`, without cross-field refinement) |
| `repository` | Repository index schema (`repository.json`)                            |
| `graph`      | Dependency graph schema (D3-compatible output)                         |

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
        node-version: '22'
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
