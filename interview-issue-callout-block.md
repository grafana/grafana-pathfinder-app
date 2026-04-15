# Add new block type: Callout

## Summary

Add a **Callout** block type to the block editor. Callouts are styled admonition boxes used in documentation to draw attention to tips, warnings, or important notes.

## Motivation

Guide authors frequently need to highlight key information — a prerequisite warning, a helpful tip, or a success confirmation. Currently they work around this with bold markdown text or HTML blocks, but a dedicated callout block would provide consistent styling and a better editing experience.

## What it should do

A callout block has three properties:

| Property  | Type   | Required | Description                                          |
| --------- | ------ | -------- | ---------------------------------------------------- |
| `variant` | enum   | Yes      | One of: `info`, `warning`, `success`, `error`        |
| `title`   | string | No       | Optional heading displayed at the top of the callout |
| `content` | string | Yes      | Markdown body text                                   |

When rendered, it should look something like:

```
┌─────────────────────────────────────────┐
│ ⚠️  Watch out                           │
│                                         │
│ This operation will restart the service. │
│ Make sure you've saved your work first.  │
└─────────────────────────────────────────┘
```

Each variant should have a distinct visual treatment (border/background color, icon). Use Grafana's design system theme tokens for colors rather than hardcoding values.

## Acceptance criteria

- [ ] `callout` is a valid block type in the type system and Zod schema
- [ ] A `CalloutBlockForm` lets users pick a variant, enter an optional title, and write content
- [ ] The block appears in the block palette with an appropriate icon and description
- [ ] Callout blocks render correctly in the guide viewer with variant-appropriate styling
- [ ] The content field supports markdown (rendered inline)
- [ ] Existing tests pass (`npm run check`)
- [ ] At least basic test coverage for the new form component

## Getting started

The codebase has a consistent pattern for block types. A good approach is to pick a simple existing block and follow its implementation end-to-end:

- **Reference block to follow:** `image` — it's the simplest block with straightforward props
- **Type definitions:** `src/types/json-guide.types.ts` — look at `JsonImageBlock` and the `JsonBlock` union
- **Validation:** `src/types/json-guide.schema.ts` — see how `JsonImageBlockSchema` is defined and composed
- **Editor form:** `src/components/block-editor/forms/ImageBlockForm.tsx` — template for your form component
- **Palette metadata:** `src/components/block-editor/constants.ts` — `BLOCK_TYPE_METADATA` and `BLOCK_TYPE_ORDER`
- **Form registration:** `src/components/block-editor/BlockFormModal.tsx` — `FORM_COMPONENTS` map
- **JSON → render pipeline:** `src/docs-retrieval/json-parser.ts` — `convertBlockByType` switch and converter functions
- **Renderer components:** `src/docs-retrieval/components/docs/` — where block renderers live

## Stretch goals (if time allows)

- Add a "collapsible" option so the callout can be expanded/collapsed
- Support an optional `icon` override (custom emoji or Grafana icon name)
- Add e2e test coverage in `tests/block-editor.spec.ts`
