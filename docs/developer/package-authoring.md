# Package authoring guide

This guide covers the two-file package model used by Grafana Pathfinder. It is intended for content authors in the `interactive-tutorials` repository and enablement teams creating packages in any repository.

For the block-level guide format (actions, requirements, sequences, quizzes), see the [JSON guide format](./interactive-examples/json-guide-format.md). For CLI commands that validate, build, and graph packages, see [CLI tools](./CLI_TOOLS.md).

---

## Package directory structure

A package is a directory containing at minimum `content.json`. An optional `manifest.json` carries metadata, dependencies, and targeting. An optional `assets/` directory holds images and other non-JSON resources.

```
prometheus-grafana-101/
├── content.json          ← content blocks (what the user sees)
├── manifest.json         ← metadata, dependencies, targeting
└── assets/               ← optional images and diagrams
    └── architecture.png
```

The directory name should match the package `id`.

### File ownership

| File            | Required | Who edits it                           | Contains                                                    |
| --------------- | -------- | -------------------------------------- | ----------------------------------------------------------- |
| `content.json`  | Yes      | Content authors (block editor)         | `schemaVersion`, `id`, `title`, `blocks`                    |
| `manifest.json` | No       | Product, enablement, recommender teams | Flat metadata, dependencies, `targeting`, `testEnvironment` |
| `assets/`       | No       | Content authors                        | Images, diagrams, supplementary non-JSON resources          |

Content and metadata are separate files because they serve different consumers, are authored by different roles, and change for different reasons. The block editor reads and writes `content.json` without touching `manifest.json`. Git diffs stay scoped to the concern being changed.

### Cross-file consistency rule

The `id` field must match between `content.json` and `manifest.json`. The CLI enforces this — a mismatch produces an error.

### Extension metadata

Package directories may contain arbitrary additional files and subdirectories beyond the reserved names (`content.json`, `manifest.json`, `assets/`). These are invisible to Pathfinder — the CLI does not parse, validate, or warn about them. Use tool-specific subdirectories (e.g., `testdata/`, `grafana-docs/`) to avoid collisions.

---

## content.json reference

The content file is what the block editor produces. It contains only the fields needed to render the guide.

| Field           | Type          | Required | Description                                                                                    |
| --------------- | ------------- | -------- | ---------------------------------------------------------------------------------------------- |
| `schemaVersion` | `string`      | No       | Schema version (default: `"1.1.0"` for packages)                                               |
| `id`            | `string`      | Yes      | Bare package identifier — must match `manifest.json`                                           |
| `title`         | `string`      | Yes      | Display title for the guide                                                                    |
| `blocks`        | `JsonBlock[]` | Yes      | Array of content blocks (see [JSON guide format](./interactive-examples/json-guide-format.md)) |

---

## manifest.json field reference

The manifest carries metadata, dependencies, and targeting as flat top-level fields. All fields except `id` and `type` are optional.

| Field              | Type                                 | Required                      | Default                   | Description                                                                |
| ------------------ | ------------------------------------ | ----------------------------- | ------------------------- | -------------------------------------------------------------------------- |
| `schemaVersion`    | `string`                             | No                            | `"1.1.0"`                 | Schema version                                                             |
| `id`               | `string`                             | **Yes**                       | —                         | Bare package identifier — must match `content.json`                        |
| `type`             | `"guide"` \| `"path"` \| `"journey"` | **Yes**                       | —                         | Package type                                                               |
| `repository`       | `string`                             | No                            | `"interactive-tutorials"` | Provenance — which repository this package belongs to                      |
| `steps`            | `string[]`                           | Required for `path`/`journey` | —                         | Ordered bare IDs of child packages                                         |
| `description`      | `string`                             | Recommended                   | —                         | Full description for display and search                                    |
| `language`         | `string`                             | No                            | `"en"`                    | Content language (BCP 47 tag)                                              |
| `category`         | `string`                             | Recommended                   | —                         | Content category for taxonomy (e.g., `"data-sources"`, `"dashboards"`)     |
| `author`           | `{ name?, team? }`                   | Recommended                   | —                         | Content author or owning team                                              |
| `startingLocation` | `string`                             | Recommended                   | `"/"`                     | URL path where the guide expects to begin execution                        |
| `depends`          | `DependencyList`                     | No                            | —                         | Hard prerequisites — must be completed first                               |
| `recommends`       | `DependencyList`                     | No                            | —                         | Soft prerequisites — recommended but not required                          |
| `suggests`         | `DependencyList`                     | No                            | —                         | Related content for enrichment                                             |
| `provides`         | `string[]`                           | No                            | —                         | Virtual capabilities this guide provides on completion                     |
| `conflicts`        | `string[]`                           | No                            | —                         | Packages this one conflicts with (mutually exclusive)                      |
| `replaces`         | `string[]`                           | No                            | —                         | Packages this one supersedes entirely                                      |
| `targeting`        | `{ match? }`                         | No                            | —                         | Advisory recommendation targeting (see [targeting](#targeting))            |
| `testEnvironment`  | `TestEnvironment`                    | Recommended                   | `{ tier: "cloud" }`       | Test infrastructure requirements (see [testEnvironment](#testenvironment)) |

---

## Dependency quick reference

Dependency fields use **conjunctive normal form** (CNF): the outer array is AND, inner arrays are OR. This maps to Debian's established syntax where commas separate AND-clauses and pipes separate OR-alternatives.

### AND/OR syntax

| JSON                     | Meaning                          | Debian equivalent |
| ------------------------ | -------------------------------- | ----------------- |
| `["A", "B"]`             | A **and** B                      | `A, B`            |
| `[["A", "B"]]`           | A **or** B                       | `A \| B`          |
| `[["A", "B"], "C"]`      | (A **or** B) **and** C           | `A \| B, C`       |
| `["A", ["B", "C"], "D"]` | A **and** (B **or** C) **and** D | `A, B \| C, D`    |

### Dependency field semantics

| Field        | Meaning                                                                       | Effect                                    |
| ------------ | ----------------------------------------------------------------------------- | ----------------------------------------- |
| `depends`    | Hard prerequisite — must be completed before this guide is accessible         | Blocks access                             |
| `recommends` | Soft prerequisite — most users benefit from completing first                  | Prompts but does not block                |
| `suggests`   | Related content that enhances understanding                                   | Informational only                        |
| `provides`   | Completing this guide satisfies any dependency on the named capability        | Enables virtual capabilities              |
| `conflicts`  | Cannot be meaningfully used together (deprecated content, mutually exclusive) | Schema-only — not enforced at runtime yet |
| `replaces`   | This guide supersedes another entirely                                        | Schema-only — not enforced at runtime yet |

### Virtual capabilities

Multiple guides can `provides` the same abstract capability. Any guide depending on that capability is satisfied when any provider is completed:

```json
// prometheus-grafana-101/manifest.json
{ "provides": ["datasource-configured"] }

// loki-grafana-101/manifest.json
{ "provides": ["datasource-configured"] }

// advanced-queries/manifest.json — either provider satisfies this
{ "depends": ["datasource-configured"] }
```

### Example: guide with hard and soft dependencies

```json
{
  "depends": ["welcome-to-grafana", ["prometheus-grafana-101", "loki-grafana-101"]],
  "recommends": ["first-dashboard"],
  "provides": ["advanced-queries-complete"]
}
```

This means: the user must complete `welcome-to-grafana` AND either `prometheus-grafana-101` or `loki-grafana-101`. Completing `first-dashboard` first is recommended but not required. On completion, the capability `advanced-queries-complete` is satisfied.

---

## Targeting

The `targeting.match` field follows the recommender's match expression grammar. It controls when the context engine recommends this guide. Expressions use combinators (`and`, `or`) over match predicates.

### Examples from bundled guides

**Single URL prefix:**

```json
{
  "targeting": {
    "match": { "urlPrefix": "/" }
  }
}
```

**Combined URL and platform:**

```json
{
  "targeting": {
    "match": {
      "and": [{ "urlPrefix": "/connections" }, { "targetPlatform": "oss" }]
    }
  }
}
```

The `match` field is loosely typed — the recommender owns match semantics. The schema accepts `Record<string, unknown>` to allow the grammar to evolve without schema changes.

---

## testEnvironment

The `testEnvironment` field declares what infrastructure a guide needs for Layer 4 E2E testing.

| Field         | Type       | Description                                                               |
| ------------- | ---------- | ------------------------------------------------------------------------- |
| `tier`        | `string`   | Environment tier: `"local"` (OSS/Docker), `"cloud"` (Grafana Cloud), etc. |
| `minVersion`  | `string`   | Minimum Grafana version (semver, e.g., `"12.2.0"`)                        |
| `datasets`    | `string[]` | Named datasets the environment must provision                             |
| `datasources` | `string[]` | Data source types the environment must have                               |
| `plugins`     | `string[]` | Plugin IDs the environment must have installed                            |
| `instance`    | `string`   | Specific Grafana instance hostname (e.g., `play.grafana.org`)             |

When `testEnvironment` is omitted, the default is `{ tier: "cloud" }`.

### Example

```json
{
  "testEnvironment": {
    "tier": "local",
    "minVersion": "12.2.0"
  }
}
```

---

## Repository index

Each repository publishes a compiled `repository.json` that maps bare package IDs to filesystem paths and denormalized manifest metadata. It is generated by `pathfinder-cli build-repository` — never hand-edited.

### What repository.json contains

Each entry maps a bare package ID to a `RepositoryEntry` with the package's path, type, and all denormalized manifest metadata:

```json
{
  "prometheus-grafana-101": {
    "path": "prometheus-grafana-101/",
    "type": "guide",
    "title": "Prometheus and Grafana",
    "description": "Learn to use Prometheus and Grafana...",
    "category": "data-sources",
    "author": { "name": "Interactive Learning", "team": "Grafana Developer Advocacy" },
    "startingLocation": "/connections",
    "recommends": ["welcome-to-grafana"],
    "provides": ["prometheus-configured"],
    "targeting": { "match": { "and": [{ "urlPrefix": "/connections" }, { "targetPlatform": "oss" }] } },
    "testEnvironment": { "tier": "local", "minVersion": "12.2.0" }
  }
}
```

### Publication strategies

There are two strategies, chosen based on how frequently the repository's content changes:

| Strategy               | When to use                                                  | How it works                                                                              |
| ---------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| **Committed lockfile** | Low-velocity repos (e.g., bundled guides in the plugin repo) | `repository.json` is committed to git; CI verifies freshness by rebuilding and diffing    |
| **CI-generated**       | High-velocity repos (e.g., `interactive-tutorials`)          | `repository.json` is generated as a CI build artifact and published to CDN, not committed |

### Setting up the freshness check (committed lockfile)

For repositories that commit `repository.json`, add a CI step that rebuilds and diffs:

```bash
# Rebuild and compare — fails if committed file is stale
node dist/cli/cli/index.js build-repository src/bundled-interactives -o /tmp/repository-check.json
diff -q src/bundled-interactives/repository.json /tmp/repository-check.json
```

This pattern is already in use in this repository's CI (the `validate-packages` job in `.github/workflows/ci.yml`).

### Setting up CI-generated publication

For repositories that don't commit `repository.json`:

```bash
# Build and publish as part of CI
node dist/cli/cli/index.js build-repository packages/ -o dist/repository.json
# Upload dist/repository.json to CDN alongside guide content
```

---

## Copy-paste templates

### Minimal guide

The simplest possible package — just content, no manifest:

**`my-guide/content.json`**

```json
{
  "schemaVersion": "1.1.0",
  "id": "my-guide",
  "title": "My guide",
  "blocks": [
    {
      "type": "text",
      "body": "Welcome to this guide."
    }
  ]
}
```

### Guide with dependencies

A guide with metadata, dependencies, and targeting:

**`my-guide/content.json`**

```json
{
  "schemaVersion": "1.1.0",
  "id": "my-guide",
  "title": "Advanced alerting",
  "blocks": []
}
```

**`my-guide/manifest.json`**

```json
{
  "id": "my-guide",
  "type": "guide",
  "description": "Set up advanced alerting rules for your Grafana instance.",
  "category": "alerting",
  "author": { "name": "Your Name", "team": "Your Team" },
  "startingLocation": "/alerting",
  "depends": ["welcome-to-grafana"],
  "recommends": ["first-dashboard"],
  "provides": ["alerting-configured"],
  "targeting": {
    "match": { "urlPrefix": "/alerting" }
  },
  "testEnvironment": {
    "tier": "local",
    "minVersion": "12.2.0"
  }
}
```

### Path metapackage

A path composes multiple guides into an ordered sequence:

**`getting-started-path/content.json`**

```json
{
  "schemaVersion": "1.1.0",
  "id": "getting-started-path",
  "title": "Getting started with Grafana",
  "blocks": [
    {
      "type": "text",
      "body": "This learning path walks you through the basics of Grafana, from your first dashboard to monitoring with Prometheus."
    }
  ]
}
```

**`getting-started-path/manifest.json`**

```json
{
  "id": "getting-started-path",
  "type": "path",
  "description": "A guided learning path through the fundamentals of Grafana.",
  "category": "getting-started",
  "steps": ["welcome-to-grafana", "first-dashboard", "prometheus-grafana-101"]
}
```

---

## Worked example: converting a bare guide to a package

Suppose you have a single-file guide `prometheus-grafana-101.json`:

```json
{
  "schemaVersion": "1.0.0",
  "id": "prometheus-grafana-101",
  "title": "Prometheus and Grafana",
  "blocks": [{ "type": "text", "body": "..." }]
}
```

**Step 1: Create the directory**

```
prometheus-grafana-101/
```

**Step 2: Move the guide content**

Rename the file to `content.json` inside the directory. Remove any metadata fields that belong in the manifest (the content file should only have `schemaVersion`, `id`, `title`, `blocks`):

**`prometheus-grafana-101/content.json`**

```json
{
  "schemaVersion": "1.1.0",
  "id": "prometheus-grafana-101",
  "title": "Prometheus and Grafana",
  "blocks": [{ "type": "text", "body": "..." }]
}
```

**Step 3: Create the manifest**

Create `manifest.json` with the package's metadata, dependencies, and targeting. The `id` must match `content.json`:

**`prometheus-grafana-101/manifest.json`**

```json
{
  "id": "prometheus-grafana-101",
  "type": "guide",
  "repository": "bundled",
  "description": "Learn to use Prometheus and Grafana to monitor your infrastructure.",
  "category": "data-sources",
  "author": {
    "name": "Interactive Learning",
    "team": "Grafana Developer Advocacy"
  },
  "startingLocation": "/connections",
  "recommends": ["welcome-to-grafana"],
  "provides": ["prometheus-configured"],
  "targeting": {
    "match": {
      "and": [{ "urlPrefix": "/connections" }, { "targetPlatform": "oss" }]
    }
  },
  "testEnvironment": {
    "tier": "local",
    "minVersion": "12.2.0"
  }
}
```

**Step 4: Validate**

```bash
npm run build:cli
node dist/cli/cli/index.js validate --package prometheus-grafana-101
```

**Step 5: Rebuild the repository index**

```bash
node dist/cli/cli/index.js build-repository src/bundled-interactives -o src/bundled-interactives/repository.json
```

---

## Further reading

- [JSON guide format](./interactive-examples/json-guide-format.md) — block-level schema reference
- [CLI tools](./CLI_TOOLS.md) — `validate`, `build-repository`, `build-graph` command reference
- [Authoring interactive guides](./interactive-examples/authoring-interactive-journeys.md) — starting point for all guide authoring
- [Pathfinder package design](../design/PATHFINDER-PACKAGE-DESIGN.md) — the full design spec (for design review, not day-to-day authoring)
- [Dependencies design](../design/package/dependencies.md) — deep dive on the dependency model
