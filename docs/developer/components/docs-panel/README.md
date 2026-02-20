# Docs Panel Components

The core documentation functionality of the plugin, including context-aware recommendations, interactive learning paths, live session integration, and comprehensive content rendering.

## Location

**Path**: `/src/components/docs-panel/`
**Main Component**: `docs-panel.tsx`
**Context Component**: `context-panel.tsx`

## Purpose

The docs-panel exists to:

- Provide AI-powered context-aware documentation recommendations
- Render interactive learning paths with milestone navigation
- Enable live collaborative learning sessions
- Track learning progress and achievements
- Offer tabbed interface for multiple content streams
- Integrate developer tools for content authoring
- Support multiple content types (journeys, docs, guides)

## Files Overview

### `docs-panel.tsx` ⭐ **Main Component**

**Purpose**: Primary documentation viewer with tabbed interface and session integration
**Location**: `/src/components/docs-panel/docs-panel.tsx`
**Role**:

- Manages multiple content tabs (recommendations, my learning, content tabs)
- Handles navigation between milestones within learning paths
- Integrates live session features for collaborative learning
- Provides unified interface for different content types
- Coordinates with interactive engine for step execution
- Manages tab persistence and restoration

**Key Features**:

- **Multi-tab Interface**: Fixed tabs (Recommendations, My Learning) + dynamic content tabs
- **Content Type Support**: Learning journeys, documentation pages, interactive guides
- **Milestone Navigation**: Previous/Next navigation within learning paths
- **Live Sessions**: Real-time collaborative learning with presenter/attendee modes
- **Session Integration**: Action capture and replay for synchronized experiences
- **Real-time Loading**: Lazy loading of content when tabs are activated
- **Keyboard Shortcuts**: Tab switching and navigation shortcuts
- **Cache Management**: Intelligent caching with cleanup on tab close
- **Dev Tools**: Integrated developer tools panel (dev mode only)
- **Progress Tracking**: Automatic progress tracking for guides and milestones
- **Error Boundary**: Graceful error handling for My Learning tab

**State Management**:

```typescript
interface CombinedPanelState {
  tabs: LearningJourneyTab[];
  activeTabId: string;
  contextPanel: ContextPanel;
  pluginConfig: DocsPluginConfig;
}

interface LearningJourneyTab {
  id: string;
  title: string;
  baseUrl: string;
  currentUrl: string;
  content: Content | null;
  isLoading: boolean;
  error: string | null;
  type?: 'learning-journey' | 'docs';
}
```

**Hook Integration**:

- `useInteractiveElements()` - Interactive step execution and requirements checking
- `useKeyboardShortcuts()` - Tab switching and milestone navigation
- `useLinkClickHandler()` - Journey starts, image lightbox, internal navigation
- `useUserStorage()` - Tab persistence and restoration
- `useSession()` - Live session state and collaboration features

**Session Integration**:

- **SessionProvider**: Wraps component with session context
- **ActionCaptureSystem**: Records presenter actions
- **ActionReplaySystem**: Replays actions for attendees
- **PresenterControls**: Session management for presenters
- **AttendeeJoin**: Join interface for participants
- **HandRaiseButton/Queue**: Participant interaction features

---

### `context-panel.tsx` ⭐ **Recommendations Engine**

**Purpose**: AI-powered context-aware documentation recommendations
**Location**: `/src/components/docs-panel/context-panel.tsx`
**Role**:

- Analyzes current Grafana context (path, datasources, dashboard info)
- Fetches personalized recommendations from AI service
- Displays recommendations organized by priority and type
- Handles opening content in the main docs panel
- Shows recommendation banner when service is disabled
- Integrates developer tools panel (dev mode only)

**Key Features**:

- **Context Analysis**: Extracts context from current Grafana page
- **Smart Recommendations**: AI-powered content suggestions based on user's workflow
- **Recommendation Types**: Learning journeys vs. standalone docs
- **Priority Levels**: Primary and related recommendations
- **Expandable Sections**: Collapsible lists with metadata
- **Real-time Updates**: Refreshes on page navigation
- **Dev Tools Integration**: Shows SelectorDebugPanel when dev mode enabled
- **Terms Banner**: Displays EnableRecommenderBanner when terms not accepted

**Context Detection**:

- Current page path and URL parameters
- Active datasources and their types
- Dashboard information (if on dashboard page)
- Panel types and configurations
- Query languages in use
- User role and permissions
- Grafana version and environment
- Generated context tags for AI processing

**Recommendation Flow**:

1. **Context Collection**: Gather user's current Grafana state
2. **API Request**: Send context to recommendation service endpoint
3. **Content Processing**: Parse recommendations and fetch milestone data
4. **Priority Sorting**: Organize by primary vs. related recommendations
5. **Display**: Show organized recommendations with expand/collapse
6. **User Action**: User clicks recommendation to open
7. **Integration**: Opens content in main panel via callbacks

**Recommendation Structure**:

```typescript
interface Recommendation {
  title: string;
  url: string;
  type: 'learning-journey' | 'docs';
  priority: 'primary' | 'related';
  description?: string;
  estimatedTime?: string;
}
```

---

### `MinimizedSidebarIcon.tsx`

**Purpose**: Icon component for minimized sidebar state
**Location**: `/src/components/docs-panel/MinimizedSidebarIcon.tsx`
**Role**:

- Displays icon when sidebar is minimized
- Provides visual indicator for reopening
- Consistent with Grafana's sidebar behavior

### `/components/` Directory

**Purpose**: Extracted sub-components for cleaner organization
**Location**: `/src/components/docs-panel/components/`

**Components:**

- **MyLearningErrorBoundary.tsx** - Error boundary for My Learning tab
- **LoadingIndicator.tsx** - Loading state display component
- **ErrorDisplay.tsx** - Error message display component
- **TabBarActions.tsx** - Tab bar action buttons

### `/utils/` Directory

**Purpose**: Utility functions for docs panel
**Location**: `/src/components/docs-panel/utils/`

**Utilities:**

- **isDocsLikeTab()** - Checks if tab is documentation-type
- **getTranslatedTitle()** - Handles title localization

## Architecture

### Component Structure

```
CombinedLearningJourneyPanel (SceneObjectBase)
├── SessionProvider (collaboration context)
│   └── CombinedPanelRenderer (React component)
│       ├── Tab Bar
│       │   ├── Recommendations Tab
│       │   ├── My Learning Tab
│       │   └── Content Tabs (dynamic)
│       ├── Tab Content
│       │   ├── ContextPanel (recommendations)
│       │   ├── MyLearningTab (learning paths)
│       │   └── ContentRenderer (journeys/docs)
│       ├── Live Session Components
│       │   ├── PresenterControls
│       │   ├── AttendeeJoin
│       │   ├── HandRaiseButton
│       │   └── HandRaiseQueue
│       ├── SelectorDebugPanel (dev mode)
│       ├── FeedbackButton
│       └── HelpFooter
```

### State Management Layers

**Scene State** (SceneObjectBase):

- Tab list and active tab
- Context panel instance
- Plugin configuration

**React State** (Component):

- Session mode (presenter/attendee/none)
- UI interactions
- Form states

**User Storage**:

- Tab persistence
- Progress tracking
- Badge unlocks

**Session State**:

- Live session participants
- Action queue for replay
- Presenter actions

## Tab Types

### Fixed Tabs

**Recommendations Tab**:

- Always present
- Contains ContextPanel
- Shows AI recommendations
- Shows EnableRecommenderBanner (if needed)
- Shows SelectorDebugPanel (dev mode only)

**My Learning Tab**:

- Always present
- Contains MyLearningTab component
- Shows learning paths and progress
- Wrapped in error boundary
- Badge celebrations

### Dynamic Content Tabs

**Properties:**

- Created when user opens content
- Persisted across sessions
- Closeable by user
- Support for learning paths and docs
- Milestone navigation (journeys)

**Tab State:**

```typescript
{
  id: string; // Unique identifier
  title: string; // Display name
  baseUrl: string; // Initial URL
  currentUrl: string; // Current milestone URL
  content: Content; // Rendered content
  isLoading: boolean; // Loading state
  error: string | null; // Error state
}
```

## Live Session Features

### Session Modes

**Presenter Mode**:

- Controls session flow
- Actions captured and broadcast
- Can see hand raise queue
- Manages attendees

**Attendee Mode**:

- Follows presenter's actions
- Actions replayed automatically
- Can raise hand for questions
- Read-only experience

**None (Default)**:

- Standard individual learning
- No collaboration features
- Full control of navigation

### Session Actions

**Captured Actions:**

- Tab switches
- Milestone navigation
- Content scrolling
- Interactive step execution
- Guide openings

**Action Replay:**

- Queued and replayed in order
- Smooth transitions between actions
- Maintains state consistency
- Error handling for failed replays

## Usage Patterns

### Opening Learning Paths

```typescript
// From context panel recommendations
const tabId = await model.openLearningJourney(url, title);

// From learning paths panel
onOpenGuide(guideId); // Resolves to URL internally

// Navigation within journeys
model.navigateToNextMilestone();
model.navigateToPreviousMilestone();
```

### Opening Documentation Pages

```typescript
// From context panel or related links
const tabId = await model.openDocsPage(url, title);

// From dev tools (PR tester, URL tester)
onOpenDocsPage(url, title);
```

### Tab Management

```typescript
// Switch active tab
model.setActiveTab(tabId);

// Close tab (preserves cache intelligently)
model.closeTab(tabId);

// Close all content tabs
model.closeAllContentTabs();
```

### Starting Live Session

```typescript
// Presenter starts session
<PresenterControls sessionId={sessionId} />

// Attendees join
<AttendeeJoin sessionId={sessionId} />

// Hand raising
<HandRaiseButton />
```

## Integration Points

### Content System

- **Content Fetcher**: `/src/docs-retrieval/content-fetcher.ts`
  - Unified content fetching for all types
  - Handles authentication and caching
  - Supports multiple content sources

- **Content Renderer**: `/src/docs-retrieval/ContentRenderer.tsx`
  - Renders HTML content as React components
  - Handles interactive elements
  - Manages image lightbox

- **HTML Parser**: `/src/docs-retrieval/html-parser.ts`
  - Converts HTML to React elements
  - Sanitizes content
  - Applies styling

### Context Engine

- **Context Service**: `/src/context-engine/context.service.ts`
  - Analyzes Grafana context
  - Generates context tags
  - Fetches AI recommendations

- **Context Collection**: `/src/context-engine/context-collector.ts`
  - Extracts datasource information
  - Identifies current page type
  - Collects user preferences

### Interactive Engine

- **Interactive Hook**: `/src/interactive-engine/interactive.hook.ts`
  - Executes interactive steps
  - Manages step state
  - Handles requirements and objectives

- **Requirements Manager**: `/src/requirements-manager/`
  - Validates step requirements
  - Checks objectives completion
  - Self-healing mechanism

### User Storage

- **Tab Storage**: Persists open tabs across sessions
- **Progress Storage**: Tracks guide completion
- **Learning Paths Storage**: Badge and streak data
- **Interactive Storage**: Step completion state

### Live Sessions

- **Session Provider**: `/src/integrations/workshop/SessionProvider.tsx`
- **Action Systems**: Capture and replay user actions
- **PeerJS Integration**: WebRTC communication

### Analytics

- **Scroll Tracking**: Content engagement metrics
- **Interaction Tracking**: User action analytics
- **Progress Events**: Learning milestone events
- **Badge Events**: Achievement unlocks

### Styling

- **Component Styles**: `/src/styles/docs-panel.styles.ts`
- **Content HTML Styles**: `/src/styles/content-html.styles.ts`
- **Interactive Styles**: `/src/styles/interactive.styles.ts`
- **Prism Styles**: `/src/styles/prism.styles.ts` (code highlighting)
- Grafana theme integration for consistent appearance

### Configuration

- **Plugin Config**: `DocsPluginConfig` interface
- **API Endpoints**: Recommendation service, docs base URL
- **Feature Flags**: OpenFeature integration
- **Dev Mode**: Developer tools access control

## Dependencies

### External Dependencies

- **@grafana/scenes**: Scene-based state management
- **@grafana/ui**: Grafana UI components
- **@grafana/data**: Data types and utilities
- **@grafana/runtime**: Runtime services
- **React**: UI framework
- **PeerJS**: WebRTC for live sessions

### Internal Dependencies

- **Interactive Engine**: Step execution
- **Content System**: Content fetching and rendering
- **Context Engine**: Recommendation generation
- **User Storage**: Persistence layer
- **Analytics**: Event tracking
- **Learning Paths**: Progress tracking

## Data Collected

### User Activity

- Tab open/close events
- Content view duration (scroll tracking)
- Milestone navigation
- Interactive step completion
- Search queries (if applicable)

### Learning Progress

- Guide completion status
- Step completion state
- Badge unlocks
- Streak maintenance
- Path progress percentages

### Session Data (Live Sessions Only)

- Session participation
- Actions performed (as presenter)
- Hand raises
- Session duration

All data stored locally in browser unless explicitly synced (future feature).

## See Also

- `docs/developer/interactive-engine/` - Interactive step system
- `docs/developer/LIVE_SESSIONS.md` - Live session setup
- `docs/developer/USER_STORAGE.md` - Storage system
- `docs/developer/components/LearningPaths/` - Learning path tracking
- `docs/developer/components/SelectorDebugPanel/` - Developer tools
