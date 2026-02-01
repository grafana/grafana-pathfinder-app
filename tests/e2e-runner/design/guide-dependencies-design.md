# Guide Dependencies Design

This document specifies the conceptual model for guide-level dependencies, capabilities, and test environment requirements. This metadata enables Layer 4 (Live Environment Validation) by allowing guides to declare what they need and what they provide.

## Overview

Guides are modeled after **Debian packages**: they can declare what they **require** (prerequisites) and what they **provide** (capabilities). This enables:

- **Test environment routing**: Direct guides to appropriate test environments based on their requirements
- **Dataset dependencies**: Express what pre-seeded data a guide expects
- **Learning path ordering**: Define prerequisite relationships between guides
- **Capability abstraction**: Allow multiple guides to satisfy the same abstract requirement

## The Debian Model

We adopt the proven dependency semantics from the [Debian package system](https://www.debian.org/doc/manuals/debian-faq/pkg-basics.en.html#depends). Debian's package management has refined these concepts over decades, and they map naturally to educational content dependencies.

### Dependency types

| Debian Term | Guide Field | Meaning for Guides |
|-------------|-------------|-------------------|
| **Depends** | `depends` | Guide A depends on Guide B if B **must be completed** before A is accessible. This is a hard prerequisite that gates access. |
| **Recommends** | `recommends` | Guide A recommends Guide B if most users would benefit from completing B first, but it's **not strictly required**. The system may prompt users but won't block access. |
| **Suggests** | `suggests` | Guide A suggests Guide B if B contains **related content that enhances** understanding of A. Purely informational; used for "you might also like" recommendations. |
| **Conflicts** | `conflicts` | Guide A conflicts with Guide B when both **cannot be meaningfully used together**. Typically used when a guide is deprecated in favor of another, or when guides target mutually exclusive environments (e.g., OSS-only vs. Cloud-only). |
| **Replaces** | `replaces` | Guide A replaces Guide B when A **supersedes B entirely**. Used for versioned content where a new guide completely obsoletes an older one. Completion of A may automatically mark B as unnecessary. |
| **Provides** | `provides` | Guide A provides capability X when completing A **satisfies any dependency on X**. This enables virtual capabilities where multiple different guides can satisfy the same abstract requirement. |

We omit Debian's `Breaks` field as it maps to runtime conflicts, which are less relevant for educational content.

### Virtual capabilities

The `provides` field enables a powerful pattern borrowed from Debian's "virtual packages." Multiple guides can provide the same abstract capability, allowing flexible learning paths:

- A guide teaching Prometheus setup and a guide teaching Loki setup might both `provide` a `datasource-configured` capability
- A downstream guide can `depend` on `datasource-configured` without caring which specific guide the user completed
- This enables branching learning paths while maintaining clear prerequisites

## Design Principles

1. **Guide-level only**: This dependency metadata exists only at the guide root level, not on individual blocks. Block-level `requirements` continue to use the existing string array format for runtime gating.

2. **Structured over strings**: Unlike block-level requirements (which use strings like `"has-datasource:prometheus"`), guide-level dependencies use a structured object for clarity and validation.

3. **Debian-inspired semantics**: We adopt Debian's proven dependency vocabulary rather than inventing new terminology.

4. **Test-environment awareness**: Include fields specifically for test infrastructure routing, enabling Layer 4 validation.

## Test Environment Requirements

> **Warning**: this section is notional, for design discussion; it may be over-specified, but
> indicates directionally the kind of concerns that the approach will need to consider.

Beyond inter-guide dependencies, guides may declare requirements for their test environment. This metadata enables the E2E runner to route guides to appropriate test infrastructure:

- **Tier**: Which environment can run this guide (`local`, `managed`, or `cloud`)
- **Minimum version**: The minimum Grafana version required
- **Datasets**: Pre-seeded data the guide expects (e.g., sample Prometheus metrics)
- **Plugins**: Grafana plugins that must be installed
- **Datasources**: Data sources that must be configured
- **Feature toggles**: Grafana feature flags that must be enabled

Guides without explicit test environment requirements default to `local` tier, meaning they can run against a standard local Grafana Docker instance.

## Example

A complete example showing a guide with dependencies:

```json
{
  "schemaVersion": "1.0.0",
  "id": "advanced-alerting-techniques",
  "title": "Advanced alerting techniques",
  "dependencies": {
    "depends": ["intro-to-alerting"],
    "recommends": ["prometheus-quickstart"],
    "suggests": ["oncall-integration", "alert-silencing"],
    "provides": ["multi-condition-alerts", "notification-policies"],
    "conflicts": ["deprecated-alerting-v9"],
    "replaces": ["alerting-techniques-v10"],
    "testEnvironment": {
      "tier": "managed",
      "minVersion": "11.0.0",
      "datasets": ["prometheus-sample-metrics"],
      "datasources": ["prometheus"],
      "plugins": ["grafana-oncall-app"]
    }
  },
  "blocks": []
}
```

## Relationship to Block-Level Requirements

| Concern | Block-Level `requirements` | Guide-Level `dependencies` |
|---------|---------------------------|---------------------------|
| **Scope** | Single step/block | Entire guide |
| **Purpose** | Runtime gating ("can this step execute now?") | Structural metadata ("what does this guide need to be useful?") |
| **Format** | String array (`["has-datasource:X"]`) | Structured object with named fields |
| **Evaluation** | Real-time in browser during guide execution | Pre-flight by test runner; UI filtering for recommendations |
| **Persistence** | No | Capabilities persist on guide completion |

## Related Documents

- [TESTING_STRATEGY.md](../../TESTING_STRATEGY.md) - Overall testing vision and Layer 4 context
- [E2E Test Runner Design](./e2e-test-runner-design.md) - Layer 3 architecture
- [Implementation Milestones](./MILESTONES.md) - Layer 3 implementation tasks
- [Debian Package Dependencies](https://www.debian.org/doc/manuals/debian-faq/pkg-basics.en.html#depends) - Authoritative reference for dependency semantics
