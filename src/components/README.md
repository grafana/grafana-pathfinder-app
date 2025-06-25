# Components Directory

This directory contains all React and Grafana Scenes components that make up the plugin's user interface.

## Component Architecture

The components are organized into logical groups with clear responsibilities:

### Main Application Components
- **App/**: Root application component and routing logic
- **AppConfig/**: Plugin configuration interface for admin settings
- **docs-panel/**: Core documentation features (recommendations, learning journeys)

## Component Files

### `testIds.ts`
**Purpose**: Centralized test identifiers for automated testing
**Role**: Provides consistent data-testid attributes for UI testing
**Used By**: 
- `AppConfig/AppConfig.tsx` - Configuration form testing
- Any component requiring test automation

**Exports**:
- `testIds.appConfig` - Test IDs for configuration form elements

---

## Subdirectories

### `/App` - Main Application
Contains the root application component that handles plugin initialization and routing.

### `/AppConfig` - Configuration Interface  
Contains the admin configuration component for setting up plugin parameters like API endpoints and authentication.

### `/docs-panel` - Core Documentation Features
Contains the main documentation functionality including:
- Context-aware recommendations
- Interactive learning journeys  
- Document viewer
- Tabbed interface for multiple content types

## Component Relationships

```
App (root)
├── AppConfig (admin only)
└── docs-panel/
    ├── context-panel (recommendations)
    └── docs-panel (main viewer)
```

## Design Patterns

### Grafana Scenes Integration
- Components extend `SceneObjectBase` for state management
- Scenes handle routing and application state
- Clean separation between scene logic and rendering

### Component Composition
- Small, focused components with single responsibilities
- Props interfaces for type safety
- Consistent naming conventions

### State Management
- Scenes for application-level state
- React hooks for component-level state
- Context providers for configuration

### Testing Strategy
- Centralized test IDs in `testIds.ts`
- Component-level testing with consistent selectors
- Integration testing through scene state

This organization ensures maintainable, testable components that follow Grafana's development patterns. 