# Interactive learning Plugin

![Interactive learning](https://raw.githubusercontent.com/grafana/docs-plugin/refs/heads/main/src/img/logo.svg)

[![License](https://img.shields.io/github/license/grafana/docs-plugin)](LICENSE)

Get help exactly when and where you need it. Interactive learning brings contextual documentation and interactive guides directly into Grafana, so you can learn and build without leaving your workflow.

## What is Interactive learning?

Interactive learning is your in-app learning companion. It provides:

- **Smart recommendations** – Get relevant docs and guides based on what you're working on
- **Interactive guides** – Follow step-by-step guided learning journeys with "Show Me" and "Do It" features
- **Tab-based navigation** – Open multiple docs and guides in tabs, just like a browser
- **Milestone tracking** – See your progress through learning journeys with clear milestones
- **Always available** – Access help without switching windows or searching documentation sites

## How to Access Interactive learning

1. Look for the **Help** button (?) in the top navigation bar of Grafana
2. Click the Help button to open the Interactive learning panel
3. Browse recommended documentation based on your current context
4. Click **View** to read a doc or **Start** to begin an interactive guides

## Getting Started

Once you open Interactive learning:

1. **Review recommendations** – See docs and guides tailored to what you're doing in Grafana
2. **Open content in tabs** – Click "View" or "Start" to open content in a new tab
3. **Navigate guides** – Use the milestone navigation at the bottom to move through learning journeys
4. **Try interactive features** – Click "Show Me" to see where things are, or "Do It" to have Interactive learning guide you through actions
5. **Manage your tabs** – Close tabs you're done with, or keep them open for reference

## Keyboard Shortcuts

- `Alt + Left Arrow` – Previous milestone
- `Alt + Right Arrow` – Next milestone

## For Administrators

### Discovering Interactive learning

Users can find Interactive learning in multiple ways:

- **Help button** – Click the Help (?) button in the top navigation
- **Command palette** – Search for "Interactive learning", "Need help?", or "Learn Grafana" in the command palette (`Cmd+K` or `Ctrl+K`)

### Configuration Options

Admins can configure Interactive learning from the plugin's configuration page in Grafana. The configuration includes three sections:

#### 1. Configuration (Basic Settings)

- **Auto-launch guide URL** – Set a specific learning journey or documentation page to automatically open when Grafana starts (useful for demos and onboarding)
- **Global link interception** – (Experimental) When enabled, clicking documentation links anywhere in Grafana will open them in Interactive learning instead of a new tab

#### 2. Recommendations

- **Context-aware recommendations** – Enable/disable recommendation service that provides personalized documentation based on your current actions in Grafana
- **Data usage controls** – Review what data is collected and toggle the feature on or off

#### 3. Interactive Features

- **Auto-completion detection** – (Experimental) Enable automatic step completion when users perform actions themselves (without clicking "Do it" buttons)
- **Timing settings** – Configure timeouts for requirement checks and guided steps to optimize the guide experience

## Creating Interactive Guides

Interactive learning supports creating custom interactive guides in JSON format. These guides combine content (markdown, images, video) with interactive elements that can highlight UI elements, click buttons, and fill forms.

### Documentation

- **[JSON Guide Format Reference](docs/developer/interactive-examples/json-guide-format.md)** - Complete reference for the JSON guide structure and all block types
- **[HTML to JSON Migration Guide](docs/developer/interactive-examples/html-to-json-migration.md)** - How to convert existing HTML guides to JSON format
- **[Requirements Reference](docs/developer/interactive-examples/requirements-reference.md)** - Available requirements for controlling when interactive elements are accessible

### Quick Example

```json
{
  "id": "my-guide",
  "title": "My Interactive Guide",
  "blocks": [
    {
      "type": "markdown",
      "content": "# Welcome\n\nThis guide shows you how to navigate Grafana."
    },
    {
      "type": "interactive",
      "action": "highlight",
      "reftarget": "a[href='/dashboards']",
      "requirements": ["navmenu-open"],
      "content": "Click **Dashboards** to see your visualizations."
    }
  ]
}
```

See the [JSON Guide Demo](src/bundled-interactives/json-guide-demo.json) for a complete example of all block types.

## Contributing

We welcome feedback, issues, and contributions. Visit our [GitHub repository](https://github.com/grafana/grafana-pathfinder-app) to get involved.

## License

See [CHANGELOG.md](./CHANGELOG.md) for details on project changes and license information.
