---
name: pr-review-demo
description: Record a demo video of a PR's frontend changes running in Grafana. Use when the user says "record demo" on a PR, or when reviewing a PR that modifies UI components and visual verification is requested.
---

# PR review demo

Record a short demo video showing a PR's frontend changes running in Grafana, so reviewers can see exactly what changed without pulling the branch locally.

## When to use

- The user comments "record demo" (e.g., `@cursoragent record demo`)
- The user asks for a visual review or demo of a PR
- A PR review flags UI changes that would benefit from visual verification

## Workflow

### Step 1: Understand what to demonstrate

This is the most important step. You need to figure out **what the change looks like** and **how a user navigates to it** before you can record anything.

Read these sources in order, building a mental model of what to show:

1. **The PR description**: This is your primary source. Authors typically describe what changed and often include reproduction steps, screenshots, or navigation instructions. Read it carefully with `gh pr view <NUMBER>`.
2. **The invoking prompt**: The user's message that triggered this skill may contain specific instructions like "demo the new badge component" or "show the sidebar on the dashboards page." If they tell you where to look, follow their lead.
3. **The diff**: Run `gh pr diff <NUMBER> --name-only` to see which files changed. Read the actual diff for UI-relevant files (`.tsx`, `.jsx`, `.css`, `.scss`) to understand the visual impact. Pay attention to:
   - Which components were modified or created
   - What props/state changed (this hints at behavioral changes)
   - Route definitions or navigation changes (this tells you where to find it)
4. **Component context**: If the navigation path still isn't clear, trace the changed component(s) upward — find where they're imported and rendered — to identify the page/route that hosts them.

By the end of this step you should be able to answer:
- **Where**: Which URL or UI path leads to the change (e.g., `/a/grafana-pathfinder-app`, or "open a guide from the sidebar")
- **What**: What specific interaction or visual state to demonstrate (e.g., "click the new sort button and show the reordered list")
- **Before/after** (if applicable): Whether showing the change requires a comparison, or if the new state alone is sufficient

If you cannot determine the navigation path from any of these sources, say so in your response and ask the user for guidance. Do not guess.

### Step 2: Build and start Grafana

1. Build the plugin:
   ```bash
   npm run build
   ```

2. Start Grafana and services:
   ```bash
   docker compose up --build -d
   ```

3. Wait for Grafana to be ready — poll until it responds:
   ```bash
   until curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/login | grep -q 200; do sleep 2; done
   ```

If Grafana is already running from a previous step, rebuild the plugin and restart only the Grafana container to pick up the new build:
```bash
npm run build && docker compose restart grafana
```

See `AGENTS.md` § "Cursor Cloud specific instructions" for Docker setup if Docker is not yet available.

### Step 3: Set up the UI state

Before recording, use the `computerUse` subagent to navigate to the correct page and set up any preconditions the demo needs. This might include:

- Navigating to a specific page or route
- Opening a sidebar panel or modal
- Selecting a specific tab, dropdown option, or configuration
- Creating test data (e.g., starting a learning path so there's progress to show)

The goal is to have the UI in the right starting state so the recording itself is focused and short.

Take a screenshot to confirm you're in the right place before recording.

### Step 4: Record the demo

1. **Start recording**:
   ```
   RecordScreen(mode: START_RECORDING)
   ```

2. **Perform the demonstration** using the `computerUse` subagent. Give it specific, step-by-step instructions based on what you learned in Step 1. Keep the demo focused:
   - Show the changed behavior, not general navigation
   - If it's a visual change, pause briefly on the result so it's visible in the recording
   - If it's an interaction change, perform the interaction clearly
   - Aim for **under 30 seconds** of recording

3. **Save the recording**:
   ```
   RecordScreen(mode: SAVE_RECORDING, save_as_filename: "<descriptive_name>")
   ```
   Use a filename that describes the PR content, e.g., `pr_142_badge_sort_reorder` or `pr_87_sidebar_tooltip_fix`.

If the demo doesn't go as expected (wrong page, missing state, error), **discard** the recording and retry:
```
RecordScreen(mode: DISCARD_RECORDING)
```

### Step 5: Verify the recording

Use the `mediaReview` subagent to verify the saved video actually shows what you intended. Check:

- The changed UI element or behavior is clearly visible
- The interaction plays out correctly
- The recording isn't blank, cut off, or showing the wrong page

If the video doesn't clearly demonstrate the change, discard it and re-record.

### Step 6: Present the result

Include the demo video in your response using a video tag:

```html
<video src="/opt/cursor/artifacts/<filename>.mp4" controls></video>
```

Add a brief caption explaining what the video shows and how it relates to the PR changes. Example:

> **Demo: PR #142 — badge sort reorder**
> Shows the new drag-to-reorder behavior on the badges section of the My Learning page. Badges can now be rearranged by dragging, and the new order persists across page reloads.

## Notes

- **Video stays in the Cursor review pane** for now. GitHub PR comment embedding of video artifacts is a future enhancement.
- If the PR only changes non-visual code (utilities, types, test files, build config), this skill is not appropriate. Say so and skip.
- If Grafana fails to start or the plugin doesn't load, troubleshoot using `docker compose logs grafana` before giving up. See `AGENTS.md` § "Cursor Cloud specific instructions" for common issues.
- Multiple short recordings are better than one long one if the PR touches several unrelated UI areas.
