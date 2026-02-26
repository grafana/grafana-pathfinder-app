# Guide health telemetry

Continuous health monitoring for interactive guides. Detects guide breakage before users encounter it by running E2E validation sweeps and emitting structured telemetry.

## The problem

Pathfinder ships hundreds of interactive guides. Each guide depends on a stack of moving parts: Grafana UI selectors, navigation structure, plugin APIs, and product behavior. Any of these can change without warning, silently breaking guides. Today, breakage is discovered by users — or not at all.

The E2E CLI (`npx pathfinder-cli e2e`) validates individual guides against a live Grafana instance. It produces structured JSON reports with step-level results, error classifications, and failure artifacts. But it's a one-shot tool designed for CI and local development. There is no continuous monitoring, no telemetry pipeline, and no alerting when guides degrade.

## Design goals

1. **Detect guide breakage within 48 hours** of the change that caused it
2. **Produce actionable telemetry** — not just "guide failed," but which step, what classification, and where to find the diagnostic artifacts
3. **Keep the CLI simple** — the E2E CLI remains a single-guide execution engine; fleet management lives elsewhere
4. **Minimize operational complexity** — sequential sweeps, no parallelism, no custom orchestration frameworks

## Architecture

Two layers with a clean separation. The JSON report is the contract between them.

```
┌─────────────────────────────────────────────────────────────┐
│                   Orchestration layer                        │
│                  (cron job / scheduler)                      │
├─────────────────────────────────────────────────────────────┤
│  For each guide in the population:                          │
│    1. Start fresh Grafana container                         │
│    2. Create isolated run directory (UUID)                  │
│    3. Invoke CLI → produces JSON report + artifacts         │
│    4. Read JSON report                                      │
│    5. Emit metrics from report data                         │
│    6. On failure: upload artifacts to GCS                   │
│    7. On success: delete run directory                      │
│    8. Tear down container                                   │
└──────────────────────────┬──────────────────────────────────┘
                           │ JSON report (the contract)
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                      CLI (inner layer)                       │
│              npx pathfinder-cli e2e <guide>                  │
├─────────────────────────────────────────────────────────────┤
│  - Validates guide JSON                                     │
│  - Runs pre-flight checks (Grafana health, auth, plugin)    │
│  - Spawns Playwright, executes steps sequentially            │
│  - Captures artifacts on failure (screenshots, DOM)         │
│  - ALWAYS writes a JSON report, even on internal failure     │
│  - Exits with structured exit code                          │
└─────────────────────────────────────────────────────────────┘
```

### The split principle

The CLI is a **single-guide execution engine** that produces rich structured output. The orchestration layer is a **fleet manager** that schedules, isolates, and observes.

| Concern                                  | Owns it              | Rationale                               |
| ---------------------------------------- | -------------------- | --------------------------------------- |
| Guide execution                          | CLI                  | Already built and tested                |
| JSON report generation                   | CLI                  | Tightly coupled to execution data       |
| Artifact capture                         | CLI                  | Requires browser context                |
| Error boundary (always produce a report) | CLI                  | Only the CLI can catch its own failures |
| Scheduling and sweep management          | Orchestration        | Environment concern                     |
| Container lifecycle                      | Orchestration        | Infrastructure concern                  |
| Artifact upload and retention            | Orchestration        | Environment concern (GCS, S3, etc.)     |
| Metrics emission                         | Orchestration        | Derived from JSON reports               |
| Alerting                                 | Downstream (Grafana) | Standard observability stack            |

## CLI error boundary

The CLI **must always produce a JSON report**, regardless of how it fails. This is the foundational contract. If the orchestration layer cannot read a report, it is blind.

### Failure modes and report guarantees

Every observable failure path writes a report before exiting:

| Failure mode               | Current behavior             | Required behavior                                                      |
| -------------------------- | ---------------------------- | ---------------------------------------------------------------------- |
| Guide validation fails     | `process.exit(2)`, no report | Write report with `abortReason: "VALIDATION_FAILED"`                   |
| Grafana health check fails | `process.exit(3)`, no report | Write report with `abortReason: "GRAFANA_UNREACHABLE"`                 |
| Playwright spawn fails     | `process.exit(2)`, no report | Write report with `abortReason: "SPAWN_FAILED"`                        |
| Playwright crash/segfault  | No results file              | Write partial report from whatever data is available                   |
| Unhandled exception        | Uncaught error, no report    | Top-level try/catch writes report with `abortReason: "INTERNAL_ERROR"` |
| Step execution failure     | Report written (existing)    | No change needed                                                       |
| Auth expiry mid-test       | Report written (existing)    | No change needed                                                       |

### Implementation approach

A top-level try/catch wraps the entire `e2eCommand` action handler. Every catch branch writes a valid `E2ETestReport` with zero steps and an appropriate `abortReason` before calling `process.exit()`. The report schema gains new abort reason values for pre-execution failures.

### The SIGKILL edge case

The CLI cannot intercept `SIGKILL`, `OOM-kill`, or kernel-level termination. These are OS-level signals that bypass all userspace handlers. The orchestration layer must handle one degenerate case: **if the CLI exits and no report file exists, synthesize a minimal infrastructure failure record from the exit code.** This should be rare — the error boundary covers everything else.

## Isolation model

Each guide runs against a **fresh Grafana container**. This provides strong isolation at the cost of startup time.

### Why container-level isolation

Some guides mutate Grafana state — creating dashboards, data sources, folders, or other resources. Browser-level cleanup (clearing localStorage, cookies, navigating to a clean page) is insufficient for these guides. Container-level isolation eliminates the entire category of cross-guide state pollution.

### The timing trade-off

Container startup adds 10-30 seconds per guide. For hundreds of guides, a full sweep takes hours. This is acceptable — the detection target is sub-48-hours, not sub-minute. Sequential sweeps with container isolation are simple, correct, and sufficient for the foreseeable guide population.

### Per-guide execution flow

```
1. docker run grafana/grafana → fresh instance
2. Wait for /api/health → healthy
3. mkdir /runs/<uuid>
4. npx pathfinder-cli e2e <guide> \
     --grafana-url http://localhost:<port> \
     --output /runs/<uuid>/report.json \
     --artifacts /runs/<uuid>/artifacts \
     --always-screenshot
5. Read /runs/<uuid>/report.json
6. If failed → upload /runs/<uuid>/ to GCS
   If passed → rm -rf /runs/<uuid>/
7. docker stop + rm
8. Emit metrics
```

## Metrics strategy

The orchestration layer reads JSON reports and emits metrics. The CLI does not push metrics or know about the telemetry backend.

### Why orchestration-side emission

The CLI is a developer tool. Adding push-based telemetry would create a mode split — "am I a developer tool or a monitoring agent?" — that accumulates complexity. The JSON report already contains everything needed for metric extraction: step-level results with durations, classifications, skip reasons, artifact paths, and abort information.

### Metric dimensions from the JSON report

The `E2ETestReport` and `MultiGuideReport` schemas provide these dimensions:

| Dimension            | Source in report                                       | Example values                           |
| -------------------- | ------------------------------------------------------ | ---------------------------------------- |
| Guide ID             | `guide.id`                                             | `welcome-to-grafana`, `loki-grafana-101` |
| Pass/fail            | `summary.mandatoryFailed === 0`                        | `true`, `false`                          |
| Step count by status | `summary.passed`, `.failed`, `.skipped`, `.notReached` | `8`, `1`, `2`, `0`                       |
| Step duration        | `steps[].duration`                                     | `1234` (ms)                              |
| Error classification | `steps[].classification`                               | `infrastructure`, `unknown`              |
| Abort reason         | `abortReason`                                          | `AUTH_EXPIRED`, `GRAFANA_UNREACHABLE`    |
| Run ID               | Generated by orchestration layer                       | UUID, matches artifact directory name    |

### MVP metrics

| Metric                              | Type            | Labels               | Purpose                          |
| ----------------------------------- | --------------- | -------------------- | -------------------------------- |
| `guide_health_run_result`           | Gauge (0/1)     | `guide_id`, `run_id` | Per-guide pass/fail              |
| `guide_health_run_duration_seconds` | Gauge           | `guide_id`           | Total guide execution time       |
| `guide_health_steps_total`          | Gauge           | `guide_id`, `status` | Step counts by status            |
| `guide_health_abort_total`          | Counter         | `guide_id`, `reason` | Abort events by reason           |
| `guide_health_artifact_url`         | Info/annotation | `guide_id`, `run_id` | Link to GCS artifacts on failure |

### Nice-to-have operational metrics

| Metric                                | Type  | Purpose                           |
| ------------------------------------- | ----- | --------------------------------- |
| `guide_health_sweep_duration_seconds` | Gauge | Total sweep wall time             |
| `guide_health_sweep_guide_current`    | Info  | Which guide is currently running  |
| `guide_health_sweep_progress`         | Gauge | Guides completed / total in sweep |

### Timing and histograms

Native histograms for per-step latency distributions are **out of scope for MVP**. The JSON report includes `durationMs` per step, which the orchestration layer can emit as gauge metrics. This is sufficient for detecting gross regressions (step took 30 seconds instead of 2) without the complexity of histogram configuration and bucket tuning. Histograms can be added later if trend analysis becomes a priority.

## Artifact lifecycle

Artifacts are diagnostic leave-behinds for failed guides. They enable humans to quickly understand why a guide broke without re-running it.

### What gets captured

The CLI captures artifacts for every step when `--always-screenshot` is enabled:

| Artifact               | Format | When captured |
| ---------------------- | ------ | ------------- |
| Screenshot (post-step) | PNG    | Every step    |
| Screenshot (pre-step)  | PNG    | Failed steps  |
| DOM snapshot           | HTML   | Failed steps  |
| Console errors         | JSON   | Failed steps  |

### Upload policy

| Guide result | Action                             | Rationale                                       |
| ------------ | ---------------------------------- | ----------------------------------------------- |
| Passed       | Delete run directory               | No diagnostic value; avoid storage accumulation |
| Failed       | Upload entire run directory to GCS | Full debugging context for triage               |

### Storage and retention

Artifacts are uploaded to a GCS bucket with a **30-day lifecycle policy** for automatic deletion. This eliminates the need for manual cleanup or storage monitoring.

```
gs://pathfinder-guide-health/
  └── runs/
      └── <uuid>/
          ├── report.json
          └── artifacts/
              ├── step-1-success.png
              ├── step-3-failure.png
              ├── step-3-pre-failure.png
              ├── step-3-dom.html
              └── step-3-console.json
```

### Linking artifacts to metrics

The orchestration layer emits a `run_id` label on failure metrics. This UUID matches the directory name in GCS. From a Grafana alert, a human can construct the artifact URL: `gs://pathfinder-guide-health/runs/<run_id>/`. Annotations or exemplars on dashboards can link directly.

## Alerting

Alerting is handled by standard Grafana alerting rules on the emitted metrics. The monitoring system does not implement its own alerting.

### Example alert rules

| Alert                    | Condition                                                                 | Severity |
| ------------------------ | ------------------------------------------------------------------------- | -------- |
| Guide failure            | `guide_health_run_result == 0` for any guide                              | Warning  |
| Persistent guide failure | `guide_health_run_result == 0` for same guide across 2 consecutive sweeps | Critical |
| Sweep stall              | `guide_health_sweep_duration_seconds` exceeds 2x historical average       | Warning  |
| Infrastructure failure   | `guide_health_abort_total{reason="GRAFANA_UNREACHABLE"}` increases        | Critical |

## Relationship to existing systems

### E2E CLI (`src/cli/commands/e2e.ts`)

The CLI is the foundation. This design extends it with the error boundary contract but does not change its core execution model. The CLI remains usable as a standalone developer tool.

### E2E test runner design (`docs/design/e2e-test-runner-design.md`)

The test runner design describes how individual guides are validated. This design describes how to run that validation continuously across a fleet of guides and observe the results.

### Faro integration (`src/lib/faro.ts`)

Faro provides frontend observability for Grafana Cloud users. Guide health telemetry is backend/infrastructure observability — different concern, different pipeline. No overlap.

### Guide metadata (separate epic)

A separate epic is adding per-guide metadata (mutation profile, dependencies, platform requirements). When available, the orchestration layer can use this metadata for smarter scheduling, targeted cleanup, or environment selection. This design does not depend on that metadata — it treats all guides uniformly with container-level isolation.

## Design decisions

| Decision                  | Choice                                  | Rationale                                                      |
| ------------------------- | --------------------------------------- | -------------------------------------------------------------- |
| Metrics emission location | Orchestration layer (from JSON reports) | Keeps CLI simple and environment-agnostic                      |
| Isolation model           | Fresh Grafana container per guide       | Eliminates cross-guide state pollution; timing cost acceptable |
| Detection latency target  | Sub-48-hours                            | Sequential sweeps of hundreds of guides are sufficient         |
| Parallelism               | None (sequential sweeps)                | Not needed; premature optimization adds operational complexity |
| Artifact retention        | 30-day GCS lifecycle                    | Automatic cleanup, no operational burden                       |
| Error boundary            | CLI always writes a report              | Single communication contract between layers                   |
| Artifact upload trigger   | Failure only                            | Passed guides have no diagnostic value                         |

## Out of scope

| Item                                                         | Reason                                          |
| ------------------------------------------------------------ | ----------------------------------------------- |
| Native histograms / latency analytics                        | Not needed for MVP breakage detection           |
| Parallel guide execution                                     | Sequential sweeps meet the 48-hour target       |
| Prioritized scheduling (e.g., recently changed guides first) | Adds complexity without clear MVP value         |
| Guide-level reset declarations (mutation profiles)           | Covered by separate guide metadata epic         |
| CLI-side metrics emission                                    | Orchestration-side emission is cleaner          |
| Visual regression testing (screenshot diffing)               | Different problem; potential future enhancement |
| Multi-environment testing (different Grafana versions)       | Future concern as guide population grows        |

## Risks

| Risk                                                 | Likelihood | Impact                                                | Mitigation                                                     |
| ---------------------------------------------------- | ---------- | ----------------------------------------------------- | -------------------------------------------------------------- |
| Container startup time makes sweeps too slow         | Medium     | Sweep duration exceeds 48h for large populations      | Monitor sweep duration; add parallelism only when needed       |
| Grafana container images change, breaking test setup | Low        | All guides fail simultaneously (infrastructure noise) | Alert on >50% guide failure rate as infrastructure signal      |
| GCS artifact storage costs grow unexpectedly         | Low        | Budget impact                                         | 30-day lifecycle policy caps accumulation; monitor bucket size |
| CLI error boundary misses an edge case               | Medium     | Orchestration layer sees missing report               | Fallback: synthesize minimal record from exit code; fix CLI    |
| Guide population outgrows sequential sweep model     | Medium     | Detection latency exceeds target                      | Partition guides across multiple cron jobs                     |

## Future enhancements

These are explicitly deferred. Each becomes relevant only when the MVP encounters a specific limitation.

- **Parallelism**: Partition guides across parallel cron jobs or workers when sweep duration approaches the detection latency target
- **Prioritized scheduling**: Run recently-changed or historically-flaky guides more frequently
- **Histogram metrics**: Per-step latency distributions for trend analysis and performance regression detection
- **Multi-environment sweeps**: Test guides against multiple Grafana versions or editions
- **Artifact diffing**: Compare failure screenshots across runs to detect new vs. recurring failures
- **Guide metadata integration**: Use mutation profiles and dependency declarations for targeted isolation and smarter scheduling

## Related documentation

- [E2E test runner design](./e2e-test-runner-design.md) — CLI architecture and step execution logic
- [Testing strategy](./TESTING_STRATEGY.md) — Overall testing philosophy and failure classification
- [E2E testing](../developer/E2E_TESTING.md) — CLI usage reference and troubleshooting
- [CLI tools](../developer/CLI_TOOLS.md) — Guide validation and E2E commands
