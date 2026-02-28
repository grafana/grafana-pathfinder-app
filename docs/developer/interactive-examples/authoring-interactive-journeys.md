# Authoring interactive guides

This page is the starting point for creating interactive tutorials in Grafana Pathfinder. It links to the external guide repository and to the detailed reference docs in this directory.

## External repository

There is a public GitHub repository at [https://github.com/grafana/interactive-tutorials](https://github.com/grafana/interactive-tutorials) where all interactive guides are maintained. Use existing guides for inspiration and to extrapolate common patterns.

The [README.md](https://github.com/grafana/interactive-tutorials/blob/main/README.md) in that repo contains best practices and workflow recommendations for authoring your own interactive journeys.

## Reference docs

The following reference docs cover every aspect of the guide format and interactive system:

| Document                                              | What it covers                                                                                                                                                   |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [JSON guide format](./json-guide-format.md)           | Complete schema reference for JSON guides — blocks, interactive elements, sections, sequences, conditionals, quizzes, and metadata                               |
| [Interactive types](./interactive-types.md)           | Supported action types (`highlight`, `button`, `formfill`, `navigate`, `hover`, `guided`, `noop`, `sequence`), Show vs Do behavior, and `reftarget` expectations |
| [Selectors reference](./selectors-reference.md)       | How to target DOM elements — selector priority, `grafana:` prefix resolution, pseudo-selectors, and debugging techniques                                         |
| [Requirements reference](./requirements-reference.md) | Pre-condition and post-condition system — requirement types, validation flow, `canFix` behavior, and the requirements manager                                    |
| [Guided interactions](./guided-interactions.md)       | User-performed action mode — when to use guided blocks, completion detection, cancel/skip behavior, and multi-step guided sequences                              |
| [Package authoring](../package-authoring.md)          | Two-file package model — `content.json` + `manifest.json` field reference, dependency syntax, targeting, templates, and repository index                         |

## Related engine docs

- [`docs/developer/engines/interactive-engine.md`](../engines/interactive-engine.md) — architecture and internals of the interactive execution engine
- [`docs/developer/engines/requirements-manager.md`](../engines/requirements-manager.md) — requirements validation system internals

## Agent rules

For prescriptive constraints when authoring guides, see `.cursor/rules/interactiveRequirements.mdc`.
