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
`execInSession(sessionId, { command, readyFile, timeoutMs })` against
`POST /v1/sessions/{id}/exec`. Exec reuses the stream's SSH client and never opens a new
connection, so a session whose terminal has not connected returns `409`
`terminal_not_connected`.

`readyFile` gates the command behind that file existing, so a "Check my work" click cannot
evaluate the criterion before setup finishes. This is a **UI-race guard, not a security boundary** —
the learner has full shell access to the same VM. We pass `PATHFINDER_READY_FILE`, exported from
`coda-api.ts` and shared between the setup write and the check; it is our path to choose, not the
plugin's. The plugin's older `mode: 'gated'` is deprecated.

Errors carry a machine-readable `code` alongside the message — branch on that, never on wording or
on the status alone. `terminal_not_connected` (409, "not yet") and `terminal_disconnected` (503,
"no longer") need different handling, and `role_forbidden` (403) means the learner's Grafana role
is below the plugin's `minimumSessionRole`, which is neither a bug nor something retrying fixes.
Use `isNotReady`, `isRoleForbidden` and `isUnavailable` from `coda-api.ts`.

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

**A present `TerminalContext` is not a working terminal.** `TerminalProvider` mounts unconditionally
in `docs-panel.tsx` while `TerminalPanel` — the only caller of `_register`, and therefore the only
source of a real `connect` — is behind all three gates. Anything that would _wait_ on a connection
must check `isTerminalRegistered` first, or it waits forever on a `connect` that is still `null`
(issue #1541). The challenge block does both: `useCodaTerminalGate()` for the two operator-owned
gates, which are stable enough to render up front, and `isTerminalRegistered` at click time and in
its status watcher, because the panel loads lazily and is not registered on first paint.

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

The terminal needs both plugins in one Grafana. Coda is **not** part of the base dev stack — it is an
opt-in overlay, `docker-compose.coda.yaml`, so that the default stack (and CI) runs the same
no-Coda configuration a user without the plugin gets.

Build the plugin in its own checkout first:

```bash
# in a checkout of github.com/grafana/grafana-coda-app
mage build:linuxARM64        # or build:linuxAMD64 on Intel — must match the container arch
npm run build
```

Then enable the overlay by adding this to your (gitignored) `.env`:

```bash
COMPOSE_FILE=docker-compose.yaml:docker-compose.coda.yaml
CODA_PLUGIN_DIST=../grafana-coda-app/dist
```

after which the usual `docker compose up -d --build grafana` picks it up. Or pass the files
explicitly, without touching `.env`:

```bash
docker compose -f docker-compose.yaml -f docker-compose.coda.yaml up -d --build grafana
```

The overlay mounts two things that must always travel together: the plugin's `dist/`, and a
provisioning entry (`demo/coda-app-provisioning.yaml`) that enables it.

**Never move that entry into `provisioning/plugins/`.** Grafana treats a provisioned-but-missing app
plugin as fatal:

```
app provisioning error: plugin not installed: "grafana-coda-app"
```

The provisioning module fails, every module depending on it fails, and Grafana **exits 1** — it never
serves a request. So the entry is only safe next to the mount that installs the plugin. For the same
reason `CODA_PLUGIN_DIST` is **required with no default**: a wrong default would mount an empty
directory, Grafana would find no `plugin.json`, and the provisioning entry would then be fatal.
Failing fast on an unset variable beats debugging a Grafana that never comes up.

Running without the overlay is a supported case, not a broken one: `isAppPluginEnabled` returns
false, `CodaBackendStatus` says the plugin is absent, and the terminal stays hidden. Worth
exercising deliberately, since that is what most users see.

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

In local dev this usually means the `docker-compose.coda.yaml` overlay is not enabled, or
`CODA_PLUGIN_DIST` points at a `dist/` that was never built — see
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
