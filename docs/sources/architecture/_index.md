---
title: Interactive learning architecture
menuTitle: Architecture
description: Understand where Interactive learning gets guides, how actions run in Grafana, what contextual data recommendations use, and how guides and progress are stored.
weight: 40
review_date: 2026-09-30
---

# Interactive learning architecture

Interactive learning, also called Pathfinder, displays documentation and guides alongside your work in Grafana. This page explains its content sources, permissions, and storage so you can decide how to use it in your organization.

## Where content comes from

| Content source                 | What it provides                                                                         | Availability                                                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Bundled content                | Guides included with the plugin.                                                         | Available without the recommendation service. Individual guide assets or steps can still need a network connection. |
| Grafana's public guide catalog | Additional guides, learning paths, and journeys from Grafana's content delivery network. | Requires access to the content service.                                                                             |
| Context-aware recommendations  | Suggestions based on the Grafana page and features you are using.                        | Enabled by default in Grafana Cloud; requires administrator opt-in on self-managed Grafana.                         |
| Custom guides                  | Content your organization's authors save and publish.                                    | Requires the Pathfinder storage service and appropriate permissions.                                                |
| Grafana documentation          | Reference documentation and tutorials opened in the panel.                               | Requires access to the documentation site.                                                                          |

Turning off recommendations stops requests to the recommendation service. It does not turn off Interactive learning or all network requests: an online browser can still load the public catalog, guides, and documentation. If the recommendation service is unavailable, Pathfinder uses available fallback content.

For the controls, refer to [Administrator reference](../administrators-reference/).

## How interactive actions work

Guides render inside Grafana and interact with the page you are viewing. They can include explanations, images, code, questions, interactive steps, and hands-on challenges.

- **Show me** highlights the relevant part of the interface.
- **Do it** performs the described action, such as clicking a button, filling a field, or navigating.
- **Guided steps** wait for you to perform actions yourself.
- **Challenges and quizzes** let you practice and check your understanding.

Actions use your existing Grafana session and permissions. A guide does not grant access to a data source, dashboard, or administrative action that you cannot otherwise use. Review steps before running them: actions can change resources in your Grafana instance.

A step can check prerequisites such as the current page, a required data source, or a visible control. If a prerequisite is missing, the guide explains what is needed. Some failures offer **Fix this** to help recover. Where enabled and available, Grafana Assistant can suggest a repair for a missing target; accepting a suggestion changes the current session's guide, not the published source.

## What recommendation requests contain

The recommendation service receives a selected set of context, rather than the complete page or dashboard:

| Context                                        | Purpose                                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Current page path and contextual tags          | Identify the Grafana feature and activity.                                                        |
| Data source types                              | Suggest relevant data source content.                                                             |
| Grafana role, platform, and interface language | Select suitable recommendations.                                                                  |
| User identifier and email                      | Use hashed values in Grafana Cloud and generic values on self-managed Grafana.                    |
| Instance source                                | Identify the Grafana Cloud hostname; self-managed instances generally use a generic source value. |

Dashboard metadata is processed locally and is not included as dashboard content in the recommendation request. The request sends data source types, not data source credentials or query results.

The [Terms and conditions](../terms-and-conditions/) page reproduces the recommendation data usage notice shown in Grafana. An administrator can stop context-aware requests on the **Recommendations** tab.

## Where custom guides are stored

The block editor keeps a working copy in the browser. Saving a draft or publishing a guide writes to a separate Pathfinder storage service through Grafana. The plugin's backend forwards these requests; installing the plugin alone does not provide that storage service.

| Guide state        | Who can use it                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| Local working copy | The author in that browser. Export a copy to protect against cleared browser storage.                         |
| Saved draft        | Authors with the required access can load it from the guide library. It is absent from the published catalog. |
| Published guide    | Users in the same Grafana organization can open it from the custom guide catalog.                             |

Custom guides are scoped to their Grafana organization. Publishing a guide does not publish it on Grafana's public documentation site or copy it to other stacks. To move a guide, export it and import it on the destination instance.

For procedures and storage limitations, refer to the [Block editor guide](../block-editor/).

## Learning progress and display preferences

Pathfinder tracks step progress, guide completion, and learning-path milestones. **My learning** brings together learning paths, completed content, and earned badges. Paths can offer alternative tracks and a sequence of milestones.

Browser storage retains working state such as open tabs and in-progress steps. Some learning state also uses Grafana user storage, and installations with the completion service can save completion records on the server. Do not assume that every in-progress step or local draft follows you to another browser. Clearing browser storage can remove local state.

Closing the sidebar does not reset learning progress. The **Enable interactive learning** administrator setting also preserves existing progress when disabled. Use the guide's reset control when you want to repeat it from the beginning.

Guides can appear in the sidebar, a floating panel, or full screen. The optional **Open in interactive window** feature uses a paired browser tab to control the original Grafana tab. It requires administrator enablement and explicit pairing.

## Optional services

### Sandbox terminals

Some guides use a temporary sandbox instead of your own infrastructure. Sandbox terminals require the separate Coda app plugin and its service configuration. Interactive learning provides the guide and terminal interface; Coda provides the sandbox. The terminal shows its remaining lifetime. Availability, templates, and permitted user roles depend on the instance configuration.

### Live sessions

Experimental live sessions let a presenter share guide actions with attendees. They require a signalling service to connect participants' browsers. Each attendee's guide actions run with that attendee's Grafana permissions.

### Grafana Assistant

Some guides offer customization or repair through Grafana Assistant. These controls depend on Assistant availability and the applicable settings. Reading guides and using their standard interactive actions does not require Assistant.
