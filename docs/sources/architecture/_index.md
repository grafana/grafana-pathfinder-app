---
title: Architecture
menuTitle: Architecture
description: Understand how the Interactive learning plugin operates and how it communicates with the Recommender service.
weight: 1
---

# Interactive learning architecture

Interactive learning is an app-based plugin built using the Grafana plugin SDK. Its primary mount point is the Extension Sidebar. This is the same mount point that Grafana Assistant uses, which allows both applications to operate in any part of the Grafana UI.

## The components of Interactive learning

Interactive learning has three main components:

- Context retrieval - Retrieves the context of the current page in Grafana.
- Documentation rendering - Renders the selected documentation or guide.
- Interactive engine - Facilitates the interactive features within the documentation or guide.

![Interactive Learning architecture](/media/docs/pathfinder/architecture.png)

## Context retrieval

Context retrieval is the process of retrieving the context of the current page in Grafana, as well as other relevant data points such as the current user role, datasource types, and contextual tags. The following table outlines the full set of data points that the context retrieval component collects.

{{< fixed-table >}}

| Metric                | Example                                                | Description                                                                           | Sent to Recommender   |
| --------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------- | --------------------- |
| **currentPath**       | `/explore`                                             | Current URL pathname from Grafana location service                                    | Yes (as `path`)       |
| **currentUrl**        | `/explore?left={"datasource":"prometheus"}`            | Full URL including pathname, search params, and hash                                  | No                    |
| **pathSegments**      | `['d', 'abc123', 'my-dashboard']`                      | URL path split into segments for entity/action detection                              | No                    |
| **dataSources**       | `[{id: 1, name: 'Prometheus', type: 'prometheus'}]`    | Array of configured datasources from Grafana API                                      | Yes (types only)      |
| **dashboardInfo**     | `{id: 5, title: 'My Dashboard', uid: 'abc123'}`        | Dashboard metadata when viewing a dashboard                                           | No                    |
| **tags**              | `['dashboard:edit', 'selected-datasource:prometheus']` | Contextual tags derived from path, actions, datasources, and user interactions        | Yes                   |
| **visualizationType** | `timeseries`, `gauge`, `table`                         | Detected panel/visualization type from EchoSrv events when creating or editing panels | No (included in tags) |
| **grafanaVersion**    | `11.3.0`                                               | Current Grafana version from build info                                               | No                    |
| **timestamp**         | `2025-10-27T10:30:00.000Z`                             | ISO timestamp when context was retrieved                                              | No                    |
| **searchParams**      | `{editPanel: '2', tab: 'queries'}`                     | URL query parameters as key-value pairs                                               | No                    |
| **user_id**           | `a1b2c3...` (hashed)                                   | Hashed user identifier for Cloud users, generic `oss-user` for OSS                    | Yes                   |
| **user_email**        | `d4e5f6...` (hashed)                                   | Hashed user email for Cloud users, generic `oss-user@example.com` for OSS             | Yes                   |
| **user_role**         | `Admin`, `Editor`, `Viewer`                            | User's organization role from Grafana                                                 | Yes                   |
| **platform**          | `cloud` or `oss`                                       | Whether running on Grafana Cloud or self-hosted OSS                                   | Yes                   |
| **source**            | `instance123.grafana.net` or `oss-source`              | Cloud instance hostname or generic OSS identifier                                     | Yes                   |

{{< /fixed-table >}}

### The recommender service

The recommender service is a REST API that generates recommendations based on context data. Grafana Labs creates and hosts this service to generate recommendations for the Interactive learning plugin. The service uses pattern matching on the context data to generate recommendations.

{{< admonition type="note" >}}
The recommender service is disabled by default for open source Grafana users. Grafana administrators can enable it by navigating to the plugin configuration and toggling the **Enable context-aware recommendations** switch. For more information, refer to the [Administrators reference](/docs/grafana/latest/pathfinder/administrators-reference/).
{{< /admonition >}}

## Documentation rendering

The documentation rendering component renders documentation or guide content. The system parses documentation into a React component tree rather than rendering it in an iframe. This approach allows the documentation to render in the same way as the rest of the Grafana UI, using the same components and styles. It also allows rendering images and videos directly in the sidebar. The renderer covers most elements of documentation and guide content. If you notice a rendering issue, let us know by [opening an issue](https://github.com/grafana/grafana-pathfinder-app/issues/new).

## Interactive engine

The interactive engine provides interactive features within documentation or guides. It powers the **Show me** and **Do it** buttons, as well as interactive elements and the requirements and objectives system. The following components make up the interactive engine:

- **Show me button** - Shows the next step in the documentation or guide.
- **Do it button** - Executes the action of the current step in the documentation or guide.
- **Do section button** - Executes the action of the current section in the documentation or guide.
- **Guided steps** - Steps that guide users through actions by clicking a button to start.
- **Multistep steps** - Steps that execute in sequence after clicking a button to start.
- **Requirements and objectives system** - Checks if users have completed requirements and objectives for the current step.

### Tracking user progress

Interactive learning uses localStorage to track user progress for interactive features within documentation or guides. Guide progression resets when a user closes the guide tab. Tabs and progression persist across sessions until the user closes the tab.
