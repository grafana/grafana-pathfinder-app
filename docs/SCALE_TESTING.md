# Scale Testing Guide for Live Sessions

This guide provides procedures for testing live sessions with multiple concurrent attendees to identify performance limits and bottlenecks.

## Overview

Live sessions use a peer-to-peer architecture where the presenter broadcasts tutorial actions to all connected attendees. As the number of attendees increases, the presenter's machine must send more data, and the PeerJS signaling server must handle more connections.

**Current Status**: Tested up to 5 concurrent attendees successfully. Higher scale limits need systematic testing.

## Prerequisites

Before running scale tests:

- **PeerJS Server**: Running and accessible to all test participants
- **Test Devices**: Multiple browser windows, devices, or coordinated team members
- **Interactive Tutorial**: Loaded and ready (e.g., Prometheus & Grafana 101)
- **Monitoring Tools**: Browser DevTools, task manager, or performance monitoring
- **Network**: Stable connection for all participants

## Testing Methodology

### Test Levels

**Level 1: Baseline (1-5 Attendees)**

- **Purpose**: Verify basic functionality
- **Expected**: All actions work reliably
- **Status**: ✅ Validated

**Level 2: Medium Scale (10-15 Attendees)**

- **Purpose**: Identify first signs of degradation
- **Expected**: Some latency increase acceptable
- **Status**: ⏳ Needs testing

**Level 3: High Scale (25-50 Attendees)**

- **Purpose**: Find breaking point
- **Expected**: Document where system fails
- **Status**: ⏳ Needs testing

**Level 4: Stress Test (50+ Attendees)**

- **Purpose**: Understand absolute limits
- **Expected**: System may fail
- **Status**: ⏳ Future work

## Test Procedure

### Setup Phase

1. **Start PeerJS Server**:
   ```bash
   npm run peerjs-server
   ```
2. **Verify Server Health**:
   - Check console shows "PeerJS server running on port 9000"
   - No immediate error messages

3. **Prepare Test Tutorial**:
   - Open Pathfinder sidebar
   - Load an interactive tutorial (e.g., "Prometheus & Grafana 101")
   - Verify all "Show Me" and "Do It" buttons are functional

4. **Set Up Monitoring**:
   - Open browser DevTools (F12) on presenter machine
   - Monitor Network tab for WebRTC traffic
   - Open Task Manager to track CPU/memory usage

### Execution Phase

#### For Each Test Level:

**1. Create Session**:

```
Presenter: Click "Start Live Session"
Presenter: Enter session name: "Scale Test [N] Attendees"
Presenter: Note the join code
Presenter: Share join code with test attendees
```

**2. Join Attendees**:

```
Attendee 1-N: Click "Join Live Session"
Attendee 1-N: Enter join code
Attendee 1-N: Select mode (mix of Guided and Follow)
Attendee 1-N: Join session
```

**3. Verify Connections**:

```
Presenter: Open session controls
Presenter: Verify all N attendees appear in list
Presenter: Check connection indicators show "connected"
```

**4. Test Interactive Actions**:

Test each action type with all attendees connected:

**Test 1: Show Me (Highlight)**

```
Presenter: Click "Show Me" on any tutorial step
Expected: All guided-mode attendees see highlight within 2 seconds
Measure: Time from click to attendee sees highlight
```

**Test 2: Do It (Button Click)**

```
Presenter: Click "Do It" on button action
Expected: All follow-mode attendees see button click execute
Measure: Success rate, execution time
```

**Test 3: Do It (Form Fill)**

```
Presenter: Click "Do It" on form fill action
Expected: All follow-mode attendees see form populated
Measure: Success rate, any visual delays
```

**Test 4: Do It (Navigation)**

```
Presenter: Click "Do It" on navigation action
Expected: All follow-mode attendees navigate to same page
Measure: Success rate, navigation time
```

**Test 5: Mode Switching**

```
Attendee: Switch from Guided → Follow
Presenter: Click "Do It" immediately after
Expected: Mode change propagates, action executes correctly
Measure: Mode change latency
```

**Test 6: Rapid Actions**

```
Presenter: Click 5 "Show Me" buttons in rapid succession
Expected: All actions reach attendees in order
Measure: Action delivery rate, any dropped events
```

### Measurement Phase

Record the following metrics for each test level:

#### Latency Metrics

- **Action Latency**: Time from presenter click to attendee sees effect
  - Target: < 500ms for Show Me
  - Target: < 1000ms for Do It

- **Connection Quality**: Latency shown in connection indicators
  - Excellent: < 100ms
  - Good: 100-300ms
  - Poor: > 300ms

#### Resource Usage

**Presenter Machine**:

- CPU usage (idle vs active broadcasting)
- Memory usage
- Network bandwidth (bytes sent per second)
- Browser responsiveness

**Attendee Machine** (sample):

- CPU usage
- Memory usage
- Network bandwidth (bytes received per second)
- Browser responsiveness

**PeerJS Server**:

- Active connection count
- CPU usage
- Memory usage
- Log messages (warnings/errors)

#### Success Rates

- **Connection Success**: % of attendees that successfully connect
- **Action Delivery**: % of actions that reach all attendees
- **Action Execution**: % of "Do It" actions that execute correctly
- **Mode Switch**: % of mode switches that work correctly

### Failure Criteria

Document when you observe:

- **Performance Degradation**:
  - Action latency exceeds 2 seconds
  - CPU usage > 80% sustained
  - Memory usage grows unbounded

- **Functional Failures**:
  - Actions not reaching some attendees
  - Actions executing out of order
  - Attendees unable to connect
  - Connection drops during session

- **System Errors**:
  - Browser crashes or freezes
  - PeerJS server errors in logs
  - Network errors in DevTools

## Test Results Template

Document results using this template:

```markdown
### Scale Test: [N] Attendees - [Date]

**Configuration**:

- PeerJS Server: [Local/Cloud]
- Tutorial: [Name]
- Attendee Mix: [X Guided, Y Follow]
- Network: [Local/VPN/Remote]

**Latency Results**:

- Show Me: [Avg]ms (min: [X]ms, max: [Y]ms)
- Do It: [Avg]ms (min: [X]ms, max: [Y]ms)
- Connection Quality: [Excellent/Good/Poor]

**Resource Usage**:

- Presenter CPU: [X]%
- Presenter Memory: [X]MB
- Attendee CPU (sample): [X]%
- Server Connections: [N]

**Success Rates**:

- Connection: [X]% ([Y]/[N] successful)
- Action Delivery: [X]% ([Y] delivered/[Z] sent)
- Action Execution: [X]% ([Y] executed/[Z] attempted)

**Issues Observed**:

- [List any problems, errors, or degradation]

**Conclusion**:

- [Pass/Fail]
- [Recommended max attendees at this level]
- [Next steps]
```

## Example Test Scenarios

### Scenario 1: Local Workshop (10 Attendees)

**Context**: In-person training session with all attendees on same network

**Setup**:

- Local PeerJS server on trainer's machine
- All attendees connected to same WiFi
- Mixed guided/follow modes

**Expected Results**:

- Minimal network latency
- High success rates
- Good performance

### Scenario 2: Remote Webinar (25 Attendees)

**Context**: Online workshop with geographically distributed attendees

**Setup**:

- Cloud-hosted PeerJS server
- Attendees on various networks (home, office, mobile)
- Mostly guided mode (less intensive)

**Expected Results**:

- Variable network latency
- Some connection challenges
- Acceptable performance for guided mode

### Scenario 3: Large Event (50+ Attendees)

**Context**: Conference or large training event

**Setup**:

- Dedicated PeerJS server instance
- Mix of in-person and remote attendees
- Guided mode only (recommended)

**Expected Results**:

- May reach architectural limits
- Presenter machine may struggle
- Consider alternative architecture (relay server)

## Optimization Recommendations

Based on test results, consider these optimizations:

### For 10-15 Attendees

- **No changes needed**: Current architecture should handle this well
- Monitor connection quality
- Prefer wired connection for presenter

### For 25-50 Attendees

- **Reduce broadcast frequency**: Implement throttling for rapid actions
- **Optimize event payload**: Minimize data sent per action
- **Recommend Guided mode**: Less intensive than Follow mode
- **Dedicated server**: Use production PeerJS server, not local

### For 50+ Attendees

- **Consider relay architecture**: One relay per 10-15 attendees
- **Implement multicast**: Group attendees by network segment
- **Recording + Playback**: Consider recording session for async viewing
- **Split sessions**: Multiple smaller sessions instead of one large

## Troubleshooting

### High Latency

**Symptoms**: Actions take > 2 seconds to reach attendees

**Possible Causes**:

- Network congestion
- Presenter CPU overload
- PeerJS server overload

**Solutions**:

- Reduce attendee count
- Close unnecessary applications
- Upgrade server resources

### Connection Failures

**Symptoms**: Attendees can't connect or drop frequently

**Possible Causes**:

- Firewall blocking WebRTC
- PeerJS server unavailable
- Network instability

**Solutions**:

- Configure TURN server fallback
- Verify server is accessible
- Test with fewer attendees first

### Out of Order Actions

**Symptoms**: Attendees see actions in wrong sequence

**Possible Causes**:

- Network packet reordering
- Browser event queue overflow

**Solutions**:

- Add sequence numbers to events
- Implement event acknowledgment
- Reduce action frequency

## Reporting Results

After testing, please share results with the team:

1. **Create test report** using template above
2. **Document in**: `/docs/scale-testing-results/YYYY-MM-DD-N-attendees.md`
3. **Update KNOWN_ISSUES.md** with tested limits
4. **Share findings** in team channel or PR

## Future Improvements

Based on scale testing findings:

- [ ] Implement automatic quality degradation (reduce features at high scale)
- [ ] Add presenter dashboard showing connection health
- [ ] Optimize event protocol to reduce bandwidth
- [ ] Implement event batching for efficiency
- [ ] Add reconnection support for dropped attendees
- [ ] Create load testing automation scripts

## References

- Live Sessions Plan: `/plans/collaborative-live-sessions.md`
- PeerJS Server Setup: `/docs/LOCAL_PEERJS_SERVER.md`
- Known Issues: `/docs/KNOWN_ISSUES.md`
