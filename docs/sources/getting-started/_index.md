---
title: Getting started
menuTitle: Getting started
description: Learn how to enable and use the Interactive learning plugin.
weight: 1
---

# Getting started

Interactive learning is currently available in public preview for open source Grafana and is rolling out to Grafana Cloud. This guide shows you how to enable Interactive learning in your Grafana instance and how to use it.

## Enable Interactive learning

You can enable Interactive learning by deploying or updating your Grafana instance with the `interactiveLearning` feature flag, or by installing the plugin from the Grafana plugin repository. Choose the method that best suits your deployment.

### Using a feature flag (recommended)

To enable the feature flag, add the following to your Grafana configuration:

**Using configuration file (`grafana.ini` or `custom.ini`):**

```ini
[feature_toggles]
enable = interactiveLearning
```

**Using environment variables:**

```bash
GF_FEATURE_TOGGLES_ENABLE=interactiveLearning
```

**Using Docker:**

```bash
docker run -d \
  -p 3000:3000 \
  -e "GF_FEATURE_TOGGLES_ENABLE=interactiveLearning" \
  grafana/grafana:latest
```

After enabling the feature flag, restart your Grafana instance.

### Using the plugin repository (UI or CLI)

Alternatively, you can install Interactive learning as a plugin from the Grafana plugin repository.

**Using the Grafana UI:**

1. Navigate to **Administration** > **Plugins and data** > **Plugins**.
1. Search for `Interactive learning`.
1. Click the plugin card to open the plugin details page.
1. Click **Install** to install the plugin.

**Using the Grafana CLI:**

```bash
grafana cli plugins install grafana-pathfinder-app
```

After installation, restart your Grafana instance.

## Open the Interactive learning sidebar

After enabling Interactive learning, click the **Help** button in the top navigation bar of Grafana to open the Interactive learning sidebar. You can then browse the recommendations and click any item to view the documentation or guide.

![Interactive learning sidebar](/media/docs/pathfinder/getting-started-panel-open.png)

You can also use the command palette to open the sidebar — search for `Interactive learning`, `Need help?`, or `Learn Grafana` by pressing **Cmd+K** on macOS or **Ctrl+K** on Windows and Linux.

## Try out an interactive guide

If you're new to Grafana and want to learn where everything is located, try the **Welcome to Grafana** guide. To start it, click **View** on the **Welcome to Grafana** recommendation.

![Recommendation card](/media/docs/pathfinder/welcome-to-grafana-recommendation.png)

The guide opens in a new tab. Follow the steps by clicking the **Show me** button to highlight each step.

### Interactive elements

The guide walks you through the main areas of Grafana and shows you how to use the interactive elements.

![Welcome to Grafana guide](/media/docs/pathfinder/welcome-to-grafana-tutorial.png)

#### Show me

The **Show me** button highlights the next step in the guide. Steps can have optional text shown alongside the highlighted element. You can dismiss the highlight box by clicking somewhere else on the page, scrolling, or clicking **Do it**. Clicking **Show me** again resets the highlight.

![Example of a highlight step](/media/docs/pathfinder/highlight.png)

#### Do it

The **Do it** button performs the action for the current step. Several action types can run:

- **Highlight / button** — Clicks the highlighted element.
- **Form fill** — Fills an input field with a specific value.
- **Navigate** — Moves to a different page in Grafana.
- **Hover** — Hovers over an element to reveal hover-only UI (such as menu options or row actions).
- **Multistep** — Runs a sequence of actions automatically.
- **Guided** — Highlights each step and waits for you to perform the action yourself.
- **Popout** — Docks or undocks the guide between the sidebar and a floating window.

![Example of a do it button](/media/docs/pathfinder/doit.png)

The default way to mark a step complete is to click **Do it**. Administrators can also enable an experimental auto-completion feature that detects when you perform the action yourself. For more information, refer to the [Administrators reference](../administrators-reference/).

## The floating panel

If you need the right sidebar for something else (for example, Grafana Assistant) while a guide is open, click the **Pop out** button at the top of the panel to detach the guide into a floating, resizable, draggable window. Drag it anywhere on screen, resize it from any edge, or minimize it to a small pill. Click **Pop out** again or drag the window to the right edge of the screen to dock it back into the sidebar.

Guide authors can also build a `popout` action into their guide steps so the guide automatically moves out of the way when needed.

## Author your own guide

Editors and admins can create custom interactive guides directly inside Grafana with the **block editor**, then publish them to the docs panel for everyone on the instance. See the [Block editor guide](../block-editor/) for the full workflow.

## Tabs, milestones, and progress

Each guide opens as a tab in the docs panel — you can keep several guides open at once and switch between them like browser tabs. Guides that are part of a learning path show milestones in a footer; navigate between them with the arrow buttons or use the keyboard shortcuts:

- **Alt + Left arrow** — previous milestone.
- **Alt + Right arrow** — next milestone.

Progress through guides and learning paths is tracked in the **My learning** tab — you can see what you've completed, what's in progress, and what badges you've earned.
