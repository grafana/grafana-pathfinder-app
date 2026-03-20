# Coda VM system

Coda is a backend service (separate repo: [`grafana-coda-app`](https://github.com/grafana/grafana-coda-app)) that provisions **ephemeral 30-minute VMs** on AWS for sandbox terminal access inside Grafana Pathfinder. Pathfinder's Go backend is the sole consumer of Coda's REST API; the React frontend never calls Coda directly.

See also: [`.cursor/rules/coda.mdc`](../../.cursor/rules/coda.mdc) for prescriptive agent constraints.

## Architecture

### Coda components

```
Pathfinder Plugin (Go backend)
    │  REST API (JWT)
    ↓
Coda Server  (Node.js / Express / PostgreSQL)
    │  Webhook (shared secret)
    ↓
Coda Job Manager  (Bash / webhook / K8s)
    │  K8s Job API
    ↓
Coda Runner  (container: Terraform / Jsonnet / wsa CLI)
    │  AWS APIs
    ↓
EC2 VMs, S3, Security Groups
```

| Component       | Tech stack                                              | Purpose                                                                  |
| --------------- | ------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Server**      | Node.js 18+, Express, PostgreSQL                        | Central API, state management, quota, auth, credential storage           |
| **Job Manager** | Bash, [webhook](https://github.com/adnanh/webhook), K8s | Receives HTTP webhooks, creates K8s Jobs in `coda-jobs` namespace        |
| **Runner**      | Bash/Python CLI (`wsa`), Terraform/OpenTofu, Jsonnet    | Generates Terraform from Jsonnet templates, provisions EC2, reports back |
| **Relay**       | Go, Gorilla WebSocket                                   | WebSocket-to-TCP proxy for SSH connections to VMs                        |

### Terminal I/O path

```
Browser (xterm.js)
    ↕  Grafana Live WebSocket
Pathfinder Backend (Go)
    ├─ REST ──→ Coda Server  (VM lifecycle)
    └─ WSS  ──→ Relay ──→ TCP:22 ──→ EC2 VM (SSH)
```

The frontend subscribes to a Grafana Live channel. The backend handles all SSH negotiation and streams terminal I/O over the Live channel.

## VM lifecycle

### State machine

```
pending ──→ provisioning ──→ active ──→ destroying ──→ destroyed
    │             │             │
    └─────────────┴─────────────┴──→ error
```

Additional state: **pooled** — pre-provisioned and waiting in the hot pool (`vm-aws` only).

| State          | Meaning                                        |
| -------------- | ---------------------------------------------- |
| `pending`      | Created in database, job not yet started       |
| `provisioning` | K8s Job running, EC2 being created             |
| `pooled`       | Pre-provisioned, waiting for a user to claim   |
| `active`       | SSH-accessible, 30-minute expiry timer running |
| `destroying`   | Teardown in progress                           |
| `destroyed`    | Fully removed                                  |
| `error`        | Provisioning or destruction failed             |

### Provisioning flow

1. Pathfinder backend calls `POST /api/v1/vms` with `template`, `owner`, and optional `config`.
2. Coda Server validates auth, checks quota, creates a DB record, uploads config to S3.
3. Server sends a webhook to Job Manager (`PUT /hooks/jobs`).
4. Job Manager creates a K8s Job in the `coda-jobs` namespace.
5. Runner pod fetches config from S3, runs Jsonnet → Terraform, provisions EC2.
6. Runner calls `POST /api/v1/vms/provisioner/:jobId` with credentials.
7. Server stores encrypted credentials, sets state to `active`.
8. Pathfinder backend retrieves credentials via `GET /api/v1/vms/:id`.

### Destruction flow

VMs are automatically destroyed after 30 minutes. Explicit destruction follows the same pattern: Server → Job Manager webhook → Runner `terraform destroy` → Server marks `destroyed`.

## VM templates

| Template                | Instance type | AMI                      | Pool      | Use case                                       |
| ----------------------- | ------------- | ------------------------ | --------- | ---------------------------------------------- |
| `vm-aws`                | t3.micro      | `coda-vm`                | Hot pool  | Default sandbox — generic Ubuntu VM            |
| `vm-aws-sample-app`     | t3.small      | `coda-sample-app-vm`     | On-demand | Pre-configured integration app (nginx, etc.)   |
| `vm-aws-alloy-scenario` | t3.small      | `coda-alloy-scenario-vm` | On-demand | Pre-configured Grafana Alloy learning scenario |

### Sample apps

When a guide specifies `vmTemplate: "vm-aws-sample-app"` and `vmApp: "nginx"`:

1. `CreateVM("vm-aws-sample-app", user, { "app": "nginx" })` is called.
2. Runner uses `vm-aws-sample-app.jsonnet` which references the `coda-sample-app-vm` AMI.
3. EC2 user-data runs `systemctl start coda-bootstrap@nginx`.
4. Bootstrap script pulls the latest sample-apps repo, renders the app's Jinja cloud-init template, installs packages, writes config files, and runs setup commands.
5. Alloy is installed with placeholder config — the tutorial guides the user to configure it.

Validated apps include: `linux-node`, `nginx`, `mysql`, `mongodb`. Many more are available but less tested (apache-tomcat, rabbitmq, clickhouse, etc.).

### Alloy scenarios

When a guide specifies `vmTemplate: "vm-aws-alloy-scenario"` and `vmScenario: "otel-examples/cost-control"`:

1. `CreateVM("vm-aws-alloy-scenario", user, { "scenario": "otel-examples/cost-control" })` is called.
2. Runner uses `vm-aws-alloy-scenario.jsonnet` which references the `coda-alloy-scenario-vm` AMI.
3. EC2 user-data bootstraps the selected scenario (Alloy config, synthetic metrics, etc.).

Scenario IDs may contain slashes (e.g. `otel-examples/cost-control`) and are treated as a single logical identifier. In the Grafana Live channel path these are encoded as additional path segments and are rejoined server-side.

Available scenarios are fetched via `GET /api/plugins/grafana-pathfinder-app/resources/alloy-scenarios` (proxied to `GET /api/v1/alloy-scenarios` on Coda Server).

## Pathfinder backend integration

### CodaClient (`pkg/plugin/coda.go`)

The `CodaClient` struct handles all communication with Coda's REST API.

**Authentication**: JWT-based. A long-lived refresh token (stored in secure jsonData) is exchanged for short-lived access tokens. `getAccessToken()` automatically refreshes when the token expires (1-minute buffer).

**Key methods**:

| Method                                                 | Coda endpoint                 | Purpose                                        |
| ------------------------------------------------------ | ----------------------------- | ---------------------------------------------- |
| `Register(ctx, enrollmentKey, instanceID, codaAPIURL)` | `POST /api/v1/auth/register`  | One-time registration, returns refresh token   |
| `CreateVM(ctx, template, owner, config...)`            | `POST /api/v1/vms`            | Create VM with optional config map             |
| `GetVM(ctx, vmID)`                                     | `GET /api/v1/vms/:id`         | Get VM status and credentials                  |
| `DeleteVM(ctx, vmID, force)`                           | `DELETE /api/v1/vms/:id`      | Destroy VM (`?force=true` for stuck VMs)       |
| `ListVMs(ctx, opts)`                                   | `GET /api/v1/vms`             | List VMs (filter by `owner`, `state`, `limit`) |
| `FindActiveVMForUser(ctx, owner)`                      | Uses `ListVMs`                | Find most recent usable VM + surplus list      |
| `CountVMsForUser(ctx, owner)`                          | Uses `ListVMs`                | Count non-terminal VMs for quota check         |
| `ListSampleApps(ctx)`                                  | `GET /api/v1/sample-apps`     | Available sample apps for block editor         |
| `ListAlloyScenarios(ctx)`                              | `GET /api/v1/alloy-scenarios` | Available Alloy scenarios for block editor     |

**URL validation**: Coda API URL must be `https` and the host must end with `.lg.grafana-dev.com` or `.grafana.com`. Relay URL must be `wss` with the same allowlist.

### HTTP resource handlers (`pkg/plugin/resources.go`)

All routes are prefixed by Grafana as `/api/plugins/grafana-pathfinder-app/resources/`.

| Route              | Method | Handler                | Purpose                                   |
| ------------------ | ------ | ---------------------- | ----------------------------------------- |
| `/coda/register`   | POST   | `handleCodaRegister`   | Register with Coda using enrollment key   |
| `/vms`             | POST   | `handleCreateVM`       | Create VM (template + optional config)    |
| `/vms`             | GET    | `handleListVMs`        | List user's VMs                           |
| `/vms/{id}`        | GET    | `handleGetVM`          | Get VM details                            |
| `/vms/{id}`        | DELETE | `handleDeleteVM`       | Destroy VM                                |
| `/sample-apps`     | GET    | `handleSampleApps`     | Proxy to Coda's sample-apps endpoint      |
| `/alloy-scenarios` | GET    | `handleAlloyScenarios` | Proxy to Coda's alloy-scenarios endpoint  |
| `/health`          | GET    | `handleHealth`         | Plugin health (includes `codaRegistered`) |

### Grafana Live streaming (`pkg/plugin/stream.go`)

Terminal I/O uses Grafana's Live streaming infrastructure (WebSocket-based pub/sub).

**Channel path format**:

```
terminal/{vmId}/{nonce}                                → default (vm-aws)
terminal/{vmId}/{nonce}/{template}                     → custom template
terminal/{vmId}/{nonce}/{template}/{app}               → custom template + app (sample-app)
terminal/{vmId}/{nonce}/vm-aws-alloy-scenario/{id}     → alloy scenario (id may contain slashes)
```

`vmId` is `"new"` on first connect. The `nonce` (timestamp) prevents channel reuse across reconnects.

For `vm-aws-alloy-scenario`, the scenario ID is treated as all remaining path segments joined by `/`, allowing IDs like `otel-examples/cost-control` to be encoded naturally.

**Stream lifecycle**:

| Callback          | Role                                                                  |
| ----------------- | --------------------------------------------------------------------- |
| `SubscribeStream` | Authorize subscription, validate channel path                         |
| `RunStream`       | Provision/reuse VM, establish SSH, stream output, send heartbeats     |
| `PublishStream`   | Receive frontend input (`input`, `resize`) and forward to SSH session |

**VM resolution** (`resolveVMForUser`):

1. **In-memory cache** — `userVMs` map (`userLogin → vmID`). Check if cached VM is usable and matches requested template+app/scenario.
2. **ListVMs fallback** — Query Coda API for user's active VMs. Match template+app/scenario.
3. **Quota cleanup** — If quota is full (≥ 3 VMs), `cleanupUserVMsForQuota` force-destroys all of the user's stale usable VMs and polls until the count drops, then retries creation. If Coda's server-side quota check rejects creation despite the local check passing, one more cleanup + retry is attempted.
4. **Create new** — `CreateVM` with the requested template and config.

Template+app/scenario scoping: if the user's existing VM has a different app or scenario, the old VM is destroyed and a new one is created. This ensures switching between sample apps or alloy scenarios gives a fresh environment.

**VM polling** (`waitForVMActive`): polls `GetVM` every 3 seconds, up to 60 attempts (~3 minutes). Sends status updates to the frontend on each poll.

**Heartbeat**: sends a heartbeat frame every 3 seconds to keep the Grafana Live channel open.

**VM expiry poll**: every 15 seconds, checks whether the active VM has entered a terminal state (`destroying`, `destroyed`, `error`). If so, sends an error and cancels the stream.

**Stream output types** (`TerminalStreamOutput`):

| Type           | Description                                                   |
| -------------- | ------------------------------------------------------------- |
| `output`       | SSH stdout/stderr data                                        |
| `error`        | Error message                                                 |
| `connected`    | SSH session ready (includes `vmId`)                           |
| `disconnected` | Session ended                                                 |
| `status`       | VM state update (e.g., `pending`, `provisioning`, `retrying`) |
| `heartbeat`    | Keep-alive signal                                             |

### SSH via relay (`pkg/plugin/terminal.go`, `pkg/plugin/wsconn.go`)

**Connection flow**:

1. `ConnectSSHViaRelay(relayURL, vmID, creds, token)` opens a WebSocket to `wss://{relayURL}/relay/{vmID}` with `Authorization: Bearer {accessToken}`.
2. `WSConn` wraps the WebSocket as a `net.Conn` (binary messages, 30 s write deadline, 90 s pong-based read deadline).
3. SSH handshake over `WSConn` using the VM's private key. Host key verification is disabled because VMs are ephemeral.
4. `NewTerminalSessionWithClient` opens a PTY (`xterm-256color`, 24x80) with stdin/stdout/stderr pipes.
5. `forwardOutput()` and `forwardStderr()` goroutines stream data to the `onOutput` callback.
6. `Write()` sends data to stdin; `Resize()` sends a `WindowChange` request.

**Retry logic**:

| Constant                 | Value | Description                                    |
| ------------------------ | ----- | ---------------------------------------------- |
| `maxSSHRetries`          | 3     | SSH connection attempts before giving up       |
| `maxCredentialRefreshes` | 2     | Re-fetch credentials from Coda on auth failure |
| `sshRetryDelay`          | 5 s   | Delay between SSH retries                      |

Auth errors trigger a credential refresh (re-call `GetVM` to get fresh credentials), then retry. Other retryable errors (timeout, connection refused) retry with delay. After all retries fail, the backend destroys the VM to free the quota slot.

## Pathfinder frontend integration

### TerminalContext (`src/integrations/coda/TerminalContext.tsx`)

Shared React context providing terminal state and actions to any component.

**Key API**:

| Property/Method                | Description                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------------- |
| `status`                       | `ConnectionStatus`: `'disconnected'`, `'connecting'`, `'connected'`, `'error'`     |
| `connect(vmOpts?)`             | Start connection (accepts `TerminalVMOptions` for template/app)                    |
| `disconnect()`                 | Tear down connection                                                               |
| `sendCommand(command)`         | Send a command string to the terminal (appends newline)                            |
| `openTerminal(vmOpts?)`        | Expand panel + connect if not already connected; reconnect if template/app changes |
| `isExpanded` / `setIsExpanded` | Panel visibility state                                                             |

**Module-level status**: `getTerminalConnectionStatus()` exposes connection status without React context, used by the requirements manager to check `is-terminal-active`.

### useTerminalLive hook (`src/integrations/coda/useTerminalLive.hook.ts`)

Core hook that manages the Grafana Live stream subscription.

- `connect(vmOpts?)` subscribes to `plugin/grafana-pathfinder-app/terminal/new/{nonce}/{template?}/{app?|scenario?}`.
- `TerminalVMOptions` carries `template`, `app` (for `vm-aws-sample-app`), and `scenario` (for `vm-aws-alloy-scenario`).
- Publishes input and resize events with `{ useSocket: true }` for multi-node Grafana compatibility.
- Handles stream output types: `output` → `terminal.write()`, `connected` → attach input listener, `status` → terminal status messages, `error` → display error.
- **Animated provision progress bar**: during `pending` and `provisioning` states, renders an asymptotic ease-out progress bar inline in xterm (overwrites the current line every 500 ms). Bar reaches ≈38 % at 10 s, ≈82 % at 45 s, and caps at 95 % until `active` arrives.
- Handshake timeout: 35 seconds, reset on each `status` update from backend.

### TerminalPanel (`src/integrations/coda/TerminalPanel.tsx`)

Collapsible, resizable panel at the bottom of the sidebar.

- **xterm.js** with FitAddon, WebLinksAddon, SerializeAddon, SearchAddon, WebglAddon.
- Registers with `TerminalContext` via the `_register()` callback.
- Auto-reconnect on mount if `getWasConnected()` returns true (sessionStorage).
- Scrollback serialized on unmount, restored on reconnect (sessionStorage, ~100 KB limit).
- Panel height: 100-600 px, persisted in localStorage.

### Terminal persistence (`src/integrations/coda/terminal-storage.ts`)

| Key                                      | Storage        | Purpose                                                              |
| ---------------------------------------- | -------------- | -------------------------------------------------------------------- |
| `pathfinder-coda-terminal-is-open`       | localStorage   | Whether terminal panel is expanded                                   |
| `pathfinder-coda-terminal-height`        | localStorage   | Panel height in pixels                                               |
| `pathfinder-coda-terminal-was-connected` | sessionStorage | Whether to auto-reconnect (tab-scoped)                               |
| `pathfinder-coda-terminal-scrollback`    | sessionStorage | Serialized terminal content (tab-scoped)                             |
| `pathfinder-coda-terminal-last-vm-opts`  | sessionStorage | Last VM opts (template/app/scenario) for auto-reconnect (tab-scoped) |

## Interactive guides

### Terminal-connect block type

Guides can include a `terminal-connect` block that renders a "Try in terminal" button and optionally provisions a specific VM template.

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
| `content`    | string | (required)          | Markdown description shown above the button               |
| `buttonText` | string | `"Try in terminal"` | Button label                                              |
| `vmTemplate` | string | `""` (→ `vm-aws`)   | VM template to provision                                  |
| `vmApp`      | string | `""`                | App name for `vm-aws-sample-app`                          |
| `vmScenario` | string | `""`                | Scenario ID for `vm-aws-alloy-scenario` (may contain `/`) |

Defined in `src/types/json-guide.types.ts` (`JsonTerminalConnectBlock`) and validated by `src/types/json-guide.schema.ts`.

### TerminalConnectStep component

`src/components/interactive-tutorial/terminal-connect-step.tsx`

- Renders the button and optional markdown content.
- On click, calls `terminalCtx.openTerminal({ template: vmTemplate, app: vmApp })`.
- Completes when `status === 'connected'` or user clicks "Continue".
- 10-second safety timeout if connection never completes.

### Block editor form

`src/components/block-editor/forms/TerminalConnectBlockForm.tsx`

- Provides fields for description, button text, VM template, and app/scenario name.
- When `vm-aws-sample-app` is selected, fetches available apps from `GET /api/plugins/grafana-pathfinder-app/resources/sample-apps` and shows a dropdown.
- When `vm-aws-alloy-scenario` is selected, fetches available scenarios from `GET /api/plugins/grafana-pathfinder-app/resources/alloy-scenarios` and shows a dropdown.
- The generic `useCodaOptions(enabled, url, key)` hook handles both fetches with loading/error states (replaced the earlier `useSampleApps` hook).

### Requirements

The `is-terminal-active` requirement checks `getTerminalConnectionStatus() === 'connected'`. It is used by `terminal` blocks (run command in terminal) and other steps that need an active terminal session.

### Block palette gating

Terminal block types (`terminal`, `terminal-connect`) are only shown in the block palette when `pluginConfig.enableCodaTerminal` is `true`. The `BlockPalette` component checks this via `getConfigWithDefaults()`.

## Configuration

### Plugin settings

**jsonData** (public):

| Key                  | Type    | Default | Description                            |
| -------------------- | ------- | ------- | -------------------------------------- |
| `enableCodaTerminal` | boolean | `false` | Feature gate for terminal UI           |
| `codaRegistered`     | boolean | `false` | Set after successful Coda registration |
| `codaApiUrl`         | string  | —       | Coda Server HTTPS URL                  |
| `codaRelayUrl`       | string  | —       | Relay WSS URL                          |

**secureJsonData** (encrypted):

| Key             | Description                            |
| --------------- | -------------------------------------- |
| `refreshToken`  | JWT refresh token from registration    |
| `enrollmentKey` | One-time key provided by administrator |

### Registration flow

1. Admin enters enrollment key in plugin settings page.
2. `POST /api/plugins/grafana-pathfinder-app/resources/coda/register` sends the key + instance ID + Coda API URL.
3. Backend calls `POST /api/v1/auth/register` on Coda Server.
4. Coda returns a refresh token + access token.
5. Backend stores the refresh token in secure jsonData, sets `codaRegistered = true`.

### Feature gating

The terminal panel is shown when **both** `isDevMode` and `pluginConfig.enableCodaTerminal` are true (see `docs-panel.tsx`). Block palette terminal blocks require only `enableCodaTerminal`.

## Quota and security

- **Per-user quota**: max 3 non-terminal VMs per user (enforced by `CountVMsForUser` before creation).
- **Quota cleanup**: if the quota is full when a new VM is needed, `cleanupUserVMsForQuota` force-deletes all of the user's usable VMs in parallel, then polls Coda's count until it drops below the limit (up to ~30 s) before retrying `CreateVM`. If Coda's server-side check rejects creation despite the local check passing, one additional cleanup + retry is attempted.
- **URL validation**: Coda API URL must be `https`, Relay URL must be `wss`, both must have hosts ending in `.lg.grafana-dev.com` or `.grafana.com`.
- **Credentials isolation**: SSH private keys and VM IPs are handled exclusively by the Go backend. The frontend never sees them.
- **Ephemeral VMs**: 30-minute maximum lifespan, minimal attack surface (SSH port only), per-session key pairs.

## Troubleshooting

### Auth expired / registration invalid

If Coda returns 401, the backend logs `"authentication failed, please re-register"`. Fix: re-enter the enrollment key in plugin settings and re-register.

### VM stuck in provisioning

If `waitForVMActive` exhausts 60 polls (~3 minutes), the stream sends an error. The VM may be stuck in the Coda pipeline. Check Coda Server logs and K8s Job status. Force-delete the VM via `DELETE /api/v1/vms/:id?force=true`.

### SSH connection failures

After 3 SSH retries (with up to 2 credential refreshes), the backend destroys the VM and reports an error. Common causes: security group misconfiguration, relay connectivity issue, or VM not fully booted. Check the backend plugin logs for `ConnectSSHViaRelay` errors.

### Terminal not appearing

Verify `enableCodaTerminal` is `true` in plugin jsonData and dev mode is enabled. The terminal panel requires both flags. Check `codaRegistered` is `true` in the health endpoint response.

### Sample app not installing

The bootstrap script runs at VM boot. If the app fails to install, SSH in and check `journalctl -u coda-bootstrap@<app>`. Common issues: network timeouts during package install, missing app template in the sample-apps repo.
