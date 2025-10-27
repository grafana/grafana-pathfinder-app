---
title: Getting started
menuTitle: Getting started
description: Learn how to enable and use the Interactive learning plugin.
weight: 1
---

# Getting started

Interactive learning is currently available in public preview for Grafana OSS and will soon be arriving to Grafana Cloud. Below are the steps to enable interactive learning within your Grafana instance and how to use it.

## Enable Interactive learning

To enable Interactive learning, you need to either deploy or update your Grafana instance with the following feature flag: `interactiveLearning` or installing the plugin from the Grafana Labs plugin repository. Choose the method that best suits your deployment method.

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
1. Search for "Interactive learning".
1. Click on the plugin card to open the plugin details page.
1. Click **Install** to install the plugin.

**Using the Grafana CLI:**

```bash
grafana cli plugins install grafana-pathfinder-app
```

After installation, restart your Grafana instance.

## Finding the Interactive learning sidebar

After enabling Interactive leaning, you can start using it by clicking the "Help" button in the top navigation bar of Grafana. This will open the Interactive learning sidebar. You can then browse the recommendations and click on any item to view the documentation or tutorial.

![Interactive learning sidebar](/media/docs/pathfinder/getting-started-panel-open.png)


You can also use the command palette to open the Interactive learning sidebar. Search for "Interactive learning", "Need help?", or "Learn Grafana" in the command palette (`Cmd+K` or `Ctrl+K`).

## Try out an interactive tutorial

If you are new to Grafana and want to learn where everything is located, you can try out the "Welcome to Grafana" tutorial. This tutorial will guide you through the main areas of Grafana and help you get familiar with the interface. To try this tutorial click `View` on the "Welcome to Grafana" recommendation.

![Recommendation card](/media/docs/pathfinder/welcome-to-grafana-recommendation.png)

This will open the "Welcome to Grafana" tutorial in a new tab. You can then follow the steps in the tutorial by clicking the "show me" button to see the next step.

### Interactive elements

The interactive tutorial will guide you through the main areas of Grafana and help you get familiar with the interface. It will also show you how to use the interactive elements of the tutorial.

![Welcome to Grafana tutorial](/media/docs/pathfinder/welcome-to-grafana-tutorial.png)

#### Show me

The "Show me" button will show you the next step in the tutorial by highlighting the next step. Steps by also have optional text shown along side the highlighted element. The optional text and highlight box can be removed by either clicking somewhere else on the page, scrolling or clicking the "do it" button. Clicking the "show me" button again will reset the highlight and text.

![Example of a highlight step](/media/docs/pathfinder/highlight.png)

#### Do it

The "Do it" button will execute the action of the current step in the tutorial. There are several types of actions that can be executed:
* highlight / button - This will interact with the highlighted element using a mouse click.
* formfill - This will interact with a form fill element by setting the value of the element.
* navigate - This will navigate to a new page.
* multistep - This will execute a sequence of actions in a specific order. These are shown as "do it" only buttons.
* guided - This will request the user to perform the action manually using a series of highlighted elements.

![Example of a do it button](/media/docs/pathfinder/doit.png)

Currently the only way to mark a step as complete is to click the "do it" button. We have an experimental feature feature that tracks user actions and marks a step as complete when the user performs the action. This feature will need to be enabled by your Grafana administrators. See [Enable the auto-completion feature](/docs/pathfinder/enable-the-auto-completion-feature/) for more information.