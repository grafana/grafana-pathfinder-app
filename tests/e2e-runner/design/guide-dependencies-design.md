# Guide Dependencies Design

This document specifies the guide-level metadata schema for expressing dependencies, capabilities, and test environment requirements. This metadata enables Layer 4 (Live Environment Validation) by allowing guides to declare what they need and what they provide.

## Overview

Guides are modeled after **Debian packages**: they can declare what they **require** (prerequisites) and what they **provide** (capabilities). This enables:

- **Test environment routing**: Direct guides to appropriate test environments based on their requirements
- **Dataset dependencies**: Express what pre-seeded data a guide expects
- **Learning path ordering**: Define prerequisite relationships between guides
- **Capability abstraction**: Allow multiple guides to satisfy the same abstract requirement

## Design Principles

1. **Guide-level only**: This metadata structure exists only at the guide root level, not on individual blocks. Block-level `requirements` continue to use the existing string array format.

2. **Rich structure over strings**: Unlike block-level requirements (which use strings like `"has-datasource:prometheus"`), guide-level dependencies use a structured object for expressiveness and validation.

3. **Debian-inspired semantics**: Borrow proven concepts from package management (requires, provides, suggests, conflicts).

4. **Test-environment awareness**: Include fields specifically for test infrastructure routing.

## Schema Specification

### Top-Level Guide Structure

```typescript
interface JsonGuide {
  schemaVersion?: string;
  id: string;
  title: string;

  /** Guide-level dependency metadata (NEW) */
  dependencies?: GuideDependencies;

  blocks: JsonBlock[];
}
```

### GuideDependencies Interface

```typescript
interface GuideDependencies {
  /**
   * Hard prerequisites - ALL must be satisfied before the guide is accessible.
   * Can reference guide IDs, capabilities, or environment conditions.
   */
  requires?: string[];

  /**
   * Alternative prerequisites - AT LEAST ONE must be satisfied.
   * Useful when multiple guides teach equivalent foundational concepts.
   */
  requiresAny?: string[];

  /**
   * Capabilities this guide provides when completed.
   * Other guides can depend on these via `requires`.
   * The guide's `id` is implicitly provided upon completion.
   */
  provides?: string[];

  /**
   * Related guides that complement this one (informational, not gating).
   * Used for "recommended next steps" UI and learning path suggestions.
   */
  suggests?: string[];

  /**
   * Mutually exclusive guides or conditions.
   * If any conflict is satisfied, this guide should be hidden or show a warning.
   */
  conflicts?: string[];

  /**
   * Test environment requirements - used by E2E runner for routing.
   */
  testEnvironment?: TestEnvironmentRequirements;
}
```

### TestEnvironmentRequirements Interface

```typescript
interface TestEnvironmentRequirements {
  /**
   * Which test tier can run this guide.
   * - "local": Can run against local Docker Grafana (default)
   * - "managed": Requires a managed test environment with specific setup
   * - "cloud": Requires Grafana Cloud environment
   */
  tier?: 'local' | 'managed' | 'cloud';

  /**
   * Minimum Grafana version required.
   * Guides will be skipped on environments below this version.
   */
  minVersion?: string;

  /**
   * Required datasets that must be pre-seeded in the test environment.
   * See "Available Datasets" section for valid values.
   */
  datasets?: string[];

  /**
   * Required plugins that must be installed.
   * Uses Grafana plugin IDs (e.g., "grafana-lokiexplore-app").
   */
  plugins?: string[];

  /**
   * Required data sources that must be configured.
   * Can specify by type (e.g., "prometheus") or name.
   */
  datasources?: string[];

  /**
   * Feature toggles that must be enabled.
   */
  featureToggles?: string[];
}
```

## Dependency Reference Syntax

The `requires`, `requiresAny`, `provides`, `suggests`, and `conflicts` arrays use a unified reference syntax:

| Pattern           | Meaning                                            | Example                     |
| ----------------- | -------------------------------------------------- | --------------------------- |
| `guide:{id}`      | Another guide must be completed                    | `guide:intro-to-alerting`   |
| `cap:{name}`      | An abstract capability must be satisfied           | `cap:datasource-configured` |
| `env:{condition}` | Environment condition (same as block requirements) | `env:min-version:11.0.0`    |

### Examples

```json
{
  "requires": ["guide:intro-to-alerting", "cap:prometheus-basics", "env:min-version:11.0.0"]
}
```

**Shorthand**: For convenience, bare strings without a prefix are treated as guide references:

```json
{
  "requires": ["intro-to-alerting"]
}
// Equivalent to:
{
  "requires": ["guide:intro-to-alerting"]
}
```

## Capability Resolution

When a guide is completed:

1. `guide:{id}` becomes satisfied (implicit)
2. All items in `provides` become satisfied capabilities
3. Capabilities persist to user storage (localStorage in browser, mocked in tests)

Multiple guides can provide the same capability, enabling flexible learning paths:

```json
// prometheus-quickstart.json
{
  "id": "prometheus-quickstart",
  "dependencies": {
    "provides": ["cap:datasource-ready", "cap:metrics-available"]
  }
}

// loki-quickstart.json
{
  "id": "loki-quickstart",
  "dependencies": {
    "provides": ["cap:datasource-ready", "cap:logs-available"]
  }
}

// explore-your-data.json
{
  "id": "explore-your-data",
  "dependencies": {
    "requires": ["cap:datasource-ready"]
    // Satisfied by EITHER prometheus-quickstart OR loki-quickstart
  }
}
```

## Complete Example

```json
{
  "schemaVersion": "1.0.0",
  "id": "advanced-alerting-techniques",
  "title": "Advanced alerting techniques",
  "dependencies": {
    "requires": [
      "intro-to-alerting",
      "cap:prometheus-basics"
    ],
    "requiresAny": [
      "prometheus-quickstart",
      "mimir-quickstart"
    ],
    "provides": [
      "cap:multi-condition-alerts",
      "cap:notification-policies"
    ],
    "suggests": [
      "oncall-integration",
      "alert-silencing"
    ],
    "conflicts": [
      "deprecated-alerting-v9"
    ],
    "testEnvironment": {
      "tier": "managed",
      "minVersion": "11.0.0",
      "datasets": ["prometheus-sample-metrics"],
      "datasources": ["prometheus"],
      "plugins": ["grafana-oncall-app"]
    }
  },
  "blocks": [...]
}
```

## Available Datasets

The managed test environments provide these pre-seeded datasets:

| Dataset ID                  | Description                 | Contains                                                |
| --------------------------- | --------------------------- | ------------------------------------------------------- |
| `prometheus-sample-metrics` | Standard Prometheus metrics | Node exporter, container metrics, synthetic app metrics |
| `loki-sample-logs`          | Sample log data             | Application logs, system logs, structured JSON logs     |
| `tempo-sample-traces`       | Distributed traces          | Multi-service trace data with spans                     |
| `testdata`                  | Grafana TestData datasource | Random walk, CSV, annotations                           |

_Note: This list will expand as managed environments are provisioned._

## Test Environment Routing

The E2E test runner uses `testEnvironment` to determine where to run each guide:

```
┌─────────────────────────────────────────────────────────────┐
│                    Guide Dependencies                        │
│                    testEnvironment field                     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Test Router                               │
│                                                              │
│  tier: "local"    → Run against local Docker Grafana        │
│  tier: "managed"  → Route to managed test environment       │
│  tier: "cloud"    → Route to Grafana Cloud staging          │
│  (unspecified)    → Default to "local"                      │
└─────────────────────────────────────────────────────────────┘
```

Guides without a `dependencies` field or without `testEnvironment` default to `tier: "local"`.

## Validation

Layer 1 (Static Analysis) validates guide dependencies:

1. **Schema validation**: Ensure `dependencies` object matches the schema
2. **Reference validation**: Warn if referenced guides don't exist in the corpus
3. **Cycle detection**: Error if circular dependencies exist
4. **Dataset validation**: Warn if unknown dataset IDs are referenced

## Relationship to Block-Level Requirements

| Concern        | Block-Level `requirements`            | Guide-Level `dependencies`                         |
| -------------- | ------------------------------------- | -------------------------------------------------- |
| **Scope**      | Single step/block                     | Entire guide                                       |
| **Purpose**    | Runtime gating ("can execute now?")   | Structural metadata ("what does this guide need?") |
| **Format**     | String array (`["has-datasource:X"]`) | Structured object                                  |
| **Evaluation** | Real-time in browser                  | Pre-flight in test runner, UI filtering            |
| **Persisted**  | No                                    | Capabilities persist on completion                 |

## Implementation Status

| Component              | Status                                  |
| ---------------------- | --------------------------------------- |
| Schema types           | ⏳ Future                               |
| Zod validation         | ⏳ Future                               |
| Capability storage     | ⏳ Future                               |
| E2E router integration | ⏳ Future (requires Layer 3 completion) |
| Static validation      | ⏳ Future                               |

## Related Documents

- [TESTING_STRATEGY.md](../../TESTING_STRATEGY.md) - Overall testing vision and Layer 4 context
- [E2E Test Runner Design](./e2e-test-runner-design.md) - Layer 3 architecture
- [Implementation Milestones](./MILESTONES.md) - Layer 3 implementation tasks
