# Custom guides

Custom guides are guides created and managed directly inside Grafana using the Pathfinder block editor. They live in the Pathfinder backend and appear in the **Custom guides** section of the docs panel once published.

> **Scope:** Custom guides are private to your Grafana stack. They are stored in the Pathfinder backend that runs alongside your Grafana instance and are not shared with other organisations, tenants, or Grafana Cloud stacks. A guide published on one stack is not visible on any other.

---

## Overview

A custom guide moves through three states:

| State         | Meaning                                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------------------- |
| **Not saved** | Exists only in the browser (localStorage). Not visible to anyone else.                                         |
| **Draft**     | Saved to the Pathfinder backend. Only visible to authors in the library. Not shown to users in the docs panel. |
| **Published** | Live in the docs panel. Visible to all users of the Grafana instance.                                          |

---

## Creating a guide

1. Open the Pathfinder sidebar and navigate to the block editor.
2. Click the title field at the top and type a name for your guide. Press **Enter** or click away to confirm.
3. On first commit the editor auto-generates a unique ID from the title (e.g. `my-guide-a3f9`). This ID is used as the backend resource name and does not change if you rename the guide later.
4. Add blocks using the **+** button at the bottom of the editor. Available block types include markdown, interactive steps, sections, conditionals, quizzes, terminals, and more.

> **Tip:** Content is auto-saved to localStorage as you work, so a browser refresh won't lose your progress. This local save is separate from the backend — the status badge in the header reflects both.

### Generate with AI

When Grafana Assistant is available, the header shows a **Generate with AI** button next to **New**. Click it to describe the guide you want in natural language and have the assistant draft a validated JSON guide for you.

- The assistant generates a guide that matches the Pathfinder JSON schema. The output is parsed and validated before touching the editor, so invalid responses are never loaded.
- Selectors the assistant does not know are left as the placeholder string `REPLACE_WITH_SELECTOR` with `action: "noop"` so the guide validates. Pick each placeholder using the element picker or **Regenerate with AI** once you've drafted the outline.
- If you already have content in the editor you will be asked to confirm before the generated guide replaces it.
- If validation fails, the modal surfaces the specific errors and offers a **Retry** that re-sends the prompt with those errors appended so the assistant can fix them.

The button is hidden when the assistant is not available in the current Grafana environment.

---

## Saving and publishing

The primary action button in the header follows the guide's lifecycle:

| Current state           | Primary button    | What it does                                                                 |
| ----------------------- | ----------------- | ---------------------------------------------------------------------------- |
| Not saved               | **Save as draft** | Saves to the backend as a draft. Assigns a resource name if not already set. |
| Draft — no changes      | **Publish**       | Makes the guide live in the docs panel.                                      |
| Draft — unsaved changes | **Update draft**  | Saves the latest changes to the draft without publishing.                    |
| Published               | **Update**        | Pushes the latest changes to the live published guide.                       |

The **•••** menu provides the alternative action:

- When the primary is **Update draft** → the menu offers **Publish** (skip the draft update and go live directly).
- When published → the menu offers **Unpublish** (revert to draft, removing it from the docs panel).
- When not saved → the menu offers **Publish** (save and go live in one step).

### Collision detection

When saving a new guide for the first time, if a guide with the same resource name already exists in the library, you are prompted to confirm an overwrite. To save as a separate guide instead, cancel and change the guide's title before saving.

---

## Editing a published guide

1. Open the library (**Library** button in the header) and click **Load** next to the guide.
2. Make your changes in the editor.
3. The status badge changes to **Published (modified)** to indicate the live version is out of date.
4. Click **Update** to push changes to the live guide.

Changes are not visible to users until you click **Update**.

---

## Unpublishing a guide

Click **•••** → **Unpublish**. The guide is removed from the docs panel immediately but remains in the library as a draft. It can be re-published at any time.

---

## Viewing guides in the docs panel

Published guides appear under **Custom guides** in the Pathfinder sidebar docs panel. They are available to all users on the Grafana instance where the guide was published.

Draft guides are not shown in the docs panel. They can only be accessed through the block editor library.

---

## The guide library

The library (**Library** button) lists all guides stored in the Pathfinder backend — both drafts and published. From here you can:

- **Load** a guide into the editor for editing.
- **Delete** a guide permanently (requires confirmation).
- **Refresh** the list to pick up changes made by other authors.

---

## Status badges

The badge in the top-right of the header reflects the backend sync state:

| Badge                             | Meaning                                         |
| --------------------------------- | ----------------------------------------------- |
| **Draft** (purple)                | Saved to backend, in sync, not published.       |
| **Draft (modified)** (orange)     | Local changes not yet saved to the draft.       |
| **Published** (blue)              | Live and in sync with the backend.              |
| **Published (modified)** (orange) | Local changes not yet pushed to the live guide. |

When the backend is unavailable the badge area instead shows a **Saved** / **Saving…** indicator reflecting the localStorage auto-save state.

---

## Regenerate selectors with the assistant

Every form that accepts a DOM selector (interactive, multistep/guided steps, code-block, conditional branches) shows a **Regenerate with AI** button next to **Pick element** when Grafana Assistant is available.

Use it when a picked selector is fragile — for example, a deep compound selector or one that uses `:nth-child`. The workflow is:

1. Pick the element once with the crosshair picker (or paste in a selector you already have).
2. Click **Regenerate with AI**. The app resolves the current selector, walks the element's attributes and ancestry, and asks the deterministic generator for up to four grounded candidates.
3. That structured context plus Pathfinder's selector best practices is sent to Grafana Assistant. The assistant returns a single selector string.
4. The returned selector is validated, and the app confirms it still resolves to the same element before writing it back into the form.
5. If the assistant's answer does not resolve (or is worse than the current one) the app falls back to the top grounded candidate and shows a toast explaining what happened.

The button is hidden when the assistant is unavailable and is disabled while a previous regeneration is in flight.

---

## Technical notes

- Guide IDs are auto-generated as `<title-slug>-<4-char-random>` and locked after first save. Renaming a guide does not change its ID or resource name.
- The backend stores guides as `InteractiveGuide` custom resources in the `pathfinderbackend.ext.grafana.com/v1alpha1` API group.
- `resourceVersion` is used for optimistic concurrency control — the editor always fetches the latest version after a save before allowing a subsequent write.
- Backend tracking state (`resourceName`, `backendStatus`, `lastPublishedJson`) is persisted to localStorage so the correct button state survives a page refresh.
