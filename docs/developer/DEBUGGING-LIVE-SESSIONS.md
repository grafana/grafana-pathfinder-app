# Debugging Live Sessions

## How to Test

### Setup

1. Open Grafana in two browser windows (or one normal + one incognito)
2. Open browser console (F12) in both windows
3. Navigate to Pathfinder panel in both windows

### As Presenter (Window 1)

1. Open any interactive tutorial (e.g., "Prometheus & Grafana 101")
2. Click "Start Live Session"
3. Enter a session name (e.g., "Test Session 123")
4. Click "Create Session"

**Expected Console Logs:**

```
[SessionManager] Creating session...
[SessionManager] Peer ready: [peer-id]
[SessionManager] Session created: [peer-id]
[DocsPanel] Initializing ActionCaptureSystem for presenter
[ActionCapture] Started capturing presenter actions
[ActionCapture] Capture handlers set up
```

5. Copy the 6-character join code

### As Attendee (Window 2)

1. Click "Join Live Session"
2. Paste the join code
3. Click "Next"
4. You should see:
   - Session Name: "Session" (placeholder until connected)
   - Tutorial URL displayed
5. Select "Guided" mode
6. Click "Join Session"

**Expected Console Logs:**

```
[SessionManager] Joining session: [peer-id]
[SessionManager] Attendee peer ready: [peer-id]
[SessionManager] Connected to presenter: [peer-id]
[SessionManager] Received event from presenter: {type: 'session_start', ...}
[SessionState] Successfully joined session: {config: {...}}
[DocsPanel] Auto-opening tutorial: [url]
[DocsPanel] Initializing ActionReplaySystem for attendee
[ActionReplay] Mode changed: undefined → guided
[DocsPanel] Setting up event listener for attendee
```

7. The tutorial should auto-open in a new tab
8. You should see a green banner: "Connected to: Test Session 123"

### Testing Show Me Replication

**As Presenter:**

1. Click any "Show Me" button in the tutorial

**Expected Console Logs (Presenter):**

```
[ActionCapture] Broadcasted show_me event for step: [step-id]
```

**Expected Console Logs (Attendee):**

```
[DocsPanel] Received event: show_me
[ActionReplay] Handling show_me in guided mode
[ActionReplay] Highlighted element: [selector]
```

**Expected Behavior:**

- Attendee should see the same element highlighted with a tooltip
- The highlight should appear immediately (within 100-200ms)

## Common Issues

### Issue: "No console logs appear"

- Make sure you've opened the browser console (F12 → Console tab)
- Check that you're looking at the correct browser window
- Refresh the page and try again

### Issue: "Presenter logs appear but no ActionCapture logs"

- The ActionCaptureSystem only starts when a session is active
- Make sure you clicked "Create Session" successfully
- Check that the "Session Active" button appears in the top bar

### Issue: "Attendee connects but no logs appear"

- Check the Network tab for WebRTC errors
- Verify the join code is correct (6 characters)
- Try creating a new session and joining again

### Issue: "session_start event not received"

- This means the PeerJS connection isn't fully established
- Check firewall/network settings
- Try refreshing both windows and starting fresh

### Issue: "Show Me doesn't broadcast"

- Verify the tutorial has interactive elements with "Show Me" buttons
- Check that the button text actually says "Show Me"
- Try clicking a different "Show Me" button
- Verify you're in the tutorial tab, not the Recommendations tab

### Issue: "Show Me broadcasts but attendee doesn't see highlight"

- Check if the attendee has the same tutorial open
- Verify the attendee's console shows the event was received
- Check if the element exists on the attendee's page (selector might not match)
- Look for "Element not found" warnings in the console

## Event Flow Diagram

```
Presenter                              Attendee
   │                                      │
   ├─ createSession()                     │
   │  └─> peer.on('connection')          │
   │                                      │
   │                              ┌──────┤
   │                              │      │
   │                              │  joinSession(peerId)
   │                              │  └─> peer.connect()
   │                              │      └─> send('attendee_join')
   │  ◄────────────────────────────────┤
   │  (receives attendee_join)          │
   │                                    │
   ├─ send('session_start')             │
   │  ───────────────────────────────>  │
   │                            (receives session_start)
   │                            │  └─> sets sessionInfo
   │                            │  └─> opens tutorial
   │                            └─> initializes ActionReplay
   │                                    │
   │  (user clicks Show Me)             │
   ├─ ActionCapture.handleButtonClick() │
   │  └─> broadcastEvent(show_me)       │
   │  ───────────────────────────────>  │
   │                            (receives show_me)
   │                            └─> ActionReplay.handleEvent()
   │                                └─> showHighlight()
   │                                    │
```

## Manual Verification Steps

1. **Connection established?**
   - Presenter: Check if attendee appears in the "Connected Attendees" list
   - Attendee: Check if green "Connected to:" banner appears

2. **Tutorial open?**
   - Attendee: New tab should open automatically with the tutorial
   - If not, check console for "Auto-opening tutorial" log

3. **Capture active?**
   - Presenter: Look for "[ActionCapture] Capture handlers set up" in console
   - Presenter: Click anywhere and check for any ActionCapture logs (even if not on a button)

4. **Replay active?**
   - Attendee: Look for "[ActionReplay] Mode changed" in console
   - Attendee: Verify "Setting up event listener" log appears

5. **Event transmission?**
   - Presenter: After clicking Show Me, check for "Broadcasted show_me event"
   - Attendee: Check for "Received event: show_me" within 100ms

## PeerJS Cloud Service Status

If connections are failing entirely:

1. Check https://peerjs.com/ for service status
2. The default PeerJS cloud signaling server is free but may have rate limits
3. Consider implementing a custom PeerJS server if issues persist

## Network Requirements

- **Ports**: Needs outbound HTTPS (443) and WebRTC data channels
- **Firewall**: May be blocked by strict corporate firewalls
- **VPN**: Some VPNs may interfere with P2P connections
- **Browser**: Works best in Chrome/Edge, Firefox, Safari (not IE)
