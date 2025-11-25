# Release Process

This document describes how releases are created and managed for the Grafana Pathfinder plugin.

## Release Workflows

The project uses **three distinct GitHub Actions workflows** for different release scenarios:

### 1. Tag-Based Releases (`.github/workflows/release.yml`)

- **Trigger**: Push of version tags matching pattern `v*` (e.g., `v1.0.0`)
- **Process**:
  - Uses `grafana/plugin-actions/build-plugin` action
  - Builds the plugin for distribution
  - Plugin signing is available but currently commented out
  - Creates GitHub release with built artifacts

### 2. Continuous Deployment (`.github/workflows/push.yml`)

- **Trigger**: Push to `main` branch
- **Process**:
  - Runs CI/CD pipeline on every push to main
  - Deploys to `dev` environment automatically
  - Adds git commit SHA as version suffix (e.g., `1.1.31+abcdef`)
  - Uses Grafana's plugin CI workflows
  - Triggers Argo Workflow for Grafana Cloud deployment

### 3. Manual Publishing (`.github/workflows/publish.yml`)

- **Trigger**: Manual workflow dispatch
- **Purpose**: Deploy to specific environments (dev/ops/prod)
- **Process**:
  - Allows selection of branch and target environment
  - Supports docs-only publishing option
  - Uses Grafana's shared CI workflows
  - Publishes to plugin catalog as "pending" status

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
