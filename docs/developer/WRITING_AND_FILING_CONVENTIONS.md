# Writing, filing, and experiment conventions

Moved out of `AGENTS.md` to keep always-on context small. Load when writing UI text or docs, filing issues, running experiments, or writing `npx` examples.

## Writing style

All UI text and documentation uses **sentence case** per the [Grafana Writers' Toolkit](https://grafana.com/docs/writers-toolkit/write/style-guide/capitalization-punctuation/#capitalization) — capitalize the first word and proper nouns only, including headings, button labels, and menu items. Product and company names are proper nouns (**Grafana**, **Loki**, **Prometheus**, **Tempo**, **Mimir**, **Alloy**, **Grafana Cloud**, **Grafana Enterprise**, **Grafana Labs**); generic terms are not (dashboard, alert, data source, panel, query, plugin).

Users know the plugin as **Interactive learning**; "Pathfinder" is the internal name. Never use it in user-facing text (UI copy, `t()` defaults, aria-labels, alt text, locale values); identifiers, keys, and logs may keep it. ESLint and `user-facing-name.test.ts` enforce this.

## Filing issues

Fill out `.github/ISSUE_TEMPLATE/structured-issue.yml`, especially User impact / flow change and Acceptance criteria, and apply `needs-review` plus type, area, and severity labels. Report security issues via [Grafana's security reporting page](https://grafana.com/legal/report-a-security-issue/), not in this repository.

## A/B experiments

Use `/create-experiment`. Only object-valued flags carrying a `variant` field emit exposure events; a boolean experiment flag silently produces no readout.

## `npx` examples

Namespace every `npx` example under `pathfinder-cli@...` (write `npx pathfinder-cli@... example`, never `npx pathfinder-example`) so we are not namesquatted.

## Tech-debt audits

Use `/techdebt <subsystem>` against a concrete target; add `--suggestive` for lower-confidence candidates.
