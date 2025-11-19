---
title: Getting started
menuTitle: Getting started
description: Learn how to enable and use the Interactive learning plugin.
weight: 1
---

# Getting started

Interactive learning is currently available in public preview for open source Grafana and will soon arrive in Grafana Cloud. This guide shows you how to enable Interactive learning in your Grafana instance and how to use it.

## Enable Interactive learning

You can enable Interactive learning by deploying or updating your Grafana instance with the `interactiveLearning` feature flag, or by installing the plugin from the Grafana plugin repository. Choose the method that best suits your deployment.

### Using a feature flag (Recommended)

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
1. Click on the plugin card to open the plugin details page.
1. Click **Install** to install the plugin.

**Using the Grafana CLI:**

```bash
grafana cli plugins install grafana-pathfinder-app
```

After installation, restart your Grafana instance.

## Finding the Interactive learning sidebar

After enabling Interactive learning, you can start using it by clicking the **Help** button in the top navigation bar of Grafana. This opens the Interactive learning sidebar. You can then browse the recommendations and click on any item to view the documentation or guide.

![Interactive learning sidebar](/media/docs/pathfinder/getting-started-panel-open.png)

You can also use the command palette to open the Interactive learning sidebar. Search for `Interactive learning`, `Need help?`, or `Learn Grafana` in the command palette by pressing **Cmd+K** on macOS or **Ctrl+K** on Windows and Linux.

## Try out an interactive guide

If you're new to Grafana and want to learn where everything is located, try the **Welcome to Grafana** guide. This guide take you through the main areas of Grafana and helps you get familiar with the interface. To start this guide, click **View** on the **Welcome to Grafana** recommendation.

![Recommendation card](/media/docs/pathfinder/welcome-to-grafana-recommendation.png)

This opens the **Welcome to Grafana** guide in a new tab. You can then follow the steps in the guide by clicking the **Show me** button to see each step.

### Interactive elements

The interactive guide guides you through the main areas of Grafana and helps you get familiar with the interface. It also shows you how to use the interactive elements of the guide.

![Welcome to Grafana guide](/media/docs/pathfinder/welcome-to-grafana-tutorial.png)

#### Show me

The **Show me** button shows you the next step in the tutorial by highlighting it. Steps can also have optional text shown alongside the highlighted element. You can remove the optional text and highlight box by clicking somewhere else on the page, scrolling, or clicking the **Do it** button. Clicking the **Show me** button again resets the highlight and text.

![Example of a highlight step](/media/docs/pathfinder/highlight.png)

#### Do it

The **Do it** button executes the action of the current step in the tutorial. Several types of actions can be executed:

- **Highlight/button** - Interacts with the highlighted element using a mouse click.
- **Form fill** - Interacts with a form fill element by setting the value of the element.
- **Navigate** - Navigates to a new page.
- **Multistep** - Executes a sequence of actions in a specific order. These are shown as **Do it** only buttons.
- **Guided** - Requests that you perform the action manually using a series of highlighted elements.

![Example of a do it button](/media/docs/pathfinder/doit.png)

Currently, the only way to mark a step as complete is to click the **Do it** button. An experimental feature tracks user actions and marks a step as complete when you perform the action. Your Grafana administrators must enable this feature. For more information, refer to the [Administrators reference](/docs/grafana/latest/pathfinder/administrators-reference/).
