# Testing against Grafana Cloud with Graft

[Graft](https://github.com/grafana/plugin-graft) (`grafana/plugin-graft`, **Grafanista-only**) is an internal dev tool: a browser extension paired with a local server/binary that intercepts Grafana Cloud requests and serves a locally-built plugin from disk, with hot reload. Some Pathfinder contributors use it instead of, or alongside, this repo's Docker-based `npm run server` workflow (see [`LOCAL_DEV.md`](LOCAL_DEV.md)).

## Why a dev would reach for it here

- Test the `dist/` build (from `npm run dev` or `npm run build`) against a **real** Grafana Cloud stack — real data, real feature flags, hundreds of capabilities a local Docker stack doesn't have.
- Reproduce and fix a customer escalation directly on their stack, if authorized.
- Pair with an AI coding agent for rapid debug loops against a live stack — this is part of how Jay develops Pathfinder day to day.

## What this means when helping with this repo

- **No running `docker compose` container doesn't mean the plugin isn't running.** It may be served into a Cloud stack via Graft instead. Don't assume `npm run server` is the only way a dev is seeing their changes.
- **Graft's config and logs live outside this repo** — in `~/.config/graft/` and `~/.local/state/graft/`, not under this project. There's nothing to find here.
- **Graft's per-domain feature flag overrides are unrelated to Pathfinder's own flag system.** If a dev mentions flipping a flag while using Graft, that's Grafana Cloud's feature toggles via Graft, not Pathfinder's OpenFeature/experiment system (see [`FEATURE_FLAGS.md`](FEATURE_FLAGS.md), [`EXPERIMENT_TESTING.md`](EXPERIMENT_TESTING.md)).
- **The plugin ID Graft is configured with is `grafana-pathfinder-app`** (from `src/plugin.json`), pointed at this repo's `dist/` directory.

## Where to look for more

This repo doesn't own or document Graft itself — for install, setup, and feature detail, use plugin-graft's own docs rather than this file drifting out of date:

- [Is Graft for you?](https://github.com/grafana/plugin-graft/blob/main/docs/is-graft-for-you.md)
- [Graft features](https://github.com/grafana/plugin-graft/blob/main/docs/graft-features.md)
- [Setup guide](https://github.com/grafana/plugin-graft/blob/main/docs/setup.md)
- [Observability / logs](https://github.com/grafana/plugin-graft/blob/main/docs/observability.md)

Don't attempt to install or configure Graft on a user's behalf — point them at plugin-graft's README quick-install if asked.
