---
title: Architecture
menuTitle: Architecture
description: Understand how the Interactive learning plugin operates and how it communicates with the Recommender service.
weight: 1
---

# Interactive learning architecture

Interactive learning is a app based plugin built using the Grafana plugin SDK. Its primary mount point is the Extension Sidebar. This is the same mount point that the Grafana Assistant uses which allows both applications to operate in any part of the Grafana UI.

## The components of Interactive learning

Interactive learning has three main components:

- Context retrieval - Retrieves the context of the current page in Grafana.
- Documentation rendering - Renders the selected documentation or tutorial.
- Interactive engine - Facilitates the interactive features within the documentation or tutorial.

![Interactive Learning architecture](/media/pathfinder/architecture.png)

## Context retrieval

Context retrieval is the process of retrieving the context of the current page in Grafana, aswell as other relevant data points such as the current user role, datasource types and contextual tags. The table below outlines the full set of data points that the context retrieval component collects.

{{< fixed-table >}}

| Metric                           | Example                                                | Description                                                                                          | Sent to Recommender   |
| -------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | --------------------- |
| **currentPath**                  | `/explore`                                             | Current URL pathname from Grafana location service                                                   | Yes (as `path`)       |
| **currentUrl**                   | `/explore?left={"datasource":"prometheus"}`            | Full URL including pathname, search params, and hash                                                 | No                    |
| **pathSegments**                 | `['d', 'abc123', 'my-dashboard']`                      | URL path split into segments for entity/action detection                                             | No                    |
| **dataSources**                  | `[{id: 1, name: 'Prometheus', type: 'prometheus'}]`    | Array of configured datasources from Grafana API                                                     | Yes (types only)      |
| **dashboardInfo**                | `{id: 5, title: 'My Dashboard', uid: 'abc123'}`        | Dashboard metadata when viewing a dashboard                                                          | No                    |
| **tags**                         | `['dashboard:edit', 'selected-datasource:prometheus']` | Contextual tags derived from path, actions, datasources, and user interactions                       | Yes                   |
| **visualizationType**            | `timeseries`, `gauge`, `table`                         | Detected panel/visualization type from EchoSrv events when creating or editing panels                | No (included in tags) |
| **grafanaVersion**               | `11.3.0`                                               | Current Grafana version from build info                                                              | No                    |
| **timestamp**                    | `2025-10-27T10:30:00.000Z`                             | ISO timestamp when context was retrieved                                                             | No                    |
| **searchParams**                 | `{editPanel: '2', tab: 'queries'}`                     | URL query parameters as key-value pairs                                                              | No                    |
| **user_id**                      | `a1b2c3...` (hashed)                                   | Hashed user identifier for Cloud users, generic `oss-user` for OSS                                   | Yes                   |
| **user_email**                   | `d4e5f6...` (hashed)                                   | Hashed user email for Cloud users, generic `oss-user@example.com` for OSS                            | Yes                   |
| **user_role**                    | `Admin`, `Editor`, `Viewer`                            | User's organization role from Grafana                                                                | Yes                   |
| **platform**                     | `cloud` or `oss`                                       | Whether running on Grafana Cloud or self-hosted OSS                                                  | Yes                   |
| **source**                       | `instance123.grafana.net` or `oss-source`              | Cloud instance hostname or generic OSS identifier | Yes                   |
{{< /fixed-table >}}

### The recommender service

The recommender service is a REST API that is used to generate recommendations based on the context data. It is created and hosted by Grafana Labs and is used to generate recommendations for the Interactive learning plugin based on the context data. Pattern matching on the above context data is used to generate recommendations. Note that for OSS users.

{{< admonition type="note" >}}
The recommender service is disabled by default for OSS users. Your Grafana administrators can enable it by going to the plugin configuration and toggling the "Enable context-aware recommendations" switch. For more information, see [Enable the recommender service](/docs/pathfinder/enable-the-recommender-service/).
{{< /admonition >}}

## Documentation rendering

This component is responsible for rendering the documentation or tutorial content. The documentation is parsed into a React component tree and then rendered rather than being rendered via an iframe. This allows for the documentation to be rendered in the same way as the rest of the Grafana UI, with the ability to use the same components and styles. It also allows us to render images and videos directly into the sidebar. The render covers most elements of our documentation and tutorial content, if you notice a rendering issue, please let us know by [opening an issue](https://github.com/grafana/grafana-pathfinder-app/issues/new).

## Interactive engine

The interactive engine is responsible for the interactive features within the documentation or tutorial. It is responsible for the "Show me" and "Do it" buttons, aswell as the interactive elements within the documentation. It is also responsible for the requirements and objectives system. The interactive engine. Here is a breakdown of these components:
* Show me button - This button is used to show the user the next step in the documentation or tutorial.
* Do it button - This button is used to execute the action of the current step in the documentation or tutorial.
* Do section button - This button is used to execute the action of the current section in the documentation or tutorial.
* Guided steps - These are steps that are guided by the user. They are executed by the user clicking a button to start the guided step.
* Multistep steps - These are steps that are executed in a sequence. They are executed by the user clicking a button to start the multistep step.
* Requirements and objectives system - This is the system that is used to check if the user has completed the requirements and objectives of the current step in the documentation or tutorial.

### Tracking user progress

Currently, we use localStorage to track the user progress for the interactive features within the documentation or tutorial. We would eventually like to move to a more persistent storage using a backend service. This means tutorial progression is reset when a user closes the tutorial tab. Tabs and progression are persisted across sessions until the user closes the tab.