---
name: release-prep
description: Orchestrate the pre-release flow for grafana-pathfinder-app — bump the version in package.json, draft a CHANGELOG entry (via the `changelog` skill), run `npm run check` and `npm run build`, then print the exact `git tag` command for the user to execute. Never creates or pushes the tag itself; tagging is a one-way door the user owns.
---

Read `.cursor/skills/release-prep/SKILL.md` and follow it exactly.
