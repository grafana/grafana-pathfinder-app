---
title: Terms and conditions
menuTitle: Terms and conditions
description: Data usage notice for Interactive learning's context-aware recommendations.
weight: 50
---

<!--
DO NOT EDIT BY HAND.
This page is generated from src/components/AppConfig/terms-content.ts
by scripts/sync-terms-and-conditions.js. Update the source file and run
`npm run docs:sync-terms` to refresh this page.
-->

# Terms and conditions

**Version:** 1.1.0

This page is the data usage notice that Interactive learning shows in the plugin configuration when an administrator enables context-aware recommendations. It is reproduced here so it is reviewable outside Grafana.

## Context-aware recommendations

When enabled, Interactive learning sends contextual data from your Grafana instance to the recommendation service which returns personalized documentation recommendations.

### Data collection and usage

When you enable the context-aware recommendations, Interactive learning collects the following information:

- **Current page path and URL** - to identify which Grafana feature you're using.
- **A list of the types of installed data sources** - to recommend relevant data source documentation.
- **Dashboard information** - including dashboard titles, tags, and folder information when you're viewing dashboards. Interactive learning processes this information locally and doesn't send it to the recommendation service
- **Visualization types** - when creating or editing panels.
- **User role** - your organizational role, such as Admin, Editor, or Viewer.
- **Grafana instance type** - whether you are using Grafana Cloud, Grafana Enterprise, or open source Grafana.
- **User identifier and email** - for Grafana Cloud, a hashed user identifier and email address used for personalization. For open source Grafana, only a generic identifier ('oss-user') and email ('oss-user@example.com') are used. All user data is hashed using SHA-256 before transmission for privacy protection.

### How Grafana uses your data

- **Personalized recommendations** - to provide documentation and learning paths that are contextually relevant
- **Service improvement** - to enhance the quality and accuracy of recommendations
- **Analytics** - to evaluate which recommendations are most useful to users

### Data security

- Interactive learning transmits all data securely using HTTPS.
- All user identifiers and email addresses are hashed using SHA-256 before transmission to protect your privacy.
- Interactive learning doesn't collect any sensitive information such as dashboard content, query details, or other personal data.
- Grafana only uses the data for the purposes described in this notice.

### Your control

- You can disable the context-aware recommendations feature at any time in the plugin configuration.
- When disabled, Interactive learning doesn't send any contextual data, user identifiers, or Grafana instance information to the recommendation service.
- When disabled, Interactive learning displays bundled examples and documentation by default. If your browser is online, the plugin may also fetch a public guide catalog from Grafana's content delivery network (interactive-learning.grafana.net) so it can offer additional learning content. These fetches are limited to public catalog and guide files; they don't include user identifiers, dashboard data, or any other contextual information beyond standard HTTP request metadata such as your IP address and browser User-Agent. Air-gapped installations and browsers reporting offline status make no such fetches.

### Changes to data usage

This notice is subject to change with updates to the plugin.

### Effective date

This data usage applies whenever you enable context-aware recommendations ends when you disable the feature or uninstall the plugin.
