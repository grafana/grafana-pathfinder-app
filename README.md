# Grafana Pathfinder

![Grafana Pathfinder](https://raw.githubusercontent.com/grafana/docs-plugin/refs/heads/main/src/img/logo.svg)

[![License](https://img.shields.io/github/license/grafana/docs-plugin)](LICENSE)

Get help exactly when and where you need it. Grafana Pathfinder brings contextual documentation and interactive tutorials directly into Grafana, so you can learn and build without leaving your workflow.

## What is Grafana Pathfinder?

Grafana Pathfinder is your in-app learning companion. It provides:

- **Smart recommendations** – Get relevant docs and tutorials based on what you're working on
- **Interactive tutorials** – Follow step-by-step guided learning journeys with "Show Me" and "Do It" features
- **Tab-based navigation** – Open multiple docs and tutorials in tabs, just like a browser
- **Milestone tracking** – See your progress through learning journeys with clear milestones
- **Always available** – Access help without switching windows or searching documentation sites

## How to Access Pathfinder

1. Look for the **Help** button (?) in the top navigation bar of Grafana
2. Click the Help button to open the Pathfinder panel
3. Browse recommended documentation based on your current context
4. Click **View** to read a doc or **Start** to begin an interactive tutorial

## Getting Started

Once you open Pathfinder:

1. **Review recommendations** – See docs and tutorials tailored to what you're doing in Grafana
2. **Open content in tabs** – Click "View" or "Start" to open content in a new tab
3. **Navigate tutorials** – Use the milestone navigation at the bottom to move through learning journeys
4. **Try interactive features** – Click "Show Me" to see where things are, or "Do It" to have Pathfinder guide you through actions
5. **Manage your tabs** – Close tabs you're done with, or keep them open for reference

## Keyboard Shortcuts

- `Alt + Left Arrow` – Previous milestone
- `Alt + Right Arrow` – Next milestone

## For Administrators

### Discovering Pathfinder

Users can find Grafana Pathfinder in multiple ways:

- **Help button** – Click the Help (?) button in the top navigation
- **Command palette** – Search for "Grafana Pathfinder", "Need help?", or "Learn Grafana" in the command palette (`Cmd+K` or `Ctrl+K`)

### Configuration Options

Admins can configure Pathfinder from the plugin's configuration page in Grafana. The configuration includes three sections:

#### 1. Configuration (Basic Settings)

- **Auto-launch tutorial URL** – Set a specific learning journey or documentation page to automatically open when Grafana starts (useful for demos and onboarding)
- **Global link interception** – (Experimental) When enabled, clicking documentation links anywhere in Grafana will open them in Pathfinder instead of a new tab

#### 2. Recommendations

- **Context-aware recommendations** – Enable/disable recommendation service that provides personalized documentation based on your current actions in Grafana
- **Data usage controls** – Review what data is collected and toggle the feature on or off

#### 3. Interactive Features

- **Auto-completion detection** – (Experimental) Enable automatic step completion when users perform actions themselves (without clicking "Do it" buttons)
- **Timing settings** – Configure timeouts for requirement checks and guided steps to optimize the tutorial experience

## Contributing

We welcome feedback, issues, and contributions. Visit our [GitHub repository](https://github.com/grafana/grafana-pathfinder-app) to get involved.

## License

See [CHANGELOG.md](./CHANGELOG.md) for details on project changes and license information.
