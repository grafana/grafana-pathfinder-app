# E2E Testing Framework for Interactive Guides

This directory contains the end-to-end testing framework for validating interactive guides in Pathfinder. The framework automatically executes all steps in a guide (Show Me → Do It) and generates detailed failure reports.

## Overview

The testing framework:
- Parses HTML guides to extract interactive steps
- Executes each step automatically (Show Me then Do It)
- Captures detailed failure information including screenshots
- Generates JSON reports with actionable error messages
- Can be used via CLI or programmatically

## Installation

The framework is included in the Pathfinder package. For other repositories:

```bash
npm install grafana-pathfinder-app
```

## Usage

There are two ways to run guide tests:

1. **CLI (Recommended)**: Simple command-line interface, no spec files needed
2. **Playwright Test**: Optional Playwright test framework integration for CI/CD

### CLI Usage (Recommended)

The CLI is the simplest way to test guides and doesn't require creating spec files for each guide.

#### Local Development

For local development in this repository:

```bash
npm run test:guide -- --guide bundled:welcome-to-grafana
```

Or run directly:

```bash
node e2e/cli.js --guide bundled:welcome-to-grafana
```

#### Published Package

When the package is published and installed in another repository:

```bash
npx grafana-pathfinder-app test-guide --guide bundled:welcome-to-grafana
```

#### CLI Options

Test from an HTML file:

```bash
npx grafana-pathfinder-app test-guide --guide ./path/to/guide.html
```

With custom Grafana URL:

```bash
npx grafana-pathfinder-app test-guide --guide bundled:welcome-to-grafana --grafana-url http://localhost:3000
```

Specify output directory:

```bash
npx grafana-pathfinder-app test-guide --guide bundled:welcome-to-grafana --output ./test-results
```

### Playwright Test Framework (Optional)

For CI/CD integration or when you need Playwright's built-in test reporting, you can use the generic Playwright test file. **No spec files are needed for each guide** - one generic spec file works with any guide.

#### Running with Playwright

```bash
# Test a bundled guide
GUIDE_URL=bundled:welcome-to-grafana npx playwright test e2e/guides/guide.spec.ts

# Test from an HTML file
GUIDE_URL=./path/to/guide.html npx playwright test e2e/guides/guide.spec.ts

# With custom Grafana URL
GUIDE_URL=bundled:welcome-to-grafana GRAFANA_URL=http://localhost:3000 npx playwright test e2e/guides/guide.spec.ts

# With custom output directory
GUIDE_URL=bundled:welcome-to-grafana TEST_OUTPUT_DIR=./results npx playwright test e2e/guides/guide.spec.ts
```

#### Environment Variables

The generic spec file (`e2e/guides/guide.spec.ts`) accepts these environment variables:

- `GUIDE_URL`: Guide URL to test (default: `bundled:welcome-to-grafana`)
- `GRAFANA_URL`: Grafana instance URL (default: `http://localhost:3000` or Playwright's `baseURL`)
- `TEST_OUTPUT_DIR`: Output directory for test results (default: `./test-results`)

#### Benefits of Playwright Test Approach

- Built-in test reporting and HTML reports
- Integration with CI/CD systems that expect Playwright test files
- Parallel test execution support
- Playwright's assertion library
- Test retries and other Playwright features

**Note**: The CLI approach is simpler and recommended for most use cases. Use Playwright tests only if you need the additional features mentioned above.

### Prerequisites

1. **Build Pathfinder**: Run `npm run build` to create a production build
2. **Start Grafana**: Run `npm run server` in a separate terminal (or use `--start-stack` flag when implemented)

### Programmatic Usage

```typescript
import { runGuideTest } from 'grafana-pathfinder-app/e2e/guide-runner';
import { TestConfig } from 'grafana-pathfinder-app/e2e/types';

const config: TestConfig = {
  guideUrl: 'bundled:welcome-to-grafana',
  grafanaUrl: 'http://localhost:3000',
  outputDir: './test-results',
  startStack: false,
  timeout: 30000,
};

const report = await runGuideTest(config);
console.log(`Test completed: ${report.summary.passed} passed, ${report.summary.failed} failed`);
```

## Test Reports

Reports are generated as JSON files in the output directory. Each report includes:

- **Guide metadata**: ID, URL, title
- **Summary**: Total steps, passed, failed, skipped counts
- **Step-by-step results**: Detailed information for each step
- **Failure details**: Error type, message, screenshot path, step HTML context

### Report Format

```json
{
  "guide": {
    "id": "welcome-to-grafana",
    "url": "bundled:welcome-to-grafana",
    "title": "Welcome to Grafana"
  },
  "summary": {
    "totalSteps": 7,
    "passed": 5,
    "failed": 2,
    "skipped": 0
  },
  "steps": [
    {
      "index": 0,
      "type": "highlight",
      "reftarget": "a[data-testid='Nav menu item'][href='/']",
      "status": "passed",
      "showMeDuration": 1200,
      "doItDuration": 800,
      "totalDuration": 2000
    },
    {
      "index": 1,
      "type": "highlight",
      "reftarget": "a[data-testid='Nav menu item'][href='/dashboards']",
      "status": "failed",
      "error": {
        "type": "selector_not_found",
        "message": "No elements found matching selector",
        "stepHtml": "<li class=\"interactive\" data-reftarget=\"...\">...</li>",
        "screenshot": "./screenshots/step-1-failure.png"
      },
      "showMeDuration": 0,
      "doItDuration": 0,
      "totalDuration": 0
    }
  ],
  "timestamp": "2024-01-15T10:30:00Z",
  "grafanaUrl": "http://localhost:3000",
  "duration": 45000
}
```

## Error Types

The framework captures several error types:

- `selector_not_found`: The target selector doesn't exist in the DOM
- `element_not_clickable`: The element exists but cannot be clicked
- `requirement_failed`: Step requirements were not met
- `timeout`: Operation timed out
- `button_not_found`: Show Me or Do It button not found
- `action_failed`: Action execution failed
- `unknown`: Unexpected error

## Architecture

### Core Components

1. **guide-runner.ts**: Main test orchestrator
2. **guide-parser.ts**: HTML parsing and step extraction (runs in browser context)
3. **step-executor.ts**: Step execution logic (Show Me → Do It)
4. **reporter.ts**: Report generation
5. **types.ts**: TypeScript type definitions
6. **fixtures.ts**: Playwright fixtures for guide testing
7. **cli.ts**: Command-line interface

### Integration Points

The framework integrates with Pathfinder through:

1. **Panel Opening**: Clicks the Help button to open Pathfinder sidebar
2. **Guide Loading**: Dispatches `auto-launch-tutorial` event (same mechanism Pathfinder uses)
3. **Step Discovery**: Parses rendered HTML to find interactive steps
4. **Button Interaction**: Finds and clicks "Show me" and "Do it" buttons via Playwright selectors
5. **Error Capture**: Intercepts console errors and captures DOM state

### Minimal Core Code Changes

The framework is designed to minimize changes to Pathfinder core code:
- Uses existing events and APIs (e.g., `auto-launch-tutorial` event)
- Parses HTML in browser context (no DOM manipulation needed)
- Interacts with UI via Playwright (no code injection)
- Captures errors via console interception (no error handling modifications)

## Example Test

See `guides/guide.spec.ts` for the generic Playwright test file that works with any guide. This is optional - the CLI approach doesn't require spec files.

## Troubleshooting

### Grafana not accessible

Make sure Grafana is running:
```bash
npm run server
```

### Guide not loading

- Verify the guide URL is correct
- Check that Pathfinder plugin is installed and enabled
- Ensure the guide exists in `bundled-interactives/index.json`

### Steps not executing

- Check browser console for errors
- Verify selectors are correct (may have changed in Grafana UI)
- Review screenshots in the output directory

### Build Issues

Ensure Pathfinder is built before testing:
```bash
npm run build
```

## Development

To modify the testing framework:

1. Edit files in `e2e/` directory
2. Run TypeScript compiler: `npm run typecheck`
3. Test changes: `npx grafana-pathfinder-app test-guide --guide bundled:welcome-to-grafana`

## Excluding from Production Builds

The `e2e/` directory is excluded from production builds via:
- Webpack configuration (if needed)
- `package.json` `files` field (excludes `e2e/` from npm package)

This ensures the testing framework is not shipped with production builds.

