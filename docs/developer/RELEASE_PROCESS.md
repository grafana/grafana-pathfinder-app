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

### 3. CLI / MCP Releases (`.github/workflows/cli-publish.yml`)

- **Trigger**:
  - Push to `main` and `pull_request` (with paths filtering on CLI-relevant files): build, pack, image build, local smoke. No publish.
  - Push of a `cli-v*` tag (e.g., `cli-v1.1.0`): same, plus npm publish and Docker push, then a registry smoke test.
- **Process**:
  - Builds the CLI via `npm run build:cli`.
  - Packs an npm tarball via `scripts/pack-cli.js` (rewrites `package.json` → `name: pathfinder-cli`, `version: <CURRENT_SCHEMA_VERSION>`, narrows `files` to `dist/cli/`, restores the working tree).
  - Builds `Dockerfile.cli` and tags `grafana/pathfinder-cli:<version>` (Docker Hub) plus `ghcr.io/grafana/pathfinder-cli:<version>` (GHCR mirror).
  - Asserts the tag matches `CURRENT_SCHEMA_VERSION` from `src/types/json-guide.schema.ts`. Mismatched tags fail loud.
  - Publish steps gracefully skip when secrets (`NPM_TOKEN`, `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`) are absent — useful while the registry credentials are being provisioned. The build/pack/image-build path is exercised on every run regardless.

See [CLI and MCP releases](#cli-and-mcp-releases) below for the operator playbook.

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

## CLI and MCP releases

The `pathfinder-cli` npm package and `grafana/pathfinder-cli` Docker image (mirrored to `ghcr.io/grafana/pathfinder-cli`) are released independently from the plugin tarball. The plugin and CLI release cadences are decoupled.

### Versioning

CLI and MCP versions are pinned to `CURRENT_SCHEMA_VERSION` exported from `src/types/json-guide.schema.ts`. The repo's `package.json#version` (which carries the plugin version) is **not** used for the published CLI artifact — it is rewritten at publish time by `scripts/prepublish-cli.js`. The published `name` and `dependencies` are likewise rewritten so the published artifact contains only what the CLI runtime needs.

### Tag scheme

CLI releases use `cli-v*` tags. Plugin releases continue to use `v*`. Distinct prefixes prevent the two release workflows from fighting over the same tag.

### Dry-run locally

```bash
npm run pack:cli                                              # produce pathfinder-cli-<version>.tgz
docker build -f Dockerfile.cli -t pathfinder-cli:local .      # produce the image
docker run --rm pathfinder-cli:local --version                # CLI smoke
docker run --rm pathfinder-cli:local mcp                      # routes to placeholder, exits 1
```

### Cutting a release

1. Verify `CURRENT_SCHEMA_VERSION` in `src/types/json-guide.schema.ts` is the version you intend to ship.
2. Tag and push: `git tag cli-v<version> && git push origin cli-v<version>`. The `<version>` must match `CURRENT_SCHEMA_VERSION` exactly — the workflow asserts this.
3. The `cli-publish.yml` workflow runs the build, packs the artifact, builds the image, and (if secrets are configured) publishes to npm + Docker Hub + GHCR, then runs a registry smoke test.

### Required secrets

| Secret               | Purpose                                                                       |
| -------------------- | ----------------------------------------------------------------------------- |
| `NPM_TOKEN`          | npm publish auth (`pathfinder-cli`).                                          |
| `DOCKERHUB_USERNAME` | Docker Hub login (push to `grafana/pathfinder-cli`).                          |
| `DOCKERHUB_TOKEN`    | Docker Hub login.                                                             |
| `GITHUB_TOKEN`       | GHCR mirror push. Provided automatically by Actions; needs `packages: write`. |

If any required secret is missing, the corresponding publish job logs a `::warning::` and exits 0 — the workflow stays green so the build/pack/image-build path is still validated. The registry smoke test auto-skips for the same reason.

GHCR publishes independently of Docker Hub: it authenticates with the always-present `GITHUB_TOKEN`, so a missing or revoked Docker Hub credential does not dark out the GHCR mirror.

### Supply-chain attestation

Both artifact streams attach sigstore-backed attestations on every published `cli-v*` tag:

- **npm**: published with `npm publish --provenance`. Verify with:
  ```bash
  npm view pathfinder-cli@<version> --json | jq '.dist.attestations'
  ```
- **Docker images** (Docker Hub and GHCR): signed keyless via `cosign sign`. Verify with:
  ```bash
  cosign verify <image>:<version> \
    --certificate-identity-regexp 'https://github.com/grafana/grafana-pathfinder-app/.+' \
    --certificate-oidc-issuer 'https://token.actions.githubusercontent.com'
  ```
  (Replace `<image>` with `grafana/pathfinder-cli` or `ghcr.io/grafana/pathfinder-cli`.)

Both rely on the `id-token: write` permission granted to `publish-npm` and `publish-docker`.

### Refreshing the Docker base-image digest

`Dockerfile.cli` pins `node:22-alpine` by digest (same digest in both stages) so two builds of the same `cli-v*` git tag produce identical images. Refresh the digest periodically — at minimum, when cutting a new `cli-v*` release that's more than a few weeks behind the previous one — by running:

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
