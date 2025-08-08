# Grafana Pathfinder

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

Grafana Pathfinder brings contextual help and interactive learning directly into Grafana. Open the sidebar, get tailored recommendations, and follow guided learning journeys without leaving your workflow.

## What you can do

- Context-aware recommendations based on where you are in Grafana
- Interactive learning journeys with milestones and progress
- Open multiple docs/journeys in tabs; navigate with keyboard shortcuts
- Quick “View” or “Start” actions from recommendations
- Optional auto-launch of a tutorial on startup (for demos)

## How to use

1. Open the sidebar and click “Grafana Pathfinder”.
2. Review the “Recommended Documentation”.
3. Click “View” to open a doc tab, or “Start” to launch a learning journey.
4. Use the bottom navigation (or Alt+Arrow keys) to move between milestones.
5. Tabs persist while Grafana is open; close tabs from the tab header.

## Settings (optional)

Admins can configure the plugin from the app’s configuration page:
- Recommender service URL
- Docs base URL and credentials (if needed)
- Auto-launch tutorial URL (opens automatically on startup)

See: docs → App Configuration.

## Documentation

Developer and architecture docs have moved to the docs/ folder:

- Overview: `docs/overview.md`
- Components: `docs/components/README.md`
  - App: `docs/components/App/README.md`
  - AppConfig: `docs/components/AppConfig/README.md`
  - Docs Panel: `docs/components/docs-panel/README.md`
  - Feedback Button: `docs/components/FeedbackButton/README.md`
- Utils & Hooks: `docs/utils/README.md`
- Styles: `docs/styles/README.md`
- Constants: `docs/constants/README.md`
- Pages & Routing: `docs/pages/README.md`

For project architecture, see `ARCHITECTURE.md`.

## Contributing

We welcome issues and PRs. Please follow TypeScript + React best practices and our lint/typecheck CI.

## License

Apache-2.0. See `LICENSE`.
