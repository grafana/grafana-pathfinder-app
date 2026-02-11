# Known Issues

## Live Sessions (Experimental Feature)

### Critical Requirements

#### PeerJS Server Requirement

**Issue**: Live sessions require a running PeerJS signaling server.

**Status**: This is **not optional** - the feature will not work without it.

**Setup**:

```bash
# Must run in separate terminal
npm run peerjs-server
```

**Explanation**: The PeerJS server handles peer discovery and WebRTC connection setup between presenter and attendees. Once connected, guide data flows peer-to-peer directly between browsers.

**Production**: For production use, deploy a dedicated PeerJS server. See `docs/developer/LIVE_SESSIONS.md` for deployment options.

### Known Limitations

#### 1. Monaco Editor Visual Update in Follow Mode

**Issue**: When an attendee is in Follow mode and the presenter executes a formfill action on a Monaco editor (e.g., PromQL query field), the editor **visually updates only if the attendee's browser window is focused**.

**Cause**: This is a Monaco editor limitation - Monaco does not update its visual display when the browser tab/window is not in focus. The value is actually being set in the underlying textarea, but Monaco's rendering engine waits until the window regains focus to update the display.

**Workaround**: Attendees should keep their browser window focused when following along with interactive guides that involve code editors.

**Status**: This is a limitation of the Monaco editor component, not a bug in Pathfinder. The action executes correctly and the step completion still works properly.

**Technical Details**:

- The formfill action triggers successfully
- The underlying textarea value is set correctly
- Monaco editor events are dispatched
- Step completion is marked correctly
- Only the visual rendering is delayed until window focus

**Example**: In the "Prometheus & Grafana 101" guide, when the presenter fills the PromQL query field, attendees will see the query appear in their editor once they click or focus on their browser window.

#### 2. No Automatic Reconnection

**Issue**: If presenter or attendee disconnects, there is no automatic reconnection.

**Impact**:

- Presenter disconnect ends the session for all attendees
- Attendee disconnect requires manual rejoin with new connection

**Workaround**:

- Ensure stable network connection before starting session
- For presenter: Keep browser tab active and network stable
- For attendee: Rejoin using the same join code if disconnected

**Status**: Planned for future release. Manual reconnection logic to be added in Phase 5 (Production Readiness).

#### 3. Scale Limitations

**Issue**: Feature has only been tested with up to 5 concurrent attendees.

**Current Status**:

- **Tested**: 1-5 attendees ✅
- **Untested**: 10-25 attendees ⚠️
- **Unknown**: 25+ attendees ❓

**Recommendation**:

- Safe for workshops with < 10 attendees
- Larger groups: Test in your environment first
- Very large groups (50+): Not recommended until scale testing complete

**Next Steps**: Systematic testing with 10, 25, 50 attendees planned for Phase 5.

#### 4. Browser Compatibility

**Issue**: Feature requires modern browser with full WebRTC support.

**Supported**:

- Chrome 90+
- Firefox 88+
- Edge 90+
- Safari 15+

**Not Supported**:

- Internet Explorer (any version)
- Legacy browsers without WebRTC DataChannel support

**Check Compatibility**: The feature will fail gracefully if browser doesn't support required APIs.

#### 5. Network Firewall Restrictions

**Issue**: Restrictive corporate firewalls may block WebRTC connections.

**Symptoms**:

- Attendee can't connect even with correct join code
- Connection timeout errors
- PeerJS connects but WebRTC fails

**Workaround**:

- Use TURN server fallback (see `docs/developer/LIVE_SESSIONS.md`)
- Configure firewall to allow WebRTC ports
- Test connection in unrestricted network first

**Status**: TURN server configuration documented but not extensively tested.

### Planned Fixes

**Phase 5: Production Readiness**

- [ ] Automatic reconnection with exponential backoff
- [ ] Connection quality indicators
- [ ] Graceful handling of presenter disconnect
- [ ] Scale testing with 10, 25, 50 attendees
- [ ] Better error messages for firewall issues
- [ ] TURN server testing and documentation

### Reporting Issues

If you encounter issues not listed here:

1. Check browser console for errors
2. Verify PeerJS server is running (`npm run peerjs-server`)
3. Test in incognito/private window
4. See troubleshooting in `docs/developer/LIVE_SESSIONS.md`
5. File issue with:
   - Browser and version
   - Number of attendees
   - Console errors
   - Network environment (local/VPN/corporate)

### Feature Maturity

**Current Status**: ✅ MVP Complete - Experimental

**What Works Reliably**:

- Guided and Follow modes
- All action types (button, formfill, navigate, highlight, hover, noop, multistep, guided)
- Session creation and joining
- Mode switching during session

**Use With Caution**:

- Sessions with > 5 attendees (untested)
- Restrictive network environments
- Long-running sessions (> 1 hour)
- Production/critical training (wait for production-ready status)

**Not Recommended**:

- Mission-critical training (no recording yet)
- Large public workshops (scale unknown)
- Environments with unstable networks
