# Release process

Cloud plugin promotion and rollback are governed by the [deployment_tools release guide](https://github.com/grafana/deployment_tools/blob/master/docs/grafana-pathfinder/RELEASE.md) and [incident runbook](https://github.com/grafana/deployment_tools/blob/master/docs/grafana-pathfinder/RUNBOOK.md). This document describes source preparation, artifacts and workflow contracts. CLI/MCP publishing is independent of plugin rollout.

## Release workflows

| Workflow                                                  | Trigger and responsibility                                                                        |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [Plugins - CD](../../.github/workflows/publish.yml)       | Manual dispatch; build/catalog publication and provisioned Cloud deployment via shared CD v11.2.0 |
| [Tag-based release](../../.github/workflows/release.yml)  | A pushed `v*` tag builds GitHub plugin artifacts; it is not the Cloud deployment procedure        |
| [CLI publishing](../../.github/workflows/cli-publish.yml) | Relevant PRs build/test; relevant main pushes publish the CLI container as described below        |

## Version management

`package.json` owns the plugin semantic version; keep lockfile version entries and changelog aligned using the repository's release-prep workflow. `src/plugin.json` contains `%VERSION%`, replaced during the build. Prepare a reviewed new version for a fix rather than replacing a published artifact.

Shared CD normally leaves the main-branch version unsuffixed, uses a commit suffix for other branches, and applies special prod-canary suffix behavior. Do not assume all dev builds have a suffix: inspect the resolved commit and published version in the run. A workflow's selected ref and its **branch** input are distinct; use main for both in the production path and verify the resulting tag SHA.

## Release process steps

1. Prepare the version/changelog PR from current main and run required source CI. Review compatibility with the Go resource proxy, persisted settings, APIs and external content.
2. Dispatch **Plugins - CD** with the release branch as input **branch**, **environment=dev**, **docs-only=false**. Record the exact build SHA/version and validate the affected user journey in dev under the operational guide.
3. Merge the reviewed source PR. Check the resulting main commit and repeat relevant checks if it differs from what was tested.
4. Follow the operational guide to dispatch main to **prod**, verify each wave and approve the production gates. The current workflow disables Playwright in CD; its success does not replace browser validation.
5. Verify tag/artifact provenance and complete GitHub release notes/publication after operational verification. Record release and deployment evidence separately.

### Tag and GitHub release responsibilities

Shared CD can create `v<version>` and a **draft GitHub release** after successful catalog publication when production is targeted. It does not wait for Argo deployment health. Do not push a separate tag as a routine prerequisite to Cloud publishing.

The shared workflow's tag creation uses the workflow context SHA; verify it matches the intended tested commit, particularly if workflow ref and build branch differ. An existing tag can be retained by the workflow, so a green run does not prove a pre-existing tag is correct. Stop and resolve mismatched provenance with the release owner; do not overwrite released tags/artifacts to hide a mismatch.

A deliberate tag push invokes `release.yml` for artifact publication. Use that route only when artifact publication is the intended operation, not to bypass Cloud promotion gates. Its signing configuration is commented out; this does not describe the separate shared CD signing path. Inspect the actual artifact/signing result rather than assuming all plugin releases are unsigned.

## Deployment environments

The workflow offers `dev`, `ops` and `prod`. Dev targets dev only; ops targets ops/staging only. With the current `prod-targets-all` default, prod traverses dev → ops/staging → prod-canary → prod. Argo defaults require manual approval for prod-canary and prod. Pathfinder configures deployment PR auto-merge for dev/ops only. Follow the live run's parameters and links in `#pathfinder-app-release`.

There is no fixed Pathfinder Argo workflow name: shared CD uses the `grafana-plugins-deploy` template in namespace `grafana-plugins-cd`. Workflow completion, deployment PR merge, reconciliation, and a healthy browser are separate milestones.

## Build process

Webpack enters `src/module.tsx`, builds the frontend bundle and replaces version/date placeholders. The plugin distribution also includes its backend proxy artifacts through the release build. Local commands:

```bash
npm run build  # production frontend build
npm run dev    # development watch mode
npm run sign   # signing operation; requires appropriate credentials
```

Use the release workflow's artifacts as the distribution evidence; a local frontend build alone does not prove the complete release was published or deployed.

## Monitoring and notifications

Use `#pathfinder-app-release` for release progress and `#grafana-pathfinder-alerts` / Pathfinder On Call for incidents. The operational guide links current dashboards, read-only gcx queries and recovery checks. Missing telemetry or idle traffic is not a healthy-release result.

For a demonstrated release regression, stop promotion and restore a compatible known-good wave pin using the operational runbook. Build a new corrective version after dev validation; do not simply resume the faulty release. External guides/package indexes and persisted API data are not reverted by plugin rollback.

## CLI and MCP continuous publish

The `pathfinder-cli` Docker image at `ghcr.io/grafana/pathfinder-cli` is rebuilt and pushed when a merge to `main` changes a CLI-relevant path listed in `.github/workflows/cli-publish.yml`. There is no tag-driven release flow, no npm publish, and no Docker Hub push — the GHCR image is the single consumable artifact and the only registry. Authentication uses the always-present `GITHUB_TOKEN`; no repo secrets are required to operate the pipeline.

### Tags published on each relevant main merge

| Tag                                               | Stability                                                  |
| ------------------------------------------------- | ---------------------------------------------------------- |
| `ghcr.io/grafana/pathfinder-cli:latest`           | Tip of relevant changes on `main`. Use for "follow trunk." |
| `ghcr.io/grafana/pathfinder-cli:main-<short-sha>` | Per-commit tag. Record/pin its digest for reproducibility. |

### Versioning

The CLI's `--version` output is sourced from `CURRENT_SCHEMA_VERSION` in `src/types/json-guide.schema.ts`. The repo's `package.json#version` (the plugin version) is unrelated to the CLI version — they evolve independently.

To bump what `pathfinder-cli --version` returns, bump `CURRENT_SCHEMA_VERSION` in source and merge — the next `:latest` will reflect it.

### Dry-run locally

```bash
npm run build:cli                                             # compile dist/cli/
docker build -f Dockerfile.cli -t pathfinder-cli:local .      # produce the image
docker run --rm pathfinder-cli:local --version                # CLI smoke
docker run --rm pathfinder-cli:local mcp --version            # MCP subcommand smoke
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

`Dockerfile.cli` pins `node:24-alpine` by digest (same digest in both stages) so two builds of the same git commit produce identical images. Keep the image at Node 24.14.1 or newer so its bundled npm supports the repository's supply-chain settings. Refresh the digest periodically by running:

```bash
docker pull node:24-alpine
docker inspect --format='{{index .RepoDigests 0}}' node:24-alpine
```

Replace both `FROM` lines in `Dockerfile.cli` with the new digest. The two stages must use the same digest.

### Plugin tarball is unaffected

The CLI is not bundled into the plugin tarball. Webpack only enters from `src/module.tsx` and never traverses `src/cli/`, so changes confined to `src/cli/` do not add the CLI to the plugin's `dist/` output. Verify by running `npm run build` on this branch and on `main` and diffing the file lists; they should match exactly.

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
