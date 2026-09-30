---
title: Get started with Interactive learning
menuTitle: Get started
description: Open Interactive learning in Grafana Cloud or self-managed Grafana, follow your first interactive guide, track learning progress, and find help when a step cannot run.
weight: 10
review_date: 2026-09-30
---

# Get started with Interactive learning

Interactive learning, also called Pathfinder, helps you learn Grafana while you use it. Open a guide alongside your work, find the relevant controls with **Show me**, and use **Do it** to perform a step.

Interactive learning is in public preview. Available features depend on your Grafana version, instance configuration, and permissions.

## Grafana Cloud

On a Grafana Cloud stack where Interactive learning is available, select **Help** in the top navigation bar to open the sidebar. You do not need to edit a configuration file or install the plugin yourself.

If **Help** opens the classic menu, your administrator might have disabled Pathfinder or the feature might not be available on the stack. Ask an administrator to check the [Interactive learning settings](../administrators-reference/#disable-interactive-learning-in-grafana-cloud).

## Self-managed Grafana

The current plugin requires Grafana 12.3 or later. You need permission to install plugins and restart Grafana.

### Install from the plugin catalog

1. Open **Administration** > **Plugins and data** > **Plugins**.
1. Search for `Interactive learning` and open the plugin page.
1. Select **Install**.
1. Restart Grafana if your installation requires it.

Alternatively, install it with the Grafana CLI and restart Grafana:

```bash
grafana cli plugins install grafana-pathfinder-app
```

### Enable automatic installation with a feature toggle

Grafana versions that support `interactiveLearning` can install the plugin when the toggle is enabled, provided plugin preinstallation is allowed. Add it to the enabled toggles in `grafana.ini` or `custom.ini`:

```ini
[feature_toggles]
enable = interactiveLearning
```

For an environment-based configuration, set:

```bash
GF_FEATURE_TOGGLES_ENABLE=interactiveLearning
```

Preserve any other feature toggles you already enable, then restart Grafana. If your deployment disables plugin preinstallation, use your usual plugin installation process instead.

Context-aware recommendations require a separate administrator opt-in on self-managed Grafana. Bundled guides are available without it. Refer to [Configure recommendations](../administrators-reference/#configure-recommendations).

## Open a guide

1. Select **Help** in Grafana's top navigation bar.
1. Select **Recommendations** in the sidebar.
1. Find a guide relevant to what you want to learn and select **Start**, or **Resume** if you have already started it.
1. Read the introduction and any prerequisites before running the steps.

Recommendations change with your Grafana page and configuration, so the guides you see can differ from another user's. A learning path can open a cover page with milestones and, where provided, a choice of tracks.

You can also open the command palette with **Cmd+K** on macOS or **Ctrl+K** on Windows and Linux, then search for `Interactive learning`, `Need help?`, or `Learn Grafana`.

## Follow interactive steps

### Find a control with Show me

Select **Show me** to highlight the control a step refers to. Read the instruction, then perform the action yourself or select **Do it**.

### Run an action with Do it

Select **Do it** to perform the described action. Depending on the step, it can click a control, fill a field, navigate to another page, or run several actions. **Do section** runs the supported actions in a section. A guided sequence instead waits for you to perform each action yourself.

{{< admonition type="caution" >}}
Guide actions run in your current Grafana instance with your permissions. Read the step before running it, particularly when it creates or changes a dashboard, alert, or other resource.
{{< /admonition >}}

### Track completion

Automatic detection is enabled by default for supported actions, so steps can complete when you perform them yourself. Your administrator can change this setting. Quizzes, inputs, and challenges have their own completion checks.

The guide's progress indicator reflects completed steps. Use **Mark complete**, or **Mark complete and continue** in a learning path, when you want to mark the guide complete yourself. Merely opening the last milestone does not complete the whole path.

## Use learning paths and My learning

A learning path groups related guides into milestones. Open **My learning** to browse learning paths and review your progress and badges. Private paths published for your organization appear separately from public learning content when available.

Use a path's milestone controls to move between guides. Within a learning path, you can also use:

- **Alt + Left arrow** for the previous milestone.
- **Alt + Right arrow** for the next milestone.

A path can provide multiple tracks for different approaches or environments. Choose the track that matches your goal before starting its milestones.

Open guides remain in tabs so you can switch between them. Closing the sidebar does not reset your progress. Some working state is stored in your browser; do not assume every unfinished step follows you to another browser.

## Give a guide more space

Guide controls offer different layouts:

- **Pop out** moves the guide into a draggable, resizable panel on the same page. Use **Dock** to return it to the sidebar.
- **Full screen** gives the guide more room. Use the back control to return to your previous view.
- **Open in interactive window**, if enabled by your administrator, opens a separate browser tab and requires pairing with the original Grafana tab.

Depending on the guide and current layout, these controls appear in the guide toolbar or its menu.

## If a step cannot run

1. Read the step's prerequisite or error message.
1. Check that you are on the expected Grafana page and have access to the required data source or resource.
1. Complete any earlier steps that open the required controls, then retry.
1. Use **Fix this** if the guide offers it. Some repairs require Grafana Assistant and administrator enablement.

For broader problems, reload Grafana and reopen the guide. Use **More options** > **Give feedback** to report an issue, including the guide name and step that failed.

## Create guides for your team

Users with the Editor or Admin role can select **More options** > **Create guide** in the sidebar to open the block editor. Saving and publishing depends on storage availability and permissions on your instance. Refer to the [Block editor guide](../block-editor/) for the full workflow.
