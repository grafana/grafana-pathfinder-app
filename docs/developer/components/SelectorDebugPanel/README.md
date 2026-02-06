# Selector Debug Panel

A comprehensive developer tools panel providing three essential tools for content development: the Interactive Guide Editor, PR Tester, and URL Tester.

## Overview

The Selector Debug Panel serves as the container for all developer tools in the Pathfinder plugin. It provides content authors and developers with tools to create, test, and validate interactive guides.

## Location

**Path**: `/src/components/SelectorDebugPanel/`
**Main Component**: `SelectorDebugPanel.tsx`

## Purpose

The Selector Debug Panel exists to:

- Provide centralized access to all developer tools
- Enable guide authoring without leaving Grafana
- Support PR testing and validation workflows
- Offer URL testing and validation utilities
- Maintain clean separation between production and dev features

## Enabling Dev Mode

### 1. Access Plugin Configuration

Navigate to plugin configuration:

```
https://your-grafana.com/a/grafana-pathfinder-app?page=configuration
```

### 2. Enable Dev Mode

**Option A: Via Dev Mode Tab**
1. Go to "Dev Mode" configuration tab
2. Add your user ID to the "Dev Mode User IDs" list
3. Click "Save configuration"
4. Page will reload automatically

**Option B: Via URL Parameter (Quick Enable)**
1. Add `&dev=true` to configuration URL
2. Check "Dev Mode" checkbox
3. Click "Save configuration"

### 3. Access Debug Panel

1. Open the **Pathfinder sidebar** (click the book icon)
2. Stay on the **"Recommendations"** tab
3. Scroll to the bottom
4. You'll see **"DOM Selector Debug"** section with an orange "Dev Mode" badge

## Debug Panel Features

The debug panel provides three main tools:

### 1. Interactive Guide Editor

**Purpose**: Visual block-based editor for authoring JSON guides

**Features:**
- Block palette with all block types
- Drag-and-drop block composition
- Action recording mode
- Nested blocks (sections, conditionals)
- Import/export JSON guides
- Preview mode for testing
- GitHub PR integration
- Auto-save to localStorage

**Block Types Supported:**
- Text, Interactive, Multistep, Guided
- Section, Conditional
- Image, Video, Code, Alert

**Use Cases:**
- Creating new interactive guides
- Editing existing guides
- Recording user workflows
- Testing guide behavior

See: `docs/developer/components/block-editor/`

### 2. PR Tester

**Purpose**: Test content changes from GitHub Pull Requests

**Features:**
- PR URL input and validation
- Automatic content file detection
- Three testing modes:
  - **Single**: Test one guide at a time
  - **Open All**: Open all PR guides
  - **Learning Path**: Create ordered test sequence
- Drag-and-drop file ordering
- State persistence across sessions

**Use Cases:**
- Reviewing content PRs
- Testing guide changes before merge
- Sequential guide testing
- Multi-guide PR validation

See: `docs/developer/components/PrTester/`

### 3. URL Tester

**Purpose**: Validate and test content URLs

**Features:**
- URL format validation
- Supported domain checking
- Quick guide opening
- URL persistence
- Error feedback

**Supported URLs:**
- `interactive-learning.grafana.net`
- `raw.githubusercontent.com`
- `grafana.com/docs`
- `localhost` (local testing)

**Use Cases:**
- Testing guide URLs
- Validating content sources
- Quick guide access during development

## Component Architecture

### SelectorDebugPanel.tsx

Main container component that:
- Manages section expansion state
- Lazy loads heavy components (BlockEditor)
- Persists section state to localStorage
- Handles dev mode exit
- Provides consistent UI structure

### Section Management

Each tool has:
- Collapsible section header
- Persistent expansion state
- Independent lazy loading
- Shared styling and layout

### State Persistence

Persisted to localStorage:
- `pathfinder-devtools-block-editor-expanded`
- `pathfinder-devtools-pr-tester-expanded`
- `pathfinder-devtools-url-tester-expanded`

### Lazy Loading

Components loaded on-demand:
- BlockEditor (largest component)
- Heavy dependencies excluded from main bundle
- Improves initial load performance

## Integration Points

### Docs Panel Integration

The debug panel integrates with the main docs panel:
- Shares `onOpenDocsPage` callback
- Shares `onOpenLearningJourney` callback
- Opens guides in existing tab system
- Respects content security policies

### Dev Mode System

- Checks `isDevModeEnabledGlobal()` for visibility
- User-based access control via config
- Graceful hiding when dev mode disabled
- Persistent dev mode state

### Leave Dev Mode

Users can exit dev mode via:
- "Leave dev mode" button in panel header
- User-specific disabling (multi-user support)
- Fallback to global disable if needed
- Automatic page reload on exit

## Development Workflow

### Recommended Process

**For Guide Authoring:**
1. Open Interactive Guide Editor
2. Create new guide or import existing
3. Add blocks from palette
4. Configure block properties
5. Test in preview mode
6. Export or create PR

**For PR Review:**
1. Open PR Tester
2. Paste PR URL
3. Select testing mode
4. Review guides in sequence
5. Provide feedback on PR

**For URL Validation:**
1. Open URL Tester
2. Paste content URL
3. Verify format and domain
4. Test opening in tab

## Dependencies

### Core Dependencies

- **React**: UI framework
- **@grafana/ui**: Grafana UI components
- **React.lazy**: Code splitting for BlockEditor

### Internal Dependencies

- **BlockEditor**: Guide authoring tool
- **PrTester**: PR testing utility
- **UrlTester**: URL validation tool
- **Dev Mode Utils**: Access control

## Security Considerations

### Dev Mode Protection

- Only enabled users see the panel
- User ID list stored in plugin config
- Admin-controlled access
- No production exposure

### Content Validation

- URL tester validates against allowed domains
- GitHub API rate limiting handled
- Content security policies enforced
- No arbitrary URL execution

## See Also

- `docs/developer/components/block-editor/` - Guide editor documentation
- `docs/developer/components/PrTester/` - PR testing documentation
- `docs/developer/DEV_MODE.md` - Dev mode setup and configuration
- `docs/developer/GUIDE_AUTHORING.md` - Guide authoring best practices
