# Authoring interactive guides

This page is the starting point for creating interactive guides in Grafana Pathfinder. Choose an authoring workflow below, then use the reference docs for the guide and package formats.

## Choose an authoring workflow

- **Publish a guide to a Grafana stack:** Use the Pathfinder block editor, then save the guide as a draft and publish it. See the [block editor authoring guide](../../sources/block-editor/_index.md) for the UI workflow and [Custom guides](../CUSTOM_GUIDES.md) for the storage and lifecycle details.
- **Contribute a public guide:** Use the block editor to create and preview the content, then follow the contribution workflow in the [`grafana/interactive-tutorials` README](https://github.com/grafana/interactive-tutorials/blob/main/README.md). Use [Package authoring](../package-authoring.md) when adding package metadata or composing a learning path or journey.
- **Import guides through automation:** See [Custom guides](../CUSTOM_GUIDES.md#external-import-ci--terraform--scripts) for single-guide and learning-path upload scripts, or [External API](../EXTERNAL_API.md) for the API contract.

## External repository

The public [`grafana/interactive-tutorials`](https://github.com/grafana/interactive-tutorials) repository contains shared interactive learning packages. Use existing guides for examples, but validate formats and supported behavior against the references below.

Its [README](https://github.com/grafana/interactive-tutorials/blob/main/README.md) documents the contributor setup, block editor workflow, preview options, and PR process.

## Reference docs

The following docs are the primary authoring references:

| Document                                              | What it covers                                                                                                                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [JSON guide format](./json-guide-format.md)           | Complete block schema reference for content, interactive steps, containers, assessments, inputs, and specialized blocks                                                               |
| [Interactive types](./interactive-types.md)           | Supported action types (`highlight`, `button`, `formfill`, `navigate`, `hover`, `noop`, `popout`), `multistep` and `guided` blocks, Show vs Do behavior, and `reftarget` expectations |
| [Selectors reference](./selectors-reference.md)       | How to target DOM elements — selector priority, `grafana:` prefix resolution, pseudo-selectors, and debugging techniques                                                              |
| [Requirements reference](./requirements-reference.md) | Pre-condition and post-condition system — requirement types, validation flow, `canFix` behavior, and the requirements manager                                                         |
| [Guided interactions](./guided-interactions.md)       | User-performed action mode — when to use guided blocks, completion detection, cancel/skip behavior, and multi-step guided sequences                                                   |
| [Package authoring](../package-authoring.md)          | Package directory model — required `content.json`, optional `manifest.json` and assets, guide/path/journey metadata, dependencies, targeting, templates, and repository indexes       |

## Related engine docs

- [`docs/developer/engines/interactive-engine.md`](../engines/interactive-engine.md) — architecture and internals of the interactive execution engine
- [`docs/developer/engines/requirements-manager.md`](../engines/requirements-manager.md) — requirements validation system internals

## Agent rules

For prescriptive constraints when authoring guides, see [interactive requirements](../../../.cursor/rules/interactiveRequirements.mdc).
