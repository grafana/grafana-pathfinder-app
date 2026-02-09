# Content Testing Strategy: "Enablement Observability"

## Vision: Content as Code

We are moving from a model of "static documentation" to **"Content as Code."** We see interactive guides as software artifacts that participate in the full DevOps lifecycle. They are versioned, tested, and monitored just like the product code they document.

The content referred to can currently be found in [grafana/interactive-tutorials](https://github.com/grafana/interactive-tutorials)

This approach enables **"Enablement Observability"**: the ability to detect when a product change breaks enablement material, or when content drifts from the product reality.

---

## Content scale and ecosystem

The content corpus currently includes approximately **24 interactive guides**, with expected growth to **100-200 guides** as authors across the organization contribute content for their products and features.

All interactive guides are wired into the **Grafana Recommender** ([grafana/grafana-recommender](https://github.com/grafana/grafana-recommender)), which serves as the gating function for content distribution. The recommender determines which guides are surfaced to users based on context, user behavior, and content health signals. This architecture means:

- Users only see content that the recommender determines is relevant
- Content that fails tests can be de-prioritized or de-listed from recommendations
- The recommender is the critical integration point between content quality and user experience
- Where before, more content just means "more" (lists get longer), the new model is that in _any given
  app context_ we want to show the best 5, with quality guaranteed via testing.

---

## Failure Classification

Content breaks, and from a lot of experience with documentation, the breaks fall into several categories.
The core of this is that _content is always coupled to product_, so testing is a way of managing that
coupling.

| Failure Type                              | Cause                                                                                          | Resolution                                                    | Ownership                                                      | Artifacts                                                                         |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Content Drift                             | Outdated content; product changed                                                              | Update the guide (Content PR).                                | Content Team                                                   | Screenshot of current UI vs. guide expectation.                                   |
| Product Regression                        | Product broke an implied contract, e.g. a UI element removed or renamed without content change | Fix the product (Engineering PR) or update Selector Registry. | Product Engineering                                            | DOM snapshot, selector that failed, Grafana version.                              |
| Test Infrastructure Failure & Flaky Tests | test env failure (network timeout, Docker crash, auth expired).                                | Retry or quarantine the test; fix infrastructure/root cause.  | Interactive Learning Plugin Team or test author, if applicable | Console logs, network trace, exit code, failure rate over time, Playwright traces |

---

## The Testing Pyramid

For software, we have a pyramid of testing: unit, integration, e2e, etc. We employ the same concepts for
content.

```
┌─────────────────────────────────────────┐
│  Layer 4: Live Environment Validation   │  ← Expensive, realistic
│  (Nightly against Cloud/Staging)        │
├─────────────────────────────────────────┤
│  Layer 3: E2E Integration               │  ← Minutes, real browser
│  (Playwright against local Grafana)     │
├─────────────────────────────────────────┤
│  Layer 2: Engine Unit Tests             │  ← Seconds, mocked DOM
│  (Parser, executor, requirements)       │
├─────────────────────────────────────────┤
│  Layer 1: Static Analysis               │  ← Instant, no runtime
│  (Schema, lint, registry validation)    │     Automated in CI
└─────────────────────────────────────────┘
```

### Layer 1: Static Analysis (The "Linter") ✅ IMPLEMENTED

- **Goal:** Instant feedback on structure and validity on every commit / save.
- **Checks:**
  - JSON Schema validation, unknown field detection
  - Reference integrity (do links point to real sections?)
  - Condition validation for interactive requirements
- **Implementation:**
  - [`src/validation/validate-guide.ts`](../../src/validation/validate-guide.ts) - Core validation logic
  - [`src/validation/condition-validator.ts`](../../src/validation/condition-validator.ts) - Requirements condition validation
  - [`src/cli/commands/validate.ts`](../../src/cli/commands/validate.ts) - CLI command
  - Run via: `npx pathfinder-cli validate ./path/to/guide.json`
  - Use of this CLI is presently in the CI chain for the [https://github.com/grafana/interactive-tutorials](https://github.com/grafana/interactive-tutorials) repo.

### Layer 2: Engine Verification (Unit Tests)

- **Goal:** Ensure the Pathfinder plugin itself works, runs on every PR
- **Checks:**
  - Can the engine parse the JSON?
  - Do the state machines (Show Me \-\> Do It) transition correctly?
  - Does the requirement checking logic work?
- **Speed:** Seconds.
- **Owner:** Interactive Learning Plugin Team.

### Layer 3: E2E Integration 🚧 IN PROGRESS

- **Goal:** Verify the "User Experience" against a local Grafana instance on content PRs, nightly builds.
- **Checks:**
  - Does the guide actually work on Grafana v11.x?
  - Do the selectors find elements in the DOM?
  - Does the "Happy Path" complete successfully?
- **Tooling:** Playwright-based CLI Runner (`pathfinder-cli e2e`)
- **Design Documentation:**
  - [E2E Test Runner Design](./e2e-test-runner-design.md) - Full architecture and design rationale

### Layer 4: Live Environment Validation

- **Goal:** Verify guides work in production-like environments, for release candidates, weekly against Cloud staging.
- **Checks:**
  - Cross-environment compatibility (OSS vs Cloud).
  - Version matrix coverage (v10.x, v11.x).
  - Performance under realistic conditions.
- **Speed:** 10-30 minutes or even hours
- **Managed environments:** The Interactive Learning Plugin team will provide a limited number of managed test environments for automated testing. These environments support guides with complex prerequisites (specific data sources, plugins, or configurations) that cannot be tested locally or in basic CI.
- **Author benefit:** Authors whose guides have complex requirements can rely on Layer 4 for automated validation rather than maintaining local test environments.

#### Layer 4 prerequisites

Layer 4 validation requires **guide-level dependency metadata** to route guides to appropriate test environments. This metadata follows a "Debian package" model where guides declare what they **require** and what they **provide**:

- **Environment targeting**: Which environments can run this guide (local, managed, cloud)
- **Dataset dependencies**: What pre-seeded data the guide expects (Prometheus metrics, Loki logs, etc.)
- **Version requirements**: Minimum Grafana version needed
- **Guide dependencies**: Which other guides must be completed first (learning path ordering)
- **Capability abstraction**: Multiple guides can provide the same abstract capability, enabling flexible learning paths

This structured metadata lives in a `dependencies` object at the guide root level, separate from block-level `requirements` (which remain string arrays for runtime gating). See [Guide Dependencies Design](./guide-dependencies-design.md) for the detailed specification.

---

## Circuit Breakers

Content naturally drifts as the product evolves. Guide test failures should **inform** but not **gate** product releases.

| Test Layer       | Failure Behavior       | Rationale                              |
| :--------------- | :--------------------- | :------------------------------------- |
| Layer 1 (Static) | **Block merge**        | Syntax errors are always bugs          |
| Layer 2 (Unit)   | **Block merge**        | Plugin engine must work                |
| Layer 3 (E2E)    | **Warn, don't block**  | Guide may need update                  |
| Layer 4 (Live)   | **Informational only** | Guide (or environment) may need update |

### Escalation thresholds

**Ownership model:** There is no single "triage queue." Each organization owns their guides, and each team's failure queue is proportional to their contribution. Content authors are notified of failures and update on their own schedule.

**Expected break rate:** At scale, we expect a low break rate (single-digit percentages). Most guides should pass most of the time.

**Escalation paths:**

- **Single guide failure:** Log to dashboard, notify the guide's content owner.
- **\>20% of guides failing:** Alert to \#enablement-alerts, investigate systemic issue.
- **Critical path guide failure:** (e.g., "Welcome to Grafana") Escalate to Interactive Learning Plugin Team.
- **Unknown or unclassified errors:** Escalate to Interactive Learning Plugin Team as the default owner.
- **Non-content errors:** Any error that the content owner cannot fix (infrastructure, plugin bugs, etc.) escalates to Interactive Learning Plugin Team.

### Forcing Functions

From a strategic perspective, we will not ever make people fix broken content, because
the model is that content authors own their content, and we will not direct their time.
But there are consequences: because interactive guides are wired into the recommender,
in the future we will build mechanisms into the recommendation agent to be aware of
test results, and to de-prioritze or de-list content from recommendation results that
does not pass the tests. The result is that content effectively can stay broken, and
won't impact users because it will never be surfaced to them in the first place.

The key approach here is that we don't have to guarantee all content works, we only
have to guarantee that the content we distribute works. Teams who own broken content
can be notified, and the consequence of not fixing the content is de-listing from how
the content is reached in the first place.

Content authors may have the option to roll-back to a previous version at their option,
provided it passes test.

---

## Author Workflow

1. Authors use the Block Editor (in this repo) to author JSON content
2. Authors open PRs to [https://github.com/grafana/interactive-tutorials](https://github.com/grafana/interactive-tutorials) where the content is stored and versioned
3. Github Actions on that repo reuses the CLI tools that this repo will provide, to
   implement "the test pyramid" described in this document
4. Signals coming out of that Github CI will inform downstream processes, such as
   author notifications, "Enablement Observability Dashboard" (see below), and so on. Tentatively (this is not all worked out) but we will use Grafana CI/CD observability techniques + alerting to accomplish this. For more detail, see: [this repo](https://github.com/grafana/grafana-ci-otel-collector)

### Local testing

Local E2E testing is possible for some authors via `npx pathfinder-cli e2e ./guide.json`. However, feasibility depends on the guide's prerequisites:

- **Simple guides** (no special environment or data requirements) can be tested locally against a standard Grafana Docker instance
- **Complex guides** (requiring specific data sources, plugins, or environment configuration) may not be locally testable
- It is the **author's responsibility** to determine whether their guide can be tested locally

For guides with complex prerequisites, authors should rely on CI automation. In Layer 4 (Live Environment Validation), the Interactive Learning Plugin team will provide a limited number of managed test environments that can handle guides with specific requirements.

## Success Metrics

Shift focus from "tests pass" to outcome-based metrics that measure actual user value.

### Primary Metrics

| Metric                | Definition                                        |
| :-------------------- | :------------------------------------------------ |
| **Guide Freshness**   | % of guides updated within last 90 days           |
| **Registry Coverage** | % of guide selectors using registry (not raw CSS) |
| **E2E Pass Rate**     | % of E2E tests passing on latest Grafana          |
| **Mean Time to Fix**  | Days from failure detection to resolution         |

### Secondary Metrics

| Metric                    | Definition                                      |
| :------------------------ | :---------------------------------------------- |
| **User Completion Rate**  | % of users who complete a guide after starting  |
| **Time to Documentation** | Days from feature release to guide availability |
| **Flaky Test Rate**       | % of tests with \>10% failure variance          |

### Dashboard

These metrics are surfaced in the **Enablement Observability Dashboard**, which provides:

- Per-guide health status (green/yellow/red).
- Failure taxonomy breakdown (drift vs regression vs flaky).
- Trend lines for coverage and pass rates.

### Project success metric

The overarching success metric for this initiative is a **growing content base that passes all checks**.

Individual guide failures are acceptable and expected as part of normal content lifecycle. What matters is that the "green" content base (guides passing all test layers) grows over time. This growth indicates:

- Increasing utility of the overall platform
- Healthy content creation velocity
- Effective quality gates that don't block progress

We do not aim for 100% pass rate at any given moment. We aim for a trend line showing more passing content over time.

---

## Artifacts

1. **The Source Code:** The raw `guide.json` files.
2. **The Registry:** A versioned library of `selector-registry.json` that maps abstract intents to concrete DOM implementation details.
3. **The Report:** A structured JSON/JUnit report generated by the E2E runner, providing the "Green/Red" status for the Enablement Dashboard.
4. **Failure Artifacts:** Screenshots, DOM snapshots, console logs, and Playwright traces attached to failed test runs.

## Dependency Management

We apply dependency principles to guides:

- **Inter-Guide Dependencies:** Defined in metadata (e.g., "Guide B requires Guide A").
- **Validation Only:** The system _validates_ these dependencies (fails if "Guide A" is not completed) but does not currently _resolve_ them (i.e., it will not automatically run Guide A).
- **Mocking:** For testing "Guide B", the test runner can inject the "Guide A completed" state to isolate the test.

---

## Implementation Status

| Layer            | Status         | Implementation                                            |
| :--------------- | :------------- | :-------------------------------------------------------- |
| Layer 1 (Static) | ✅ Complete    | [`src/validation/`](../../src/validation/)                |
| Layer 2 (Unit)   | ✅ Complete    | Existing Jest test suite                                  |
| Layer 3 (E2E)    | 🚧 In Progress | See [E2E Test Runner Design](./e2e-test-runner-design.md) |
| Layer 4 (Live)   | ⏳ Future      | Requires Layer 3 completion                               |

---

## Scope boundaries

The following concerns are explicitly **out of scope** for this initiative:

- **Cost optimization:** CI minutes, artifact storage, and environment costs are not a concern at this stage. The focus is on building capability and proving the model, not optimizing for efficiency. Cost considerations may be revisited once the system is operational and usage patterns are understood.

---

## Related Documents

### E2E Implementation (Layer 3)

The E2E testing layer is the most complex component. Detailed design and implementation planning:

- **[E2E Test Runner Design](./e2e-test-runner-design.md)** - Complete architecture, CLI interface, step execution logic, error classification, and timing considerations

### Static Analysis (Layer 1)

- [`src/validation/validate-guide.ts`](../../src/validation/validate-guide.ts) - Core guide validation
- [`src/validation/condition-validator.ts`](../../src/validation/condition-validator.ts) - Requirements condition parser
- [`src/cli/commands/validate.ts`](../../src/cli/commands/validate.ts) - CLI command implementation

### Layer 4 Prerequisites

- **[Guide Dependencies Design](./guide-dependencies-design.md)** - Guide-level metadata schema for environment targeting, dataset requirements, and inter-guide dependencies

---

## Document Authority

This section establishes the authority hierarchy for E2E testing documentation, preventing duplication and ensuring single sources of truth.

| Document                          | Purpose                                     | Authority                                |
| --------------------------------- | ------------------------------------------- | ---------------------------------------- |
| TESTING_STRATEGY.md               | Vision, failure taxonomy, testing pyramid   | Immutable principles                     |
| e2e-test-runner-design.md         | Architecture, interfaces, specifications    | Single source of truth for specs         |
| guide-dependencies-design.md      | Guide metadata schema, dependency semantics | Source of truth for guide-level metadata |

### Guide failure ownership model

- Content authors own their guides
- Authors notified on failure, update on their schedule
- Recommender excludes failing guides until fixed
