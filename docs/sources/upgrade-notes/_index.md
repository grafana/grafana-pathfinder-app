---
title: Upgrade notes
menuTitle: Upgrade notes
description: Review changes that affect learners and administrators when upgrading Interactive learning, including completion tracking, organization controls, and sandbox migration.
weight: 60
review_date: 2026-09-30
---

# Upgrade notes

This section contains the headline changes for each Interactive learning release, including breaking changes and migration steps. For the full per-release detail, see the project [CHANGELOG](https://github.com/grafana/grafana-pathfinder-app/blob/main/CHANGELOG.md).

## Version 2.19: Organization controls and learning tracks

Administrators can disable Interactive learning for their organization from the plugin configuration page. In Grafana Cloud, this restores the classic **Help** menu after a page reload. Learning progress is preserved, and administrators can re-enable Interactive learning from the same configuration page. Follow [Disable Interactive learning](../administrators-reference/#disable-interactive-learning-in-grafana-cloud) for the procedure.

The organization setting must save successfully and load when users reload Grafana. If settings cannot be read, Interactive learning can remain enabled. Administrators should reload and verify the result after saving.

Learning paths can also offer named tracks alongside the **Foundations** sequence. Choose a track on the path's cover page to follow its guides and track your progress. Kiosk pages can now include launch forms and copyable commands alongside guide tiles.

No learner action is required to migrate existing content.

## Version 2.18.3: Shareable learning kiosks

Learning catalogs can be opened from a shareable kiosk URL without changing the instance-wide kiosk setting. Guides open on the current Grafana instance, and the kiosk includes an exit control. Opening a kiosk guide preserves the user's saved panel preferences.

No migration is required.

## Version 2.18: Progress and completion

**One-time effect for anyone with a guide in progress.** Completed guides, badges, streaks, and finished milestones are unaffected.

### What changed

Every guide now offers **Mark complete**, including guides that contain only reading material. In a learning path, **Mark complete and continue** completes the current milestone and opens the next one. Progress reflects completed work; moving to another milestone alone no longer earns completion credit. Previously awarded navigation progress can decrease.

Unfinished guides restart at the beginning once after this upgrade. The new storage format keeps similarly named guides from sharing step progress. Older in-progress step data cannot be assigned safely to a guide and is discarded.

A guide's percentage in the guide list can retain its previous value until you reopen it. Completed guides, badges, streaks, and finished milestones are retained.

### Action required

None.

## Version 2.16: Private learning paths and the Coda plugin

Version 2.16 adds stack-private guide packages and learning paths. Published content appears under **Custom guides**, and private paths have their own section in **My learning**. These features require the Pathfinder App Platform service on your stack.

**The Coda terminal migration is a breaking change for existing sandbox users.** It does not affect guides that do not use a sandbox.

### What changed

The sandbox VM and terminal backend has moved out of Interactive learning into a separate app plugin, `grafana-coda-app`. Interactive learning keeps the terminal panel and the guide block types (`terminal`, `terminal-connect`, `challenge`) and now talks to that plugin over a documented, versioned API.

This makes the sandbox terminal usable by any Grafana plugin rather than only Interactive learning, and reduces Interactive learning's own backend to a single purpose.

### Action required

If you use the Coda terminal:

1. Ask your sandbox administrator to install and enable the **Coda** app plugin (`grafana-coda-app`) and configure its service connection. Availability depends on your deployment.
1. Ask the administrator to register it for your Grafana instance and verify access for your learners.
1. Leave **Enable Coda terminal** switched on in Interactive learning's settings.

When migrating an existing installation:

- Obtain a new enrollment key from your Coda administrator. Grafana stores encrypted settings separately for each plugin, so the existing refresh token cannot be transferred from Interactive learning.
- Have your sandbox administrator register the plugin. Saving its configuration redeems the enrollment key; **Register now** is a recovery action, not a required second setup step.
- Verify the minimum session role if learners use the Viewer role. The separate Coda plugin defaults to requiring Editor or above to start a sandbox. Ask your sandbox administrator to configure access for your learners.

Until the Coda app plugin is installed and registered, Interactive learning hides the terminal panel and the terminal block types. Guides containing those blocks still load; the affected steps report that the sandbox is unavailable rather than failing. Interactive learning's configuration page names whichever step is still outstanding.

Interactive learning no longer reads `codaApiUrl`, `codaRelayUrl`, `codaRegistered`, or the enrollment key and refresh token it used to store — all five moved to the Coda app plugin. `enableCodaTerminal` stays, and still controls whether Interactive learning shows terminal UI at all.

Old Coda settings can remain in Interactive learning after migration. If you need the old credential revoked, ask your Coda administrator; migrating the terminal does not confirm revocation. Keep any required downgrade path in mind before removing old settings.

## Earlier upgrades

Earlier releases introduced the floating panel, the block editor without dev mode, and kiosk configuration. Use the current [getting-started guide](../getting-started/) and [block editor guide](../block-editor/) for today's controls.

If your authoring instructions still require dev mode to open the block editor, update them to use **More options** > **Create guide**. Users need the Editor or Admin role; dev mode is not required.

For individual changes before version 2.16, refer to the [changelog](https://github.com/grafana/grafana-pathfinder-app/blob/main/CHANGELOG.md).

## Version 1.1.83: New content delivery infrastructure

Interactive guides moved from GitHub raw URLs to Grafana's content delivery network at `interactive-learning.grafana.net`. Install a current, compatible plugin version to keep loading guides.

After upgrading and restarting Grafana, open Interactive learning and check that guides load. If your network restricts outbound connections, allow access to the guide content service.

## Get help after upgrading

If guides fail to load, confirm the installed plugin version and whether the instance can reach the content service. Report the guide name, failing step, and plugin version through **More options** > **Give feedback**, or open an issue in the [GitHub repository](https://github.com/grafana/grafana-pathfinder-app/issues).
