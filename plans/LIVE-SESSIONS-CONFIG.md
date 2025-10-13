# Live Sessions Configuration Toggle - Complete ✅

## Overview
Added a configuration toggle to enable/disable the collaborative live sessions feature. This is disabled by default for stability and to give administrators control over the feature.

## Implementation

### 1. Added Configuration Setting
**File**: `src/constants.ts`

Added `enableLiveSessions` to the plugin configuration:
```typescript
export const DEFAULT_ENABLE_LIVE_SESSIONS = false; // Disabled by default

export interface DocsPluginConfig {
  // ... existing fields ...
  // Live Sessions (Collaborative Learning)
  enableLiveSessions?: boolean;
}

export const getConfigWithDefaults = (config: DocsPluginConfig): Required<DocsPluginConfig> => ({
  // ... existing fields ...
  enableLiveSessions: config.enableLiveSessions ?? DEFAULT_ENABLE_LIVE_SESSIONS,
});
```

**Default Value**: `false` (disabled) for safety and stability

### 2. Added UI Toggle in Plugin Configuration
**File**: `src/components/AppConfig/ConfigurationForm.tsx`

Added a new FieldSet with Switch control:

#### Features:
- ✅ Toggle switch to enable/disable live sessions
- ✅ Info alert when enabled explaining how it works
- ✅ Warning alert when disabled explaining what the feature does
- ✅ Persists to plugin settings

#### UI Text:
- **Title**: "Enable live collaborative learning sessions"
- **Description**: "Allow presenters to create live sessions where attendees can follow along with interactive tutorials in real-time"
- **Enabled Info**: Explains how presenters and attendees use the feature
- **Disabled Warning**: Explains what the feature does when disabled

### 3. Conditional Button Visibility
**File**: `src/components/docs-panel/docs-panel.tsx`

Updated the UI to only show live session buttons when enabled:

```typescript
// Get plugin configuration
const pluginContext = usePluginContext();
const config = useMemo(() => {
  return getConfigWithDefaults(pluginContext?.meta?.jsonData || {});
}, [pluginContext?.meta?.jsonData]);
const isLiveSessionsEnabled = config.enableLiveSessions;

// Only show buttons when enabled
{!isSessionActive && isLiveSessionsEnabled && (
  <>
    <Button ... >Start Live Session</Button>
    <Button ... >Join Live Session</Button>
  </>
)}
```

### 4. Join URL Handling When Disabled
**File**: `src/components/docs-panel/docs-panel.tsx`

Added logic to handle attendees trying to join via URL when feature is disabled:

```typescript
React.useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  if (params.has('session')) {
    if (!isLiveSessionsEnabled) {
      // Show notification
      getAppEvents().publish({
        type: 'alert-warning',
        payload: [
          'Live Sessions Disabled',
          'Live sessions are disabled on this Grafana instance. Ask your administrator to enable them in the Pathfinder plugin configuration.'
        ]
      });
    } else {
      setShowAttendeeJoin(true);
    }
  }
}, [isLiveSessionsEnabled]);
```

## User Experience

### When Enabled (Administrator Sets to True)
1. **Presenters** see:
   - "Start Live Session" button in Pathfinder sidebar
   - Can create sessions and share join codes

2. **Attendees** see:
   - "Join Live Session" button in Pathfinder sidebar
   - Can join sessions with join codes
   - Join URLs work normally

### When Disabled (Default)
1. **Presenters** see:
   - No live session buttons
   - Clean, simple UI without experimental features

2. **Attendees** see:
   - No join button
   - If they try to use a join URL, they get a warning notification:
     > "Live Sessions Disabled - Live sessions are disabled on this Grafana instance. Ask your administrator to enable them in the Pathfinder plugin configuration."

## Configuration Steps

### For Administrators

**To Enable Live Sessions:**
1. Go to **Configuration** → **Plugins**
2. Find **Grafana Pathfinder**
3. Click **Configure**
4. Scroll to **Live Sessions (Collaborative Learning)**
5. Toggle the switch to **ON**
6. Click **Save configuration**
7. Reload Grafana (page will auto-reload)

**To Disable Live Sessions:**
1. Follow same steps but toggle to **OFF**

### Environment Variable (Optional)
Can also be set via environment variable:
```bash
GF_PLUGINS_GRAFANA_GRAFANADOCSPLUGIN_APP_ENABLE_LIVE_SESSIONS=true
```

## Security & Stability Benefits

### Why Disabled by Default

1. **Stability**: P2P connections can be unreliable depending on network configuration
2. **Control**: Administrators can test the feature before rolling out
3. **Awareness**: Users won't accidentally create sessions without understanding the feature
4. **Network Security**: Some corporate networks may block P2P connections
5. **PeerJS Reliability**: Free PeerJS cloud server can be unreliable

### Best Practices

**Recommended for:**
- ✅ Training environments
- ✅ Demo sessions
- ✅ Internal workshops
- ✅ Teams with reliable networks

**Not recommended for:**
- ❌ Production-critical workflows
- ❌ Environments with strict firewall rules
- ❌ Large-scale broadcasts (50+ attendees)
- ❌ Mission-critical documentation delivery

## Testing Checklist

### When Disabled (Default State)
- [ ] No "Start Live Session" button visible
- [ ] No "Join Live Session" button visible
- [ ] Join URLs show warning notification
- [ ] Join codes fail gracefully with message
- [ ] No console errors related to sessions

### When Enabled
- [ ] "Start Live Session" button appears
- [ ] "Join Live Session" button appears
- [ ] Can create sessions normally
- [ ] Can join sessions normally
- [ ] Join URLs work as expected
- [ ] Configuration persists after reload

### Configuration UI
- [ ] Toggle switch works
- [ ] Info alert shows when enabled
- [ ] Warning alert shows when disabled
- [ ] Settings save and persist
- [ ] Page reloads after save

## Files Modified

- ✅ `src/constants.ts` - Added config field and default
- ✅ `src/components/AppConfig/ConfigurationForm.tsx` - Added UI toggle
- ✅ `src/components/docs-panel/docs-panel.tsx` - Conditional button visibility + join URL handling

## Build Status
✅ Clean build with no errors

## What's Next

With this safety toggle in place, the feature is ready for:
1. **Administrator Testing** - Admins can enable and test without user impact
2. **Controlled Rollout** - Enable for specific training sessions
3. **Feedback Collection** - Get feedback from safe, controlled use
4. **Iteration** - Improve based on real-world usage

The default-disabled state ensures the feature won't surprise users or cause issues in production environments! 🎉

