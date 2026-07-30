---
name: pr-summary
description: Generate a structured PR description from the current diff using `docs/design/CONCERNS.md` routing. Interviews the author for motivation before drafting. Produces canonical sections (Summary, What to look at, Why, How to verify, Breaking changes, Reversibility) tailored to change type. Outputs the draft for human review; can apply via `gh pr edit` after explicit confirmation. Pair with `/review` — this skill drafts, `/review` reviews.
---

Read `.cursor/skills/pr-summary/SKILL.md` and follow it exactly.
