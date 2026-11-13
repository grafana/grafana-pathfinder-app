# Kiosk catalogs and PR previews

Kiosks are JSON catalogs with launch rules and an optional structured page. Existing rule arrays, HTML-banner catalogs, and `page.version: 1` pages continue to work. New layouts use `page.version: 2`. Older plugins reject version 2 catalogs, so release the supporting plugin before publishing them.

The rules still own navigation: `url` selects guide content, `page` selects an internal Grafana route, `targetUrl` selects the presentation stack, and `interactiveLearning: false` opens a product. Blocks reference rules by `id`; appearance never changes a destination.

## Version 2

Start from [the event example](../examples/kiosk/event-v2.json) or [the onboarding example](../examples/kiosk/onboarding-v2.json). Their relative image paths resolve against the catalog that was actually loaded.

Page options retain `width`, `spacing`, and `header`. An optional `brand` object supplies a `name`, a `logo` image, or both beside the exit control. An icon-only brand requires a non-decorative logo with alternative text; use it with `header: "minimal"`. The optional `appearance` object is also available on sections and heroes:

| Field              | Values                                                                                                                             |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `preset`           | `grafana`, `subtle`, `bold`                                                                                                        |
| `accentColor`      | Six-digit hex color for decorative emphasis                                                                                        |
| `background`       | `{ "type": "solid", "color": "#211141" }` or `{ "type": "gradient", "from": "#211141", "to": "#542659", "direction": "diagonal" }` |
| Gradient direction | `right`, `down`, `diagonal`                                                                                                        |
| `density`          | `compact`, `normal`, `spacious`                                                                                                    |
| `radius`           | `none`, `small`, `large`                                                                                                           |

Text foregrounds are generated from backgrounds. Gradients must support a common black or white foreground with at least 4.5:1 contrast. Accent colors decorate borders and primary hero actions; their text color is generated for contrast. Controls retain Grafana's keyboard and focus behavior. Unspecified section appearance inherits the surrounding design.

Version 2 adds:

- `section`: optional `title`, `description`, and `appearance`, plus `blocks`.
- `columns`: two or three entries in `columns`, each containing `blocks`. `ratio` is `equal`, `wide-left`, or `wide-right`; unequal ratios require two columns. Each column may also have `eyebrow`, `title`, `description`, and `appearance`. Columns stack in reading order on small screens.
- `image`: an `image` object with `src`, nonempty `alt` or `decorative: true`, optional `caption`, `aspectRatio` (`auto`, `square`, `wide`, `portrait`), and `fit` (`contain`, `cover`). HTTPS and relative paths are accepted; embedded SVG markup and data URLs are not.

Heroes support `image`, `layout` (`stacked`, `split`), `titleSize` (`medium`, `large`, `extra-large`), `appearance`, and `primaryAction` / `secondaryAction` (`ruleId`, `label`). A split hero without an image places its actions beside the copy. Guide links support `columns` (1–3); each card can specify `image`, `icon`, `badge`, `actionLabel`, and `featured`. Built-in icons are `compass`, `book-open`, `rocket`, `chart-line`, `heart`, `bolt`, and `cloud`.

Text supports `format: "markdown"` for emphasis, code spans, lists, and HTTPS links. HTML remains literal text. Existing launch forms, commands, dividers, and guide links are retained.

Sections may contain columns and leaf blocks. Columns contain only leaf blocks. Sections cannot contain other sections. There is a total limit of 50 blocks including containers. All nested rule references must exist, and launch forms require interactive guides with unique input variable names.

## Validation

The CLI and preview share the catalog schema. After building the CLI:

```sh
node dist/cli/cli/index.js schema kiosk
node dist/cli/cli/index.js validate --kiosk docs/examples/kiosk/event-v2.json
node dist/cli/cli/index.js validate --kiosk docs/examples/kiosk/onboarding-v2.json --format json
```

The exported JSON Schema describes structural constraints. Its `x-refinements` describes cross-field checks that also run in the CLI and browser, including reference integrity, total block count, and background contrast. Runtime destination validation still applies.

## Previewing a PR

In dev tools, fetch a public GitHub PR and select **Kiosk**. Choose a catalog, inspect its commit SHA and validation results, then select **Preview kiosk**. Discovery includes changed catalogs and unchanged `kiosk/**/rules.json` files from that snapshot, so guide-only and asset-only PRs can be reviewed.

**Current instance** launches on the current stack. **Presentation** opens the catalog's configured stacks in new tabs; each target needs dev mode and a compatible plugin. Input forms remain available only in current-instance mode. Exit returns to the tester; presentation leaves the kiosk open.

Catalogs, recognized repository guide URLs, manifests, path members, shared snippets, and relative assets use the captured PR head SHA, including fork heads. Other external guide URLs remain external and are labeled in the tester. Missing or invalid snapshot content produces an error rather than silently substituting published content. Re-fetching captures a fresh SHA and isolated test-session ID.

PR markers isolate guide progress and saved answers, and existing completion guards prevent test completions from creating ordinary learning records. Kiosk preview exposure and conversion events are suppressed. Guide actions still run against real Grafana resources: preview is not a sandbox.

## DEM design examples

[Setup first](../examples/kiosk/dem-setup-first.json) leads with a split hero and a primary guided-setup action. [Two perspectives](../examples/kiosk/dem-two-perspectives.json) explains Synthetic Monitoring and Frontend Observability in illustrated panels, followed by the combined-setup action. Both retain the published DEM rule destinations. The product routes require their corresponding Grafana Cloud apps.

The illustration assets are hosted under `https://grafana.com/media/interactive-learning/kiosk/dem/v1/`; examples reference those URLs without committing image binaries. Upload revisions to a new version folder instead of overwriting existing assets. They were generated with the built-in image tool from the two concept mockups. The prompts isolated the overview browser/probe/session illustration, the outside-in browser/globe/probe illustration, and the inside-out browser/session/error illustration respectively, requesting transparent backgrounds, matching purple linework, and no text or UI controls. `grafana-mark.png` is the unmodified `apple-touch-icon.png` from the official Grafana 13.3.0 distribution.

The [dark setup-first](../examples/kiosk/dem-setup-first-dark.json) and [dark two-perspectives](../examples/kiosk/dem-two-perspectives-dark.json) variants use neutral Grafana surfaces and `dem-overview-warm.png`, `dem-outside-warm.png`, and `dem-inside-warm.png`. These transparent illustrations were edited with the built-in image tool, using each original image as the edit target and the same prompt:

> Use case: style-transfer. Asset type: transparent illustration for a Grafana DEM kiosk in dark mode. Input image 1 is the edit target. Preserve its exact subject, composition, shapes, aspect ratio, whitespace, and simple friendly illustration style. Change only the palette: replace ALL purple/lavender fills with neutral charcoal and mid-grey; light silver outlines ensure visibility against a #181B1F panel. Orange #FF9830 and amber #FFBF47 selectively highlight graph strokes, probe connections, location pins and focal points. Large browser panels and globe surfaces stay charcoal/grey, not orange. Keep any green success and red error indicators. Keep the same concept and no new objects, text, logos or watermarks. No purple, no blue tint, no excessive glow. Preserve a genuinely transparent background with clean alpha edges. Render the illustration, not a screenshot or UI mockup.
