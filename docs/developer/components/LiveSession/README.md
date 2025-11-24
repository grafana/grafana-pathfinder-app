# Live Session

The Live Session component (`src/components/LiveSession/`) provides real-time collaboration features for interactive learning sessions.

## Overview

Live Session enables multiple users to participate in shared learning sessions, with features like hand raising, connection indicators, and presenter controls.

## Architecture

### Core Components

- **`PresenterControls.tsx`** - Controls for session presenters
- **`AttendeeJoin.tsx`** - Join interface for attendees
- **`HandRaiseButton.tsx`** - Button for raising hand
- **`HandRaiseIndicator.tsx`** - Visual indicator for raised hands
- **`HandRaiseQueue.tsx`** - Queue of raised hands
- **`ConnectionIndicator.tsx`** - Connection status indicator

## Features

### Real-Time Communication

- Peer-to-peer connections via PeerJS
- WebRTC for low-latency communication
- Connection status monitoring

### Hand Raising System

- Attendees can raise hands
- Presenter sees queue of raised hands
- Visual indicators for active participants

### Session Management

- Presenter controls session flow
- Attendees follow presenter's actions
- Synchronized state across participants

## Integration

Live Session uses:
- **PeerJS** (`peerjs` package) - P2P communication
- **Live Session Service** - Session management (see `src/integrations/workshop/`)

## Configuration

Live Session can be configured via:
- Plugin settings for PeerJS server
- Session parameters
- Connection options

## Usage

```typescript
import { PresenterControls, AttendeeJoin } from '../components/LiveSession';

// Presenter view
<PresenterControls sessionId={sessionId} />

// Attendee view
<AttendeeJoin sessionId={sessionId} />
```

## See Also

- `docs/developer/README_LIVE_SESSIONS.md` - Live sessions documentation
- `docs/developer/LOCAL_PEERJS_SERVER.md` - Local PeerJS server setup
- `docs/developer/DEBUGGING-LIVE-SESSIONS.md` - Debugging guide

