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
| Minting a gcx token, and the UI that offers it                  | **Pathfinder** (in the browser)           |
| Session lifecycle, VM provisioning, quota                       | `grafana-coda-app`                        |
| SSH, relay handshake, credential handling                       | `grafana-coda-app`                        |
| Writing the gcx config into the VM                              | `grafana-coda-app`                        |
| Coda API URL, relay URL, enrollment key, refresh token          | `grafana-coda-app`                        |

**There is no Coda Go code in this repo.** `pkg/` is an App Platform proxy only, and
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
| `error`             | Error message, plus a `code` from the same closed set the REST routes use                                    |
| `heartbeat`         | Keep-alive, every 3 s                                                                                        |

`seq` is reserved on `SessionEvent` for future ordering; it is not emitted in v1.

An `error` frame's `code` is what turns "Failed to create VM, please try again" into "you already have
the maximum number of sandbox VMs" (`vm_quota_exceeded`). It was added after v1.0 and is optional, so
an unrecognised code and an absent one both fall back to displaying `error` — never fatal, since new
codes are an additive change within v1. `codaErrorCodeMessage` in `useTerminalLive.hook.ts` is shared
with the REST path so both read the same code the same way.

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

## gcx credentials

Every sandbox image ships the [`gcx`](https://github.com/grafana/gcx) CLI, and it has no credential
until something gives it one. A `terminal-connect` block with `gcx: true` does that: once the terminal
is connected, `provisionGcx(sessionId, { token? })` sends a Grafana service account token to
`POST /v1/sessions/{id}/credential`, and the Coda backend writes
`$HOME/.config/gcx/config.yaml` (mode `0600`, `current-context: coda`) into the VM over the SSH channel
it already owns. gcx then talks to **this** Grafana as **this** learner.

**The browser mints; the backend cannot.** Grafana refuses to create a service account whose role
exceeds the caller's own, and a plugin's managed service account is created with no basic role at all —
`plugin.json` `iam` grants fine-grained permissions, never a role. So the plugin can mint nothing
usable, by design, and minting with the user's own session satisfies Grafana's guard by construction
instead of re-implementing it. Whatever comes back is capped at what the user already had.

**The cap holds only for a newly created account, so the account name is part of the guard.** One
service account per user, reused, with a fresh short-lived token per session. Pathfinder names that
account itself — `coda-gcx-u<userId>`, in `integrations/coda/gcx-service-account.ts` — rather than
taking the client's `coda-gcx-<login>` default: that default lowercases the login and rewrites every
non-`[a-z0-9-]` run to `-`, so `a.b` and `a-b` land on one name, and reuse is by exact name. A
collision would hand one person a token minted against another person's account, at that account's
role. Numeric ids do not collide. Reuse also outlives a role change — Grafana caps the role when the
account is created and grants the creator write on it, so an Admin who mints and is later demoted keeps
a route to an Admin token — and `assertServiceAccountIsMintable` refuses a reused account that
outranks the caller today. _Today_ is the load-bearing word: the comparison reads the caller's role
from `/api/user/orgs` rather than from `config.bootData`, which carries the role the page was loaded
with. That refusal carries its own code, `service_account_outranks_caller`, rather than folding into
`mint_forbidden`: both branch to the paste field, but only this one names something an operator can
delete, and only this one is a rung an operator can clear.

**A lookup that cannot answer holds the mint back.** The client reuses an exact name match without
checking its role, so an account this code could not read is an _unknown_ role rather than an absent
one — passing the name on regardless would hand the reuse straight back to the client. Grafana's `403`
on `serviceaccounts:read` is the ordinary route to the paste field below Admin, so it is reported as
`mint_forbidden`; any other failure is `service_account_check_unavailable`, which returns to `idle`
with the mint still on offer rather than sending a transient `503` to the paste field for good. The
preflight runs before the token name is claimed, so neither refusal burns one, and a pasted token skips
it entirely — there is no account to reason about.

**Minting is Admin-only in practice, so the paste path is not a fallback.** `serviceaccounts:create` is
an Admin permission by default while sandbox sessions are open to Editors, so most people who can open
a terminal cannot mint. Grafana answers `403` on the service-account _search_, not only the create, and
`@grafana/coda-client` maps that to the client-synthesised code `mint_forbidden`. Treat it as a branch,
not an error: the step reveals a token field and the same flow works for everyone. **Never ship a
mint-only UI.**

**The token is readable inside the VM.** The learner has a root shell on the same box, so it is exposed
for as long as the token lives. For a **minted** token that is bounded rather than prevented — it is
the learner's own identity, capped at their own role by Grafana's guard on creating the account. A
**pasted** token carries whatever role its own service account holds, so a pasted Admin token is an
Admin credential readable at root, and `GcxSetupPanel` attaches the cap claim to the mint button only
and asks for least privilege next to the field. Recorded as an accepted risk in the Coda plugin's
`docs/SECURITY.md`.

**Only a minted token's lifetime is ours.** A mint asks for a short-lived token that expires on its
own, inside the VM's lifetime. A **pasted** token is forwarded to the backend unchanged: Pathfinder
cannot shorten it, and holds no `serviceaccounts:delete` to revoke it, so one created without an expiry
stays valid long after the sandbox is gone. `GcxSetupPanel` says so next to the field rather than
repeating the minted token's bound over both paths.

**There is no capability flag for the route.** `capabilities.features` still lists only
`exec.readyFile`, and a Coda plugin older than 1.3.0 answers `404 session_not_found` — the same code as
a bad session id. Since the call only ever follows a session we just connected, `terminal-connect-step`
reads that 404 as "the plugin is too old" and says so, rather than doing version arithmetic on
`pluginVersion`.

A refusal never dead-ends a guide. The terminal is connected either way, so the step offers **Continue
without gcx**, and later steps gated on `is-terminal-active` still pass — their `gcx` commands just fail
unauthenticated, which is visible in the terminal.

**Two entry points, one implementation.** A guide drives it through
`terminal-connect` with `gcx: true`; anyone using the terminal on its own gets the **gcx** button in the
panel toolbar, which opens the same form in a modal. The shared parts live in `integrations/coda/` —
`useGcxCredential.hook.ts` for the flow and `GcxSetupPanel.tsx` for the form — and they have to live
there, not in `components/`: `TerminalPanel` is tier 3 and cannot import from tier 4, while
`terminal-connect-step` is tier 4 and can import from tier 3. The hook takes `onReady` as an injected
callback because marking a step complete is the step's business and means nothing to a toolbar button.

**One credential per session, shared by both.** The state lives in
`integrations/coda/gcx-credential-store.ts`, not in either component. Two independent copies would let
one surface offer a mint the other has already made — and Grafana rejects a duplicate token name, so
that second mint fails with a message about token names rather than anything a learner can act on.
Sharing it also means a credential installed from the toolbar completes a `gcx` step that is waiting on
one.

**Sharing one store makes the reader's identity load-bearing.** `useGcxCredential(onReady, sessionId)`
answers only for the session named, and everything it reports — state, credential, error — is `idle`
for any other. Without that, a credential installed from the toolbar would render a ready line on a
step targeting a different VM and complete it. `terminal-connect-step` passes `onReady` only when
`gcx` is set, and guards its gcx render on the same flag, so an ordinary connect step that only needed
a **Continue** click is never completed by someone else's credential. It is the additive contract
holding: a block without `gcx` behaves exactly as it did before the field existed.

**The store is keyed to the session, and a new session clears it.** `TerminalProvider` calls
`invalidateGcxCredentialForSession` whenever the registered session id changes, because a reconnect
provisions a _fresh_ VM holding no credential — keeping the old state would report gcx as ready for a
box that no longer exists, and the ready line would name its path. A `null` id is only a disconnect,
which may still reconnect to the same session, so it does not discard anything.

**An install that settles late cannot publish over its replacement.** Provisioning takes long enough
for the terminal to reconnect underneath it, so every reset and every run start bumps a generation
counter, and a run publishes its result only while it still holds the current generation _and_ the
snapshot still names its session. Without that guard, session A finishing after the terminal moved to B
would report ready — and complete B's step — for a VM that never received a credential.

**A retry asks for a token name nothing holds.** Tokens expire well inside a long session, so the modal
keeps a **Set up again** control next to the ready line; without it the form is unreachable once a
credential exists. Grafana rejects a duplicate token name even after the first token has expired, so
the store hands each mint for a session a name of its own — `coda-<sessionId>`, then
`coda-<sessionId>-2`, and so on. That also covers a mint whose delivery failed: the token was created,
its only value was discarded with the error, and the retry must not ask for the same name back.

**Do Section stops at a gcx step.** Not by the step's `executeStep` handle — `terminal-connect` is
`refTarget: 'none'`, so no ref is attached to it and that handle has no runner-side caller. The runner
routes the step through `executeInteractiveAction`, which has no `terminal-connect` case and so takes its
`default:` branch and _reports success_. `TERMINAL_CONNECT_STEP_SCHEMA` sets
`pausesSectionRun: props.gcx === true`, which stops the run cleanly at the step and hands the learner
back the controls.

**The ladder is measured.** `recordGcxCredentialDegradation` emits the rung that stopped an install
(`mint-forbidden`, `account-outranks-caller`, `account-check-unavailable`, `plugin-too-old`,
`refused`) and
`gcx_credential_installed` / `gcx_setup_skipped`
count the outcomes. The whole shape of this surface rests on how often `mint_forbidden` comes back, so
that rate cannot be left unmeasurable — no token, session id, or backend error text goes with it.

**`gcx` does not survive any write to the backend yet.** The `InteractiveGuide` CRD in
`grafana-pathfinder-backend` (`kinds/interactiveguide.cue`) declares `vmTemplate`, `vmApp` and
`vmScenario` but not `gcx`, and the API server prunes an undeclared field with a `200` and no message.
That is every path through the CRD, not only `scripts/upsert-guide.sh`: a **block-editor save or
publish** goes through the same resource, so a guide authored in the editor reloads without the flag and
its terminal step connects without installing a credential. Bundled packages and locally loaded JSON are
unaffected — nothing prunes them — so a guide that needs `gcx` is servable today, just not from a Cloud
stack. `TerminalConnectBlockForm` says so under the checkbox rather than letting an author discover it
on reload, `src/validation/upsert-script-crd-fields.test.ts` records it as a deliberate prune alongside
the `dataCheck*` family, and the fix is a `#Block` field in that repo's CUE.

## Requirements and a connecting terminal

`is-terminal-active` and `coda-exit-zero:` read live module state through
`getTerminalConnectionStatus()` / `getTerminalSessionId()`, so they can always _see_ a connection. What
they cannot do is notice one arriving: the requirements checker runs outside React, the heartbeat
watchdog only polls DOM-fragile requirements (`navmenu-open`, `exists-reftarget`, `on-page:`), and the
retry loop is bounded at three attempts. Provisioning a VM takes about a minute, so every terminal step
in a guide had long since settled on "not connected" and stayed there — the step showed _"A terminal
connection is required"_ under a terminal that was plainly connected.

So `TerminalProvider` dispatches **`TERMINAL_STATUS_CHANGED_EVENT`** on `window` whenever the registered
status changes, and `step-checker.hook.ts` rechecks any blocked step when it fires. The event name lives
in `src/types/requirements.types.ts` because the emitter is `integrations/coda` (tier 3) and the listener
is `requirements-manager` (tier 2) — they cannot import each other, and tier 0 is the only shared ground.

One subtlety worth keeping: the recheck declines while a check is already in flight, and the event never
comes again, so a status that arrives mid-check is **remembered and drained** once the check settles. That
is not hypothetical — `openTerminal` reconnects on a 100 ms timer, so a reconnect flips
`disconnected → connecting → connected` fast enough to land inside one check.

## Availability

The terminal is optional, so `grafana-coda-app` is **not** a declared plugin dependency. Three gates
must all pass for the panel to render:

| Gate                              | Source                                                                        |
| --------------------------------- | ----------------------------------------------------------------------------- |
| `isDevMode`                       | `isDevModeEnabled(pluginConfig, userId)`                                      |
| `jsonData.enableCodaTerminal`     | Pathfinder's own setting (default `false`)                                    |
| Coda plugin installed and enabled | `useCodaPluginAvailable()` → `isAppPluginInstalled` then `isAppPluginEnabled` |

The block editor palette needs the latter two. `CodaBackendStatus` on the configuration page reports
which gate is unmet and links to `/plugins/grafana-coda-app`.

**The probe is gated on the setting, not merely its consumer.** `useCodaPluginAvailability(shouldProbe)`
takes the caller's own gate — `useCodaTerminalGate()` passes `enableCodaTerminal`, `docs-panel.tsx`
passes `isDevMode && enableCodaTerminal`, `useCodaSessionEligibility(shouldLoad)` and `useCodaOptions`
take the same gate — so a default installation asks nothing about Coda. And the question it asks when it
does probe is "is the plugin installed", answered by `isAppPluginInstalled`: from boot data with no
request, or from core's own plugin LIST when `pluginsUseMTPlugins` is on — either way cached once per
page load and never a request to `/api/plugins/grafana-coda-app/*`. Only then does it ask
`isAppPluginEnabled`, whose settings fetch is what 404s. Core logs that 404 twice to the console and pushes it into its own error tracking, which
is why an absent optional plugin must never reach it.

**Minimum Grafana version: 13.1 — for the terminal only.** The third gate calls `isAppPluginEnabled`
(and `isAppPluginInstalled`, which shares that floor),
which core's `@grafana/runtime` did not export before 13.1 and which throws synchronously rather than
rejecting when absent. Nothing else on the path needs it: `@grafana/coda-client` uses only
`getBackendSrv().fetch` and `getGrafanaLiveSrv`, and `grafana-coda-app` itself declares
`>=12.3.0-0`, so the sandbox would work on 12.3–13.0 but for this probe. Pathfinder's own
`grafanaDependency` deliberately stays `>=12.3.0-0` — raising it would block the entire plugin from
installing on those versions for the sake of one optional, dev-mode-gated feature. Instead,
`isCodaProbeSupported()` separates "this Grafana cannot answer" from "the plugin is absent", and
`CodaBackendStatus` renders a distinct `grafana-too-old` notice for the former rather than claiming
the plugin is missing.

**"Registered" is not "usable".** `registered` means a credential was obtained and stored, which stays
true of a refresh token that expired 90 days ago while every call 401s. `CodaBackendStatus` therefore
reads `isCodaUsable(capabilities)` — `registered && credential.state !== 'expired' && !configErrors.length`
— and names which of the three failed. Both fields are absent on a Coda plugin older than 1.2.0, and
absent counts as no evidence of a problem, so this is never stricter than reading `registered` was.

### The caller's own role

`GET /v1/capabilities` also answers whether _this_ user may spend VM quota, in `caller`.
`useCodaSessionEligibility()` reads it as four states, and the two that are not verdicts are the point:

| State            | Means                                             | Do                                         |
| ---------------- | ------------------------------------------------- | ------------------------------------------ |
| `checking`       | The probe is in flight                            | Wait; offer the action                     |
| `eligible`       | `caller.canCreateSessions` is true                | Offer the action                           |
| `role_forbidden` | `caller.canCreateSessions` is false               | Say so, naming `caller.minimumSessionRole` |
| `unknown`        | Coda plugin older than the field, or probe failed | Attempt, and handle `403 role_forbidden`   |

Collapsing that into a boolean would either hide the sandbox from someone entitled to it or offer it to
someone who cannot have it. `minimumSessionRole` is for the message only — **never rank roles against it
here**: the plugin context carries only the basic role, RBAC cannot grant past it, and
`canCreateSessions` already carries the decision. The challenge block uses this to explain itself before
a Start click spends a session request; the reactive `403` path stays in place for `unknown` and for the
terminal panel's own Connect button.

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

Running without the overlay is a supported case, not a broken one, and it costs no request: boot data
carries no `grafana-coda-app`, `CodaBackendStatus` says the plugin is absent, and the terminal stays
hidden. Worth exercising deliberately, since that is what most users see — a console error or a
`/api/plugins/grafana-coda-app/*` request in this state is a regression.

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
| `src/integrations/coda/useGcxCredential.hook.ts`                | The gcx mint/paste flow, shared by the toolbar button and the guide step                 |
| `src/integrations/coda/gcx-credential-store.ts`                 | One gcx credential per session; session-keyed invalidation, and the ladder's telemetry   |
| `src/integrations/coda/gcx-service-account.ts`                  | Which service account a mint may use: the collision-free name, and the role reconcile    |
| `src/integrations/coda/GcxSetupPanel.tsx`                       | The gcx form and its result line; test ids come in as a prop                             |
| `src/integrations/coda/useCodaAvailability.hook.ts`             | Runtime plugin detection and caller eligibility, cached per page load                    |
| `src/integrations/coda/terminal-storage.ts`                     | Panel state, scrollback, last VM opts                                                    |
| `src/requirements-manager/checks/coda.ts`                       | `coda-exit-zero:` check (always gated)                                                   |
| `src/requirements-manager/checks/terminal.ts`                   | `is-terminal-active` check                                                               |
| `src/components/AppConfig/CodaBackendStatus.tsx`                | Backend availability reporting                                                           |
| `src/components/interactive-tutorial/challenge-block.tsx`       | CTF-style block                                                                          |
| `src/components/interactive-tutorial/terminal-connect-step.tsx` | "Try in terminal" button, and the gcx mint/paste flow behind `gcx: true`                 |

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

| Field        | Type   | Default             | Description                                                             |
| ------------ | ------ | ------------------- | ----------------------------------------------------------------------- |
| `content`    | string | (required)          | Markdown shown above the button                                         |
| `buttonText` | string | `"Try in terminal"` | Button label                                                            |
| `vmTemplate` | string | `""` (→ `vm-aws`)   | VM template to provision                                                |
| `vmApp`      | string | `""`                | App name for `vm-aws-sample-app`                                        |
| `vmScenario` | string | `""`                | Scenario ID for `vm-aws-alloy-scenario` (may contain `/`)               |
| `gcx`        | bool   | `false`             | Also install a gcx credential — see [gcx credentials](#gcx-credentials) |

Defined in `src/types/json-guide.types.ts` and validated by `src/types/json-guide.schema.ts`. The
block editor populates the app and scenario dropdowns from `capabilities.sampleApps` and
`capabilities.alloyScenarios` (`useCodaOptions`), not from the per-catalogue routes: the SDK does not
model those, so a hand-built URL or a guessed response key would drift out of the v1 contract without
a type error, emptying the dropdown in a way indistinguishable from "plugin absent". Reading the
capabilities response also carries each item's `status`, so an experimental entry is labelled.

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
The most common cause after the backend extraction is that `grafana-coda-app` is not installed. If
the page says "This Grafana is too old for the terminal", the stack is on core older than 13.1 and
the plugin's presence cannot be probed at all — see the version note above.

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

### "Coda's credential has expired"

The plugin is registered, but Coda no longer accepts the credential it stored — the refresh token
expired, or was revoked. Nothing on the Pathfinder side fixes this: an admin needs a fresh enrollment
key and must register again at `/plugins/grafana-coda-app`. Reported by `credential.state` on
`GET /v1/capabilities`, and only by Coda plugin 1.2.0 and later.

### Challenge check always fails

The gated sentinel may be missing. Confirm setup completed — the challenge block writes
`/tmp/pathfinder-ready` as its last setup step, and a gated exec cannot pass before that exists.

### "Grafana would not let this account mint a token"

Expected below Admin: `serviceaccounts:create` is an Admin permission by default. Paste a service
account token into the field the step reveals (Administration → Service accounts), or ask an
administrator for the permission. This is a branch, not a bug.

### "This Grafana's Coda plugin is too old to install a gcx credential"

`POST /v1/sessions/{id}/credential` arrived in `grafana-coda-app` 1.3.0. An older plugin has no such
route and answers `404` with the same code as an unknown session, so this is the best reading available
— there is no capability flag to feature-detect with. Upgrade the Coda plugin.

### `11;rgb:…` or similar escape text appears after command output

A program in the VM asked the terminal for its background colour (OSC 11) and the answer was echoed as
text instead of being consumed. xterm replies to OSC 10/11/12 through `onData`, and `onData` is piped
straight to the PTY — so over a relay the reply lands after the asking program has exited and restored
termios ECHO, and the shell echoes it. `TerminalPanel` now swallows those three queries with
`registerOscHandler(code, () => true)`, and the Coda plugin stops them being asked at all by running the
PTY under `TERM=screen-256color`, which is the prefix Go's `termenv` skips. If you see this again, a
different escape sequence is involved — check which, before adding another handler.

Worth knowing why it mattered beyond the cosmetics: `gcx` links `bubbletea`, whose package `init()`
issues that query and then blocks **five seconds** waiting for a reply it never uses. Fixing this made
every `gcx` command in a sandbox five seconds faster.

### `gcx` commands fail to connect, but `gcx config check` shows both ✔ lines

The config is fine and this is the expected result in local dev. The server written into the VM is
Grafana's own `AppURL`, which in the dev stack is `http://localhost:3000` — the **VM's** loopback,
where nothing is listening. Both ✔ lines prove gcx read our file and selected our context; only
reachability is missing. Exercising the commands needs a Grafana the VM can reach. Do not "fix" this by
rewriting the URL.

### VM stuck provisioning, SSH failures, quota problems

These are backend concerns. See the `grafana-coda-app` repo's `docs/API.md` and `docs/SECURITY.md`.
