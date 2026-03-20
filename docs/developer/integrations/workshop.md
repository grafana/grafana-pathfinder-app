# Workshop Integration

The Workshop integration (`src/integrations/workshop/`) provides features for workshop mode, including action capture and replay functionality.

## Overview

The Workshop integration enables recording and replaying user actions, which is useful for creating interactive guides and tutorials.

## Components

### Action Capture

**Location**: `src/integrations/workshop/action-capture.ts`

**Purpose**: Captures user actions for later replay

**Features**:

- Records user interactions (clicks, inputs, navigation)
- Captures element selectors and context
- Stores action sequences

### Action Replay

**Location**: `src/integrations/workshop/action-replay.ts`

**Purpose**: Replays captured actions

**Features**:

- Executes actions in sequence
- Validates element existence before replay
- Handles timing and delays

### Session Manager

**Location**: `src/integrations/workshop/session-manager.ts`

**Purpose**: Manages P2P connections for collaborative live learning sessions using PeerJS

**Features**:

- Creates and joins sessions with unique join codes
- Manages attendee connections via a `Map<string, DataConnection>`
- Broadcasts events to all connected attendees
- Integrates ECDSA presenter authentication (see [Session Crypto](#session-crypto) below)
- Reads PeerJS config from Grafana runtime (`usePluginContext`) rather than plugin props

**Key class**: `SessionManager` — handles presenter and attendee roles, reconnection, hand raises, and event routing.

### Session State

**Location**: `src/integrations/workshop/session-state.tsx`

**Purpose**: React context and hooks for sharing active session state across components

Wraps `SessionManager` in a React context. Provides `useSessionContext()` for components to access session info, attendee list, hand raises, and session actions (`createSession`, `joinSession`, `endSession`).

### Session Crypto

**Location**: `src/integrations/workshop/session-crypto.ts`

**Purpose**: Asymmetric challenge-response presenter authentication using ECDSA P-256 via the browser-native Web Crypto API (no external dependencies)

**Security model**:

- Presenter generates an ECDSA P-256 key pair at session creation
- The **public key** is embedded in the join code (safe to share)
- The **private key** never leaves the presenter's browser session
- Attendees challenge the presenter with a random nonce; only the holder of the private key can produce a valid signature — knowing the join code (and therefore the public key) does not allow impersonation

**Exported API**:

| Function                                          | Description                                                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `generateSessionKeyPair()`                        | Generates an ECDSA P-256 key pair. Returns `{ publicKeyB64, privateKey }` where `publicKeyB64` is SPKI-encoded base64url. |
| `generateNonce()`                                 | Generates a 16-byte cryptographically random nonce encoded as base64url. Called by the attendee.                          |
| `signChallenge(privateKey, nonce)`                | Signs a nonce with the presenter's private key. Returns base64url signature.                                              |
| `verifyChallenge(publicKeyB64, nonce, signature)` | Verifies an ECDSA signature against the presenter's public key. Returns `false` on invalid input or verification failure. |

### Feature flags

**Location**: `src/integrations/workshop/flags.ts`

**Purpose**: Runtime feature toggles for workshop mode

| Flag                  | Default | Description                                                                                                         |
| --------------------- | ------- | ------------------------------------------------------------------------------------------------------------------- |
| `FOLLOW_MODE_ENABLED` | `false` | Enables the follow-mode UI. Currently **disabled** pending a security review. Set to `true` to restore follow mode. |

> **Note**: Follow mode is disabled as of the ECDSA authentication PR (#680). The `attendeeMode: 'guided' \| 'follow'` type still exists in `session-state.tsx` and `collaboration.types.ts` but the follow-mode UI is hidden while `FOLLOW_MODE_ENABLED` is `false`.

## Usage

The Workshop integration is used for:

- Creating interactive guides (action capture and replay)
- Running collaborative live learning sessions (presenter + attendees via P2P)
- Debugging interactive elements in development mode

## Integration Points

- **Dev Tools** (`src/utils/devtools/`) — Uses action recorder utilities
- **Interactive Engine** (`src/interactive-engine/`) — Executes replayed actions
- **Grafana runtime** — PeerJS config is read from `usePluginContext` (not plugin props)

## See Also

- `docs/developer/DEV_MODE.md` — Development mode documentation
- `src/utils/devtools/action-recorder.hook.ts` — Action recording hook
- `src/integrations/workshop/session-crypto.ts` — ECDSA presenter verification
- `src/integrations/workshop/flags.ts` — Follow-mode feature flag
