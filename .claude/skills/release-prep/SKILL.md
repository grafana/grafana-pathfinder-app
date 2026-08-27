---
name: release-prep
description: Orchestrate the pre-release flow for grafana-pathfinder-app — cut a release branch off origin/main to freeze scope, bump the version in package.json, draft a CHANGELOG entry (via the `changelog` skill), run `npm run check` and `npm run build`, then print the exact `git push`/`git tag` commands for the user to execute. Never pushes the branch or the tag itself; both are one-way doors the user owns.
---

Read `.cursor/skills/release-prep/SKILL.md` and follow it exactly.
