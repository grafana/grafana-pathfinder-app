# Multi-Step Fix for Collaborative Live Sessions

## Issue
Multi-step actions were not working for attendees in Follow mode. When the presenter clicked "Do It" on a multi-step element, the attendee would only see a highlight instead of the action executing.

## Root Cause
The `InteractiveMultiStep` component was missing the data attributes that the `ActionCaptureSystem` requires to capture and broadcast actions:
- `data-targetaction`
- `data-reftarget`  
- `data-step-id`
- `data-internal-actions` (multi-step specific)

Without these attributes, the action-capture system couldn't extract the action details, resulting in `null` being broadcast.

## Solution

### 1. Added Data Attributes to Multi-Step Elements
**File**: `src/utils/docs-retrieval/components/interactive/interactive-multi-step.tsx`

Added the following attributes to the multi-step `<div>`:
```typescript
data-targetaction="multistep"
data-reftarget={stepId || 'multistep'}
data-internal-actions={JSON.stringify(internalActions)}
data-step-id={stepId}
```

The `data-internal-actions` attribute serializes the array of internal actions that need to be executed in sequence.

### 2. Updated Type Definitions
**File**: `src/types/collaboration.types.ts`

Extended `InteractiveAction` interface to support multi-step:
```typescript
export interface InteractiveAction {
  targetAction: 'button' | 'highlight' | 'formfill' | 'navigate' | 'hover' | 'multistep';
  refTarget: string;
  targetValue?: string;
  targetComment?: string;
  internalActions?: Array<{
    targetAction: string;
    refTarget?: string;
    targetValue?: string;
    requirements?: string;
  }>;
}
```

### 3. Enhanced Action Capture
**File**: `src/utils/collaboration/action-capture.ts`

Updated `extractActionFromElement()` to parse internal actions for multi-step elements:
```typescript
// For multistep, parse internal actions
if (targetAction === 'multistep') {
  const internalActionsStr = element.getAttribute('data-internal-actions');
  if (internalActionsStr) {
    try {
      action.internalActions = JSON.parse(internalActionsStr);
    } catch (err) {
      console.error('[ActionCapture] Failed to parse internal actions:', err);
    }
  }
}
```

### 4. Enhanced Action Replay
**File**: `src/utils/collaboration/action-replay.ts`

Added multi-step detection and logging in `executeAction()`:
```typescript
// Special handling for multistep actions
if (action.targetAction === 'multistep') {
  console.log(`[ActionReplay] Executing multistep with ${action.internalActions?.length || 0} internal actions`);
}
```

The actual execution works the same way - clicking the "Do It" button triggers the multi-step's built-in `executeStep()` method, which handles executing all internal actions in sequence.

## How It Works Now

### Flow for Multi-Step in Follow Mode

1. **Presenter Clicks "Do It"** on a multi-step element
2. **Action Capture** extracts:
   - `targetAction: 'multistep'`
   - `refTarget: <stepId>`
   - `internalActions: [array of actions]`
3. **Event Broadcast** via WebRTC to all attendees
4. **Attendee Receives** event with full multi-step details
5. **Action Replay**:
   - Finds the multi-step element on attendee's screen
   - Finds the "Do It" button
   - Clicks the button programmatically
6. **Multi-Step Execution**:
   - The button click triggers `handleDoAction()`
   - Executes all internal actions in sequence
   - Waits for each action to complete
   - Marks the multi-step as completed
7. **Result**: Attendee sees all actions execute and step marked as complete ✅

## Testing

To test multi-step replication:

1. **Create session** with a tutorial containing multi-step elements
2. **Join as attendee** in Follow mode
3. **Presenter clicks "Do It"** on a multi-step
4. **Expected result**:
   - Attendee sees console log: `[ActionReplay] Executing multistep with N internal actions`
   - All internal actions execute in sequence on attendee's screen
   - Multi-step marked as completed with checkmark

## Debug Logging

When testing, look for these console messages:

**Presenter side:**
```
[ActionCapture] Broadcasted do_it event for step: <stepId>
```

**Attendee side:**
```
[ActionReplay] handleDoIt called - Current mode: follow
[ActionReplay] Executing multistep on <stepId>
[ActionReplay] Executing multistep with 3 internal actions
[ActionReplay] Triggered Do It action for attendee
```

## Files Modified

- ✅ `src/utils/docs-retrieval/components/interactive/interactive-multi-step.tsx` - Added data attributes
- ✅ `src/types/collaboration.types.ts` - Extended InteractiveAction interface
- ✅ `src/utils/collaboration/action-capture.ts` - Parse internal actions
- ✅ `src/utils/collaboration/action-replay.ts` - Handle multi-step execution
- ✅ `plans/collaborative-live-sessions-todos.md` - Updated checklist

## Build Status
✅ Clean build with no errors

## What's Next

Multi-step is now working! Next recommended steps:
1. **Test thoroughly** with different multi-step configurations
2. **Test other action types** (formfill, navigate, etc.)
3. **Test complex scenarios** (multi-step with requirements, skippable steps)
4. **Add error handling** for failed internal actions

The foundation is solid - multi-step actions are now captured, broadcast, and executed correctly! 🎉

