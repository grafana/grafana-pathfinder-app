# Collaborative Live Learning Sessions: Detailed Implementation Plan

## Executive Summary

Transform Grafana Pathfinder into a real-time collaborative learning platform where workshop presenters can broadcast their actions to attendees who follow along in synchronized sessions. Think "Twitch for Grafana training" - one expert teaching many, with multiple engagement modes from passive watching to active mirroring.

**Core Value Proposition**: Enable scalable, interactive workshops where one presenter can effectively train hundreds of attendees simultaneously, each experiencing hands-on learning in their own Grafana instance.

---

## Quick Start: Live Sessions

**Status**: ✅ MVP Complete - Phases 1-2 Shipped

### Prerequisites (3 Terminals Required)

**Terminal 1 - PeerJS Server** (Required):
```bash
npm run peerjs-server
```

**Terminal 2 - Grafana**:
```bash
npm run server
```

**Terminal 3 - Plugin Build**:
```bash
npm run dev
```

### Enable the Feature

1. Navigate to: **Configuration** → **Plugins** → **Pathfinder** → **Configuration**
2. Enable **"Live Sessions (Experimental)"**
3. Configure PeerJS server settings (default: localhost:9000)
4. Save configuration

### Use It

**As Presenter**:
1. Open Pathfinder sidebar
2. Click **"Start Live Session"** button
3. Share join code, QR code, or link with attendees
4. Click "Show Me" or "Do It" in interactive tutorials - attendees see your actions in real-time!

**As Attendee**:
1. Click **"Join Live Session"** button
2. Enter join code from presenter
3. Choose your mode:
   - **Guided Mode**: See highlights when presenter clicks "Show Me"
   - **Follow Mode**: Your Grafana mirrors presenter's "Do It" actions automatically
4. Join and follow along!

### Important Notes

- **PeerJS server is required** - The feature won't work without it running
- **Local development only** - For production, see Production Deployment section below
- **Browser window focus** - Monaco editors need window focus to show updates in Follow mode (known limitation)
- **Tested with** - Up to 5 concurrent attendees. Larger scale testing needed.

### Troubleshooting

**"Cannot connect to PeerJS server"**:
- Ensure `npm run peerjs-server` is running in Terminal 1
- Check port 9000 is not in use: `lsof -i :9000`
- See `docs/LOCAL_PEERJS_SERVER.md` for detailed help

**"Attendee can't join session"**:
- Verify both presenter and attendee use same PeerJS server
- Check browser console for connection errors
- Try from incognito/private windows

**Further Help**: See `docs/LOCAL_PEERJS_SERVER.md` and `docs/KNOWN_ISSUES.md`

---

## Use Cases & Scenarios

### Primary: Workshop & Training Sessions

**Scenario**: Company-wide Grafana training workshop
- **Presenter**: Senior SRE conducting "Prometheus Monitoring 101" workshop
- **Attendees**: 50 engineers across multiple offices/timezones
- **Flow**: 
  1. Presenter creates session, shares join code
  2. Attendees join session from their Pathfinder sidebars
  3. Presenter walks through creating dashboards, writing queries, configuring alerts
  4. Attendees see highlights in real-time, follow along in their own Grafana
  5. Session auto-records as reusable interactive tutorial

### Secondary Use Cases

**1. Emergency Response Training**
- "Production is down - everyone join this session, I'll show you how to debug"
- Real-time incident response training during actual incidents
- Record session for post-mortem training material

**2. Customer Onboarding**
- Sales/support guiding new customers through initial setup
- Personalized 1-on-1 onboarding with screen guidance
- Customer follows along in their own instance

**3. Open Source Community Workshops**
- Public sessions for community learning
- Recorded sessions become permanent learning resources
- Contributors teaching new features

**4. Certification Training**
- Instructor-led certification prep courses
- Hands-on exam practice with guidance
- Standardized training across organizations

**5. Peer Learning / Study Groups**
- Small groups collaborating on complex configurations
- Rotating presenter role for knowledge sharing
- Team learning new Grafana features together

---

## User Experience & Interface Design

### Session Lifecycle

```
Create Session → Share Join Code → Attendees Join → Live Session → End & Save Recording
```

### Presenter Experience

**Starting a Session**
```
1. Pathfinder sidebar: "Start Live Session" button
2. Modal appears:
   - Session name: "Prometheus Workshop - Jan 2025"
   - Session type: [Public / Private / Organization-only]
   - Max attendees: [Unlimited / 10 / 50 / 100 / 500]
   - Recording: [Auto-record / Manual / Off]
   - Default attendee mode: [Watch / Guided / Follow]
3. Click "Start Session"
4. Join code generated: "pathfinder-abc123"
5. Share options: Copy link / QR code / Slack message
```

**Presenter Controls (Overlay Toolbar)**
```
┌─────────────────────────────────────────────────────────────┐
│ 🔴 LIVE  |  15 Attendees  |  🎥 Recording  |  ⚙️ Settings  │
│                                                               │
│ Current Tutorial: "Create First Dashboard"                   │
│ Step 3 of 12  |  Avg Progress: 68%  |  5 behind, 2 ahead   │
│                                                               │
│ [Pause Session] [Show All Attendees] [Chat] [End Session]   │
└─────────────────────────────────────────────────────────────┘
```

**Presenter Actions**
- Everything presenter does is captured: clicks, form fills, navigation
- When presenter clicks "Show Me" on interactive step:
  - Attendees see the same highlight (in their own Grafana instance)
  - Presenter can see aggregate attendee status: "12/15 attendees viewing"
- When presenter clicks "Do It":
  - Behavior depends on attendee's selected mode
  - Presenter sees: "5 in Follow mode (action replicated), 10 in Guided mode (watching only)"
- Presenter can pause session: "Give everyone 2 minutes to catch up"

### Attendee Experience

**Joining a Session**
```
1. Pathfinder sidebar: "Join Live Session" button
2. Enter join code: "pathfinder-abc123" or click shared link
3. Session preview:
   - Title: "Prometheus Workshop - Jan 2025"
   - Presenter: Tom (Senior SRE)
   - Current attendees: 15
   - Current step: "Creating a Dashboard" (Step 3/12)
4. Select your mode:
   ○ Guided Mode - See highlights when presenter clicks "Show Me"
   ○ Follow Mode - Your Grafana mirrors presenter's "Show Me" and "Do It" actions
5. Click "Join Session"
```

**Attendee Interface**
```
┌─────────────────────────────────────────────────────────────┐
│ ← Back to Tutorial  |  Session: Prometheus Workshop         │
│                                                               │
│ Presenter: Tom (Senior SRE)  |  15 attendees  |  You: Follow│
│                                                               │
│ Current: "Add a Prometheus datasource"  |  Step 4 of 12     │
│                                                               │
│ [💬 Chat (3)] [✋ Raise Hand] [⚙️ Change Mode] [🚪 Leave]   │
└─────────────────────────────────────────────────────────────┘

[Main Grafana UI - with live highlights when presenter acts]

┌─────────────────────────────────────────────────────────────┐
│ Chat Sidebar (collapsible)                                   │
│                                                               │
│ Tom: "We're setting up Prometheus datasource now"            │
│ Sarah: "Should we use port 9090 or 9091?"                   │
│ Tom: "Good question - 9090 is standard"                      │
│ You: [Type message...]                         [Send]        │
└─────────────────────────────────────────────────────────────┘
```

### The Two Modes Explained

#### 1. Guided Mode (See But Don't Act)
**Use Case**: Attendee follows along manually, presenter guides their attention

**Behavior**:
- When presenter clicks "Show Me": Highlight appears in attendee's Grafana
- When presenter clicks "Do It": Attendee sees highlight but NO action occurs
- Attendee can manually perform actions themselves
- Perfect for workshops where attendees want hands-on practice
- Default mode for new attendees

**Implementation**: 
- Show Me: Sync highlight coordinates, selector, comment
- Do It: Show highlight only (no action execution)

#### 2. Follow Mode (Full Mirroring)
**Use Case**: Attendee wants their Grafana to automatically mirror presenter

**Behavior**:
- When presenter clicks "Show Me": Highlight appears
- When presenter clicks "Do It": Action executes in attendee's Grafana
- Attendee's instance stays perfectly in sync
- Best for demonstrations and initial walkthroughs
- Can switch back to Guided mode anytime

**Implementation**:
- Show Me: Sync highlight
- Do It: Sync action execution (action type, selector, value)
- Requires robust error handling if attendee's state diverges

---

## Technical Architecture

### High-Level Architecture (PeerJS with Lightweight Signaling Server)

```
┌─────────────────┐                                      ┌─────────────────┐
│   Presenter     │                                      │   Attendee 1    │
│                 │◄──────WebRTC Data Channel───────────►│                 │
│  (Broadcaster)  │      (P2P Direct - Tutorial Data)    │  (Receiver)     │
└─────────────────┘                                      └─────────────────┘
       │                                                          │
       │                 ┌──────────────────────┐                │
       │                 │   PeerJS Signaling   │                │
       │─────────────────│   Server (Local)     │────────────────│
       │   (Join/Answer) │   Port 9000          │  (Join/Answer) │
       │                 └──────────────────────┘                │
       │                           │                              │
       │              ┌────────────┴────────────┐                │
       │              │  Public STUN Servers    │                │
       │──────────────│  (NAT Traversal)        │────────────────│
       │              │  stun.l.google.com      │                │
       │              └─────────────────────────┘                │
       │                                                          │
       └──────WebRTC Data Channel (P2P)─────────────────────────┘
                (Star topology: presenter to each attendee)

Connection Setup: PeerJS Join Codes / QR Code / Link Sharing
Session Storage: Browser IndexedDB (local)
Recording: Client-side JSON export
```

**Implementation Approach**: Uses **PeerJS library** with a lightweight local signaling server for connection setup, then pure P2P for data transfer.

**Key Trade-off Decision**:
- **Original Plan**: Raw WebRTC with no backend (complex signaling via QR/paste)
- **Actual Implementation**: PeerJS with local server (simpler, more reliable)
- **Benefit**: Much easier implementation, better connection reliability, cleaner UX
- **Cost**: Requires running a lightweight Node.js signaling server (~50 lines)

**Why PeerJS?**
- Abstracts complex WebRTC signaling logic
- Handles ICE candidate exchange automatically
- Provides readable peer IDs instead of SDP blobs
- Maintains P2P benefits (data flows directly between peers)
- Well-tested library with good browser support

**PeerJS Configuration**:
```typescript
// Local signaling server (development)
const peer = new Peer(peerId, {
  host: 'localhost',
  port: 9000,
  path: '/pathfinder',
  key: 'pathfinder',
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' }
    ]
  }
});

// Production: Use dedicated PeerJS server or PeerJS Cloud
```

**What the Signaling Server Does**:
- Facilitates initial peer discovery (attendee finds presenter by ID)
- Exchanges WebRTC connection offers/answers
- Tracks active peers and cleans up disconnected ones

**What the Signaling Server Does NOT Do**:
- Transfer tutorial data (flows P2P directly between browsers)
- Store session state (everything in browser IndexedDB)
- Authenticate users (simple key-based validation only)

### Connection Establishment Flow (PeerJS Simplified)

**1. Session Creation (Presenter)**
```typescript
// Start local PeerJS server first: npm run peerjs-server

// Presenter creates PeerJS peer with readable ID
const peerId = generateReadableId(); // e.g., "cozy-tiger-42"
const peer = new Peer(peerId, {
  host: 'localhost',
  port: 9000,
  path: '/pathfinder',
  key: 'pathfinder'
});

// Wait for peer to connect to signaling server
peer.on('open', (id) => {
  console.log('Session created:', id);
  
  // Generate shareable join code
  const sessionInfo = {
    id: id, // PeerJS peer ID
    name: "Prometheus Workshop",
    tutorialUrl: "https://grafana.com/tutorials/prometheus-101",
    defaultMode: "guided"
  };
  
  const joinCode = id; // Simple! Just the peer ID
  const joinUrl = `${window.location.origin}/a/pathfinder?session=${joinCode}`;
  const qrCode = await QRCode.toDataURL(joinUrl);
  
  // Display join code to presenter
  showJoinOptions(joinCode, joinUrl, qrCode);
});

// Handle incoming connections from attendees
peer.on('connection', (conn) => {
  console.log('Attendee connected:', conn.peer);
  
  // Set up data channel handler
  conn.on('data', (data) => {
    // Attendee sent their mode preference
    console.log('Attendee mode:', data.mode);
  });
  
  conn.on('open', () => {
    // Connection ready, can send events now
    trackAttendee(conn);
  });
});
```

**2. Session Join (Attendee)**
```typescript
// Attendee enters join code (presenter's peer ID)
const presenterPeerId = "cozy-tiger-42";

// Create own peer to connect
const peer = new Peer({
  host: 'localhost',
  port: 9000,
  path: '/pathfinder',
  key: 'pathfinder'
});

// Connect to presenter
peer.on('open', () => {
  const conn = peer.connect(presenterPeerId);
  
  conn.on('open', () => {
    console.log('Connected to presenter!');
    
    // Send mode preference
    conn.send({ mode: 'guided', name: 'Alice' });
    
    // Listen for events from presenter
    conn.on('data', (event) => {
      handlePresenterEvent(event);
    });
  });
});
```

**3. Broadcasting Events (Presenter)**
```typescript
// Presenter clicks "Show Me" button
function captureShowMe(stepData) {
  const event = {
    type: 'show_me',
    stepId: stepData.id,
    action: stepData.action,
    timestamp: Date.now()
  };
  
  // Broadcast to all connected attendees
  attendeeConnections.forEach(conn => {
    if (conn.open) {
      conn.send(event);
    }
  });
}
```

**Key Simplifications with PeerJS**:
- No manual SDP offer/answer exchange - PeerJS handles it
- Readable peer IDs instead of complex WebRTC descriptions
- Automatic ICE candidate gathering and exchange
- Built-in connection management and cleanup
- Simple `.connect(peerId)` API instead of WebRTC ceremony

**Why This Works Better**:
- **Simpler code**: ~50 lines vs ~300 lines of raw WebRTC
- **More reliable**: PeerJS handles edge cases and reconnection
- **Better UX**: Short readable join codes vs long encoded blobs
- **Still P2P**: Data flows directly between browsers, just easier setup

### Event Protocol Specification

**Event Types**

```typescript
// Base event structure
interface SessionEvent {
  type: string;
  sessionId: string;
  timestamp: number;
  senderId: string; // presenter or attendee ID
}

// Navigation events
interface NavigationEvent extends SessionEvent {
  type: 'navigation';
  tutorialUrl: string;
  stepNumber?: number;
}

// Interactive step events
interface InteractiveStepEvent extends SessionEvent {
  type: 'show_me' | 'do_it';
  stepId: string;
  action: {
    targetAction: 'button' | 'highlight' | 'formfill' | 'navigate';
    refTarget: string; // CSS selector or button text
    targetValue?: string;
    targetComment?: string;
  };
  coordinates?: { x: number; y: number }; // For positioning
}

// Session control events
interface ControlEvent extends SessionEvent {
  type: 'pause' | 'resume' | 'end';
  message?: string;
}

// Chat events
interface ChatEvent extends SessionEvent {
  type: 'chat_message';
  senderName: string;
  message: string;
}

// Attendee status updates
interface StatusEvent extends SessionEvent {
  type: 'attendee_status';
  status: 'joined' | 'left' | 'caught_up' | 'behind';
  currentStep?: number;
}
```

**Event Flow Examples**

**Presenter clicks "Show Me"**
```typescript
// 1. Presenter action captured
const event: InteractiveStepEvent = {
  type: 'show_me',
  sessionId: 'ses_abc123',
  timestamp: Date.now(),
  senderId: 'presenter',
  stepId: 'step-4',
  action: {
    targetAction: 'highlight',
    refTarget: 'button[data-testid="add-datasource"]',
    targetComment: 'Click here to add datasource'
  },
  coordinates: { x: 450, y: 320 }
};

// 2. Broadcast to all attendees via WebRTC data channels
dataChannels.forEach((channel, attendeeId) => {
  if (channel.readyState === 'open') {
    channel.send(JSON.stringify(event));
  }
});

// 3. Each attendee receives directly via P2P connection
// 4. Each attendee processes based on their mode
```

**Attendee in Guided Mode receives Show Me**
```typescript
dataChannel.onmessage = (msg) => {
  const event: InteractiveStepEvent = JSON.parse(msg.data);
  
  if (event.type === 'show_me') {
    // In Guided mode: Show highlight
    navigationManager.highlightWithComment(
      event.action.refTarget,
      event.action.targetComment,
      event.coordinates
    );
  }
};
```

**Attendee in Follow Mode receives Do It**
```typescript
dataChannel.onmessage = (msg) => {
  const event: InteractiveStepEvent = JSON.parse(msg.data);
  
  if (event.type === 'do_it' && attendeeMode === 'follow') {
    // In Follow mode: Execute the action
    await interactiveStateManager.executeAction(
      event.action.targetAction,
      event.action.refTarget,
      event.action.targetValue
    );
  }
};
```

### Technical Components

#### 1. Session Manager (`src/utils/collaboration/session-manager.ts`)

**Responsibilities**:
- Create/join/leave sessions
- Manage WebRTC peer connections
- Handle reconnection logic
- Sync session state via P2P

```typescript
export class SessionManager {
  private peerConnections: Map<string, RTCPeerConnection> = new Map();
  private dataChannels: Map<string, RTCDataChannel> = new Map();
  private sessionId: string | null = null;
  private role: 'presenter' | 'attendee' | null = null;
  
  private iceServers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
    { 
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ];
  
  async createSession(config: SessionConfig): Promise<SessionOffer> {
    // Create WebRTC peer connection
    // Set up data channel
    // Generate offer
    // Return shareable offer (QR code, link, copy-paste)
  }
  
  async joinSession(sessionOffer: SessionOffer, mode: AttendeeMode): Promise<SessionAnswer> {
    // Create peer connection
    // Process offer
    // Generate answer
    // Return answer for presenter
  }
  
  async addAttendee(answer: SessionAnswer): Promise<void> {
    // Presenter receives attendee's answer
    // Complete WebRTC handshake
    // Add to active connections
  }
  
  broadcastEvent(event: SessionEvent): void {
    // Send event to all connected data channels (presenter only)
    this.dataChannels.forEach((channel, attendeeId) => {
      if (channel.readyState === 'open') {
        channel.send(JSON.stringify(event));
      }
    });
  }
  
  onEventReceived(callback: (event: SessionEvent) => void): void {
    // Register callback for incoming events from data channel
  }
}
```

#### 2. Action Capture System (`src/utils/collaboration/action-capture.ts`)

**Responsibilities**:
- Intercept presenter's interactive actions
- Convert to serializable event format
- Broadcast to attendees

```typescript
export class ActionCaptureSystem {
  constructor(
    private sessionManager: SessionManager,
    private interactiveHook: ReturnType<typeof useInteractiveElements>
  ) {}
  
  startCapture(): void {
    // Wrap interactive action execution
    // Before execution: Capture action details
    // Serialize to event format
    // Broadcast via SessionManager
    // Execute action locally
  }
  
  captureShowMe(stepData: InteractiveElementData): void {
    const event: InteractiveStepEvent = {
      type: 'show_me',
      // ... serialize action details
    };
    this.sessionManager.broadcastEvent(event);
  }
  
  captureDoIt(stepData: InteractiveElementData): void {
    const event: InteractiveStepEvent = {
      type: 'do_it',
      // ... serialize action details
    };
    this.sessionManager.broadcastEvent(event);
  }
}
```

#### 3. Action Replay System (`src/utils/collaboration/action-replay.ts`)

**Responsibilities**:
- Receive events from presenter
- Apply based on attendee mode
- Handle errors gracefully

```typescript
export class ActionReplaySystem {
  constructor(
    private mode: AttendeeMode,
    private navigationManager: NavigationManager,
    private interactiveStateManager: InteractiveStateManager
  ) {}
  
  async handleEvent(event: InteractiveStepEvent): Promise<void> {
    switch (this.mode) {
      case 'watch':
        // Do nothing - just update tutorial view
        break;
        
      case 'guided':
        if (event.type === 'show_me' || event.type === 'do_it') {
          // Show highlight only
          await this.showHighlight(event);
        }
        break;
        
      case 'follow':
        if (event.type === 'show_me') {
          await this.showHighlight(event);
        } else if (event.type === 'do_it') {
          // Execute action
          await this.executeAction(event);
        }
        break;
    }
  }
  
  private async showHighlight(event: InteractiveStepEvent): Promise<void> {
    // Use existing NavigationManager to show highlight
  }
  
  private async executeAction(event: InteractiveStepEvent): Promise<void> {
    // Use existing InteractiveStateManager to execute
    // Handle failures gracefully (attendee state may differ)
  }
}
```

#### 4. Session UI Components

**Presenter Controls** (`src/components/LiveSession/PresenterControls.tsx`)
```typescript
export function PresenterControls({ session }: Props) {
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  
  return (
    <div className={styles.presenterToolbar}>
      <SessionStatus 
        attendeeCount={attendees.length}
        isRecording={session.isRecording}
      />
      <AttendeeProgress attendees={attendees} />
      <ChatPanel messages={session.messages} />
      <ControlButtons
        onPause={() => session.pause()}
        onResume={() => session.resume()}
        onEnd={() => session.end()}
      />
    </div>
  );
}
```

**Attendee Interface** (`src/components/LiveSession/AttendeeInterface.tsx`)
```typescript
export function AttendeeInterface({ session }: Props) {
  const [mode, setMode] = useState<AttendeeMode>('guided');
  
  return (
    <div className={styles.attendeeInterface}>
      <SessionHeader 
        presenter={session.presenter}
        attendeeCount={session.attendeeCount}
        currentMode={mode}
      />
      <ModeSelector 
        currentMode={mode}
        onChange={setMode}
      />
      <ChatSidebar 
        messages={session.messages}
        onSend={(msg) => session.sendChat(msg)}
      />
    </div>
  );
}
```

---

## Backend Infrastructure (PeerJS Server Required)

### PeerJS Signaling Server (Lightweight Backend)

The implementation requires a **PeerJS signaling server** for connection setup. This is a lightweight Node.js process that handles peer discovery and WebRTC signaling.

**What We Use**:

1. **PeerJS Server** (Required - Signaling only)
   - Handles peer discovery and connection setup
   - Exchanges WebRTC offers/answers
   - Tracks active peers
   - ~50 lines of code via `peer-server` npm package
   - See `docs/LOCAL_PEERJS_SERVER.md` for setup

2. **Public STUN Servers** (NAT traversal)
   - Google's public STUN servers
   - Twilio's public STUN servers
   - Free, no registration needed

3. **Browser IndexedDB** (Local storage)
   - Session recordings
   - Session history
   - User preferences

### Development Setup

**Local Development** (Recommended for development):
```bash
# Terminal 1: Start PeerJS signaling server
npm run peerjs-server

# Terminal 2: Start Grafana
npm run server

# Terminal 3: Build plugin
npm run dev
```

**Server Configuration** (`scripts/peerjs-server.js`):
```javascript
const { PeerServer } = require('peer');

const server = PeerServer({
  port: 9000,
  path: '/pathfinder',
  key: 'pathfinder',
  alive_timeout: 60000,
  debug: true
});

console.log('PeerJS server running on port 9000');
```

### Production Deployment Options

**Option 1: Self-Hosted PeerJS Server (Recommended for Enterprise)**

Deploy on your own infrastructure:

```bash
# Install globally
npm install -g peer

# Run with production config
peer --port 443 \
     --path /pathfinder \
     --key your-secure-key \
     --sslkey ./ssl/key.pem \
     --sslcert ./ssl/cert.pem
```

**Advantages**:
- Full control over infrastructure
- No external dependencies
- Better security (can restrict to your domains)
- Can monitor and scale as needed

**Requirements**:
- Node.js server (small footprint: ~100MB RAM)
- SSL certificate (required for HTTPS)
- Open port for WebSocket connections

**Option 2: PeerJS Cloud Service (Easiest for Small Teams)**

Use PeerJS hosted cloud service:

```typescript
const peer = new Peer({
  host: 'peerjs.com',
  secure: true,
  port: 443
});
```

**Advantages**:
- No infrastructure to manage
- Free tier available
- Handles scaling automatically

**Disadvantages**:
- External dependency
- Potential privacy concerns (peer IDs visible to service)
- May have rate limits

**Option 3: Hybrid Approach (Development + Production)**

Use local server for development, cloud for production:

```typescript
const isProduction = window.location.hostname !== 'localhost';

const peerConfig = isProduction
  ? { host: 'peerjs.com', secure: true, port: 443 }
  : { host: 'localhost', port: 9000, path: '/pathfinder' };

const peer = new Peer(peerId, peerConfig);
```

### Production Deployment Guide

**1. Deploy PeerJS Server**

Using Docker:
```dockerfile
FROM node:18-alpine
RUN npm install -g peer
EXPOSE 9000
CMD ["peer", "--port", "9000", "--path", "/pathfinder"]
```

Using systemd:
```ini
[Unit]
Description=PeerJS Signaling Server
After=network.target

[Service]
Type=simple
User=peerjs
ExecStart=/usr/bin/peer --port 9000 --path /pathfinder
Restart=always

[Install]
WantedBy=multi-user.target
```

**2. Configure Reverse Proxy (nginx)**

```nginx
server {
    listen 443 ssl;
    server_name peerjs.yourdomain.com;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    location /pathfinder {
        proxy_pass http://localhost:9000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

**3. Update Plugin Configuration**

In Grafana plugin configuration:
```
PeerJS Host: peerjs.yourdomain.com
PeerJS Port: 443
PeerJS Path: /pathfinder
PeerJS Key: your-secure-production-key
```

**4. Security Hardening**

- Use strong API key in production
- Restrict CORS to your Grafana domains
- Enable rate limiting to prevent abuse
- Monitor connection counts and bandwidth
- Use HTTPS/WSS for all connections

**5. Monitoring**

Add health checks:
```javascript
// Add to peerjs-server.js
const express = require('express');
const app = express();

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    connections: server.clients.size,
    uptime: process.uptime()
  });
});

app.listen(9001);
```

Monitor:
- Active peer connections
- Connection success rate
- Average latency
- Error rates
- Server CPU/memory usage

### Session State Storage (Client-side)

**Technology**: Browser IndexedDB

**Schema**:
```typescript
// All stored locally in browser
interface SessionRecording {
  id: string;
  name: string;
  presenter: {
    id: string;
    name: string;
  };
  tutorialUrl: string;
  duration: number;
  recordedAt: string;
  events: SessionEvent[];
  chat: ChatMessage[];
  attendees: {
    id: string;
    name?: string;
    joinedAt: number;
    leftAt?: number;
  }[];
}

// Store in IndexedDB
const db = await openDB('pathfinder-sessions');
await db.put('recordings', recording);

// Export as downloadable JSON for sharing
const json = JSON.stringify(recording);
const blob = new Blob([json], { type: 'application/json' });
const url = URL.createObjectURL(blob);
// User downloads and can share via email, Slack, file hosting, etc.
```

---

## Session Recording & Playback

### Recording Format

Sessions are recorded as a sequence of timestamped events that can be:
1. Replayed as a video-like experience
2. Converted to interactive tutorial format
3. Shared/distributed for async learning

**Recording File Structure** (JSON):
```json
{
  "sessionId": "ses_abc123",
  "name": "Prometheus Workshop - Jan 2025",
  "presenter": {
    "id": "user_123",
    "name": "Tom"
  },
  "tutorialUrl": "https://grafana.com/tutorials/prometheus-101",
  "duration": 3600000,
  "recordedAt": "2025-01-15T14:00:00Z",
  "events": [
    {
      "timestamp": 0,
      "type": "navigation",
      "tutorialUrl": "https://...",
      "stepNumber": 1
    },
    {
      "timestamp": 15000,
      "type": "show_me",
      "stepId": "step-1",
      "action": {
        "targetAction": "highlight",
        "refTarget": "button[data-testid='add-datasource']",
        "targetComment": "Click here to add datasource"
      }
    },
    {
      "timestamp": 18000,
      "type": "do_it",
      "stepId": "step-1",
      "action": {
        "targetAction": "button",
        "refTarget": "Add data source"
      }
    },
    // ... more events
  ],
  "chat": [
    {
      "timestamp": 30000,
      "senderId": "att_456",
      "senderName": "Sarah",
      "message": "Should we use port 9090?"
    }
  ]
}
```

### Playback Mode

Recorded sessions can be played back with:
- Speed control (0.5x, 1x, 2x)
- Skip ahead/rewind
- Pause at any point
- Switch between Watch/Guided/Follow modes during playback
- View chat messages at appropriate timestamps

### Tutorial Conversion

Convert recording to standalone interactive tutorial:
```typescript
function convertRecordingToTutorial(recording: SessionRecording): InteractiveTutorial {
  // Extract unique steps from recording
  // Generate tutorial HTML with interactive elements
  // Include presenter's timing as suggested delays
  // Add chat Q&A as helpful hints
  
  return {
    title: recording.name,
    author: recording.presenter.name,
    steps: extractedSteps,
    metadata: {
      sourceSession: recording.sessionId,
      recordedAt: recording.recordedAt,
      duration: recording.duration
    }
  };
}
```

---

## Error Handling & Edge Cases

### State Divergence

**Problem**: Attendee's Grafana state differs from presenter's

**Example**: Presenter clicks "Edit panel" but attendee hasn't created panel yet

**Solutions**:
1. **Graceful degradation**: Skip action, show warning to attendee
2. **Requirement checking**: Before executing, verify prerequisites
3. **State sync checkpoints**: Periodically sync critical state
4. **Fallback to Guided**: If Follow mode fails repeatedly, suggest Guided mode

```typescript
async function executeActionWithValidation(
  action: InteractiveStepEvent,
  mode: AttendeeMode
): Promise<void> {
  if (mode !== 'follow') return;
  
  try {
    // Check if action is possible in current state
    const canExecute = await validatePrerequisites(action);
    
    if (!canExecute) {
      // Show friendly message
      showToast('Skipping step - your setup differs from presenter');
      // Log for diagnostics
      logStateDivergence(action);
      return;
    }
    
    // Execute action
    await interactiveStateManager.executeAction(action);
  } catch (error) {
    // Handle gracefully
    showToast('Could not follow presenter action - switch to Guided mode?');
  }
}
```

### Network Issues (P2P Specific)

**Presenter Disconnects**:
- P2P connections drop for all attendees
- Attendees notified: "Presenter disconnected"
- Recording saved locally up to disconnection point
- Presenter can create new session and reshare join code
- No automatic reconnection (trade-off of serverless approach)

**Attendee Disconnects**:
- Only their P2P connection drops
- Other attendees unaffected (benefit of P2P!)
- Attendee can rejoin by getting new answer from presenter
- Presenter sees: "Attendee 3 disconnected"

**Poor Connectivity**:
- WebRTC automatically adjusts to bandwidth
- DataChannel has built-in congestion control
- Monitor channel.bufferedAmount to detect issues
- Show latency indicator when bufferedAmount > threshold
- Automatically throttle events if buffer grows

**ICE Connection Failures**:
- Most common issue: Restrictive corporate firewalls
- Automatic fallback to TURN relay servers
- Show connection status: "Using relay (slower connection)"
- Worst case: Manual screenshot sharing as fallback

### Scaling Considerations (P2P Approach)

**Small sessions (< 10 attendees)** ✅ Optimal:
- Direct P2P to each attendee
- Full bidirectional communication
- Chat works smoothly
- Both modes (Guided/Follow) work well

**Medium sessions (10-50 attendees)** ✅ Good:
- Star topology: Presenter connects to each
- One-way communication (presenter → attendees)
- Chat aggregated client-side, then relayed
- Presenter may see slight lag with 30+ connections

**Large sessions (50-100 attendees)** ⚠️ Challenging:
- Browser connection limits (~256 max)
- Use repeater topology: Some attendees relay to others
- Automatically recruit first 10 attendees as repeaters
- Guided mode only (Follow mode too complex at this scale)
- Consider optional signaling server for this scale

**Very large sessions (100+ attendees)** ❌ Need Server:
- P2P approach not suitable
- Recommend: Deploy optional WebSocket server version
- Or use hybrid: Stream screen share + Pathfinder for interactivity
- For most workshop use cases, this scale is rare

**Recommended Approach**:
- Default: P2P (works great for 95% of use cases)
- For large organizations: Provide optional server deployment guide
- Best of both worlds: Easy setup for most, scalable for enterprises

---

## Security & Privacy

### Authentication & Authorization

**Session Access Control**:
```typescript
enum SessionVisibility {
  PUBLIC = 'public',           // Anyone with join code
  ORGANIZATION = 'org',        // Only org members
  PRIVATE = 'private'          // Invited users only
}

interface SessionPermissions {
  canJoin: (userId: string) => boolean;
  canPresent: (userId: string) => boolean;
  canModerate: (userId: string) => boolean;
}
```

**Join Code Security**:
- Short-lived codes (expire after 24 hours)
- Rate limiting on join attempts
- Optional password protection
- IP-based restrictions for enterprise

### Data Privacy

**Personal Data**:
- Hash user IDs in analytics
- Optional anonymous mode for attendees
- GDPR-compliant recording consent
- Auto-delete recordings after configured period

**Content Security**:
- Prevent screen scraping of proprietary dashboards
- Watermark sensitive sessions
- Enterprise: On-premise session server option

### Abuse Prevention

**Rate Limiting**:
- Max 5 sessions per user per day
- Max session duration: 8 hours
- Max attendees per free account: 10
- Enterprise: Unlimited

**Content Moderation**:
- Chat message filtering
- Report/block functionality
- Presenter can mute/kick attendees
- Automatic profanity filtering

---

## Implementation Phases

### Phase 1: Foundation (Weeks 1-4)

**Goal**: Basic P2P presenter-to-attendee broadcasting

**Deliverables**:
- WebRTC P2P connection setup (using public STUN servers)
- Session creation with shareable QR code/link/copy-paste
- DataChannel event protocol
- Presenter captures Show Me/Do It
- Attendees receive and display events in Guided mode
- Simple presenter/attendee UI
- IndexedDB for local session storage

**Success Criteria**: 
- 2 people can do a session: presenter shows, attendee follows along manually
- P2P connection establishes successfully (including through NAT)
- Events transmitted with < 200ms latency (P2P is faster than WebSocket!)
- Works without any backend deployment

### Phase 2: Modes & Controls (Weeks 5-7)

**Goal**: Three modes fully functional, enhanced controls

**Deliverables**:
- Watch, Guided, Follow modes implemented
- Mode switching UI
- Presenter controls (pause/resume)
- Attendee progress tracking
- Basic error handling for state divergence

**Success Criteria**:
- Follow mode works reliably for simple workflows
- Attendees can switch modes mid-session
- Presenter sees real-time attendee status

### Phase 3: Chat & Collaboration (Weeks 8-10)

**Goal**: Rich interaction between participants

**Deliverables**:
- Real-time chat system
- Raise hand / Q&A features
- Presenter can spotlight attendees
- Emoji reactions / polls
- Enhanced attendee management

**Success Criteria**:
- Chat works smoothly with 50+ participants
- Presenter can manage attendee interactions effectively

### Phase 4: Recording & Playback (Weeks 11-14)

**Goal**: Sessions become permanent learning resources

**Deliverables**:
- Session recording to JSON
- Playback UI with controls
- Recording-to-tutorial converter
- Recording library/browser
- Sharing & embedding capabilities

**Success Criteria**:
- Recorded sessions play back accurately
- Recordings convert to high-quality interactive tutorials
- Users can browse and discover recordings

### Phase 5: Scale & Polish (Weeks 15-18)

**Goal**: Production-ready for typical workshops, with optional scale

**Deliverables**:
- Performance optimization for 50 attendees (P2P limit)
- Advanced error handling and TURN fallback
- Network resilience improvements
- Analytics and insights
- Optional: Repeater topology for 50-100 attendees
- Optional: WebSocket server deployment guide for 100+ attendees

**Success Criteria**:
- Reliably support 50 attendee sessions via P2P
- < 1% error rate in Follow mode
- < 5% of users need TURN relay fallback
- Clear upgrade path for larger sessions
- Zero infrastructure cost for 95% of use cases

---

## Metrics & Success Tracking

### Key Metrics

**Adoption Metrics**:
- Sessions created per week
- Total attendees across all sessions
- Average session duration
- Repeat presenters (%)

**Engagement Metrics**:
- Average attendees per session
- Mode distribution (Watch / Guided / Follow)
- Chat messages per session
- Attendee retention (% who stay for full session)

**Quality Metrics**:
- Follow mode success rate (%)
- Event delivery latency (ms)
- Error rate by action type
- Attendee satisfaction (post-session survey)

**Business Impact**:
- Reduction in support tickets (workshops replace 1-on-1 support)
- Faster onboarding time (measured via user surveys)
- Recording reuse rate (views of recordings vs live attendees)

### Analytics Dashboard

Presenters get post-session insights:
- Attendee engagement heatmap (when people paid attention)
- Most replayed moments (valuable content indicators)
- Questions asked per section
- Drop-off points (where attendees left)
- Follow mode success rate per step

---

## Integration Points

### Existing Pathfinder Components

**1. Interactive System** (`src/utils/interactive.hook.ts`)
- Wrap `executeInteractiveAction` to capture presenter actions
- Reuse for attendee action execution in Follow mode

**2. Navigation Manager** (`src/utils/navigation-manager.ts`)
- Leverage for highlight display
- Coordinate positioning system

**3. Tutorial Recorder** (`src/components/SelectorDebugPanel`)
- Similar capture mechanism
- Could share code for action serialization

**4. Context Service** (`src/utils/context`)
- Detect when to suggest creating session (e.g., "Share this tutorial with your team")
- Track session participation for recommendations

### New Files Structure

```
src/
  components/
    LiveSession/
      PresenterControls.tsx
      AttendeeInterface.tsx
      SessionBrowser.tsx
      RecordingPlayer.tsx
      ChatPanel.tsx
      index.ts
      
  utils/
    collaboration/
      session-manager.ts         // Core session lifecycle
      action-capture.ts           // Capture presenter actions
      action-replay.ts            // Replay on attendee side
      event-protocol.ts           // Event type definitions
      websocket-client.ts         // WebSocket wrapper
      recording-converter.ts      // Convert recordings to tutorials
      state-validator.ts          // Validate attendee state
      index.ts
      
  types/
    collaboration.types.ts        // TypeScript interfaces
    
  constants/
    collaboration-config.ts       // Timeouts, limits, etc.
```

---

## User Documentation

### For Presenters

**"How to Run Your First Workshop"**
1. Prepare your tutorial in Pathfinder
2. Click "Start Live Session"
3. Share join code with attendees (Slack, email, QR code)
4. Walk through tutorial, clicking Show Me and Do It as you normally would
5. Monitor attendee progress in real-time
6. Answer questions via chat
7. End session (auto-saves recording)

**Best Practices**:
- Start with Watch or Guided mode for new audiences
- Use Follow mode sparingly (complex workflows may diverge)
- Pause regularly to let attendees catch up
- Announce when switching tutorial sections
- Record session for async learners

### For Attendees

**"How to Join a Workshop"**
1. Get join code from presenter
2. Open Pathfinder, click "Join Live Session"
3. Enter code, select your preferred mode:
   - **Watch**: Just observe, take notes
   - **Guided**: See what presenter highlights, follow along manually
   - **Follow**: Your Grafana mirrors presenter's actions
4. Ask questions via chat
5. Switch modes anytime if Follow isn't working

---

## Future Enhancements

### V2 Features (Post-Launch)

**1. Breakout Rooms**
- Split large workshop into smaller groups
- Each breakout has sub-session
- Rejoin main session

**2. Co-Presenting**
- Multiple presenters in one session
- Hand off control smoothly
- Panel discussions

**3. Interactive Polls & Quizzes**
- Test attendee knowledge mid-session
- Multiple choice questions
- Results shown to presenter

**4. AI Assistant**
- Auto-generate session summaries
- Suggest when to pause (if attendees falling behind)
- Answer common questions automatically

**5. Integration with Learning Management Systems (LMS)**
- Export recordings to Moodle, Canvas, etc.
- Attendance tracking
- Certification integration

**6. Mobile Attendee App**
- Follow along on phone/tablet
- View-only mode for smaller screens
- Chat participation

---

## Conclusion

Collaborative Live Learning Sessions transform Pathfinder from a documentation tool into a **platform for live, interactive education**. By enabling workshop presenters to broadcast their actions and guide attendees in real-time, we create a scalable way to transfer Grafana expertise across organizations and communities.

The phased approach ensures we deliver value quickly while building toward a comprehensive solution. Starting with basic P2P broadcasting and progressively adding modes, recording, and scaling capabilities allows us to learn from real usage and iterate.

**Key Differentiators**:
- **Zero Infrastructure** - Works completely P2P using free public STUN servers
- **Built into Grafana** - No context switching, seamless experience
- **Multiple engagement modes** - Watch/Guided/Follow for different learning styles
- **Automatic recording → tutorial conversion** - Sessions become permanent resources
- **Privacy-first** - Direct P2P, data never goes through third-party servers
- **No deployment needed** - Just frontend code, works immediately

**P2P Architecture Benefits**:
- ✅ Zero hosting costs - No servers to pay for or maintain
- ✅ Lower latency - Direct peer connections are faster than server relay
- ✅ Better privacy - Data stays between presenter and attendees
- ✅ Simpler deployment - Just bundle with plugin, no backend setup
- ✅ Works offline - Can use on local networks without internet
- ✅ Scales perfectly for typical workshop sizes (10-50 people)

**When P2P Isn't Enough**:
For organizations that need 100+ attendee sessions, we provide:
- Optional signaling server deployment guide
- Optional WebSocket relay server for scale
- But 95% of users will never need this

This feature positions Pathfinder as not just a learning tool, but a **community platform** where Grafana experts can share knowledge at scale - all without requiring any infrastructure.

