# Dependencies

> Part of the [Pathfinder package design](../PATHFINDER-PACKAGE-DESIGN.md).
> See also: [Identity and resolution](./identity-and-resolution.md) · [Learning journeys](./learning-journeys.md)

---

Dependency fields live flat at the top level of `manifest.json`, alongside metadata fields. They express structural relationships between guides — prerequisites, recommendations, capabilities, and conflicts.

## Fields

Dependency fields live flat at the top level of `manifest.json`, alongside metadata and targeting. Each dependency field that accepts guide references (`depends`, `recommends`, `suggests`) uses the `DependencyList` type, which supports AND/OR logic. Fields that declare capabilities or relationships (`provides`, `conflicts`, `replaces`) use plain `string[]`.

```typescript
/**
 * A dependency clause: either a single reference (string)
 * or an OR-group of alternatives (string[]).
 */
type DependencyClause = string | string[];

/**
 * A list of dependency clauses combined with AND.
 * Each clause is either a bare string (single reference)
 * or an array of strings (OR-group of alternatives).
 *
 * Follows Debian's dependency syntax in JSON form:
 * - Debian: `A | B, C`  (comma = AND, pipe = OR)
 * - JSON:   `[["A", "B"], "C"]`
 */
type DependencyList = DependencyClause[];
```

All references use bare globally-unique IDs. See [identity model](./identity-and-resolution.md).

## AND/OR semantics

Dependency lists use **conjunctive normal form** (CNF): the outer array is AND, inner arrays are OR. This maps directly to Debian's established syntax where commas separate AND-clauses and pipes separate OR-alternatives.

| JSON                     | Meaning                          | Debian equivalent |
| ------------------------ | -------------------------------- | ----------------- |
| `["A", "B"]`             | A **and** B                      | `A, B`            |
| `[["A", "B"]]`           | A **or** B                       | `A \| B`          |
| `[["A", "B"], "C"]`      | (A **or** B) **and** C           | `A \| B, C`       |
| `["A", ["B", "C"], "D"]` | A **and** (B **or** C) **and** D | `A, B \| C, D`    |

**Example** — a guide that requires completion of `welcome-to-grafana` AND either `prometheus-grafana-101` or `loki-grafana-101`:

```json
{
  "depends": ["welcome-to-grafana", ["prometheus-grafana-101", "loki-grafana-101"]]
}
```

This complements virtual capabilities (`provides`): OR-groups express direct alternatives between concrete guides, while `provides` expresses abstract capability satisfaction. Both mechanisms coexist.

## Dependency semantics

These follow the [Debian package dependency model](https://www.debian.org/doc/manuals/debian-faq/pkg-basics.en.html#depends):

| Field        | Semantics                                                                                             | MVP enforcement | Example                                   |
| ------------ | ----------------------------------------------------------------------------------------------------- | --------------- | ----------------------------------------- |
| `depends`    | Guide B **must** be completed before A is accessible. Hard gate.                                      | Yes             | `"depends": ["intro-to-alerting"]`        |
| `recommends` | Most users benefit from completing B first, but it's not required. System may prompt but won't block. | Yes             | `"recommends": ["prometheus-quickstart"]` |
| `suggests`   | B contains related content that enhances understanding of A. Informational only.                      | Yes             | `"suggests": ["oncall-integration"]`      |
| `provides`   | Completing A satisfies any dependency on capability X. Enables virtual capabilities.                  | Yes             | `"provides": ["datasource-configured"]`   |
| `conflicts`  | A and B cannot be meaningfully used together (deprecated content, mutually exclusive environments).   | Deferred        | `"conflicts": ["deprecated-alerting-v9"]` |
| `replaces`   | A supersedes B entirely. Completion of A may mark B as unnecessary.                                   | Deferred        | `"replaces": ["alerting-techniques-v10"]` |

### Deferred enforcement: `conflicts` and `replaces`

The `conflicts` and `replaces` fields are included in the schema from Phase 1 for strict adherence to the Debian dependency vocabulary. Content authors can declare these relationships immediately, and the graph builder will represent them as edges in the dependency graph. However, **no runtime system enforces these fields in the MVP**. Specifically:

- **`conflicts`**: The graph lint validates symmetric declarations (warns if A conflicts with B but B doesn't conflict with A). The graph command visualizes conflict edges. But neither the recommender nor the plugin UI acts on conflict declarations — a user can complete both conflicting guides without restriction.
- **`replaces`**: The graph lint and graph command represent replacement edges. But no system hides replaced guides, transfers completion state, or suppresses replaced content from recommendations.

This is a deliberate design call: the fields exist so that content authors can declare the relationships as they author packages, building up a correct dependency graph from day one. Enforcement behavior (recommender suppression, UI warnings, completion state migration) will be defined when a concrete consumer needs it. Defining enforcement without a consumer would risk specifying the wrong behavior.

In Debian, `Conflicts` triggers hard mutual exclusion and `Replaces` (with `Breaks`) triggers automatic package removal during upgrades. The learning content domain does not have direct analogues to these mechanics — you cannot "uninstall" a completed guide. The future enforcement design will need to define what conflict and replacement mean for completed content, likely as recommender-level signals rather than hard system constraints.

## Virtual capabilities

The `provides` field enables flexible learning paths. Multiple guides can provide the same abstract capability:

- `prometheus-grafana-101` provides `"datasource-configured"`
- `loki-grafana-101` provides `"datasource-configured"`
- `first-dashboard` depends on `"datasource-configured"` — either guide satisfies it

## Relationship to block-level requirements

| Concern         | Block-level `requirements`                     | Guide-level dependencies                                |
| --------------- | ---------------------------------------------- | ------------------------------------------------------- |
| **Scope**       | Single step/block                              | Entire guide                                            |
| **Purpose**     | Runtime gating ("can this step execute now?")  | Structural metadata ("what does this guide need?")      |
| **Format**      | String array (`["has-datasource:prometheus"]`) | Flat fields (`depends`, `recommends`, etc.) with CNF OR |
| **Evaluation**  | Real-time in browser during guide execution    | Pre-flight by test runner; UI filtering                 |
| **Persistence** | No                                             | Capabilities persist on guide completion                |

## Relationship to learning paths

Learning paths exist as **both** curated collections and dependency-derived structures:

- **Curated**: `paths.json` continues to define editorially curated learning paths with explicit ordering, badging, and presentation metadata. This is a human editorial product.
- **Derived**: The dependency graph formed by `depends`/`recommends`/`suggests` is a structural relationship that the recommender can exploit to compute on-the-fly learning paths based on user context and graph topology.

Both coexist. `paths.json` references guides by bare ID. The dependency graph is a parallel structure that enriches the recommender's understanding of content relationships.
