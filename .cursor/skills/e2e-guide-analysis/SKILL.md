---
name: e2e-guide-analysis
description: Run E2E CLI against a JSON guide to analyze edge cases and behavior. Use when the user wants to test a guide with the e2e CLI for learning purposes, study e2e failures, analyze screenshots, or investigate edge cases in the guide runner.
---

# E2E Guide Analysis

This skill runs the E2E CLI against a provided JSON guide with maximum diagnostic output, then analyzes results to identify edge cases and learnings. The goal is exploratory testing to inform e2e CLI design and guide specification improvements.

## Prerequisites

Before running, ensure:

1. Grafana is running locally: `npm run server` (or verify at http://localhost:3000)
2. Plugin is built: `npm run dev` or `npm run build`
3. The JSON guide file exists at the provided path

## Workflow

### Step 1: Run E2E CLI with maximum diagnostics

```bash
npx pathfinder-cli e2e <GUIDE_PATH> \
  --verbose \
  --always-screenshot \
  --trace \
  --artifacts ./cursor/local/e2e/artifacts/<guide-name> \
  --output ./cursor/local/e2e/artifacts/<guide-name>/report.json
```

Replace `<GUIDE_PATH>` with the user-provided path. Extract `<guide-name>` from the filename (or the title inside of the JSON if the guide-name is just 'content') and don't include .json in the name.

### Step 2: Gather artifacts

After the CLI completes (pass or fail), collect:

1. **Console output**: The full terminal output from Step 1
2. **JSON report**: Read `report.json` from the artifacts directory
3. **Screenshots**: List and read all `.png` files in the artifacts directory
4. **Trace file**: Note location of `trace.zip` if tracing was enabled (in `test-results/`)
5. **DOM snapshots**: Read any `*-dom.html` files for selector debugging

### Step 3: Analyze results

For each step in the guide, examine:

| Aspect           | What to look for                                                       |
| ---------------- | ---------------------------------------------------------------------- |
| **Status**       | passed, failed, skipped, not_reached                                   |
| **Skip reason**  | pre_completed, no_do_it_button, requirements_not_met, skippable_failed |
| **Requirements** | Were requirements met? Did fix buttons work?                           |
| **Timing**       | How long did each step take? Timeouts?                                 |
| **Screenshots**  | Visual anomalies, unexpected UI state                                  |

### Step 4: Identify learnings

Categorize findings into:

1. **Guide spec issues**: Problems with the JSON guide itself (missing fields, bad selectors, unclear requirements)
2. **E2E CLI issues**: Bugs or limitations in the test runner (detection logic, timing, edge cases)
3. **Grafana/UI issues**: Product behavior that affects guide execution
4. **Infrastructure issues**: Timeouts, network errors, auth problems

### Step 5: Write learning document

Create or update: `tests/e2e-runner/learning/<guide-name>.md`

Use this template:

```markdown
# E2E Analysis: <Guide Title>

**Guide**: `<path-to-guide>`  
**Date**: <ISO date>  
**CLI version**: (from package.json)

## Summary

<1-2 sentence overview of what was tested and overall outcome>

## Test Results

| Metric      | Value |
| ----------- | ----- |
| Total steps | N     |
| Passed      | N     |
| Failed      | N     |
| Skipped     | N     |
| Not reached | N     |
| Duration    | Xms   |

## Observations

### [Issue Category]

**Finding**: <description>  
**Evidence**: <screenshot reference, log excerpt, or JSON snippet>  
**Impact**: <how this affects guide execution>  
**Recommendation**: <suggested fix or investigation>

(repeat for each significant finding)

## Edge Cases Discovered

- <edge case 1>
- <edge case 2>

## Recommendations

### For guide authors

- <actionable guidance>

### For E2E CLI development

- <suggested improvements>

## Artifacts

- Screenshots: `artifacts/<guide-name>/`
- JSON report: `artifacts/<guide-name>/report.json`
- Trace: `test-results/.../trace.zip` (if enabled)
```

## Reference documentation

For deeper context, read these files:

- `docs/design/TESTING_STRATEGY.md` - Overall testing philosophy and failure classification
- `docs/design/e2e-test-runner-design.md` - CLI architecture and step execution logic

## Exit codes reference

| Code | Meaning                   |
| ---- | ------------------------- |
| 0    | All steps passed          |
| 1    | One or more steps failed  |
| 2    | Configuration/setup error |
| 3    | Grafana unreachable       |
| 4    | Auth failure              |

## Common edge cases to watch for

1. **Steps without "Do it" buttons**: Some steps have `doIt: false` or are `noop` type
2. **Pre-completed steps**: Objectives may complete before clicking
3. **Sequential dependencies**: Steps may wait for previous step completion
4. **Fix button failures**: Requirements fix buttons can fail repeatedly
5. **Multistep timeouts**: Complex multisteps need dynamic timeout calculation
6. **Session expiry**: Long-running tests may hit auth expiration

## Notes

- This skill is for **exploratory learning**, not pass/fail testing
- Focus on understanding behavior, not just reporting failures
- Multiple runs may reveal flaky behavior patterns
- Compare results across different guide types to find patterns
