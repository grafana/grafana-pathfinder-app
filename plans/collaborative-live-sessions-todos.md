# Collaborative Live Sessions - Implementation TODO List

## Phase 1: MVP - Guided Mode (Show Me Replication)

Goal: Presenter can create a session for an interactive guide, attendee joins with code, and sees the same highlights when presenter clicks "Show Me"

### 1.1 Core Type Definitions
- [x] Create `src/types/collaboration.types.ts`
  - [x] Define `SessionOffer` interface (id, name, tutorialUrl, offer, timestamp)
  - [x] Define `SessionAnswer` interface (attendeeId, answer, mode)
  - [x] Define `AttendeeMode` type: 'guided' | 'follow'
  - [x] Define `SessionEvent` base interface (type, sessionId, timestamp, senderId)
  - [x] Define `NavigationEvent` extends SessionEvent (tutorialUrl, stepNumber)
  - [x] Define `InteractiveStepEvent` extends SessionEvent (stepId, action details)
  - [x] Define `ChatEvent` extends SessionEvent (senderName, message)
  - [x] Define `SessionConfig` interface (name, tutorialUrl, defaultMode)
  - [x] Define `SessionInfo` interface (sessionId, joinCode, qrCode)

### 1.2 WebRTC Session Manager
- [x] Create `src/utils/collaboration/session-manager.ts`
  - [x] Define ICE server configuration (STUN: Google, Twilio; TURN: OpenRelay)
  - [x] Implement `SessionManager` class skeleton
  - [x] Add private properties (peerConnections Map, dataChannels Map, sessionId, role)
  - [x] Implement `createSession()` method:
    - [x] Create RTCPeerConnection with ICE servers
    - [x] Create data channel named 'pathfinder-events'
    - [x] Generate and set local offer
    - [x] Wait for ICE candidate gathering
    - [x] Generate session ID and join code
    - [x] Return SessionOffer object
  - [x] Implement `joinSession()` method:
    - [x] Create RTCPeerConnection
    - [x] Set remote description from offer
    - [x] Create and set local answer
    - [x] Wait for ICE gathering
    - [x] Set up ondatachannel listener
    - [x] Return SessionAnswer object
  - [x] Implement `addAttendee()` method for presenter:
    - [x] Accept SessionAnswer
    - [x] Set remote description on peer connection
    - [x] Track attendee connection
    - [x] Store data channel reference
  - [x] Implement `broadcastEvent()` method:
    - [x] Iterate through all data channels
    - [x] Check channel.readyState === 'open'
    - [x] Send JSON.stringify(event)
  - [x] Implement `onEventReceived()` callback registration
  - [x] Add connection state monitoring (iceConnectionState changes)
  - [x] Add error handling for connection failures

### 1.3 QR Code & Join Code Generation
- [x] Install qrcode package: `npm install qrcode @types/qrcode`
- [x] Create `src/utils/collaboration/join-code-utils.ts`
  - [x] Implement `generateJoinCode(offer: SessionOffer): string`
    - [x] Base64 encode JSON.stringify(offer)
  - [x] Implement `parseJoinCode(code: string): SessionOffer`
    - [x] Base64 decode and JSON.parse
    - [x] Validate structure
  - [x] Implement `generateJoinUrl(offer: SessionOffer): string`
    - [x] Create URL with session parameter
  - [x] Implement `generateQRCode(url: string): Promise<string>`
    - [x] Use qrcode library to generate data URL
  - [x] Add error handling for malformed codes

### 1.4 Presenter UI Components
- [x] Create `src/components/LiveSession/PresenterControls.tsx`
  - [x] Create component skeleton with props interface
  - [x] Add "Start Live Session" button in main UI
  - [x] Add modal for session creation:
    - [x] Input: Session name
    - [x] Display: Current tutorial URL (auto-detected)
    - [x] Button: Create Session
  - [x] On create, call SessionManager.createSession()
  - [x] Display join code in large, copyable text box
  - [x] Display QR code for mobile scanning
  - [x] Display shareable link with copy button
  - [x] Show "Waiting for attendees..." message
  - [x] Display connected attendees list (name, connection status)
  - [x] Add "End Session" button
  - [ ] Add toast notification when attendee joins

- [x] Handle session cleanup when presenter ends session:
  - [x] Presenter broadcasts session_end event
  - [x] Attendee receives and handles session_end event
  - [x] Attendee UI clears session state and indicators
  - [ ] Show notification/toast to attendee that session ended

- [x] Fix attendee join modal state persistence:
  - [x] Clear session offer when reopening modal without URL params
  - [x] Reset to join code input screen after leaving session

- [ ] Create `src/components/LiveSession/SessionToolbar.tsx`
  - [ ] Floating toolbar visible during active session
  - [ ] Show session status: "🔴 LIVE" indicator
  - [ ] Show attendee count
  - [ ] Show current tutorial step
  - [ ] Add "Pause Session" button (future)
  - [ ] Add "Settings" button (future)
  - [ ] Keep toolbar always on top with high z-index

### 1.5 Attendee UI Components
- [x] Create `src/components/LiveSession/AttendeeJoin.tsx`
  - [x] Add "Join Live Session" button in sidebar
  - [x] Modal for joining:
    - [x] Input: Join code paste box
    - [x] Or: Handle URL parameter `?session=...` for direct links
    - [x] Auto-open join modal when URL contains session parameter
  - [x] On submit, parse join code
  - [x] Display session preview:
    - [x] Session name
    - [x] Current tutorial
  - [x] Mode selector (default: Guided):
    - [x] Radio buttons: Guided / Follow
    - [x] Explanation of each mode
  - [x] "Join Session" button
  - [x] Handle errors (invalid code, expired, connection failed)

- [x] Attendee Status UI (in docs-panel.tsx)
  - [x] Show session info: name, presenter
  - [x] Show connection status indicator
  - [x] Add "Leave Session" button
  - [x] Auto-open tutorial when joining session

### 1.6 Action Capture System
- [x] Create `src/utils/collaboration/action-capture.ts`
  - [x] Create `ActionCaptureSystem` class
  - [x] Accept SessionManager and interactive hook in constructor
  - [x] Implement `startCapture()`:
    - [x] Intercept interactive "Show Me" button clicks
    - [x] Extract action details (stepId, action type, selector, comment, coordinates)
    - [x] Create InteractiveStepEvent object
    - [x] Call sessionManager.broadcastEvent()
  - [x] Store original action execution functions for restoration
  - [x] Implement `stopCapture()` to restore original behavior
  - [x] Add debouncing to prevent duplicate events

### 1.7 Action Replay System (Guided Mode Only)
- [x] Create `src/utils/collaboration/action-replay.ts`
  - [x] Create `ActionReplaySystem` class
  - [x] Accept mode, NavigationManager in constructor
  - [x] Implement `handleEvent(event: SessionEvent)`:
    - [x] Switch on event.type
    - [x] For 'show_me': Call showHighlight()
    - [x] For 'navigation': Sync tutorial URL/step
  - [x] Implement `showHighlight()`:
    - [x] Use NavigationManager.highlightWithComment()
    - [x] Pass selector, comment, coordinates from event
  - [x] Add error handling for missing elements
  - [x] Log events for debugging

### 1.8 Integration with Existing Interactive System
- [x] Integration in `src/components/docs-panel/docs-panel.tsx`
  - [x] Initialize ActionCaptureSystem for presenters
  - [x] Initialize ActionReplaySystem for attendees
  - [x] Set up event listeners
  - [x] Handle session state changes

- [x] NavigationManager integration
  - [x] `highlightWithComment()` is accessible
  - [x] Used by ActionReplaySystem for showing highlights

### 1.9 Session State Management
- [x] Create `src/utils/collaboration/session-state.tsx`
  - [x] Create React Context for active session
  - [x] Provider stores: sessionManager, role, sessionInfo, attendees
  - [x] Hook: `useSession()` to access context
  - [x] Hook: `useIsSessionActive()` returns boolean
  - [x] Hook: `useSessionRole()` returns 'presenter' | 'attendee' | null
  - [x] Added `joinSession()` method to context
  - [x] Handle `session_start` event for attendees

### 1.10 MVP Testing & Validation
- [x] Test: Presenter creates session, gets join code
- [x] Test: Attendee joins with code, sees session info
- [x] Test: Attendee loads same tutorial as presenter
- [x] Test: Presenter clicks "Show Me", attendee sees highlight
- [x] Test: Highlight appears in correct location with correct comment
- [x] Test: Multiple Show Me clicks in sequence work
- [x] Test: Attendee can leave session cleanly
- [ ] Test: Presenter can end session, attendees notified
- [ ] Test: Connection works through NAT (home networks)
- [ ] Test: QR code scan works from mobile device

---

## Phase 2: Follow Mode (Do It Replication)

Goal: Extend to full mirroring where "Do It" actions are replicated to attendees in Follow mode

### 2.1 Action Capture - Do It
- [ ] Extend `src/utils/collaboration/action-capture.ts`
  - [ ] Intercept "Do It" button clicks
  - [ ] Extract full action details (type, selector, value)
  - [ ] Create InteractiveStepEvent with type: 'do_it'
  - [ ] Include targetAction, refTarget, targetValue
  - [ ] Broadcast to all attendees
  - [ ] Maintain order of events (Show Me → Do It)

### 2.2 Action Replay - Follow Mode
- [ ] Extend `src/utils/collaboration/action-replay.ts`
  - [ ] Add mode parameter to constructor
  - [ ] Implement `executeAction()` method:
    - [ ] Accept InteractiveStepEvent
    - [ ] Extract action details
    - [ ] Call InteractiveStateManager.executeAction()
    - [ ] Handle errors gracefully (state divergence)
  - [ ] Update `handleEvent()`:
    - [ ] For 'do_it' events:
      - [ ] If mode === 'guided': Show highlight only
      - [ ] If mode === 'follow': Execute action
  - [ ] Add validation before execution
  - [ ] Show toast on successful execution
  - [ ] Show toast on failure with reason

### 2.3 State Validation
- [ ] Create `src/utils/collaboration/state-validator.ts`
  - [ ] Implement `validatePrerequisites(action)`:
    - [ ] Check if target element exists
    - [ ] Check if element is in expected state
    - [ ] Return boolean + error message
  - [ ] Implement state divergence detection
  - [ ] Log divergence for debugging
  - [ ] Suggest switching to Guided mode if repeated failures

### 2.4 Mode Switching
- [ ] Extend `src/components/LiveSession/AttendeeToolbar.tsx`
  - [ ] Add "Change Mode" button with dropdown
  - [ ] Show current mode prominently
  - [ ] Modal for mode change confirmation:
    - [ ] Explain what will happen
    - [ ] Warning if switching from Follow to Guided mid-tutorial
  - [ ] Send mode change event to presenter
  - [ ] Update ActionReplaySystem with new mode

### 2.5 Error Handling & Recovery
- [ ] Create `src/utils/collaboration/error-handler.ts`
  - [ ] Handle action execution failures
  - [ ] Show user-friendly error messages
  - [ ] Suggest remediation:
    - [ ] "Element not found - are you on the right page?"
    - [ ] "Action failed - switch to Guided mode?"
  - [ ] Implement error rate tracking
  - [ ] Auto-suggest Guided mode if error rate > 20%
  - [ ] Add "Retry" button for failed actions

### 2.6 Action Sequence Management
- [ ] Create `src/utils/collaboration/sequence-manager.ts`
  - [ ] Implement event queue for attendees
  - [ ] Handle events in order even if received out of order
  - [ ] Add sequence numbers to events
  - [ ] Detect and handle gaps in sequence
  - [ ] Request missed events if gap detected

### 2.7 Integration with All Action Types
- [ ] Test and handle: `targetAction: 'button'`
  - [ ] Button clicks replicate correctly
- [ ] Test and handle: `targetAction: 'highlight'`
  - [ ] Element highlighting and clicking
- [ ] Test and handle: `targetAction: 'formfill'`
  - [ ] Form field filling with correct values
  - [ ] Handle different input types (text, select, checkbox)
- [ ] Test and handle: `targetAction: 'navigate'`
  - [ ] URL navigation replicates
  - [ ] Internal Grafana navigation works
- [ ] Test and handle: Multi-step sequences
  - [ ] Sequential actions execute in order
  - [ ] Wait for completion before next action

### 2.8 Performance Optimization
- [ ] Implement event throttling for rapid actions
- [ ] Add buffering for network latency
- [ ] Show loading indicators during action execution
- [ ] Optimize highlight rendering (reuse elements)
- [ ] Implement action coalescing (multiple highlights → one)

### 2.9 Follow Mode Testing & Validation
- [ ] Test: Attendee in Follow mode receives and executes Do It
- [ ] Test: Button clicks replicate correctly
- [ ] Test: Form fills work with correct values
- [ ] Test: Navigation actions work
- [ ] Test: Complex multi-step sequences execute in order
- [ ] Test: Error handling when state diverges
- [ ] Test: Mode switching mid-session works smoothly
- [ ] Test: Follow mode with 5 attendees simultaneously
- [ ] Test: Network latency doesn't break execution order
- [ ] Test: Attendee can recover from failed action

---

## Phase 3: Chat & Enhanced Features

### 3.1 Chat System
- [ ] Create `src/components/LiveSession/ChatPanel.tsx`
  - [ ] Collapsible sidebar
  - [ ] Message list with timestamps
  - [ ] Input box with send button
  - [ ] Show sender name
  - [ ] Scroll to latest message
  - [ ] Unread message indicator
  - [ ] Chat persists during session

- [ ] Extend SessionManager
  - [ ] Add chat event handling
  - [ ] Broadcast chat messages to all
  - [ ] Store chat history in session

- [ ] Add chat to event types
  - [ ] ChatEvent interface
  - [ ] Handle in ActionReplaySystem

### 3.2 Attendee Management
- [ ] Show attendee list to presenter
- [ ] Show which attendees are in Follow vs Guided mode
- [ ] Show attendee progress (which step they're on)
- [ ] Show attendee connection quality
- [ ] Notify presenter when attendee falls behind
- [ ] Allow presenter to message individual attendees

### 3.3 Session Analytics
- [ ] Track session duration
- [ ] Track attendee join/leave times
- [ ] Track action execution success rates
- [ ] Track most replayed steps
- [ ] Show presenter post-session summary

---

## Phase 4: Recording & Persistence

### 4.1 IndexedDB Setup
- [ ] Install idb package: `npm install idb`
- [ ] Create `src/utils/collaboration/storage.ts`
  - [ ] Initialize IndexedDB database 'pathfinder-sessions'
  - [ ] Create object stores: recordings, sessions-history
  - [ ] Define schema for SessionRecording

### 4.2 Session Recording
- [ ] Create `src/utils/collaboration/recorder.ts`
  - [ ] Implement `SessionRecorder` class
  - [ ] Start recording on session start
  - [ ] Capture all events with timestamps
  - [ ] Capture chat messages
  - [ ] Capture attendee join/leave
  - [ ] Stop and save on session end
  - [ ] Store in IndexedDB

### 4.3 Playback System
- [ ] Create `src/components/LiveSession/RecordingPlayer.tsx`
  - [ ] Video-like controls (play, pause, seek)
  - [ ] Speed control (0.5x, 1x, 2x)
  - [ ] Timeline showing events
  - [ ] Display chat at appropriate times
  - [ ] Allow jumping to specific steps
  - [ ] Mode switcher (watch recording in Guided or Follow)

### 4.4 Recording Export/Import
- [ ] Export recording as downloadable JSON
- [ ] Import recording from file
- [ ] Share recordings via file upload (Slack, email)
- [ ] Recording library/browser UI

### 4.5 Recording to Tutorial Conversion
- [ ] Create `src/utils/collaboration/tutorial-converter.ts`
  - [ ] Parse recording events
  - [ ] Extract unique steps
  - [ ] Generate interactive tutorial HTML
  - [ ] Include timing suggestions
  - [ ] Add chat Q&A as hints
  - [ ] Export as standard tutorial format

---

## Phase 5: Scale & Polish

### 5.1 Connection Resilience
- [ ] Handle presenter disconnect gracefully
- [ ] Handle attendee disconnect/reconnect
- [ ] Show connection quality indicator
- [ ] Automatic TURN fallback for restrictive firewalls
- [ ] Show "Using relay" message when using TURN
- [ ] Reconnection logic with exponential backoff

### 5.2 Multi-Attendee Optimization
- [ ] Test with 10 simultaneous attendees
- [ ] Test with 25 simultaneous attendees
- [ ] Test with 50 simultaneous attendees
- [ ] Optimize for bandwidth usage
- [ ] Monitor and display presenter's network load
- [ ] Implement connection limits with warning

### 5.3 UX Polish
- [ ] Add keyboard shortcuts (Esc to leave, Space to pause)
- [ ] Add tooltips and help text
- [ ] Improve error messages
- [ ] Add loading states everywhere
- [ ] Add empty states (no sessions, no recordings)
- [ ] Add success animations
- [ ] Improve mobile responsiveness

### 5.4 Documentation
- [ ] User guide: How to present a workshop
- [ ] User guide: How to join a session
- [ ] User guide: Mode differences explained
- [ ] Troubleshooting: Connection issues
- [ ] Troubleshooting: Action replication failures
- [ ] Video demo of feature

### 5.5 Testing
- [ ] Unit tests for SessionManager
- [ ] Unit tests for ActionCapture
- [ ] Unit tests for ActionReplay
- [ ] Integration test: Full session flow
- [ ] E2E test: Two browser windows (presenter + attendee)
- [ ] Performance testing: 50 attendees
- [ ] Network condition testing (slow 3G, packet loss)

---

## Success Criteria Summary

### MVP (Phase 1-2):
✅ Presenter can create session with one click
✅ Attendee can join with code (QR/link/paste)
✅ Show Me highlights replicate accurately (<200ms latency)
✅ Do It actions execute in Follow mode with 95%+ success rate
✅ Works through NAT without configuration
✅ Supports 10 simultaneous attendees reliably

### Complete Feature (Phase 3-5):
✅ Chat works smoothly for real-time Q&A
✅ Sessions can be recorded and replayed
✅ Recordings convert to reusable tutorials
✅ Supports 50 attendees with acceptable performance
✅ Error recovery and graceful degradation
✅ Comprehensive documentation and examples

