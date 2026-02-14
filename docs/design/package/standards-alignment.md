# Standards alignment and future-proofing

> Part of the [Pathfinder package design](../PATHFINDER-PACKAGE-DESIGN.md).
> See also: [Learning journeys](./learning-journeys.md) · [Dependencies](./dependencies.md) · [Decision log](./decision-log.md)

---

## Alignment with external formats

### Docs team learning journey YAML

The Grafana docs team expresses inter-guide relationships in a YAML format:

```yaml
- id: prom-data-source
  category: data-availability
  links:
    - to: metrics-drilldown
```

This maps naturally to the package model:

| YAML field   | Package equivalent           |
| ------------ | ---------------------------- |
| `id`         | `id`                         |
| `category`   | `category`                   |
| `links[].to` | `suggests` (or `recommends`) |

The `links.to` relationships are soft recommendations — "completing prom-data-source enables you to better pursue metrics-drilldown." These are `suggests` or `recommends` in Debian vocabulary, not hard `depends`.

The `category` field aligns directly. The documented convention uses the same taxonomy: `"data-availability"`, `"query-visualize"`, `"take-action"`.

The docs team's `*-lj` directory structure — a top-level directory containing ordered sub-directories of guides — maps directly to the [journey metapackage model](./learning-journeys.md). The top-level directory becomes the journey package with a `manifest.json` declaring `type: "journey"` and a `steps` array. Each sub-directory is a step package.

### Dublin Core / IEEE LOM

Phase 1 metadata field names are chosen to align with established standards where applicable:

| Package field         | Dublin Core      | IEEE LOM                          | Notes                                           |
| --------------------- | ---------------- | --------------------------------- | ----------------------------------------------- |
| `description`         | `dc:description` | `general.description`             | Direct alignment                                |
| `language`            | `dc:language`    | `general.language`                | BCP 47 tag; defaults to `"en"`                  |
| `author.name`         | `dc:creator`     | `lifeCycle.contribute.entity`     | Simplified structure                            |
| `difficulty`\*        | —                | `educational.difficulty`          | Deferred to Phase 2+; enum subset of LOM values |
| `estimatedDuration`\* | —                | `educational.typicalLearningTime` | Deferred to Phase 2+; format to be vetted       |

\* Deferred fields — not in Phase 1, but names are vetted against standards now to avoid future renames.

### SCORM

The package format is designed to be the **output target** for a future SCORM import pipeline. The two-file model aligns naturally with SCORM's separation of `imsmanifest.xml` (metadata) from content files:

| SCORM concept              | Package equivalent                                                                                                                      |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Package (ZIP)              | Package directory                                                                                                                       |
| `imsmanifest.xml` metadata | `manifest.json`                                                                                                                         |
| Organization tree          | [Journey metapackage](./learning-journeys.md) with `steps` array                                                                        |
| Item (with sequencing)     | Step ordering via `steps` array                                                                                                         |
| SCO (interactive content)  | Step package — `content.json` with content blocks                                                                                       |
| Asset (static content)     | `assets/` directory within package                                                                                                      |
| Prerequisites              | `manifest.json` → `depends`                                                                                                             |
| Sequencing (forward-only)  | Advisory `steps` ordering (see [step ordering and completion semantics](./learning-journeys.md#step-ordering-and-completion-semantics)) |

The SCORM import pipeline writes two files per guide: `content.json` (converted from SCO HTML) and `manifest.json` (converted from `imsmanifest.xml` metadata). This separation means the importer naturally produces the correct package structure. For multi-SCO courses, the importer produces a journey metapackage with step packages — the same structure used for natively authored learning journeys.

SCORM-specific fields (`source`, `rights`, `educationalContext`) are deferred to the SCORM implementation phase but will be backward-compatible flat additions to `manifest.json`.

---

## Future-proofing

### Extensible flat namespace

Metadata fields live flat at the top level of `manifest.json`. Adding new optional fields is always backward-compatible. The Zod schema uses `.passthrough()` for forward compatibility — unknown fields in newer packages generate warnings but don't fail validation. See [namespace collision note](../PATHFINDER-PACKAGE-DESIGN.md#namespace-collision-note) for why flat structure is safe given the bounded, standards-aligned field inventory.

### The `source` provenance pattern (future)

When SCORM import arrives, `manifest.json` gains a flat `source` field:

```json
{
  "id": "acme-sales-training",
  "source": {
    "format": "SCORM",
    "version": "1.2",
    "importedAt": "2026-02-07T00:00:00Z",
    "originalIdentifier": "com.acme.sales-training",
    "importToolVersion": "1.0.0"
  }
}
```

This pattern generalizes to any import source (xAPI, QTI, custom formats). The `format` discriminator allows tooling to branch on provenance.

### The `type` discriminator (future)

The `type` field is introduced with `"guide"` and `"journey"` in [learning journeys](./learning-journeys.md). Journeys are the first use of this discriminator, establishing the composition pattern.

Future `type` values for SCORM extend the same pattern:

- `"course"`: SCORM course decomposition — a refinement of the journey concept with potentially stricter sequencing semantics (course → modules → guides)
- `"module"`: Grouping of related guides without strict ordering (section overview rendering)

Both future types will build on the metapackage and `steps` infrastructure established by journeys, not introduce parallel composition machinery. Default remains `"guide"` for all existing content.

### Test environment metadata (future)

A flat `testEnvironment` field will be added to `manifest.json` when Layer 4 E2E infrastructure is ready to consume it:

```json
{
  "id": "advanced-alerting",
  "testEnvironment": {
    "tier": "managed",
    "minVersion": "11.0.0",
    "datasets": ["prometheus-sample-metrics"],
    "datasources": ["prometheus"],
    "plugins": ["grafana-oncall-app"]
  }
}
```

### Schema versioning strategy

| Version | Scope                                                                                                                                  |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `1.0.0` | Current: single-file `content.json` with `id`, `title`, `blocks`, `schemaVersion`                                                      |
| `1.1.0` | Phase 1 packages: two-file model (`content.json` + `manifest.json`), `assets/` directory, `type` and `steps` for journeys              |
| `1.2.0` | Future: adds `source`, `keywords`, `difficulty`, `estimatedDuration`, `testEnvironment`; extends `type` with `"course"` and `"module"` |
| `2.0.0` | Reserved for breaking changes (field removal, semantic changes)                                                                        |

Any consumer can inspect `schemaVersion` and decide which fields to expect.

### CRD serialization readiness

The package format uses plain JSON with no Grafana-specific runtime dependencies. The CLI merges `content.json` and `manifest.json` into the logical `JsonGuide` type, which maps cleanly to Kubernetes Custom Resource Definitions:

```yaml
apiVersion: pathfinder.grafana.com/v1alpha1
kind: Guide
metadata:
  name: interactive-tutorials-prometheus-grafana-101
spec:
  # From content.json
  id: prometheus-grafana-101
  title: 'Prometheus & Grafana 101'
  blocks: [...]
  # From manifest.json (flat metadata and dependencies)
  repository: interactive-tutorials
  description: '...'
  language: en
  category: data-availability
  depends:
    - welcome-to-grafana
  targeting:
    match:
      and:
        - urlPrefixIn: ['/connections']
        - targetPlatform: oss
```

The CRD is a merged view — it does not reflect the file-level split. The split is an authoring concern; the CRD is a distribution and runtime concern.
