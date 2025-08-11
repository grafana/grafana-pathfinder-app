# Grafana Pathfinder - Architecture

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
│                         Grafana Pathfinder                     │
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
CombinedLearningJourneyPanel        // Main panel with tab management
├── ContextPanel                    // Context-aware recommendations  
├── ContentRenderer                 // Unified content rendering
├── InteractiveSection              // Interactive tutorial sections
├── InteractiveStep                // Individual interactive steps
└── InteractiveMultiStep           // Multi-step sequences

// Supporting Components  
├── CodeBlock                      // Syntax highlighted code
├── ExpandableTable               // Collapsible content sections
├── ImageRenderer                 // Lightbox image display
└── SideJourneyLink              // Cross-journey navigation
```

## System Architecture Patterns

### 1. Hook-Based Business Logic

The architecture follows a clean separation pattern where business logic is extracted into focused React hooks:

```typescript
// Content Processing
useInteractiveElements()     // Interactive tutorial functionality
useKeyboardShortcuts()      // Navigation shortcuts  
useLinkClickHandler()       // Link and interaction handling
useRequirementsChecker()    // Requirements validation
useStepChecker()           // Step completion checking

// Context Management
useContextPanel()          // Context analysis and recommendations
useContentRenderer()       // Content rendering logic
```

### 2. Unified Content System

**Content Flow Pipeline:**
```
URL Request → Content Fetcher → HTML Parser → Content Renderer → React Components
```

**Content Types:**
- **Learning Journeys**: Multi-milestone interactive tutorials
- **Documentation Pages**: Single standalone documentation

**Processing Stages:**
1. **Fetch**: Multi-strategy content retrieval with fallbacks
2. **Parse**: HTML to React component tree conversion  
3. **Enhance**: Interactive elements and metadata extraction
4. **Render**: Theme-aware React component output

### 3. Scene-Based State Management

Uses Grafana Scenes for complex application state:

```typescript
interface CombinedPanelState {
  tabs: LearningJourneyTab[];           // All open content tabs
  activeTabId: string;                  // Currently active tab
  contextPanel: ContextPanel;           // Recommendations panel
}

interface LearningJourneyTab {
  id: string;                          // Unique tab identifier
  title: string;                       // Display title
  baseUrl: string;                     // Original URL
  currentUrl: string;                  // Current milestone/page URL
  content: RawContent | null;          // Parsed content
  type: 'learning-journey' | 'docs';   // Content type
  isLoading: boolean;                  // Loading state
  error: string | null;                // Error state
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
HTML Elements → Parser → React Components → Requirements Checker → Action Executor
```

**Interactive Elements:**
- **Interactive Steps**: Individual actions with "Show Me"/"Do It" buttons
- **Interactive Sections**: Grouped steps with sequential execution
- **Requirements System**: Validation before step execution
- **Completion Tracking**: Progress persistence across sessions

## Storage and Persistence

### Tab Persistence
```typescript
// Stored in localStorage
interface PersistedTabData {
  id: string;                    // Tab identifier
  title: string;                 // Display title
  baseUrl: string;              // Original URL
  currentUrl?: string;          // Current position (milestone/page)
  type?: 'learning-journey' | 'docs';
}
```

### Journey Progress
```typescript
// Learning journey completion tracking
interface JourneyProgress {
  [journeyBaseUrl: string]: number;  // Completion percentage (0-100)
}
```

### Configuration Management
```typescript
interface DocsPluginConfig {
  recommenderServiceUrl?: string;    // AI recommendation service
  docsBaseUrl?: string;             // Documentation base URL
  docsUsername?: string;            // Authentication username
  docsPassword?: string;            // Authentication password (secure)
  tutorialUrl?: string;             // Auto-launch tutorial URL
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
  requirements: string;              // Requirements expression
  pass: boolean;                    // Validation result
  error: CheckResultError[];        // Detailed error information
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

### Content Security

**Safe Rendering:**
- **HTML Sanitization**: Controlled HTML parsing and rendering
- **XSS Prevention**: Attribute sanitization and content validation
- **CSP Compliance**: Content Security Policy adherence
- **URL Validation**: Safe URL handling and redirect prevention

### Authentication Security

**Credential Management:**
- **Secure Storage**: Grafana's secure JSON data for passwords
- **Token Handling**: Secure API token management
- **Permission Validation**: User capability checking before actions
- **Audit Logging**: Interaction tracking for security monitoring

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

## Extension Points

### Content Source Integration

**Pluggable Architecture:**
- **Content Fetchers**: Custom content source implementations
- **Parser Extensions**: Additional HTML element support
- **Renderer Plugins**: Custom React component renderers
- **Authentication Providers**: Custom auth mechanism support

### Interactive Element Extensions

**Custom Actions:**
- **Action Types**: New interactive action implementations
- **Requirement Checkers**: Custom validation logic
- **UI Components**: Custom interactive UI elements
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