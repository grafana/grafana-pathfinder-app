# E2E guide test runner

The Pathfinder CLI includes an end-to-end test runner for interactive JSON guides. It verifies that guide steps function correctly in a live Grafana instance by automating interactions through a real browser.

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
```

## CLI reference

```bash
npx pathfinder-cli e2e [options] [files...]
```

### Options

| Option                | Description                                                  | Default                      |
| --------------------- | ------------------------------------------------------------ | ---------------------------- |
| `--grafana-url <url>` | Grafana instance URL                                         | `http://localhost:3000`      |
| `--output <path>`     | Path for JSON report output                                  | None                         |
| `--artifacts <dir>`   | Directory for failure artifacts (screenshots, DOM snapshots) | `/tmp/pathfinder-e2e-{uuid}` |
| `--verbose`           | Enable detailed logging                                      | `false`                      |
| `--bundled`           | Test all bundled guides                                      | `false`                      |
| `--trace`             | Generate Playwright trace files for debugging                | `false`                      |
| `--headed`            | Run browser visibly (not headless)                           | `false`                      |
| `--always-screenshot` | Capture screenshots on success and failure                   | `false`                      |

### Input formats

The CLI accepts three input formats:

1. **File paths**: `npx pathfinder-cli e2e ./my-guide.json ./another.json`
2. **Bundled flag**: `npx pathfinder-cli e2e --bundled` (tests all guides in `src/bundled-interactives/`)
3. **Bundled by name**: `npx pathfinder-cli e2e bundled:welcome-to-grafana`

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
  "guide": { "id": "...", "title": "...", "path": "..." },
  "config": { "grafanaUrl": "...", "timestamp": "..." },
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

## Timing and timeouts

| Constant           | Value          | Purpose                                      |
| ------------------ | -------------- | -------------------------------------------- |
| Base step timeout  | 30s            | Maximum time for a single step               |
| Multistep bonus    | +5s per action | Added for each internal action in multisteps |
| Button enable wait | 10s            | Wait for sequential dependencies             |
| Fix button timeout | 10s            | Per fix operation                            |
| Max fix attempts   | 3              | Retry limit before giving up                 |

Example: A multistep with 5 internal actions gets a 55s timeout (30s base + 5×5s).

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
          node-version: '22'
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

## Related documentation

- [CLI tools](./CLI_TOOLS.md) - Guide validation commands
- [Local development](./LOCAL_DEV.md) - Setting up the development environment
