---
title: Upgrade notes
menuTitle: Upgrade notes
description: Important information about upgrading Interactive learning, including breaking changes and migration guides.
weight: 100
---

# Upgrade notes

This section contains important information about upgrading Interactive learning, including breaking changes and migration requirements.

## Version 1.1.83: New content delivery infrastructure

{{< admonition type="warning" >}}
**Breaking change:** You must upgrade to version 1.1.83 or later to continue loading interactive guides.
{{< /admonition >}}

### What changed

Starting with version 1.1.83, interactive guides are served from a dedicated content delivery network (CDN) instead of GitHub raw URLs:

| Environment | Domain                                 |
| ----------- | -------------------------------------- |
| Production  | `interactive-learning.grafana.net`     |
| Development | `interactive-learning.grafana-dev.net` |
| Operations  | `interactive-learning.grafana-ops.net` |

### Why this change was made

- **Improved reliability**: Dedicated infrastructure for serving interactive content
- **Better performance**: Optimized CDN delivery for faster content loading
- **Simplified architecture**: Removed the need for backend proxy routes

### Impact

**If you're using version 1.1.82 or earlier:**

- Interactive guides will fail to load
- You'll see security validation errors when attempting to load guide content
- Bundled guides (shipped with the plugin) continue to work

**If you're using version 1.1.83 or later:**

- No action required - guides load automatically from the new CDN
- All existing guide content works without modification

### Migration steps

1. Update the Interactive learning plugin to version 1.1.83 or later
2. Restart your Grafana instance
3. Verify guides load correctly by opening the Interactive learning sidebar

### For content creators

**No changes required to your content.** The new CDN serves the same JSON format used previously. Your existing guides work without modification.

**Dev mode changes:**

- GitHub raw URLs (`raw.githubusercontent.com`) are still supported in dev mode for testing
- Use the URL tester in the dev panel to test content from any supported source before publishing

### Technical details

The following changes were made in version 1.1.83:

- Removed the backend proxy route for GitHub content (`github-raw/*` route in `plugin.json`)
- Updated security validation to accept the new `interactive-learning.grafana.net` domains
- Removed `validateGitHubUrl` and related GitHub-specific URL validation functions
- Added `isInteractiveLearningUrl` validation for the new domains

### Getting help

If you encounter issues after upgrading:

1. Verify you're running version 1.1.83 or later
2. Check the browser console for specific error messages
3. Report issues on the [GitHub repository](https://github.com/grafana/grafana-pathfinder-app/issues)
