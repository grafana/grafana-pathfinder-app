---
title: Interactive learning
description: Get help exactly when and where you need it. Interactive learning brings contextual documentation and interactive guides directly into Grafana, so you can learn and build without leaving your workflow.
keywords:
  - learn
  - help
  - Grafana Cloud
  - Grafana OSS
  - guides
  - tutorials
weight: 1
cards:
  items:
    - title: Get started
      description: Open Interactive learning and follow your first guide.
      href: getting-started/
      height: 24
    - title: Block editor
      description: Author and publish your own interactive guides directly inside Grafana.
      href: block-editor/
      height: 24
    - title: Administrator reference
      description: Disable Pathfinder in Grafana Cloud and configure recommendations and guide behavior.
      href: administrators-reference/
      height: 24
    - title: Architecture
      description: Understand content sources, permissions, data usage, and storage.
      href: architecture/
      height: 24
    - title: Terms and conditions
      description: Data usage notice for context-aware recommendations.
      href: terms-and-conditions/
      height: 24
    - title: Upgrade notes
      description: Important information about upgrading, including breaking changes.
      href: upgrade-notes/
      height: 24
  title_class: pt-0 lh-1
review_date: 2026-09-30
hero:
  description: Get help exactly when and where you need it. Interactive learning brings contextual documentation and interactive guides directly into Grafana, so you can learn and build without leaving your workflow.
  height: 110
  image: /media/docs/pathfinder/img_3.png?w=1920
  level: 1
  title: Interactive learning
  width: 110
---

{{< docs/hero-simple key="hero" >}}

---

## Learn Grafana while you work

Interactive learning, also called Pathfinder, brings documentation and guided practice into Grafana. Use it to understand an unfamiliar feature, follow an onboarding path, or work through a guide your team has published.

- **Context-aware recommendations:** Find documentation and guides relevant to the Grafana page you are using.
- **Interactive guides:** Use **Show me** to find a control and **Do it** to perform the described action with your Grafana permissions.
- **Learning paths:** Follow milestones, choose a track where available, and review progress in **My learning**.
- **Custom guides:** Users with the Editor or Admin role can create content with the [block editor](block-editor/). Saving and publishing requires storage support on the instance.
- **Flexible layouts:** Keep guides in sidebar tabs, move them to a floating panel, or use full screen.

## Availability and administration

Interactive learning is in public preview for Grafana Cloud and self-managed Grafana. Availability depends on the instance configuration and Cloud rollout. The current plugin requires Grafana 12.3 or later.

On a Cloud stack where it is available, select **Help** to open Interactive learning. For self-managed installation and your first guide, refer to [Get started](getting-started/).

Administrators can [disable Pathfinder in Grafana Cloud](administrators-reference/#disable-interactive-learning-in-grafana-cloud) to restore the classic **Help** menu after users reload, while keeping learning progress. You can also [turn off context-aware recommendations](administrators-reference/#disable-recommendations-only) while keeping guides available.

## Explore next steps

{{< card-grid key="cards" type="simple" >}}
