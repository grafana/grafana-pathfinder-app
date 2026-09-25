# Kiosk page JSON

A kiosk catalog contains `rules` (guide destinations) and an optional structured `page`. Existing catalogs with `banner` and `rules`, or a bare rules array, keep their existing presentation. A structured page replaces the banner and default grid; every visible destination is explicitly listed in its blocks.

See the [complete DEM catalog](../examples/kiosk/dem.json) and [generated JSON Schema](../examples/kiosk/catalog.schema.json). Export the schema with the existing schema command (`node dist/cli/cli/index.js schema kiosk`). Reference the schema through your editor's JSON schema mapping; `$schema` is not a catalog field. Cross-field checks such as rule references and duplicate variable names run in the runtime validator in addition to JSON Schema.

## Page options

`page.version` is `1`. `blocks` is an ordered array of up to 50 blocks. Presentation uses Grafana theme tokens in both light and dark themes; custom CSS, HTML, scripts, and color overrides are not supported.

| Option    | Values                | Default    |
| --------- | --------------------- | ---------- |
| `width`   | `standard`, `wide`    | `standard` |
| `spacing` | `normal`, `spacious`  | `normal`   |
| `header`  | `standard`, `minimal` | `standard` |

The exit control is always available. Forms stack on narrow screens.

## Blocks

| Type          | Fields                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------- |
| `hero`        | `title`, optional `eyebrow`, `description`, `alignment` (`start` or `center`, default `center`)         |
| `text`        | `content`, optional `alignment` (default `start`), `secondary`                                          |
| `launch-form` | `ruleId`, button `label`, `inputs`                                                                      |
| `command`     | Static `command`; includes a Copy button and status feedback. Never executes the command.               |
| `divider`     | Optional `label`                                                                                        |
| `guide-links` | `layout` (`cards` or `links`), `links` containing `ruleId` and optional `label`/`description` overrides |

Text is plain text. Link descriptions appear in card layouts. Every rule in a structured catalog requires a unique `id`; rules retain `title`, `url`, `description`, and optional `type`, `page`, and `targetUrl`. Unknown fields, unsupported versions, duplicate IDs, and unresolved references reject the catalog and use the existing fallback flow.

Standard guide tiles display the current user's saved completion percentage and a checkmark at 100%. This requires no catalog fields. Progress is not shown for presentation tiles targeting another Grafana instance, where local progress would be misleading.

## Inputs

```json
{
  "type": "launch-form",
  "ruleId": "combined",
  "label": "Start guided setup",
  "inputs": [
    {
      "inputType": "text",
      "format": "http-origin",
      "variableName": "appUrl",
      "prompt": "Your website",
      "placeholder": "https://yourcompany.com",
      "required": true
    }
  ]
}
```

Use `inputType: "text"` for ordinary text, or add `format: "http-origin"` for a website origin. Use `inputType: "datasource"` with optional `datasourceFilter` for an instance data source picker. Selections store data source names, matching ordinary guide inputs. Inputs are limited to 2,048 characters; variable names must be identifiers and cannot be `__proto__`, `prototype`, or `constructor`.

The destination guide must declare exactly one compatible input for each transferred `variableName`, including matching `format`, data source filter, and requiredness. For example:

```json
{
  "type": "input",
  "inputType": "text",
  "format": "http-origin",
  "variableName": "appUrl",
  "prompt": "Your website",
  "required": true
}
```

Use `{{appUrl}}` in displayed text and `targetvalue` of a `formfill` step. Gate dependent sections with `"requirements": ["var-appUrl:*"]`. The guide input remains available for direct entry and editing.

Origins require explicit `http://` or `https://`, permit a port and trailing slash, and normalize to scheme plus host plus port. Credentials, paths, queries, fragments, whitespace, and control characters are rejected. No website request or scan is performed. Inputs with regex validation or data checks must remain inside the guide; kiosk handoff skips transferring values to them.

## Persistence and security

Forms launch only standalone guides in the same Grafana instance and tab (`?pathfinderKiosk=1`). Presentation-mode forms are disabled. Alternative guide links remain usable without completing the form. Other-instance and learning-path input transfer are unsupported.

Drafts stay in memory. Submission fetches and validates the guide through the trusted loader, resolves snippets, and checks every transferred variable's uses before persisting. Commands, selectors, navigation URLs, HTML attributes, and executable contexts cannot receive these inputs. Display fields pass through the existing Markdown parser and DOMPurify pipeline; transferred variables must resolve to text nodes, not attributes, link targets, or code. If the destination declarations or variable uses are incompatible, the guide opens normally without transferring any submitted inputs or showing a visitor warning. A bounded diagnostic and fallback event identify the issue for authors. Fetch and schema failures still block launch. The exact validated guide payload is handed to the sidebar without fetching it again.

Inputs are configuration, not secrets. Successful submissions persist in the existing per-user, per-guide response store, with its existing Grafana user-storage synchronization and local fallback. Submitted keys replace previous values; other keys and other guides are preserved. Empty optional fields are omitted and leave earlier saved values unchanged. Values are not placed in launch URLs, logs, or analytics. Storage failure keeps the form open with a retry message.

The current InteractiveGuide App Platform CRD does not declare `format`; origin-validated guides should be served as JSON packages until that backend schema is extended. The upload script warns about this field, and kiosk handoff skips transferring inputs when the destination format was removed.

Publish the plugin renderer before migrating catalogs. Older plugin versions cannot render structured pages. The DEM files in interactive-tutorials are a coordinated content update, not a deployment performed by this source change.

## Local preview

Build this checkout and run Grafana with its plugin directory mounted. The browser test `tests/kiosk-page.spec.ts` serves the DEM catalog through intercepted trusted URLs and uses two local form fields to exercise the handoff without creating monitoring resources:

```bash
GRAFANA_URL=http://localhost:3301 npx playwright test tests/kiosk-page.spec.ts --project=chromium
```

It saves screenshots under the Playwright test output directory. This demonstrates layout, persistence, and form filling; it does not certify live Synthetic Monitoring or Frontend Observability provisioning.

Command blocks use Bash syntax highlighting by default. Set `"language": "text"` for plain text, or `"language": "bash"` explicitly. Highlighting uses Grafana theme colors; copying always copies only the original command, without the decorative shell prompt.

Set `"variant": "banner"` on a hero block for a compact Grafana-branded banner with a theme-based background and border. Omit it (or use `"standard"`) to retain the original hero. Alignment, eyebrow, title, and description remain JSON-authored.
