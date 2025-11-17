# E2E Testing Framework for Interactive Guides

## Background

* Pathfinder guides include the use of DOM selectors, which point to particular interactive elements in product
These can be brittle or can break, if engineering ships changes.
* Heds wrote a great feedback doc that explored some of these issues
* Pathfinder wants to create great learning experiences and broken guides aren’t that. We’ve built a lot of defensive features into Pathfinder to make it hard for guides to mess up. What we don’t guard against is the product itself changing.  If you specify a button should be clicked, and Grafana Cloud ships an update that removes the button, the guide will naturally break
* This directory is part of the medium/long-term game plan for mainteanance

This directory contains the end-to-end testing framework for validating interactive guides in Pathfinder. The framework automatically executes all steps in a guide (Show Me → Do It) and generates detailed failure reports.

## Overview

* Provide CLI tools where pathfinder can be installed like any other NPM module
* Allow a single CLI command to test any URL-available guide on any Pathfinder stack (provided auth is available)
* Generate a detailed JSON report with actionable error messages, and possibly later detailed failure information & screenshots

Doing this as a CLI should maximize ability to automate this, e.g. in the build chain for the `interactive-tutorials` repo.

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

**Guide URL Format**: Guide URLs must be accessible to Pathfinder from the browser. Local file paths are **not supported** because Pathfinder needs URLs that can be fetched from the browser context.

Supported formats:
- **Bundled guide**: `bundled:welcome-to-grafana`
- **GitHub raw URL**: `https://raw.githubusercontent.com/grafana/interactive-tutorials/main/path/unstyled.html`
- **Data proxy URL**: `api/plugin-proxy/grafana-pathfinder-app/github-raw/path/unstyled.html`

Test with a GitHub URL:

```bash
npx grafana-pathfinder-app test-guide --guide "https://raw.githubusercontent.com/grafana/interactive-tutorials/main/welcome-to-grafana/unstyled.html"
```

With custom Grafana URL:

```bash
npx grafana-pathfinder-app test-guide --guide bundled:welcome-to-grafana --grafana-url http://localhost:3000
```

Specify output directory:

```bash
npx grafana-pathfinder-app test-guide --guide bundled:welcome-to-grafana --output ./test-results
```

#### Remote Stack Testing

The framework supports testing guides on remote Grafana instances (Grafana Cloud, Grafana Play, etc.) that require authentication and may have stack-specific data or apps.

**Important**: Some guides require specific data sources, apps, or configurations that are only available on certain stacks. Testing a guide on the wrong stack will cause failures that don't indicate guide problems.

**Authentication**: Remote stacks require Grafana session cookies for authentication. You must provide both `--grafana-session` and `--grafana-session-expiry` flags.

**Dev Mode Setup**: The framework automatically enables dev mode on remote stacks by:
1. Navigating to the plugin configuration page with `?dev=true`
2. Enabling the dev mode checkbox if not already enabled
3. Verifying dev mode is active before running tests

**Example - Grafana Cloud**:

```bash
npx grafana-pathfinder-app test-guide --guide bundled:welcome-to-grafana \
  --grafana-url https://your-instance.grafana.net \
  --grafana-session "your-session-cookie-value" \
  --grafana-session-expiry "2024-12-31T23:59:59Z"
```

**Example - Grafana Play**:

```bash
npx grafana-pathfinder-app test-guide --guide bundled:welcome-to-grafana \
  --grafana-url https://play.grafana.org \
  --grafana-session "session-value" \
  --grafana-session-expiry "2024-12-31T23:59:59Z"
```

**Getting Session Cookies**:

1. Log into your Grafana instance in a browser
2. Open browser developer tools (F12)
3. Go to Application/Storage → Cookies
4. Find the `grafana_session` cookie and copy its value
5. Find the `grafana_session_expiry` cookie and copy its value (or calculate expiry date)
6. Use these values with the CLI flags

**Stack Profile**: You can explicitly specify the stack profile:

```bash
npx grafana-pathfinder-app test-guide --guide bundled:welcome-to-grafana \
  --stack-profile remote \
  --grafana-url https://play.grafana.org \
  --grafana-session "session-value" \
  --grafana-session-expiry "2024-12-31T23:59:59Z"
```

If you provide session cookies, the stack profile is automatically set to `remote`. Use `--stack-profile local` to force local mode even if cookies are provided.

### Playwright Test Framework (Optional)

For CI/CD integration or when you need Playwright's built-in test reporting, you can use the generic Playwright test file. **No spec files are needed for each guide** - one generic spec file works with any guide.

#### Guides Must be on the Network

**Local file paths (e.g., `./guide.html`, `/path/to/guide.html`) will not be supported** because Pathfinder runs in a browser context and needs URLs that can be fetched over HTTP/HTTPS. When you test a guide, Pathfinder must load the guide content from a URL accessible to the browser, not from the local filesystem.

Instead, we can specify:
- **Bundled guide URLs**: `bundled:welcome-to-grafana` (guides included in the Pathfinder package)
- **GitHub raw URLs**: `https://raw.githubusercontent.com/grafana/interactive-tutorials/main/path/unstyled.html` (publicly accessible guides)

These URL formats work with Pathfinder's dev tools and can be loaded from any Grafana instance (local or remote).

#### Running with Playwright

```bash
# Test a bundled guide
GUIDE_URL=bundled:welcome-to-grafana npx playwright test e2e/guides/guide.spec.ts

# Test with a GitHub URL
GUIDE_URL="https://raw.githubusercontent.com/grafana/interactive-tutorials/main/welcome-to-grafana/unstyled.html" npx playwright test e2e/guides/guide.spec.ts

# With custom Grafana URL
GUIDE_URL=bundled:welcome-to-grafana GRAFANA_URL=http://localhost:3000 npx playwright test e2e/guides/guide.spec.ts

# With custom output directory
GUIDE_URL=bundled:welcome-to-grafana TEST_OUTPUT_DIR=./results npx playwright test e2e/guides/guide.spec.ts
```

#### Environment Variables

The generic spec file (`e2e/guides/guide.spec.ts`) accepts these environment variables:

- `GUIDE_URL`: Guide URL to test (default: `bundled:welcome-to-grafana`)
  - Must be accessible to Pathfinder (bundled:, GitHub raw URL, or data proxy URL)
  - Local file paths are not supported
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

**For Local Stack Testing**:
1. **Build Pathfinder**: Run `npm run build` to create a production build
2. **Start Grafana**: Run `npm run server` in a separate terminal (or use `--start-stack` flag when implemented)

**For Remote Stack Testing**:
1. **Build Pathfinder**: Run `npm run build` to create a production build
2. **Valid Session Cookies**: Obtain `grafana_session` and `grafana_session_expiry` cookies from your browser
3. **Admin Permissions**: The authenticated user must have admin permissions to enable dev mode
4. **Plugin Installed**: Pathfinder plugin must be installed and enabled on the remote instance
5. **Stack Compatibility**: Ensure the guide is compatible with the target stack (some guides require specific data sources or apps)

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

