# Pathfinder CLI Tools

The `pathfinder-cli` is a command-line interface for validating interactive JSON guides in the Grafana Pathfinder application. It ensures that guide definitions adhere to the required schema and best practices.

## Setup

The CLI is built from the source code within this repository. To set it up:

1.  **Install dependencies**:

    ```bash
    npm install
    ```

2.  **Build the CLI**:
    ```bash
    npm run build:cli
    ```

This compiles the TypeScript source in `src/cli` to `dist/cli`.

## Usage

You can run the CLI directly using Node.js after building it.

### Basic Syntax

```bash
node dist/cli/cli/index.js validate [options] [files...]
```

### Options

- `--bundled`: Validate all bundled guides located in `src/bundled-interactives/`. This option automatically discovers all JSON files in the directory (excluding `index.json`) relative to the current working directory where the command is executed. When run in another repository, it will look for `src/bundled-interactives/` in that repository's directory structure.
- `--strict`: Treat warnings as errors. The command will exit with a non-zero status code if any warnings are found.
- `--format <format>`: Output format. Options are `text` (default) or `json`.
- File arguments accept explicit paths to JSON guide files.

### Examples

**Validate all bundled guides (default script):**

This project includes a helper script for this common task:

```bash
npm run validate
# Equivalent to: node dist/cli/cli/index.js validate --bundled
```

**Validate specific guide files:**

```bash
node dist/cli/cli/index.js validate my-new-guide.json another-guide.json
```

**Note:** You can use shell glob expansion if needed:

```bash
# Shell expands *.json before passing to CLI
node dist/cli/cli/index.js validate guides/*.json

# Or use find for recursive matching
node dist/cli/cli/index.js validate $(find guides -name "*.json")
```

**Validate with strict mode (fail on warnings):**

```bash
npm run validate:strict
# Equivalent to: node dist/cli/cli/index.js validate --bundled --strict
```

**Get JSON output for CI integration:**

```bash
node dist/cli/cli/index.js validate --bundled --format json
```

## GitHub Actions Integration

You can use the CLI in a GitHub Actions workflow to automatically validate guides on every push or pull request. Since this CLI is internal to the repo, the workflow builds it from source.

Here is a succinct example workflow:

```yaml
name: Validate Guides

on: [push, pull_request]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      - name: Install Dependencies
        run: npm ci

      - name: Build CLI
        run: npm run build:cli

      - name: Validate Guides
        run: npm run validate:strict
```
