---
title: Architecture
menuTitle: Architecture
description: Understand how Grafana Pathfinder operates and how it communicates with the Grafana Recommender.
weight: 1
---

# Architecture

Grafana Pathfinder is a app based plugin built using the Grafana plugin SDK. Its primary mount point is the Extension Sidebar. This is the same mount point that the Grafana Assistant uses which allows both applications to operate in any part of the Grafana UI.

## The components of Pathfinder

Pathfinder has three main components:
* Context retrieval - Retrieves the context of the current page in Grafana.
* Documentation rendering - Renders the selected documentation or tutorial.
* Interactive tutorials - Facilitates the interactive features within the documentation or tutorial.




