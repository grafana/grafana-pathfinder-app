# Release Process

This document describes how releases are created and managed for the Grafana Pathfinder plugin.

## Release Workflows

The project uses several GitHub Actions workflows for different release scenarios:

### 1. Tag-Based Plugin Releases (`.github/workflows/release.yml`)

- **Trigger**: Push of version tags matching pattern `v*` (e.g., `v1.0.0`)
- **Process**:
  - Uses `grafana/plugin-actions/build-plugin` action
  - Builds the plugin for distribution
  - Plugin signing is available but currently commented out
  - Creates GitHub release with built artifacts

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
  - `pull_request` to `main` (CLI-relevant paths): build, pack, image build, local smoke. No push.
  - `push` to `main` (CLI-relevant paths): same, plus push the resulting Docker image to GHCR as `:latest` and `:main-<short-sha>`, cosign-sign the digest, and smoke-test the pushed image.
- **Process**:
  - Builds the CLI via `npm run build:cli`.
  - Packs an npm tarball via `scripts/pack-cli.js` (rewrites `package.json` → `name: pathfinder-cli`, `version: <CURRENT_SCHEMA_VERSION>`, narrows `files` to `dist/cli/`, restores the working tree). The Dockerfile installs this packed tarball globally inside the runtime image, so the pack-rewrite logic is exercised on every build.
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

1. **Development** (`dev`) - Automatic on push to main
2. **Operations** (`ops`) - Manual via publish workflow
3. **Production** (`prod`) - Manual via publish workflow

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

### For Official Releases

1. Update version in `package.json`
2. Create and push version tag (`git tag v1.1.32 && git push origin v1.1.32`)
3. GitHub Actions automatically builds and creates release
4. Optionally sign plugin for distribution

### For Development Deployments

1. Push changes to `main` branch
2. Automatic deployment to `dev` environment
3. Monitor via Slack channel `#pathfinder-app-release`

### For Production Deployments

1. Use manual publish workflow
2. Select target environment (ops/prod)
3. Choose branch to deploy from
4. Monitor deployment via Argo Workflow

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

The CLI inside the image carries `CURRENT_SCHEMA_VERSION` (from `src/types/json-guide.schema.ts`) as its `--version` output. The repo's `package.json#version` (the plugin version) is rewritten at image-build time by `scripts/prepublish-cli.js`, so the CLI version always tracks the schema version, not the plugin.

To bump what `pathfinder-cli --version` returns, bump `CURRENT_SCHEMA_VERSION` in source and merge — the next `:latest` will reflect it.

### Dry-run locally

```bash
npm run pack:cli                                              # produce pathfinder-cli-<version>.tgz
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
