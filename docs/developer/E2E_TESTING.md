# E2E guide test runner

The Pathfinder CLI includes an end-to-end test runner for interactive JSON guides. It verifies that guide steps function correctly in a live Grafana instance by automating interactions through a real browser.

For prescriptive agent constraints on testing (unit, integration, and E2E), see `.cursor/rules/testingStrategy.mdc`.

## Key concepts

- **DOM-based step discovery**: Tests interact with the rendered UI, not raw JSON. The plugin handles conditional logic; the runner iterates whatever steps are visible.
- **Sequential execution**: Steps run in order, matching the real user flow.
- **Requirements handling**: The runner detects unmet requirements, clicks Fix buttons, and handles skip/mandatory logic.

## Quick start

```bash
# Build the CLI first (if not already built)
npm run build:cli

# Test a specific guide file
npx pathfinder-cli e2e ./path/to/guide.json

# Test all bundled guides
npx pathfinder-cli e2e --bundled

# Test a specific bundled guide by name
npx pathfinder-cli e2e bundled:welcome-to-grafana

# Run against an isolated, clean-slate docker-compose stack (see below)
npx pathfinder-cli e2e --bundled --clean
```

## CLI reference

```bash
npx pathfinder-cli e2e [options] [files...]
```

### Options

| Option                                    | Description                                                                                                                                              | Default                           |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `--grafana-url <url>`                     | Grafana instance URL. Auto-switches to `http://localhost:3010` when `--clean` is set and this flag is not passed.                                        | `http://localhost:3000`           |
| `--output <path>`                         | Path for JSON report output                                                                                                                              | None                              |
| `--artifacts <dir>`                       | Directory for failure artifacts (screenshots, DOM snapshots)                                                                                             | `/tmp/pathfinder-e2e-{uuid}`      |
| `--verbose`                               | Enable detailed logging                                                                                                                                  | `false`                           |
| `--bundled`                               | Test all bundled guides                                                                                                                                  | `false`                           |
| `--trace`                                 | Generate Playwright trace files for debugging                                                                                                            | `false`                           |
| `--headed`                                | Run browser visibly (not headless)                                                                                                                       | `false`                           |
| `--always-screenshot`                     | Capture screenshots on success and failure                                                                                                               | `false`                           |
| `--clean`                                 | Run against an isolated docker-compose stack (project `pathfinder-e2e`, Grafana on `:3010`). Resets between dependency chains and tears down at the end. | `false`                           |
| `--clean-ready-timeout-ms <ms>`           | How long to wait for the isolated Grafana to become healthy after a `--clean` reset                                                                      | `120000`                          |
| `--package <dirOrId>`                     | Test a local package directory, or — when not an existing directory — a bare package ID resolved remotely via the recommender                            | None                              |
| `--tier <tier>`                           | Current environment tier (`local` or `cloud`); `cloud` guides are skipped on a `local` environment                                                       | `local`                           |
| `--remote`                                | Resolve and test every package from the CDN repository index                                                                                             | `false`                           |
| `--repo-url <url>`                        | CDN base URL for `--remote`                                                                                                                              | Public package repository         |
| `--resolver-url <url>`                    | Recommender base URL for `--package <id>` resolution                                                                                                     | `https://recommender.grafana.com` |
| `--cloud-instance-admin-token <host=env>` | Admin service-account token env var for a cloud target. Repeat for multiple cloud instances.                                                             | None                              |
| `--cloud-url <url>`                       | Default Grafana Cloud instance URL for cloud-tier guides without a manifest `instance`.                                                                  | `https://learn.grafana.net/`      |
| `--cloud-stack-access-policy-token <env>` | Cloud Access Policy token env var for cold isolated Grafana Cloud stack provisioning.                                                                    | None                              |
| `--cloud-stack-region <region>`           | Grafana Cloud region slug for cold isolated stack provisioning. Required with `--cloud-stack-access-policy-token`.                                       | None                              |
| `--cloud-stack-slug-prefix <prefix>`      | Slug prefix for cold-provisioned Grafana Cloud stacks.                                                                                                   | `pfe2e`                           |
| `--cloud-stack-plugin-version <version>`  | Pathfinder plugin version to install when the cold-provisioned stack does not already include the plugin.                                                | `latest`                          |

### Input formats

The CLI accepts these input formats:

1. **File paths**: `npx pathfinder-cli e2e ./my-guide.json ./another.json`
2. **Bundled flag**: `npx pathfinder-cli e2e --bundled` (tests all guides in `src/bundled-interactives/`)
3. **Bundled by name**: `npx pathfinder-cli e2e bundled:welcome-to-grafana`
4. **Local package directory**: `npx pathfinder-cli e2e --package ./my-package/` (reads `content.json` + `manifest.json`)
5. **Remote package ID**: `npx pathfinder-cli e2e --package alerting-101` (resolved via the recommender; see [Remote package-aware testing](#remote-package-aware-testing))
6. **Remote repository**: `npx pathfinder-cli e2e --remote` (every package in the CDN index)

## Exit codes

| Code | Meaning                                   |
| ---- | ----------------------------------------- |
| 0    | All steps passed                          |
| 1    | One or more steps failed                  |
| 2    | Configuration or setup error              |
| 3    | Grafana unreachable                       |
| 4    | Authentication failure or session expired |

## How it works

### Architecture overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLI Entry Point                          │
│  - Validates JSON against guide schema                           │
│  - Spawns Playwright with environment variables                  │
│  - Collects exit codes and reports                               │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Playwright Test Runner                      │
│  - Authenticates to Grafana                                      │
│  - Injects guide JSON via localStorage                           │
│  - Discovers steps from rendered DOM                             │
│  - Executes steps sequentially                                   │
│  - Reports results back to CLI                                   │
└─────────────────────────────────────────────────────────────────┘
```

### Test execution flow

1. **Pre-flight checks**
   - CLI checks Grafana health via `/api/health` (public endpoint)
   - Playwright validates authentication and plugin installation

2. **Guide injection**
   - Guide JSON written to localStorage
   - Plugin loads guide via `bundled:e2e-test` pattern

3. **Step discovery**
   - Runner scans DOM for interactive step elements
   - Collects metadata: step IDs, skip buttons, Do it buttons, multistep status

4. **Sequential execution**
   - For each step:
     - Check if pre-completed (objectives already met)
     - Handle requirements (Fix buttons with retry)
     - Click "Do it" button
     - Wait for completion indicator
   - Session validated every 5 steps to detect expiry

5. **Reporting**
   - Console output with real-time progress
   - JSON report if `--output` specified
   - Failure artifacts in `--artifacts` directory

## Requirements and skip behavior

The runner follows this decision tree when requirements are not met:

```
Requirements met? → Execute step
    │
    └─ Not met
         │
         ├─ Skippable step → SKIPPED (continue to next step)
         │
         └─ Mandatory step
              │
              ├─ Fix button available → Attempt fix (max 3 attempts)
              │    │
              │    ├─ Fix succeeded → Execute step
              │    │
              │    └─ Fix failed → FAILED (remaining steps marked not_reached)
              │
              └─ No fix button → FAILED (remaining steps marked not_reached)
```

**Skippable steps** (those with a Skip button) allow the test to continue when requirements cannot be met. **Mandatory steps** cause the test to abort on failure, marking remaining steps as `not_reached`.

## Artifacts and reporting

### Console output

The runner displays real-time progress with status icons:

- `✓` passed
- `✗` failed
- `⊘` skipped
- `○` not_reached

### JSON report

Use `--output report.json` to generate a structured report:

```json
{
  "guide": { "id": "...", "title": "...", "path": "...", "targetUrl": "..." },
  "config": { "timestamp": "..." },
  "summary": {
    "total": 10,
    "passed": 8,
    "failed": 1,
    "skipped": 1,
    "notReached": 0
  },
  "steps": [...]
}
```

For `--bundled` runs, the report includes aggregated results across all guides.

### Failure artifacts

When a step fails, the runner captures:

- **Screenshot**: `{stepId}-failure.png` of the viewport
- **DOM snapshot**: `{stepId}-dom.html` for selector debugging

Artifacts are saved to the `--artifacts` directory (or a temp directory by default).

## Guided-block test guide

To verify guided-block support (substep loop, comment box contract, completion), run the E2E CLI against a guide that includes at least one guided block. The bundled guide **Block editor tutorial** (`block-editor-tutorial`) contains a guided block with two highlight substeps and is skippable:

```bash
npx pathfinder-cli e2e bundled:block-editor-tutorial
```

Or by path:

```bash
npx pathfinder-cli e2e src/bundled-interactives/block-editor-tutorial.json
```

Guided steps are discovered via `data-targetaction="guided"` and `data-test-substep-total`; after "Do it", the runner drives substeps using only the comment box (`data-test-action`, `data-test-reftarget`, `data-test-target-value`) and step state (`data-test-step-state`, `data-test-substep-index`). Full coverage (button, highlight, formfill, hover, noop, skippable) may require additional guides such as `prometheus-grafana-101` or `loki-grafana-101`.

## Framework test guide

The bundled guide `e2e-framework-test` validates the E2E runner itself. It follows strict principles:

- **No side effects**: Read-only operations only (no data creation/modification)
- **No dependencies**: Works on a fresh Grafana instance with defaults
- **Fast execution**: Completes in under 60 seconds
- **Deterministic**: Produces the same result every run

Run it to verify your setup:

```bash
npx pathfinder-cli e2e bundled:e2e-framework-test
```

## Dependency-aware ordering

Before running, the CLI builds an execution plan from a `repository.json` index (the bundled `src/bundled-interactives/repository.json` by default, or `--repository <path>`). Guides linked by a hard `depends` prerequisite are run in dependency order and grouped into **chains**; unrelated guides form independent single-guide chains.

- **Auto-included prerequisites**: if you test a guide whose prerequisite is not in the selection (for example `bundled:loki-grafana-101` alone), the missing prerequisite (`prometheus-grafana-101`) is pulled in from the repository and run first.
- **Virtual capabilities**: a `depends` target may be a capability name; it resolves to whichever guide `provides` it.
- **Failure propagation**: if a prerequisite fails, its dependents in the same chain are marked skipped (`prerequisite failed`) and not run; the runner continues with the next chain.
- Only `depends` forms a chain. `recommends` and `suggests` are advisory and do not affect ordering. A `depends` cycle is a configuration error.

This ordering applies to every run. `--clean` additionally isolates each chain in its own environment (see below).

## Clean-slate runs (`--clean`)

The `--clean` flag boots a dedicated, isolated docker-compose stack (project `pathfinder-e2e`, Grafana on `:3010`) for the test run and tears it down at the end — the normal local dev stack on `:3000` is never touched. Use it when residual state from prior runs is making failures hard to attribute, or when you want clean-slate guarantees across a `--bundled` sweep.

The environment is reset **between dependency chains**, not between every guide. Guides within a chain share one environment so a prerequisite's state survives for its dependents. For example, the bundled `prometheus-grafana-101 → loki-grafana-101` chain runs as `docker up → prometheus-grafana-101 → loki-grafana-101 → docker down`, with no reset between the two guides.

## Timing and timeouts

| Constant             | Value            | Purpose                                      |
| -------------------- | ---------------- | -------------------------------------------- |
| Base step timeout    | 30s              | Maximum time for a single step               |
| Multistep bonus      | +5s per action   | Added for each internal action in multisteps |
| Guided substep bonus | +30s per substep | Added for each substep in guided blocks      |
| Button enable wait   | 10s              | Wait for sequential dependencies             |
| Fix button timeout   | 10s              | Per fix operation                            |
| Max fix attempts     | 3                | Retry limit before giving up                 |

Examples:

- A multistep with 5 internal actions gets a 55s timeout (30s base + 5×5s).
- A guided block with 3 substeps gets a 120s timeout (30s base + 3×30s).

## Troubleshooting

### Grafana not reachable (exit code 3)

```
❌ Pre-flight check failed: Grafana not reachable at http://localhost:3000
```

**Solutions:**

- Ensure Grafana is running: `npm run server`
- Check the URL is correct: `--grafana-url http://your-grafana:3000`
- Verify network access if using a remote instance

### Authentication failure (exit code 4)

```
❌ Session expired: Auth check returned 401
```

**Solutions:**

- For local development, restart Grafana to reset the session
- For CI, ensure auth credentials are valid
- Check that the Playwright auth state file exists: `playwright/.auth/admin.json`

### Step timeouts

Steps may timeout if:

- The Grafana UI is slow to respond
- Network requests take too long
- The step action triggers heavy operations

**Solutions:**

- Use `--trace` to generate a trace file for debugging
- Use `--headed` to watch the browser execution
- Check the DOM snapshot in artifacts for state at failure

### Configuration error (exit code 2)

```
❌ Guide validation failed
```

**Solutions:**

- Run `npm run validate` to check guide JSON syntax
- Ensure the guide file exists and is valid JSON
- Check that the guide follows the required schema

## CI integration

Example GitHub Actions workflow:

```yaml
name: E2E Guide Tests

on: [push, pull_request]

jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build plugin and CLI
        run: |
          npm run build
          npm run build:cli

      - name: Start Grafana
        run: npm run server &
        # Wait for Grafana to be ready

      - name: Wait for Grafana
        run: |
          for i in {1..30}; do
            curl -s http://localhost:3000/api/health && break
            sleep 2
          done

      - name: Install Playwright browsers
        run: npx playwright install chromium

      - name: Run E2E tests
        run: npx pathfinder-cli e2e --bundled --output results.json

      - name: Upload test artifacts
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: e2e-artifacts
          path: /tmp/pathfinder-e2e-*
```

## Environment variables

These variables are consumed by the CLI or passed to the spawned Playwright process. You generally do not need to set runner variables directly — the CLI sets them from its own flags and defaults.

| Variable                | Description                                                                    | Default                 |
| ----------------------- | ------------------------------------------------------------------------------ | ----------------------- |
| `GUIDE_JSON_PATH`       | Path to JSON guide file                                                        | Required                |
| `GRAFANA_URL`           | Grafana instance URL                                                           | `http://localhost:3000` |
| `AUTH_STATE_FILE`       | Per-guide Playwright storage-state path for form-login auth                    | Temporary CLI path      |
| `E2E_VERBOSE`           | Enable verbose logging                                                         | `false`                 |
| `E2E_TRACE`             | Generate Playwright trace file                                                 | `false`                 |
| `ABORT_FILE_PATH`       | Path where the runner writes abort reason metadata                             | Temporary CLI path      |
| `RESULTS_FILE_PATH`     | Path where the runner writes step results for JSON reporting                   | Temporary CLI path      |
| `ARTIFACTS_DIR`         | Directory for screenshots, DOM snapshots, and related artifacts                | `/tmp/pathfinder-e2e-*` |
| `ALWAYS_SCREENSHOT`     | Capture screenshots on success and failure                                     | `false`                 |
| `E2E_TRACE_OUTPUT_FILE` | Path where the runner records the generated Playwright trace artifact location | Temporary CLI path      |

For cloud targets, pass `--cloud-instance-admin-token host=ENV_VAR_NAME`; the named env var contains an admin service-account token for that exact host. The env var name is user-defined, for example `GRAFANA_PLAY_ADMIN_TOKEN`.

## Error classification

When a step fails, the runner assigns an error classification to help with triage:

| Code                 | Classification   | Notes                                        |
| -------------------- | ---------------- | -------------------------------------------- |
| `SELECTOR_NOT_FOUND` | `unknown`        | Could be content-drift OR product-regression |
| `ACTION_FAILED`      | `unknown`        | Needs human triage                           |
| `REQUIREMENT_FAILED` | `unknown`        | Could be content-drift OR missing setup      |
| `TIMEOUT`            | `infrastructure` | Likely environmental                         |
| `NETWORK_ERROR`      | `infrastructure` | Definitely environmental                     |
| `AUTH_EXPIRED`       | `infrastructure` | Definitely environmental                     |

Only `infrastructure` failures are auto-classified. `SELECTOR_NOT_FOUND`, `ACTION_FAILED`, and `REQUIREMENT_FAILED` default to `unknown` and require human triage — they could indicate content drift, a product regression, or a missing test environment setup.

For the full rationale and validation plan behind this classification approach, see [Error Classification](../design/e2e-test-runner-design.md#error-classification) in the design doc.

## Remote package-aware testing

The CLI can resolve published guides instead of reading local files, then test them against the configured Grafana instance.

- **By ID** (`--package <id>`): when the `--package` value is not an existing local directory, it is treated as a bare package ID and resolved through the recommender (`--resolver-url`, default `https://recommender.grafana.com`). The runner fetches the package's `content.json` and `manifest.json`, validates the content, and runs it.
- **Whole repository** (`--remote`): fetches the CDN `repository.json` (`--repo-url`, default the public package repository) and tests every package in the index. Dependency-aware chaining still applies, driven by the remote index.

Guides are routed by their manifest's `testEnvironment.tier`:

- `local` (or no tier) guides run against `--grafana-url`.
- `cloud` guides run against `--cloud-url` (default `https://learn.grafana.net/`), or against `https://{instance}/` when the manifest declares a host-only `testEnvironment.instance`. Shared-stack runs require an admin token explicitly associated with that host via `--cloud-instance-admin-token host=ENV_VAR_NAME`; cold isolated-stack runs require Cloud stack provisioning config instead.

Cloud auth:

- **Admin token per cloud target.** Pass `--cloud-instance-admin-token learn.grafana.net=GRAFANA_LEARN_ADMIN_TOKEN` to associate an admin service-account token env var with a cloud target. The CLI uses that admin token only to mint a fresh service account and short-lived token for each dependency chain; the browser runner receives only the minted token. Repeat the flag for each supported instance.
- **Cold isolated stack provisioning.** Pass `--cloud-stack-access-policy-token GRAFANA_CLOUD_ACCESS_POLICY_TOKEN --cloud-stack-region <region>` to let unsafe cloud dependency chains run against a fresh Grafana Cloud stack instead of the shared target. The token value must live in the named environment variable; the CLI passes it to Terraform as `TF_VAR_cloud_access_policy_token` and passes region/plugin version through Terraform variables rather than generated HCL. The local `terraform` CLI must be installed.

Per-chain service-account isolation mirrors how `--clean` resets the local docker stack per chain. Minted tokens carry a TTL, and accounts orphaned by crashed runs are swept on the next run. This isolates per-identity state (preferences, stars, sessions) between chains; it does **not** reset org data such as dashboards or data sources created by guides.

Cold isolated stack routing is used for cloud dependency chains classified as `possibly_mutating`, `mutating`, or `unknown` when cold-stack config is present. The CLI creates a Grafana Cloud stack with `delete_protection=false`, mints a short-lived Admin runner token, probes for `grafana-pathfinder-app`, installs the plugin only when missing, runs the chain against the fresh stack URL, and then attempts `terraform destroy`. Teardown is best-effort: cleanup failures are reported as warnings without replacing the primary guide result. Ctrl-C and SIGTERM also attempt to destroy any active cold-provisioned stack before exiting. If the process is killed before signal handling or Terraform teardown runs, a labeled cold stack may require manual cleanup; future hot-pool/reconciler work will add durable recovery. If cold-stack config is absent, unsafe cloud chains remain `skipped_unsafe_shared_stack`.

Read-only cloud chains with matching `--cloud-instance-admin-token` keep using the faster shared-stack service-account path. If a cloud chain lacks shared-stack auth but cold-stack config is present, the runner can use a cold isolated stack for that chain.

Interactive SSO/Okta login (driving the identity provider's login UI) is not supported. Path/journey (`milestones`) expansion is also not yet implemented; `path` and `journey` packages are skipped as an unsupported type. See the [Package-Aware Testing](../design/e2e-test-runner-design.md#package-aware-testing) design for the full picture.

### Package outcomes

In remote modes a package can end in one of these states. Only `validation_failed` counts as a test failure; the rest are logged and the batch continues:

| Outcome                    | Meaning                                                    | Test failure? |
| -------------------------- | ---------------------------------------------------------- | ------------- |
| `passed` / `failed`        | The guide ran (see step results)                           | `failed` only |
| `skipped_tier_mismatch`    | `cloud` guide on a `local` environment                     | No            |
| `skipped_no_auth`          | `cloud` guide with no matching cloud auth                  | No            |
| `skipped_invalid_instance` | manifest `instance` is not a bare hostname                 | No            |
| `resolution_failed`        | Recommender returned 404 or a network error                | No            |
| `fetch_failed`             | Could not fetch `content.json` from the CDN                | No            |
| `unsupported_type`         | Package is a `path` / `journey` (milestone expansion TODO) | No            |
| `validation_failed`        | Fetched `content.json` failed guide schema validation      | **Yes**       |

With `--output`, pre-run skips are recorded under a `preRunSkipped` array, and each tested guide's report carries package metadata (`packageId`, `tier`, `instance`, `targetUrl`, `sourceUrl`).

```bash
# Resolve and test a single published guide against local Grafana
npx pathfinder-cli e2e --package alerting-101

# Test the whole published repository (local-tier guides run, cloud guides skip)
npx pathfinder-cli e2e --remote --output results.json

# Resolve and test a cloud-tier guide on Grafana Cloud with per-chain ephemeral auth
export GRAFANA_LEARN_ADMIN_TOKEN=glsa_admin_xxx
npx pathfinder-cli e2e --tier cloud --package alerting-101 \
  --cloud-url https://learn.grafana.net/ \
  --cloud-instance-admin-token learn.grafana.net=GRAFANA_LEARN_ADMIN_TOKEN

# Test all cloud-tier guides against the default cloud instance
npx pathfinder-cli e2e --remote --tier cloud \
  --cloud-url https://learn.grafana.net/ \
  --cloud-instance-admin-token learn.grafana.net=GRAFANA_LEARN_ADMIN_TOKEN

# Test a guide whose manifest declares instance: play.grafana.org
export GRAFANA_PLAY_ADMIN_TOKEN=glsa_play_admin_xxx
npx pathfinder-cli e2e --tier cloud --package play-guide \
  --cloud-instance-admin-token play.grafana.org=GRAFANA_PLAY_ADMIN_TOKEN
```

## Related documentation

- [E2E Testing Contract](./E2E_TESTING_CONTRACT.md) - data-test-\* attributes for reliable E2E selectors
- [CLI tools](./CLI_TOOLS.md) - Guide validation commands
- [Local development](./LOCAL_DEV.md) - Setting up the development environment
- [E2E test runner design](../design/e2e-test-runner-design.md) - Architecture, design rationale, and package-aware testing design
