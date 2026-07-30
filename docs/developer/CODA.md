# Coda sandbox terminal integration

Coda provisions **ephemeral 30-minute VMs** on AWS and exposes them as interactive terminals. As of
the backend extraction, Pathfinder owns only the **terminal UI**; everything behind it lives in the
separate **[`grafana-coda-app`](https://github.com/grafana/grafana-coda-app)** plugin.

See also: [`.cursor/rules/coda.mdc`](../../.cursor/rules/coda.mdc) for prescriptive agent
constraints, and the `grafana-coda-app` repo's `docs/API.md` for the authoritative v1 API contract.

> **Moved:** the canonical App Platform identity trust-boundary statement used to live in this file.
> It now lives in [`docs/design/BACKEND_PROXY_PATTERN.md`](../design/BACKEND_PROXY_PATTERN.md) §3,
> where it belongs — this file no longer describes any Go code in this repo.

## Ownership

| Concern                                                         | Owner                                     |
| --------------------------------------------------------------- | ----------------------------------------- |
| xterm.js panel, scrollback, resize, search                      | **Pathfinder** (`src/integrations/coda/`) |
| Guide block types (`terminal`, `terminal-connect`, `challenge`) | **Pathfinder**                            |
| `is-terminal-active` and `coda-exit-zero:` requirements         | **Pathfinder**                            |
| Session lifecycle, VM provisioning, quota                       | `grafana-coda-app`                        |
| SSH, relay handshake, credential handling                       | `grafana-coda-app`                        |
| Coda API URL, relay URL, enrollment key, refresh token          | `grafana-coda-app`                        |

**There is no Coda Go code in this repo.** `pkg/` is an App Platform read proxy only, and
`plugin.json` no longer declares `"streaming": true`.

```
Pathfinder frontend (React / xterm.js)
    │  1. POST /api/plugins/grafana-coda-app/resources/v1/sessions
    │  2. Grafana Live subscribe + publish on the returned channel
    ↓
grafana-coda-app backend (Go)
    ├─ REST ──→ Coda server  (VM CRUD, catalogues, auth)
    └─ WSS  ──→ Relay ──→ SSH ──→ EC2 VM
```

## The session handshake

VM resolution takes up to ~3 minutes, so `POST /v1/sessions` **reserves intent and returns
immediately**. Provisioning happens after the client subscribes, where status frames can drive the
progress bar.

```ts
const session = await createSession({ template: 'vm-aws-sample-app', app: 'nginx' });
// → { sessionId: 's_01…', channel: 'plugin/grafana-coda-app/v1/session/s_01…', state: 'pending' }

const address = sessionChannelAddress(session.channel);
liveSrv.getStream(address).subscribe({ next: handleEvent });
liveSrv.publish(address, { type: 'input', data: 'ls\n' }, { useSocket: true });
```

The channel path is **opaque** — always use the `channel` string the backend returned. A scenario ID
containing slashes (`otel-examples/cost-control`) travels in the JSON body; the previous
channel-path grammar had to spread it across trailing segments.

Publishing uses `{ useSocket: true }` deliberately: `POST /api/live/publish` can land on a Grafana
node that is not running the stream in multi-node deployments.

### Live frame shape

One shape only:

```
frame name: "coda.session.v1"
fields:     [ { name: "event", type: string } ]   // JSON-encoded SessionEvent
```

| `SessionEvent.type` | Meaning                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------ |
| `output`            | SSH stdout/stderr data                                                                                       |
| `status`            | VM state update (`pending`, `provisioning`, `active`, `checking`, `replacing`, `ssh_connecting`, `retrying`) |
| `connected`         | SSH session ready (carries `vmId`)                                                                           |
| `disconnected`      | Session ended                                                                                                |
| `error`             | Error message                                                                                                |
| `heartbeat`         | Keep-alive, every 3 s                                                                                        |

`seq` is reserved on `SessionEvent` for future ordering; it is not emitted in v1.

## Exec

`coda-exit-zero:<command>` and the challenge block both call
`execInSession(sessionId, { command, mode, timeoutMs })` against
`POST /v1/sessions/{id}/exec`. Exec reuses the stream's SSH client and never opens a new
connection, so a session whose terminal has not connected returns `409`.

`mode: 'gated'` wraps the command behind a `/tmp/pathfinder-ready` sentinel so a "Check my work"
click cannot evaluate the criterion before setup finishes. This is a **UI-race guard, not a security
boundary** — the learner has full shell access to the same VM.

Timeouts default to 5 s and are capped at 120 s (the cap accommodates `setupScript` runs such as
`apt-get install`). Output is capped at 32 KB per stream, with `truncated: true` when it overflows.

## Availability

The terminal is optional, so `grafana-coda-app` is **not** a declared plugin dependency. Three gates
must all pass for the panel to render:

| Gate                              | Source                                                                |
| --------------------------------- | --------------------------------------------------------------------- |
| `isDevMode`                       | `isDevModeEnabled(pluginConfig, userId)`                              |
| `jsonData.enableCodaTerminal`     | Pathfinder's own setting (default `false`)                            |
| Coda plugin installed and enabled | `useCodaPluginAvailable()` → `isAppPluginEnabled('grafana-coda-app')` |

The block editor palette needs the latter two. `CodaBackendStatus` on the configuration page reports
which gate is unmet and links to `/plugins/grafana-coda-app`.

## Configuration

Pathfinder keeps exactly one Coda setting:

| Key                  | Type    | Default | Description                                 |
| -------------------- | ------- | ------- | ------------------------------------------- |
| `enableCodaTerminal` | boolean | `false` | Whether Pathfinder shows terminal UI at all |

Everything else is configured on the Coda plugin's own page:

| Kind             | Key                                |
| ---------------- | ---------------------------------- |
| `jsonData`       | `apiUrl`, `relayUrl`, `registered` |
| `secureJsonData` | `enrollmentKey`, `refreshToken`    |

### Operator migration

Grafana plugin settings are per-plugin and `secureJsonData` is write-only (`secureJsonFields`
exposes booleans, not values), so **the refresh token cannot be copied across**. Every operator with
Coda enabled must re-enter their enrollment key at `/plugins/grafana-coda-app`. There is no
automatic migration and none can be built from the frontend.

## Local development

The terminal needs both plugins in one Grafana. This repo's `docker-compose.yaml` already allows the
Coda plugin unsigned, filters its logs to debug, and bind-mounts its `dist/`:

```bash
# in a checkout of github.com/grafana/grafana-coda-app
mage build:linuxARM64        # or build:linuxAMD64 on Intel — must match the container arch
npm run build

# back here
docker compose up -d --build grafana
```

The mount defaults to `../grafana-coda-app/dist`, i.e. a sibling checkout named after the repo. If
yours lives elsewhere, set `CODA_PLUGIN_DIST` in `.env` rather than editing the compose file:

```bash
CODA_PLUGIN_DIST=/path/to/grafana-coda-app/dist
```

A missing or empty `dist/` is not an error — Grafana simply loads no Coda plugin, `isAppPluginEnabled`
returns false, and the terminal stays hidden. That is the same path a user without Coda takes, so it
is worth exercising deliberately.

Rebuilding the Coda **frontend** needs only a page reload; rebuilding its **backend** needs the
plugin process to restart, so recreate the container. A change to its `plugin.json` needs a full
Grafana restart.

## Key files

| File                                                            | Purpose                                                                                  |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `src/integrations/coda/coda-api.ts`                             | The only module that knows the Coda plugin id                                            |
| `src/integrations/coda/useTerminalLive.hook.ts`                 | Live subscription, publish, provision progress bar, 35 s handshake timeout               |
| `src/integrations/coda/TerminalContext.tsx`                     | Shared context + module-level `getTerminalConnectionStatus()` / `getTerminalSessionId()` |
| `src/integrations/coda/TerminalPanel.tsx`                       | xterm.js panel with FitAddon, WebLinks, Serialize, Search, WebGL                         |
| `src/integrations/coda/useCodaAvailability.hook.ts`             | Runtime plugin detection, cached per page load                                           |
| `src/integrations/coda/terminal-storage.ts`                     | Panel state, scrollback, last VM opts                                                    |
| `src/requirements-manager/checks/coda.ts`                       | `coda-exit-zero:` check (always gated)                                                   |
| `src/requirements-manager/checks/terminal.ts`                   | `is-terminal-active` check                                                               |
| `src/components/AppConfig/CodaBackendStatus.tsx`                | Backend availability reporting                                                           |
| `src/components/interactive-tutorial/challenge-block.tsx`       | CTF-style block                                                                          |
| `src/components/interactive-tutorial/terminal-connect-step.tsx` | "Try in terminal" button                                                                 |

### Terminal persistence

| Key                                      | Storage        | Purpose                                  |
| ---------------------------------------- | -------------- | ---------------------------------------- |
| `pathfinder-coda-terminal-is-open`       | localStorage   | Panel expanded                           |
| `pathfinder-coda-terminal-height`        | localStorage   | Panel height (100-600 px)                |
| `pathfinder-coda-terminal-was-connected` | sessionStorage | Auto-reconnect on mount                  |
| `pathfinder-coda-terminal-scrollback`    | sessionStorage | Serialized content (~100 KB cap)         |
| `pathfinder-coda-terminal-last-vm-opts`  | sessionStorage | Template/app/scenario for auto-reconnect |

No VM ID, token, or session ID is persisted client-side. A refresh therefore reconnects by creating
a **new** session; the backend reuses the underlying VM when template, app, and scenario all match.

## Guide block types

```json
{
  "type": "terminal-connect",
  "content": "Connect to an nginx sandbox to follow along:",
  "buttonText": "Connect to nginx sandbox",
  "vmTemplate": "vm-aws-sample-app",
  "vmApp": "nginx"
}
```

| Field        | Type   | Default             | Description                                               |
| ------------ | ------ | ------------------- | --------------------------------------------------------- |
| `content`    | string | (required)          | Markdown shown above the button                           |
| `buttonText` | string | `"Try in terminal"` | Button label                                              |
| `vmTemplate` | string | `""` (→ `vm-aws`)   | VM template to provision                                  |
| `vmApp`      | string | `""`                | App name for `vm-aws-sample-app`                          |
| `vmScenario` | string | `""`                | Scenario ID for `vm-aws-alloy-scenario` (may contain `/`) |

Defined in `src/types/json-guide.types.ts` and validated by `src/types/json-guide.schema.ts`. The
block editor populates the app and scenario dropdowns from `GET /v1/sample-apps` and
`GET /v1/alloy-scenarios`.

## VM templates

| Template                | Instance | Pool      | Use case                                         |
| ----------------------- | -------- | --------- | ------------------------------------------------ |
| `vm-aws`                | t3.micro | Hot pool  | Default sandbox — generic Ubuntu VM              |
| `vm-aws-sample-app`     | t3.small | On-demand | Pre-configured integration app (nginx, mysql, …) |
| `vm-aws-alloy-scenario` | t3.small | On-demand | Pre-configured Grafana Alloy learning scenario   |

The authoritative list is `GET /v1/capabilities`; prefer feature-detecting over hardcoding.

## Troubleshooting

### Terminal not appearing

Check all three gates above. `CodaBackendStatus` on the configuration page names the failing one.
The most common cause after the backend extraction is that `grafana-coda-app` is not installed.

### "The Coda app plugin is not installed or not enabled"

`POST /v1/sessions` returned 404, meaning Grafana has no such plugin route. Install and enable
`grafana-coda-app`.

In local dev this usually means the bind-mount points at nothing — see
[Local development](#local-development). Check `docker compose logs grafana | grep coda`: a plugin
that mounted but failed to start logs a reason, whereas one that never mounted is silent.

### "Coda is not registered"

The plugin is installed but has no refresh token. An admin must enter an enrollment key at
`/plugins/grafana-coda-app`.

### Challenge check always fails

The gated sentinel may be missing. Confirm setup completed — the challenge block writes
`/tmp/pathfinder-ready` as its last setup step, and a gated exec cannot pass before that exists.

### VM stuck provisioning, SSH failures, quota problems

These are backend concerns. See the `grafana-coda-app` repo's `docs/API.md` and `docs/SECURITY.md`.
