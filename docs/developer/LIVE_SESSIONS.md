# Live Sessions

Live Sessions is an experimental feature that enables collaborative, real-time guide presentations using peer-to-peer WebRTC connections.

## Quick Start

### Setup (3 Terminals)

**Terminal 1: PeerJS Server**

```bash
npm run peerjs-server
```

You should see:

```
╔════════════════════════════════════════════════════════════╗
║  PeerJS Signaling Server for Grafana Pathfinder          ║
║  Running on: http://localhost:9000/pathfinder             ║
║  Status: Ready for connections                            ║
╚════════════════════════════════════════════════════════════╝
```

**Terminal 2: Grafana**

```bash
npm run server
```

**Terminal 3: Plugin Dev Build**

```bash
npm run dev
```

### Usage

1. **Enable Live Sessions**: Go to Configuration page, enable "Live Sessions (Experimental)"
2. **Start as Presenter**: Click "Start Live Session" button, share the join code
3. **Join as Attendee**: Click "Join Live Session", enter the code
4. **Present**: Click "Show Me" or "Do It" - attendees will see your actions!

### Modes

- **Guided Mode**: Attendees see highlights when you click "Show Me"
- **Follow Mode**: Attendees' Grafana mirrors your "Do It" actions automatically

## Server Management

### Helper Script

```bash
./scripts/manage-peerjs.sh status   # Check server status
./scripts/manage-peerjs.sh start    # Start server
./scripts/manage-peerjs.sh stop     # Stop server
./scripts/manage-peerjs.sh restart  # Restart server
```

### Port Conflicts

If port 9000 is already in use:

```bash
# Option 1: Use helper script
./scripts/manage-peerjs.sh restart

# Option 2: Manual cleanup
lsof -ti:9000 | xargs kill -9
npm run peerjs-server
```

## How It Works

### Architecture

```
┌─────────────┐         ┌──────────────────┐         ┌─────────────┐
│  Presenter  │ ◄─────► │  PeerJS Server   │ ◄─────► │  Attendee   │
│   Browser   │         │  (localhost:9000)│         │   Browser   │
└─────────────┘         └──────────────────┘         └─────────────┘
                               ▲
                               │ Signaling only
                               │ (SDP exchange, ICE candidates)
                               │
                        Actual data flows P2P ───────────────────►
```

**What the server does**:

- Facilitates the initial connection handshake between peers
- Allows attendees to find the presenter by peer ID
- Tracks active peers and cleans up disconnected ones

**What the server does NOT do**:

- Data transfer (all guide data flows directly peer-to-peer)
- Storage (no session data is stored)
- Authentication (simple key-based validation only)

### Event Flow

```
Presenter                              Attendee
   │                                      │
   ├─ createSession()                     │
   │  └─> peer.on('connection')          │
   │                              ┌──────┤
   │                              │  joinSession(peerId)
   │                              │  └─> peer.connect()
   │                              │      └─> send('attendee_join')
   │  ◄────────────────────────────────┤
   │  (receives attendee_join)          │
   ├─ send('session_start')             │
   │  ───────────────────────────────>  │
   │                            (receives session_start)
   │                            └─> opens guide, initializes replay
   │                                    │
   │  (user clicks Show Me)             │
   ├─ ActionCapture.handleButtonClick() │
   │  └─> broadcastEvent(show_me)       │
   │  ───────────────────────────────>  │
   │                            (receives show_me)
   │                            └─> ActionReplay.handleEvent()
   │                                └─> showHighlight()
```

## Debugging

### Testing Setup

1. Open Grafana in two browser windows (or one normal + one incognito)
2. Open browser console (F12) in both windows
3. Navigate to Pathfinder panel in both windows

### Expected Console Logs

**Presenter (after creating session)**:

```
[SessionManager] Creating session...
[SessionManager] Peer ready: [peer-id]
[SessionManager] Session created: [peer-id]
[DocsPanel] Initializing ActionCaptureSystem for presenter
[ActionCapture] Started capturing presenter actions
```

**Attendee (after joining)**:

```
[SessionManager] Joining session: [peer-id]
[SessionManager] Connected to presenter: [peer-id]
[SessionManager] Received event from presenter: {type: 'session_start', ...}
[DocsPanel] Auto-opening guide: [url]
[ActionReplay] Mode changed: undefined → guided
```

**Show Me action**:

```
# Presenter
[ActionCapture] Broadcasted show_me event for step: [step-id]

# Attendee
[DocsPanel] Received event: show_me
[ActionReplay] Handling show_me in guided mode
[ActionReplay] Highlighted element: [selector]
```

### Verification Checklist

1. **Connection established?**
   - Presenter: Attendee appears in "Connected Attendees" list
   - Attendee: Green "Connected to:" banner appears

2. **Guide open?**
   - Attendee: New tab should open automatically with the guide

3. **Capture active?**
   - Presenter: Look for "[ActionCapture] Capture handlers set up" in console

4. **Replay active?**
   - Attendee: Look for "[ActionReplay] Mode changed" in console

## Troubleshooting

### Cannot connect to PeerJS server

- Check if `npm run peerjs-server` is running
- Verify the port isn't in use: `lsof -i :9000`
- Check browser console for connection errors

### Peer connection failed

- Check your firewall settings
- Try from incognito/private windows (different profiles)
- TURN server might be needed for restrictive networks

### Attendee can't find presenter

- Ensure both are connected to the same server
- Check that the presenter's session is still active
- Verify the peer ID hasn't expired (60s timeout)

### Show Me doesn't broadcast

- Verify the guide has interactive elements with "Show Me" buttons
- Check that you're in the guide tab, not the Recommendations tab
- Try clicking a different "Show Me" button

### Show Me broadcasts but attendee doesn't see highlight

- Check if the attendee has the same guide open
- Verify the attendee's console shows the event was received
- Check if the element exists on the attendee's page (selector might not match)

### Connection drops frequently

- Increase `alive_timeout` in server config
- Check network stability
- Look for errors in server logs

## Configuration

### Server Settings

File: `scripts/peerjs-server.js`

```javascript
{
  port: 9000,              // Server port
  path: '/pathfinder',     // API endpoint path
  key: 'pathfinder',       // Optional API key
  alive_timeout: 60000,    // Peer timeout (60 seconds)
  debug: true              // Enable debug logging
}
```

### Client Settings

File: `src/utils/collaboration/session-manager.ts`

```typescript
new Peer(peerId, {
  host: 'localhost',
  port: 9000,
  path: '/pathfinder',
  debug: 2,
  config: {
    iceServers: [...]      // STUN/TURN servers for NAT traversal
  }
})
```

## Production Deployment

For production use, deploy a dedicated PeerJS server:

### Docker Deployment

```dockerfile
FROM node:18-alpine
WORKDIR /app
RUN npm install peer
COPY scripts/peerjs-server.js .
EXPOSE 9000
CMD ["node", "peerjs-server.js"]
```

```bash
docker build -f Dockerfile.peerjs -t peerjs-pathfinder .
docker run -d -p 9000:9000 --name peerjs-pathfinder peerjs-pathfinder
```

### Security Considerations

For production deployments:

- Use HTTPS/WSS with valid SSL certificate (required for WebRTC in browsers)
- Replace the default API key with a secure random string
- Restrict CORS to your Grafana domains
- Implement rate limiting
- Set up logging and monitoring

See the PeerJS documentation for detailed security hardening guidance.

## Known Limitations

See `KNOWN_ISSUES.md` for current limitations including:

- No automatic reconnection
- Scale tested only up to 5 attendees
- Monaco editor visual updates require window focus
- Corporate firewalls may block WebRTC

## References

- [PeerJS Documentation](https://peerjs.com/docs/)
- [WebRTC Overview](https://webrtc.org/getting-started/overview)
