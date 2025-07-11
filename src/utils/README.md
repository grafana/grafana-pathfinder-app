# Utils Directory

Business logic, data fetching, and utility functions organized by functionality. This directory contains the core logic extracted from the main components during refactoring.

## File Organization

### 🔄 **Data Fetching**
- `docs-fetcher.ts` - Learning journey content and milestones
- `single-docs-fetcher.ts` - Standalone documentation pages

### 🎣 **React Hooks** (Post-Refactor)
- `interactive.hook.ts` - Interactive element handling
- `content-processing.hook.ts` - Content processing and enhancement
- `keyboard-shortcuts.hook.ts` - Keyboard navigation
- `link-handler.hook.ts` - Link click handling and lightbox

### ⚙️ **Requirements System**
- `requirements.util.ts` - Unified requirements checking with implicit requirements

### 🛠️ **Utilities & Configuration**
- `docs.utils.ts` - Component utilities and factories
- `utils.plugin.ts` - Plugin props context management
- `utils.routing.ts` - Route prefixing utilities

---

## Data Fetching Files

### `docs-fetcher.ts` ⭐ **Learning Journey Engine**
**Purpose**: Comprehensive learning journey content fetching, processing, and navigation
**Role**: 
- Fetches and processes learning journey content
- Manages milestone navigation and progress
- Handles content caching and URL resolution
- Processes interactive elements and content enhancement

**Key Features**:
- **Multi-Strategy Fetching**: Direct fetch with authentication support
- **Milestone Management**: JSON-based milestone discovery and caching
- **Content Processing**: HTML processing for interactive elements
- **Navigation Logic**: Next/previous milestone URL resolution
- **Intelligent Caching**: Content and milestone caching with cleanup

**Major Interfaces**:
```typescript
interface LearningJourneyContent {
  title: string;
  content: string;
  url: string;
  currentMilestone: number;
  totalMilestones: number;
  milestones: Milestone[];
  lastFetched: string;
  summary?: string;
}

interface Milestone {
  number: number;
  title: string;
  duration: string;
  url: string;
  isActive: boolean;
  sideJourneys?: SideJourneys;
  relatedJourneys?: RelatedJourneys;
  conclusionImage?: ConclusionImage;
}
```

**Core Functions**:
- `fetchLearningJourneyContent()` - Main content fetching
- `getNextMilestoneUrl()` / `getPreviousMilestoneUrl()` - Navigation
- `clearLearningJourneyCache()` - Cache management

**Used By**:
- `src/components/docs-panel/docs-panel.tsx` - Main content loading
- `src/components/docs-panel/context-panel.tsx` - Milestone data for recommendations

---

### `single-docs-fetcher.ts` ⭐ **Documentation Page Engine**
**Purpose**: Fetches and processes standalone documentation pages
**Role**: 
- Handles single documentation page content
- Processes interactive elements and code blocks
- Manages docs-specific caching
- Supports authentication for private docs

**Key Features**:
- **Unstyled Content**: Fetches `/unstyled.html` versions for clean content
- **Content Processing**: Code blocks, images, links, admonitions
- **Interactive Elements**: Processes embedded interactive tutorials
- **Authentication**: Support for authenticated docs access

**Core Interface**:
```typescript
interface SingleDocsContent {
  title: string;
  content: string;
  url: string;
  lastFetched: string;
}
```

**Used By**:
- `src/components/docs-panel/docs-panel.tsx` - Docs tab content loading

---

## React Hooks (Post-Refactor)

### `interactive.hook.ts` ⭐ **Interactive Elements Handler**
**Purpose**: Manages interactive tutorial elements embedded in documentation
**Role**: 
- Handles custom interactive events (highlight, form-fill, button clicks)
- Provides programmatic interaction with Grafana UI
- Supports guided tutorial sequences

**Extracted From**: Main docs panel (~200 lines)
**Key Functions**:
- `interactiveFocus()` - Highlights and focuses UI elements
- `interactiveButton()` - Finds and clicks buttons by text
- `interactiveFormFill()` - Fills form fields with values
- `interactiveSequence()` - Runs sequences of interactions

**Event Handling**:
```typescript
const events = [
  'interactive-highlight',
  'interactive-formfill', 
  'interactive-button',
  'interactive-sequence',
];
```

**Used By**:
- `src/components/docs-panel/docs-panel.tsx` - Interactive tutorial support

---

### `content-processing.hook.ts` ⭐ **Content Enhancement**
**Purpose**: Processes and enhances documentation content after rendering
**Role**: 
- Adds copy buttons to code blocks and inline code
- Processes tables for responsive behavior
- Handles collapsible sections
- Enhances user experience with interactive elements

**Extracted From**: Main docs panel (~300 lines)
**Key Features**:
- **Code Copy Buttons**: Automatic copy button injection
- **Table Processing**: Expand/collapse functionality
- **Collapsible Sections**: Interactive expand/collapse behavior
- **Cross-browser Support**: Handles different clipboard APIs

**Processing Areas**:
- Code blocks (`pre` elements) with copy buttons
- Inline code elements with mini copy buttons
- Tables with responsive wrappers
- Collapsible sections with click handlers

**Used By**:
- `src/components/docs-panel/docs-panel.tsx` - Content enhancement

---

### `keyboard-shortcuts.hook.ts` ⭐ **Navigation Shortcuts**
**Purpose**: Provides keyboard shortcuts for efficient navigation
**Role**: 
- Tab switching with Ctrl/Cmd+Tab
- Tab closing with Ctrl/Cmd+W
- Milestone navigation with Alt+Arrow keys

**Extracted From**: Main docs panel (keyboard event handling)
**Shortcuts**:
- `Ctrl/Cmd + W` - Close current tab
- `Ctrl/Cmd + Tab` - Switch between tabs
- `Alt + →` - Next milestone
- `Alt + ←` - Previous milestone

**Used By**:
- `src/components/docs-panel/docs-panel.tsx` - Keyboard navigation

---

### `link-handler.hook.ts` ⭐ **Link & Interaction Handler**
**Purpose**: Handles clicks on various interactive elements in content
**Role**: 
- Journey start button handling
- Image lightbox creation and management
- Side journey and related journey link handling
- Bottom navigation (Previous/Next) button handling

**Extracted From**: Main docs panel (~200 lines)
**Key Features**:
- **Journey Start**: Navigates to first milestone
- **Image Lightbox**: Creates responsive modal with theme support
- **External Links**: Opens side journeys in new tabs
- **Internal Navigation**: Opens related journeys in new app tabs
- **Bottom Navigation**: Milestone Previous/Next handling

**Link Types Handled**:
- `[data-journey-start="true"]` - Journey start buttons
- `img` elements - Image lightbox
- `[data-side-journey-link]` - External side journey links
- `[data-related-journey-link]` - Internal related journey links
- `.journey-bottom-nav-button` - Navigation buttons

**Used By**:
- `src/components/docs-panel/docs-panel.tsx` - Content interaction handling

---

## Utility Files

### `docs.utils.ts` ⭐ **Component Utilities**
**Purpose**: React hooks and components for creating and managing documentation panels
**Role**: 
- Provides memoized panel creation hooks
- Component factories for different usage contexts
- Backward compatibility exports

**Key Exports**:
- `useContextPanel()` - Memoized context panel hook
- `useLearningJourneyPanel()` - Memoized main panel hook  
- `ContextPanelComponent` - React component wrapper
- `LearningJourneyPanelComponent` - Alternative component wrapper

**Used By**:
- `src/components/App/App.tsx` - Context panel for extensions
- Plugin extensions and sidebar integrations

---

### `utils.plugin.ts` ⭐ **Plugin Props Management**
**Purpose**: Context management for plugin props throughout the component tree
**Role**: 
- Provides React context for plugin props
- Hooks for accessing plugin metadata
- Ensures plugin props are available to all components

**Key Exports**:
- `PluginPropsContext` - React context provider
- `usePluginProps()` - Hook for accessing plugin props
- `usePluginMeta()` - Hook for accessing plugin metadata

**Used By**:
- `src/components/App/App.tsx` - Context provider setup
- Any component needing access to plugin configuration

---

### `utils.routing.ts` ⭐ **Route Utilities**
**Purpose**: URL and routing utilities for consistent plugin navigation
**Role**: 
- Prefixes routes with plugin base URL
- Ensures consistent URL structure
- Supports Grafana's app routing patterns

**Key Function**:
```typescript
function prefixRoute(route: string): string {
  return `${PLUGIN_BASE_URL}/${route}`;
}
```

**Used By**:
- `src/pages/docsPage.ts` - Page route definition
- Any component requiring route generation

---

## Architecture Benefits

### Refactoring Impact
This directory represents the successful extraction of business logic from a monolithic ~3,500 line component:

#### Before Refactor ❌
- All logic embedded in single component file
- Mixed concerns (UI, data, styling, events)
- Difficult to test individual pieces
- Hard to maintain and extend

#### After Refactor ✅
- **Separation of Concerns**: Each file has single responsibility
- **Reusability**: Hooks can be used across components
- **Testability**: Individual functions can be unit tested
- **Maintainability**: Easy to find and modify specific functionality
- **Performance**: Better tree-shaking and code splitting potential

### Design Patterns

#### Hook-Based Architecture
- Custom hooks for stateful logic
- Clean separation from UI components
- Reusable across different components
- Easy to test and mock

#### Functional Programming
- Pure functions where possible
- Immutable data patterns
- Composable utility functions
- Predictable behavior

#### Caching Strategy
- Intelligent caching with TTL
- Memory management for large content
- Cache invalidation strategies
- Performance optimization

This organization makes the codebase significantly more maintainable and allows developers to easily understand, modify, and extend specific functionality without affecting other parts of the system.

---

## Requirements System (Enhancement)

### `requirements.util.ts` ⭐ **Unified Requirements Engine**
**Purpose**: Centralized requirements checking with implicit requirements support
**Role**: 
- Consolidates duplicated requirements logic from multiple hooks
- Implements implicit requirements (sequential dependency and completion tracking)
- Provides unified element state management
- Optimizes performance with short-circuit evaluation

**Key Features**:
- **Sequential Processing**: Elements are checked in DOM order with dependency enforcement
- **Completion Tracking**: Automatically marks completed actions and prevents re-execution
- **State Management**: Unified visual state system with CSS classes
- **Performance Optimization**: Short-circuit evaluation when requirements fail
- **Backwards Compatibility**: Supports both sequential and parallel checking modes

**Implicit Requirements**:
1. **Sequential Dependency**: If step N fails, all subsequent steps are automatically disabled
2. **Completion State**: Completed actions are disabled and marked with checkmarks

**Major Functions**:
```typescript
// Unified requirements checking
checkAllElementRequirements(container, checkFn, sequential?: boolean)

// Element state management  
updateElementState(element, config)

// Completion tracking
markElementCompleted(element)
isElementCompleted(element)
```

**Integration**:
- Used by `content-processing.hook.ts` for main requirements checking
- Used by `interactive.hook.ts` for completion tracking
- Replaces ~200 lines of duplicated logic across multiple files
- Documented in `/INTERACTIVE_REQUIREMENTS.md` for comprehensive usage guide

This enhancement provides a foundation for sophisticated tutorial flows with automatic step dependency management and progress tracking. 