# Interactive learning - Architecture

This document provides a comprehensive overview of the plugin's architecture, design patterns, and system organization.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Grafana Core Application                     │
├─────────────────────────────────────────────────────────────────┤
│                     Plugin Extension Points                    │
│  ┌───────────────────┐    ┌─────────────────────────────────┐   │
│  │  Sidebar Component│    │       Navigation Links         │   │
│  └───────────────────┘    └─────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
            │                               │
            ▼                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Interactive learning                       │
│                                                                 │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────┐ │
│  │  Context Panel  │    │  Journey Panel  │    │   App Core  │ │
│  │                 │    │                 │    │             │ │
│  │ • Recommendations│    │ • Tab Management│    │ • Routing   │ │
│  │ • Context Detection│  │ • Content Display│   │ • State     │ │
│  │ • User Interaction │  │ • Navigation    │    │ • Config    │ │
│  └─────────────────┘    └─────────────────┘    └─────────────┘ │
│            │                       │                     │     │
│            └───────────────────────┼─────────────────────┘     │
│                                    │                           │
└────────────────────────────────────┼───────────────────────────┘
                                     │
                    ┌────────────────┼────────────────┐
                    │                │                │
                    ▼                ▼                ▼
    ┌──────────────────┐  ┌──────────────┐  ┌──────────────────┐
    │ Context Engine   │  │ Interactive  │  │  Requirements   │
    │                  │  │    Engine    │  │    Manager       │
    │ • Context Service│  │ • Action     │  │ • Step Checker   │
    │ • Context Hook   │  │   Handlers   │  │ • Requirements   │
    │ • Tag Generation │  │ • Navigation │  │   Checker        │
    │ • Recommendations│  │ • State Mgmt │  │ • Objectives    │
    └──────────────────┘  └──────────────┘  └──────────────────┘
                    │                │                │
                    └────────────────┼────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Unified Content System                       │
│                                                                 │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────┐ │
│  │  Content Fetcher│    │  HTML Parser    │    │  Renderer   │ │
│  │                 │    │                 │    │             │ │
│  │ • Multi-Strategy│    │ • Element Parse │    │ • React     │ │
│  │ • Type Detection│    │ • Interactive   │    │ • Interactive│ │
│  │ • Metadata      │    │ • Error Handle  │    │ • Styling   │ │
│  └─────────────────┘    └─────────────────┘    └─────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                    External Data Sources                       │
│                                                                 │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────┐ │
│  │ Grafana.com Docs│    │ Recommendation  │    │  Local Docs │ │
│  │ Learning Journeys│    │ ML Service      │    │   Files     │ │
│  └─────────────────┘    └─────────────────┘    └─────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## Component Architecture

### Core Application Structure

```
App (SceneApp Root)
├── docsPage (SceneAppPage)
│   └── CombinedLearningJourneyPanel
│       ├── ContextPanel (Recommendations)
│       └── Content Tabs
│           ├── Learning Journey Tabs
│           └── Documentation Tabs
└── AppConfig (Admin Settings)
```

### Component Hierarchy

```typescript
// Main Components
CombinedLearningJourneyPanel        // Main panel with tab management (docs-panel.tsx)
├── ContextPanel                    // Context-aware recommendations (context-panel.tsx)
├── ContentRenderer                 // Unified content rendering (docs-retrieval/content-renderer.tsx)
├── InteractiveSection              // Interactive guide sections (docs-retrieval/components/interactive/interactive-section.tsx)
├── InteractiveStep                // Individual interactive steps (docs-retrieval/components/interactive/interactive-step.tsx)
├── InteractiveMultiStep           // Multi-step sequences (docs-retrieval/components/interactive/interactive-multi-step.tsx)
└── InteractiveGuided              // Guided interaction steps (docs-retrieval/components/interactive/interactive-guided.tsx)

// Supporting Components
├── CodeBlock                      // Syntax highlighted code (docs-retrieval/components/docs/code-block.tsx)
├── ExpandableTable               // Collapsible content sections (docs-retrieval/components/docs/expandable-table.tsx)
├── ImageRenderer                 // Lightbox image display (docs-retrieval/components/docs/image-renderer.tsx)
├── SideJourneyLink              // Cross-journey navigation (docs-retrieval/components/docs/side-journey-link.tsx)
├── VideoRenderer                 // Video embedding (docs-retrieval/components/docs/video-renderer.tsx)
└── YouTubeVideoRenderer          // YouTube video embedding (docs-retrieval/components/docs/youtube-video-renderer.tsx)

// Additional UI Components
├── WysiwygEditor                 // Content authoring editor (components/wysiwyg-editor/)
├── LiveSession                   // Live collaboration features (components/LiveSession/)
├── EnableRecommenderBanner       // Recommendation enablement UI (components/EnableRecommenderBanner/)
├── HelpFooter                    // Help and footer content (components/HelpFooter/)
├── DomPathTooltip                // DOM path visualization (components/DomPathTooltip/)
├── SelectorDebugPanel            // Selector debugging tools (components/SelectorDebugPanel/)
├── SkeletonLoader                // Loading state UI (components/SkeletonLoader/)
└── URLTester                     // URL testing utilities (components/URLTester/)
```

## System Architecture Patterns

### 1. Engine-Based Architecture

The codebase is organized into specialized engine modules that encapsulate related functionality:

**Core Engines:**

- **`interactive-engine/`**: Interactive guide execution system
  - `interactive.hook.ts` - Main interactive elements hook
  - `action-handlers/` - Action execution handlers (button, formfill, navigate, etc.)
  - `navigation-manager.ts` - Element visibility and navigation
  - `sequence-manager.ts` - Sequential step execution
  - `interactive-state-manager.ts` - State coordination
  - `global-interaction-blocker.ts` - Section execution blocking
  - `auto-completion/` - Auto-detection system for user actions

- **`context-engine/`**: Context analysis and recommendation engine
  - `context.service.ts` - Context data fetching and tag generation
  - `context.hook.ts` - React hook for context panel
  - `context.init.ts` - Service initialization

- **`requirements-manager/`**: Requirements and objectives validation
  - `step-checker.hook.ts` - Unified step requirements/objectives checking
  - `requirements-checker.hook.ts` - Requirements validation hook
  - `requirements-checker.utils.ts` - Requirement check functions
  - `requirements-explanations.ts` - User-friendly error messages

**Hook-Based Business Logic:**

```typescript
// Interactive Engine (src/interactive-engine/)
useInteractiveElements(); // Interactive guide functionality

// Context Engine (src/context-engine/)
useContextPanel(); // Context analysis and recommendations

// Requirements Manager (src/requirements-manager/)
useStepChecker(); // Step requirements and objectives validation

// Utils (src/utils/)
useKeyboardShortcuts(); // Navigation shortcuts
useLinkClickHandler(); // Link and interaction handling

// Content Rendering (src/docs-retrieval/)
useContentRenderer(); // Content rendering logic (from content-renderer.tsx)
```

### 2. Unified Content System

**Content Flow Pipeline:**

```
URL Request → Content Fetcher (docs-retrieval/content-fetcher.ts)
  → HTML Parser (docs-retrieval/html-parser.ts)
  → Content Renderer (docs-retrieval/content-renderer.tsx)
  → React Components (docs-retrieval/components/)
```

**Content Types:**

- **Learning Journeys**: Multi-milestone interactive guides
- **Documentation Pages**: Single standalone documentation

**Processing Stages:**

1. **Fetch**: Multi-strategy content retrieval with fallbacks (`content-fetcher.ts`)
2. **Parse**: HTML to React component tree conversion (`html-parser.ts`)
3. **Enhance**: Interactive elements and metadata extraction
4. **Render**: Theme-aware React component output (`content-renderer.tsx`)

**Content System Location:**

- All content retrieval logic is in `src/docs-retrieval/` (top-level, not under utils)
- Components are in `src/docs-retrieval/components/`
  - Interactive components: `components/interactive/`
  - Documentation components: `components/docs/`

### 3. Scene-Based State Management

Uses Grafana Scenes for complex application state:

```typescript
interface CombinedPanelState {
  tabs: LearningJourneyTab[]; // All open content tabs
  activeTabId: string; // Currently active tab
  contextPanel: ContextPanel; // Recommendations panel
}

interface LearningJourneyTab {
  id: string; // Unique tab identifier
  title: string; // Display title
  baseUrl: string; // Original URL
  currentUrl: string; // Current milestone/page URL
  content: RawContent | null; // Parsed content
  type: 'learning-journey' | 'docs'; // Content type
  isLoading: boolean; // Loading state
  error: string | null; // Error state
}
```

## Data Flow Architecture

### 1. Context Analysis Flow

```
User Navigation → DOM Analysis → Context Tags → Recommendation API → UI Display
```

**Context Detection:**

- **Page Analysis**: Current Grafana page and parameters
- **UI State**: Active datasources, visualization types
- **Real-time Updates**: DOM mutation observation for UI changes
- **Tag Generation**: Semantic tags from user context

### 2. Content Fetching Flow

```
Content Request → Strategy Selection → Fetch Execution → Metadata Extraction → Cache Storage
```

**Fetching Strategies:**

1. **Direct Fetch**: Standard HTTP request to original URL
2. **Unstyled Variant**: Grafana.com unstyled version for better parsing
3. **GitHub Variations**: Repository-based fallbacks
4. **Authentication**: Credentialed requests for private content

### 3. Interactive System Flow

```
HTML Elements → Parser (docs-retrieval/html-parser.ts)
  → React Components (docs-retrieval/components/interactive/)
  → Requirements Checker (requirements-manager/step-checker.hook.ts)
  → Action Executor (interactive-engine/action-handlers/)
```

**Interactive Elements:**

- **Interactive Steps**: Individual actions with "Show Me"/"Do It" buttons (`interactive-step.tsx`)
- **Interactive Sections**: Grouped steps with sequential execution (`interactive-section.tsx`)
- **Interactive Multi-Step**: Multi-action steps executed as one (`interactive-multi-step.tsx`)
- **Interactive Guided**: User-performed actions with auto-detection (`interactive-guided.tsx`)
- **Requirements System**: Validation before step execution (`requirements-manager/`)
- **Completion Tracking**: Progress persistence across sessions (`lib/user-storage.ts`)

## Storage and Persistence

### Tab Persistence

```typescript
// Stored in localStorage via lib/user-storage.ts
interface PersistedTabData {
  id: string; // Tab identifier
  title: string; // Display title
  baseUrl: string; // Original URL
  currentUrl?: string; // Current position (milestone/page)
  type?: 'learning-journey' | 'docs';
}
```

### Journey Progress

```typescript
// Learning journey completion tracking (lib/user-storage.ts)
interface JourneyProgress {
  [journeyBaseUrl: string]: number; // Completion percentage (0-100)
}
```

### User Preferences

```typescript
// User preferences stored via lib/user-storage.ts
interface UserPreferences {
  openPanelOnLaunch?: boolean; // Auto-open sidebar preference
  // Additional preferences managed through user-storage utilities
}
```

### Configuration Management

```typescript
interface DocsPluginConfig {
  recommenderServiceUrl?: string; // AI recommendation service
  docsBaseUrl?: string; // Documentation base URL
  docsUsername?: string; // Authentication username
  docsPassword?: string; // Authentication password (secure)
  tutorialUrl?: string; // Auto-launch guide URL
}
```

## Content Processing Architecture

### HTML Parser System

**Parsing Pipeline:**

```
Raw HTML → Element Walking → Attribute Mapping → Component Creation → Error Collection
```

**Key Features:**

- **Element Mapping**: HTML tags to React component mapping
- **Attribute Transformation**: HTML attributes to React props conversion
- **Interactive Detection**: Identification of interactive elements
- **Error Handling**: Graceful degradation with error collection
- **Base URL Resolution**: Relative URL resolution for assets

### Content Enhancement

**Post-Processing Steps:**

1. **Interactive Elements**: Conversion of special elements to interactive components
2. **Code Blocks**: Syntax highlighting and copy button addition
3. **Images**: Lightbox functionality and lazy loading
4. **Tables**: Expandable/collapsible table sections
5. **Links**: Internal navigation and external link handling

## Interactive Documentation System

### Requirements System

**Validation Architecture:**

```typescript
interface RequirementsCheckResult {
  requirements: string; // Requirements expression
  pass: boolean; // Validation result
  error: CheckResultError[]; // Detailed error information
}
```

**Check Types:**

- **DOM Checks**: Element existence and state validation
- **Permission Checks**: User role and capability validation
- **Environment Checks**: Grafana version and feature availability
- **Data Checks**: Datasource and dashboard validation

### Step Execution System

**Execution Flow:**

```
Requirements Check → UI State Setup → Action Execution → Completion Validation → Progress Update
```

**Action Types:**

- **Button Actions**: Automated button clicking
- **Form Fill**: Input field population
- **Navigation**: Menu and page navigation
- **Highlight**: UI element highlighting
- **Sequence**: Multi-step coordinated actions

## Styling Architecture

### CSS-in-JS Organization

**Style Structure:**

```
src/styles/
├── docs-panel.styles.ts          # Main panel styling
├── context-panel.styles.ts       # Recommendations styling
├── content-html.styles.ts        # Content HTML styling
├── interactive.styles.ts         # Interactive elements styling
└── button-utils.ts              # Reusable button utilities
```

**Theme Integration:**

- **Grafana Theme**: Full integration with Grafana's design system
- **Dark/Light Mode**: Automatic theme switching support
- **Component Variants**: Consistent styling patterns across components
- **Responsive Design**: Adaptive layouts for different screen sizes

## Error Handling and Resilience

### Content Fetching Resilience

**Error Recovery:**

1. **Multiple Strategies**: Fallback URLs and methods
2. **Graceful Degradation**: Partial content display on failures
3. **User Feedback**: Clear error messages with retry options
4. **Cache Fallback**: Stale content serving when fresh fetch fails

### Interactive System Resilience

**Error Management:**

- **Requirement Failures**: User-friendly explanations and fix suggestions
- **DOM Changes**: Mutation observer for dynamic content adaptation
- **Step Failures**: Individual step isolation prevents cascade failures
- **Recovery Actions**: Automatic retries and manual override options

## Performance Optimization

### Content Optimization

**Loading Strategies:**

- **Lazy Loading**: Content loaded on tab activation
- **Intelligent Caching**: Context-aware cache invalidation
- **Preloading**: Next milestone preloading for learning journeys
- **Bundle Optimization**: Tree-shaking and code splitting

### Rendering Optimization

**React Performance:**

- **Memoization**: Strategic use of useMemo and useCallback
- **Component Splitting**: Focused components with single responsibilities
- **State Optimization**: Minimal re-renders through state design
- **Virtual Scrolling**: Efficient handling of large content

## Security Considerations

### Content Security (`src/security/`)

**Safe Rendering:**

- **HTML Sanitization**: Controlled HTML parsing and rendering (`security/html-sanitizer.ts`)
- **XSS Prevention**: Attribute sanitization and content validation
- **CSP Compliance**: Content Security Policy adherence
- **URL Validation**: Safe URL handling and redirect prevention (`security/url-validator.ts`)
- **Log Sanitization**: Prevents sensitive data leakage in logs (`security/log-sanitizer.ts`)

### Authentication Security

**Credential Management:**

- **Secure Storage**: Grafana's secure JSON data for passwords
- **Token Handling**: Secure API token management
- **Permission Validation**: User capability checking before actions
- **Audit Logging**: Interaction tracking for security monitoring

### Security Module Location

All security utilities are centralized in `src/security/`:

- `html-sanitizer.ts` - HTML content sanitization
- `url-validator.ts` - URL validation and sanitization
- `log-sanitizer.ts` - Log output sanitization
- `security.test.ts` - Security test suite

## Monitoring and Analytics

### User Interaction Tracking

**Event Categories:**

```typescript
enum UserInteraction {
  // Navigation
  StartLearningJourneyClick,
  MilestoneArrowInteractionClick,
  CloseTabClick,

  // Content Interaction
  ViewDocumentationClick,
  LearningJourneySummaryClick,
  JumpIntoMilestoneClick,

  // Interactive Elements
  ShowMeButtonClick,
  DoItButtonClick,
  DoSectionButtonClick,
}
```

**Analytics Data:**

- **User Behavior**: Click patterns and navigation flows
- **Content Performance**: Most accessed journeys and docs
- **Feature Usage**: Interactive element engagement rates
- **Error Rates**: Failed actions and recovery patterns

## Additional System Modules

### Global State Management (`src/global-state/`)

- **Link Interception**: Global link interception for docs/guides (`global-state/link-interception.ts`)
- **Sidebar State**: Sidebar visibility and state management (`global-state/sidebar.ts`)

### Integrations (`src/integrations/`)

- **Assistant Integration**: Grafana Assistant integration (`integrations/assistant-integration/`)
- **Workshop Integration**: Workshop mode features (`integrations/workshop/`)

### Development Tools (`src/utils/devtools/`)

- **Action Recorder**: Record user actions for guide creation (`devtools/action-recorder.hook.ts`)
- **Element Inspector**: DOM element inspection (`devtools/element-inspector.hook.ts`)
- **Selector Capture**: CSS selector generation (`devtools/selector-capture.hook.ts`)
- **Selector Generator**: Automated selector generation (`devtools/selector-generator.util.ts`)
- **Step Executor**: Test step execution (`devtools/step-executor.hook.ts`)
- **Tutorial Exporter**: Export tutorials (`devtools/tutorial-exporter.ts`)

## Extension Points

### Content Source Integration

**Pluggable Architecture:**

- **Content Fetchers**: Custom content source implementations (`docs-retrieval/content-fetcher.ts`)
- **Parser Extensions**: Additional HTML element support (`docs-retrieval/html-parser.ts`)
- **Renderer Plugins**: Custom React component renderers (`docs-retrieval/content-renderer.tsx`)
- **Authentication Providers**: Custom auth mechanism support

### Interactive Element Extensions

**Custom Actions:**

- **Action Types**: New interactive action implementations (`interactive-engine/action-handlers/`)
- **Requirement Checkers**: Custom validation logic (`requirements-manager/requirements-checker.utils.ts`)
- **UI Components**: Custom interactive UI elements (`docs-retrieval/components/interactive/`)
- **Completion Handlers**: Custom success criteria

## Future Architecture Considerations

### Scalability Improvements

**Planned Enhancements:**

- **Micro-frontend Architecture**: Plugin modularity improvements
- **Web Workers**: Heavy parsing and processing offloading
- **Service Worker**: Offline content caching and serving
- **Real-time Sync**: Multi-tab progress synchronization

### Integration Expansions

**External System Integration:**

- **Learning Management Systems**: Progress tracking integration
- **Content Management Systems**: Dynamic content source support
- **Analytics Platforms**: Enhanced user behavior tracking
- **Collaboration Tools**: Shared learning session support

---

This architecture provides a solid foundation for maintainable, scalable, and extensible documentation functionality within Grafana, with clear separation of concerns and robust error handling throughout the system.
