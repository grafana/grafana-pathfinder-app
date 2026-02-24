# Components Directory

This directory contains all React and Grafana Scenes components that make up the plugin's user interface.

## Component Architecture

The components are organized into logical groups with clear responsibilities:

### Main Application Components

- **App/**: Root application component with error boundary and routing logic
- **AppConfig/**: Plugin configuration interface for admin settings and feature flags
- **docs-panel/**: Core documentation features (recommendations, learning paths, content rendering)

### Content Authoring and Development Tools

- **block-editor/**: Visual JSON guide editor for creating interactive learning content
- **SelectorDebugPanel/**: Developer tools panel with block editor, PR tester, and URL tester
- **PrTester/**: GitHub PR testing tool for validating content changes
- **UrlTester/**: URL validation and testing utilities

### Learning and Progress Tracking

- **LearningPaths/**: Learning path tracking with badges, streaks, and progress visualization
- **MyLearningTab/**: User's personal learning dashboard

### Collaboration Features

- **LiveSession/**: Real-time collaboration features with PeerJS integration for workshop sessions
- **HandRaiseButton/**: Participant interaction during live sessions
- **HandRaiseQueue/**: Queue management for raised hands
- **PresenterControls/**: Session management for presenters
- **AttendeeJoin/**: Join interface for session attendees

### UI Components

- **EnableRecommenderBanner/**: Banner for enabling recommendation service
- **HelpFooter/**: Help content and footer integration
- **DomPathTooltip/**: DOM path visualization tooltip for element inspection
- **SkeletonLoader/**: Loading state skeleton UI with multiple variants
- **FeedbackButton/**: User feedback collection button
- **OpenFeatureProvider/**: Feature flag provider integration

## Component Files

### `testIds.ts`

**Purpose**: Centralized test identifiers for automated testing across all components
**Role**: Provides consistent data-testid attributes for UI testing and E2E automation
**Location**: `/src/components/testIds.ts`
**Used By**:

- `AppConfig/ConfigurationForm.tsx` - Configuration form testing
- `SelectorDebugPanel/SelectorDebugPanel.tsx` - Dev tools panel testing
- `DomPathTooltip/DomPathTooltip.tsx` - Tooltip element testing
- Any component requiring test automation

**Exports**:

- `testIds.appConfig` - Test IDs for configuration form elements
- `testIds.devTools` - Test IDs for developer tools panel
- Additional test identifiers for various UI components

---

## Subdirectories

### `/App` - Main Application

Contains the root application component that handles:

- Plugin initialization and lifecycle management
- Error boundary for graceful error handling
- Grafana Scenes routing setup
- OpenFeature provider integration for feature flags
- Plugin props context distribution

### `/AppConfig` - Configuration Interface

Contains the admin configuration components for:

- Plugin settings (API endpoints, authentication)
- Terms and conditions acceptance
- Interactive features configuration
- Dev mode settings

### `/docs-panel` - Core Documentation Features

Contains the main documentation functionality including:

- Context-aware recommendations engine
- Interactive learning paths with milestone navigation
- Document viewer with tabbed interface
- Live session integration for collaborative learning
- Learning progress tracking
- Dev tools integration (when enabled)

## Component Relationships

```
App (root)
├── OpenFeatureProvider (feature flags)
│   ├── PluginErrorBoundary (error handling)
│   │   └── SceneApp (Grafana Scenes)
│   │       └── DocsPage
│   │           └── CombinedLearningJourneyPanel
│   │               ├── SessionProvider (live sessions)
│   │               ├── Tabs
│   │               │   ├── Recommendations Tab
│   │               │   │   ├── ContextPanel (AI recommendations)
│   │               │   │   ├── EnableRecommenderBanner
│   │               │   │   └── SelectorDebugPanel (dev mode only)
│   │               │   │       ├── BlockEditor (guide authoring)
│   │               │   │       ├── PrTester (PR testing)
│   │               │   │       └── UrlTester (URL validation)
│   │               │   ├── My Learning Tab
│   │               │   │   └── MyLearningTab
│   │               │   │       ├── LearningPathsPanel
│   │               │   │       │   ├── LearningPathCard
│   │               │   │       │   ├── BadgesDisplay
│   │               │   │       │   ├── StreakIndicator
│   │               │   │       │   └── BadgeUnlockedToast
│   │               │   └── Content Tabs (dynamic)
│   │               │       ├── ContentRenderer
│   │               │       ├── LiveSession components
│   │               │       ├── DomPathTooltip
│   │               │       └── FeedbackButton
│   │               ├── SkeletonLoader (loading states)
│   │               └── HelpFooter
└── AppConfig (admin only)
    ├── ConfigurationForm
    ├── TermsAndConditions
    └── InteractiveFeatures
```

## Design Patterns

### Grafana Scenes Integration

- Components extend `SceneObjectBase` for state management
- Scenes handle routing and application state
- Clean separation between scene logic and rendering
- Scene activation lifecycle for lazy initialization

### Component Composition

- Small, focused components with single responsibilities
- Props interfaces with TypeScript for type safety
- Consistent naming conventions across components
- Lazy loading for dev tools and large components
- Error boundaries for component-level error isolation

### State Management

- **Grafana Scenes**: Application-level state and routing
- **React Hooks**: Component-level state and side effects
- **Context Providers**: Configuration, feature flags, and session state
- **User Storage**: Persistent state for tabs, progress, and preferences
- **OpenFeature**: Feature flag evaluation and management

### Feature Flags

- OpenFeature SDK integration for runtime feature control
- Feature flags managed centrally in `/src/utils/openfeature.ts`
- Provider wraps entire application for consistent flag evaluation
- Used for gradual rollouts and A/B testing

### Error Handling

- Plugin-level error boundary catches and displays errors gracefully
- Component-specific error boundaries for critical features
- Fallback UIs provide recovery options
- Error reporting integration (Faro) for monitoring

### Testing Strategy

- Centralized test IDs in `testIds.ts`
- Component-level unit testing with React Testing Library
- Integration testing through scene state
- E2E testing with Playwright using test IDs
- Accessibility testing with consistent ARIA labels

### Code Organization

- **Hooks**: Custom hooks in dedicated files (`*.hook.ts`)
- **Styles**: Emotion CSS-in-JS in dedicated files (`*.styles.ts`)
- **Types**: Centralized type definitions in `/src/types/`
- **Utils**: Shared utilities organized by domain

This organization ensures maintainable, testable components that follow Grafana's development patterns while supporting feature experimentation and graceful error handling.
