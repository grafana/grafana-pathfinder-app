# Docs Panel Components

The core documentation functionality of the plugin, including context-aware recommendations and interactive learning journeys.

## Files Overview

### `docs-panel.tsx` ⭐ **Main Component**

**Purpose**: Primary documentation viewer with tabbed interface supporting both learning journeys and single docs
**Role**:

- Manages multiple content tabs (recommendations, learning journeys, docs pages)
- Handles navigation between milestones within learning journeys
- Integrates all the extracted hooks for clean code organization
- Provides unified interface for different content types

**Key Features**:

- **Multi-tab Interface**: Recommendations tab + dynamic content tabs
- **Content Type Support**: Learning journeys and standalone documentation pages
- **Milestone Navigation**: Previous/Next navigation within learning journeys
- **Real-time Loading**: Lazy loading of content when tabs are activated
- **Keyboard Shortcuts**: Tab switching and navigation shortcuts
- **Cache Management**: Intelligent caching with cleanup on tab close

**State Management**:

```typescript
interface CombinedPanelState {
  tabs: LearningJourneyTab[];
  activeTabId: string;
  contextPanel: ContextPanel;
}

interface LearningJourneyTab {
  id: string;
  title: string;
  baseUrl: string;
  content: LearningJourneyContent | null;
  docsContent: SingleDocsContent | null;
  type?: 'learning-journey' | 'docs';
  isLoading: boolean;
  error: string | null;
}
```

**Hook Integration** (Post-Refactor):

- `useInteractiveElements()` - Handles interactive document features
- `useContentProcessing()` - Manages code copy buttons, tables, collapsibles
- `useKeyboardShortcuts()` - Tab switching and milestone navigation
- `useLinkClickHandler()` - Journey starts, image lightbox, navigation

---

### `context-panel.tsx` ⭐ **Recommendations Engine**

**Purpose**: Context-aware documentation recommendations based on user's current Grafana state
**Role**:

- Analyzes current Grafana context (path, datasources, dashboard info)
- Fetches personalized recommendations from AI service
- Displays learning journeys and docs organized by type
- Handles opening content in the main docs panel

**Key Features**:

- **Context Analysis**: Extracts context from current Grafana page
- **Smart Recommendations**: AI-powered content suggestions
- **Recommendation Types**: Learning journeys vs. standalone docs
- **Expandable Sections**: Collapsible lists with metadata
- **Real-time Updates**: Refreshes on page navigation

**Context Detection**:

- Current page path and parameters
- Active datasources
- Dashboard information (if applicable)
- User role and preferences
- Generated context tags for AI processing

**Recommendation Flow**:

1. **Context Collection**: Gather user's current state
2. **API Request**: Send context to recommendation service
3. **Content Processing**: Fetch milestone data for learning journeys
4. **Display**: Show organized recommendations by type
5. **Integration**: Open selected content in main panel

---

## Refactoring History

This component underwent major refactoring to improve maintainability:

### Before Refactor

- Single `docs-panel.tsx` file with ~3,500 lines
- Mixed concerns: UI, business logic, styling, event handling
- Difficult to maintain and test

### After Refactor ✅

- **Main Component**: ~560 lines focused on rendering and state
- **Extracted Hooks**: Organized business logic in `/utils/*.hook.ts`
- **Extracted Styles**: Organized styling in `/styles/*.styles.ts`
- **Extracted Constants**: Type-safe selectors in `/constants/selectors.ts`

### Extracted Modules (Post-Refactor)

- `src/utils/interactive.hook.ts` - Interactive elements (~200 lines)
- `src/utils/docs-retrieval/content-renderer.tsx` - Unified renderer
- `src/utils/keyboard-shortcuts.hook.ts` - Keyboard navigation
- `src/utils/link-handler.hook.ts` - Link handling (~200 lines)
- `src/styles/docs-panel.styles.ts` - Component styling
- `src/styles/content-html.styles.ts` - Content HTML styling
- `src/constants/selectors.ts` - UI selectors and constants

## Component Relationships

```
CombinedLearningJourneyPanel (main)
├── ContextPanel (recommendations)
├── Interactive Hooks
│   ├── useInteractiveElements()
│   ├── useContentProcessing()
│   ├── useKeyboardShortcuts()
│   └── useLinkClickHandler()
├── Data Fetching
│   ├── docs-fetcher.ts (learning journeys)
│   └── single-docs-fetcher.ts (docs pages)
└── Styling
    ├── docs-panel.styles.ts
    └── content-html.styles.ts
```

## Usage Patterns

### Opening Learning Journeys

```typescript
// From context panel recommendations
const tabId = await model.openLearningJourney(url, title);

// Navigation within journeys
model.navigateToNextMilestone();
model.navigateToPreviousMilestone();
```

### Opening Documentation Pages

```typescript
// From context panel or related links
const tabId = await model.openDocsPage(url, title);
```

### Tab Management

```typescript
// Switch active tab
model.setActiveTab(tabId);

// Close tab (preserves cache intelligently)
model.closeTab(tabId);
```

## Integration Points

### Data Sources

- `src/utils/docs-fetcher.ts` - Learning journey content and milestones
- `src/utils/single-docs-fetcher.ts` - Single documentation pages
- Context panel recommendation API

### Styling

- `src/styles/docs-panel.styles.ts` - Component-level styles
- `src/styles/content-html.styles.ts` - Content-specific HTML styling
- Grafana theme integration for consistent appearance

### Configuration

- `src/constants/selectors.ts` - UI selectors and configuration
- `src/constants.ts` - API endpoints and authentication

This organization provides a clean, maintainable codebase that separates concerns and makes it easy for developers to understand and modify specific functionality.
