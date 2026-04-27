# Custom guides

Custom guides are guides created and managed directly inside Grafana using the Pathfinder block editor. They live in the Pathfinder backend and appear in the **Custom guides** section of the docs panel once published.

> **Scope:** Custom guides are private to your Grafana stack. They are stored in the Pathfinder backend that runs alongside your Grafana instance and are not shared with other organisations, tenants, or Grafana Cloud stacks. A guide published on one stack is not visible on any other.

{{< admonition type="note" >}}
This document is the **developer reference** for the custom-guide lifecycle. The end-user authoring guide with screenshots lives at [`docs/sources/block-editor/_index.md`](../sources/block-editor/_index.md) and is published to the Grafana documentation site.
{{< /admonition >}}

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

1. Open the Pathfinder sidebar and click the **Editor** tab in the tab bar (visible to users with editor or admin role; **no dev mode required**).
2. Click the title field at the top and type a name for your guide. Press **Enter** or click away to confirm.
3. On first commit the editor auto-generates a unique ID from the title (e.g. `my-guide-a3f9`). This ID is used as the backend resource name and does not change if you rename the guide later.
4. Add blocks using the **+** button at the bottom of the editor. Available block types include markdown, interactive steps (with the new `popout` action), sections, conditionals, quizzes, terminals, code blocks, grot guides, and more — see [json-guide-format.md](interactive-examples/json-guide-format.md) for the full list.

> **Tip:** Content is auto-saved to localStorage as you work, so a browser refresh won't lose your progress. This local save is separate from the backend — the status badge in the header reflects both.

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

## Technical notes

- Guide IDs are auto-generated as `<title-slug>-<4-char-random>` and locked after first save. Renaming a guide does not change its ID or resource name.
- The backend stores guides as `InteractiveGuide` custom resources in the `pathfinderbackend.ext.grafana.com/v1alpha1` API group.
- `resourceVersion` is used for optimistic concurrency control — the editor always fetches the latest version after a save before allowing a subsequent write.
- Backend tracking state (`resourceName`, `backendStatus`, `lastPublishedJson`) is persisted to localStorage so the correct button state survives a page refresh.

## Floating panel and popout step

Authors can drive the docs panel between docked (sidebar) and floating modes from inside a guide using the `popout` action. This is useful when a guide step needs the right sidebar for something else (for example, Grafana Assistant), or when bringing the guide back after the user finishes a side task.

```json
{
  "type": "interactive",
  "action": "popout",
  "targetvalue": "floating",
  "content": "Move this guide to a floating window so you can use the assistant on the right."
}
```

The `targetvalue` must be either `"floating"` (undock) or `"sidebar"` (dock). The button label flips to **Undock** or **Dock** accordingly. There is no Show me preview for `popout`.

For the full action reference, see [`interactive-types.md#popout`](interactive-examples/interactive-types.md#popout).
