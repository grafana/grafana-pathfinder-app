# Release Process

This document describes how releases are created and managed for the Grafana Pathfinder plugin.

## Release Workflows

The project uses several GitHub Actions workflows for different release scenarios:

### 1. Tag-based build (`.github/workflows/release.yml`) — NOT the release path

> **Do not release by pushing a tag.** This workflow builds a plugin zip + GitHub release on a `v*` tag push, but it is **not how Pathfinder ships** and is not exercised in practice — no v2.x tag has triggered it, and the v2.x GitHub releases are unpublished drafts. It also currently fails: `release.yml` doesn't pin a Node version, while the repo requires Node ≥ 24 (`package.json` `engines` / `.nvmrc`), so the build runs on too old a Node. Releases go out via the CD workflow (#2). The file is kept for reference only.

### 2. Manual Publishing (`.github/workflows/publish.yml`)

- **Trigger**: Manual workflow dispatch
- **Purpose**: Deploy to specific environments (dev/ops/prod)
- **Process**:
  - Allows selection of branch and target environment
  - Supports docs-only publishing option
  - Uses Grafana's shared CI workflows
  - Does not publish to plugin catalog as pending (disabled via `publish-to-catalog-as-pending: false`)

### 3. CLI / MCP continuous publish (`.github/workflows/cli-publish.yml`)

- **Trigger**:
  - `pull_request` to `main` (CLI-relevant paths): build CLI, build image, smoke test. No push.
  - `push` to `main` (CLI-relevant paths): same, plus push the resulting Docker image to GHCR as `:latest` and `:main-<short-sha>`, cosign-sign the digest, and smoke-test the pushed image.
- **Process**:
  - Builds the CLI via `npm run build:cli`.
  - Generates a minimal runtime `package.json` (commander + zod only) via `scripts/cli-build-utils.js runtime-package <out>` so the image doesn't pull the plugin's full dependency tree.
  - Builds `Dockerfile.cli` and pushes to `ghcr.io/grafana/pathfinder-cli:latest` plus `ghcr.io/grafana/pathfinder-cli:main-<short-sha>`.
  - Authenticates to GHCR with the always-present `GITHUB_TOKEN` — no repo secrets are required to operate this workflow.
- **No npm publish, no Docker Hub, no tag-driven release.** The image is the only consumable artifact. Pin to `:main-<sha>` for reproducibility; track `:latest` for "tip of trunk."

See [CLI and MCP continuous publish](#cli-and-mcp-continuous-publish) below for the operator playbook.

## Build Process

### Webpack Configuration (`.config/webpack/webpack.config.ts`)

- **Build Tool**: Webpack 5 with TypeScript support
- **Entry Point**: `src/module.tsx`
- **Output**: AMD modules for Grafana plugin system
- **Version Injection**: Automatically replaces `%VERSION%` and `%TODAY%` placeholders in `plugin.json` and `README.md`
- **Asset Processing**: Copies static assets, handles localization files, and generates source maps

### Build Commands

```bash
npm run build          # Production build
npm run dev            # Development watch mode
npm run sign           # Sign plugin for distribution
```

## Version Management

### Semver Sources

- **Primary**: `package.json` version field
- **Plugin Manifest**: `src/plugin.json` uses `%VERSION%` placeholder
- **Build Process**: Webpack replaces placeholders with actual version

### Version Suffixing

- **CD Builds**: Add git commit SHA suffix (`+abcdef`)
- **Release Builds**: Use clean semantic version from `package.json`

## Deployment Environments

### Environment Progression

All environments deploy **manually** via the CD (`Plugins - CD`) workflow dispatch — **nothing auto-deploys on merge to `main`**:

1. **Development** (`dev`) — manual CD dispatch; deployment_tools PR auto-merges.
2. **Operations** (`ops`) — manual CD dispatch; deployment_tools PR auto-merges.
3. **prod-canary / Production** (`prod`) — manual CD dispatch; requires clicking **"Resume"** on the paused approval step in the Argo UI.

### Plugin Scope

- **Scope**: `universal` (available for both on-prem and Grafana Cloud)
- **Deployment Type**: `provisioned` (managed by Grafana)

## Release Artifacts

### Generated Files (in `dist/` directory)

- `module.js` - Main plugin bundle
- `plugin.json` - Plugin manifest with version info
- `README.md` - Documentation with version placeholders replaced
- `CHANGELOG.md` - Release notes
- Localization files for 20+ languages
- Static assets (images, icons)

## Release Process Steps

A release is two phases: **(1)** prep the version + changelog on `main`, then **(2)** deploy `main` to each environment via the CD workflow. **There is no tag-based release.**

### Phase 1 — Prepare the release (version + changelog)

Use the `release-prep` skill (or do it by hand):

1. Bump the version in `package.json` + `package-lock.json` (never `src/plugin.json` — it carries `%VERSION%`, substituted at build).
2. Draft the `CHANGELOG.md` entry (via the `changelog` skill).
3. Validate under the repo's pinned Node (`.nvmrc` = 24.18; e.g. `fnm use` / `nvm use`): `npm run check` and `npm run build`.
4. Commit `chore: prep v<version> release` on a **branch** and open a **PR** to `main` — `main` is protected, so you cannot push to it directly. Merge once approved + green.

No git tag is required. (If you want a GitHub release entry for the record, create it manually — the tag→`release.yml` build is not used.)

### Phase 2 — Deploy via CD (`Plugins - CD` → `publish.yml`)

Deploy `main` to each environment in order — **dev → ops → prod-canary → prod** — by dispatching the **"Plugins - CD"** workflow (`workflow_dispatch`) with `branch: main` and the target `environment`. **All environments are manual dispatches; nothing auto-deploys on merge to `main`.**

Under the hood, CD opens a `grafana/deployment_tools` PR per environment that bumps the provisioned plugin version:

- **dev + ops** — the deployment_tools PR **auto-merges** once its CI passes; no manual action.
- **prod-canary + prod** — the Argo workflow **pauses at an approval step**. Monitor the run in the Argo UI (`argo-workflows.grafana.net`, `grafana-plugins-cd`) and click **"Resume"** on each paused approval step to let it proceed. You approve in **Argo**, not in `deployment_tools` — CD handles the PR after approval.

Deploy start, per-environment PR links, and "waiting for manual approval… click Resume" prompts are all posted to Slack **`#pathfinder-app-release`**.

## Monitoring and Notifications

- **Slack Channel**: `#pathfinder-app-release`
- **Argo Workflow**: `pathfinder-argo-workflow`
- **Auto-merge**: Enabled for dev and ops environments

## Plugin Signing

Plugin signing is available but currently disabled. To enable:

1. Generate an access policy token from Grafana
2. Add token to repository secrets as `policy_token`
3. Uncomment the signing configuration in `.github/workflows/release.yml`

## CLI and MCP continuous publish

The `pathfinder-cli` Docker image at `ghcr.io/grafana/pathfinder-cli` is rebuilt and pushed on every merge to `main`. There is no tag-driven release flow, no npm publish, and no Docker Hub push — the GHCR image is the single consumable artifact and the only registry. Authentication uses the always-present `GITHUB_TOKEN`; no repo secrets are required to operate the pipeline.

### Tags published on every main merge

| Tag                                               | Stability                                                         |
| ------------------------------------------------- | ----------------------------------------------------------------- |
| `ghcr.io/grafana/pathfinder-cli:latest`           | Tip of `main`. Moves on every merge. Use for "follow trunk."      |
| `ghcr.io/grafana/pathfinder-cli:main-<short-sha>` | Immutable per-commit pointer. Use for reproducible deploys / pin. |

### Versioning

The CLI's `--version` output is sourced from `CURRENT_SCHEMA_VERSION` in `src/types/json-guide.schema.ts`. The repo's `package.json#version` (the plugin version) is unrelated to the CLI version — they evolve independently.

To bump what `pathfinder-cli --version` returns, bump `CURRENT_SCHEMA_VERSION` in source and merge — the next `:latest` will reflect it.

### Dry-run locally

```bash
npm run build:cli                                             # compile dist/cli/
docker build -f Dockerfile.cli -t pathfinder-cli:local .      # produce the image
docker run --rm pathfinder-cli:local --version                # CLI smoke
docker run --rm pathfinder-cli:local mcp                      # routes to placeholder, exits 1
```

### Consuming the image

```bash
# Latest from main
docker run --rm ghcr.io/grafana/pathfinder-cli:latest --version

# Pinned to a specific main commit (recommended for CI / Cloud Run)
docker run --rm ghcr.io/grafana/pathfinder-cli:main-abc1234 --version

# Validate a Pathfinder package directory from another repo's CI
docker run --rm -v "$PWD:/workspace" \
  ghcr.io/grafana/pathfinder-cli:latest validate /workspace/path/to/package
```

### Package visibility

The first push creates the GHCR package as **private**. To consume it without authentication (e.g., from another org's GitHub Actions, or from Google Cloud Run via an Artifact Registry remote repository), an org admin must flip the package to public via GitHub Settings → Packages → `pathfinder-cli` → Change visibility → Public. One-time action.

### Supply-chain attestation

Every push attaches a sigstore-backed signature to the image digest via `cosign sign`. Verify with:

```bash
cosign verify ghcr.io/grafana/pathfinder-cli:latest \
  --certificate-identity-regexp 'https://github.com/grafana/grafana-pathfinder-app/.+' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com'
```

This relies on the `id-token: write` permission granted to the `publish-ghcr-main` job.

### Refreshing the Docker base-image digest

`Dockerfile.cli` pins `node:22-alpine` by digest (same digest in both stages) so two builds of the same git commit produce identical images. Refresh the digest periodically by running:

```bash
docker pull node:22-alpine
docker inspect --format='{{index .RepoDigests 0}}' node:22-alpine
```

Replace both `FROM` lines in `Dockerfile.cli` with the new digest. The two stages must use the same digest.

### Plugin tarball is unaffected

The CLI is not bundled into the plugin tarball. Webpack only enters from `src/module.tsx` and never traverses `src/cli/`, so the plugin's `dist/` output is identical with or without the CLI changes. Verify by running `npm run build` on this branch and on `main` and diffing the file lists; they should match exactly.

## Troubleshooting

### Common Issues

- **Build Failures**: Check GitHub Actions logs for specific error messages
- **Deployment Issues**: Verify environment permissions and Argo Workflow status
- **Version Conflicts**: Ensure `package.json` version matches expected format

### Useful Commands

```bash
# Check current version
npm version

# Build locally
npm run build

# Run tests
npm run test:ci

# Type checking
npm run typecheck

# Linting
npm run lint
```

## Related Documentation

- [Architecture Overview (GraphViz DOT format)](../architecture.dot)
- [Local Development](LOCAL_DEV.md)
- [Component Documentation](components/README.md)
