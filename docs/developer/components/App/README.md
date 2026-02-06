# App Component

The root application component that initializes the plugin, handles error boundaries, integrates feature flags, and manages top-level routing and state management.

## Files

### `App.tsx`

**Purpose**: Main application entry point with robust error handling and routing setup
**Location**: `/src/components/App/App.tsx`
**Role**:

- Initializes Grafana Scenes for the plugin
- Provides error boundary for graceful error recovery
- Integrates OpenFeature provider for feature flags
- Sets up routing to documentation pages
- Provides plugin props context to child components
- Initializes plugin lifecycle hooks

**Key Features**:

- **Error Boundary**: `PluginErrorBoundary` component catches and handles rendering errors
  - Prevents white screen of death
  - Displays user-friendly error fallback UI
  - Provides "Try Again" and "Refresh Page" recovery options
  - Logs errors to console for debugging
- **Feature Flags**: Wraps app with `PathfinderFeatureProvider` for OpenFeature integration
- **Scene App Creation**: Creates a `SceneApp` with the docs page route
- **Configuration Management**: Initializes global plugin configuration
- **Plugin Lifecycle**: Calls `onPluginStart()` for initialization tasks
- **Context Providers**: Multiple providers for plugin props, feature flags, and configuration
- **Memoized Scene**: Optimizes scene creation with `useMemo`

**Used By**:

- `src/module.tsx` - Imported as the main app component
- Plugin extensions for sidebar integration

**Dependencies**:

- `@grafana/data` - For `AppRootProps` type and plugin context
- `@grafana/scenes` - For `SceneApp` state management
- `@grafana/ui` - For error UI components (Button, useStyles2)
- `src/pages/docsPage` - The main docs page scene
- `src/utils/utils.plugin` - For plugin props context
- `src/constants` - For configuration management
- `src/context-engine` - For plugin initialization
- `../OpenFeatureProvider` - For feature flag provider

**Exports**:

- `App` (default) - Main application component with error boundary

### `ContextPanel.tsx`

**Purpose**: Memoized context panel wrapper for plugin extensions
**Location**: `/src/components/App/ContextPanel.tsx`
**Role**:

- Creates and memoizes `CombinedLearningJourneyPanel` instance
- Optimizes performance by preventing unnecessary re-initialization
- Provides consistent panel instance across re-renders

**Used By**:

- Plugin sidebar extensions
- App component for panel integration

**Dependencies**:

- `@grafana/data` - For plugin context
- `src/components/docs-panel/docs-panel` - For panel implementation
- `src/constants` - For configuration

**Exports**:

- `MemoizedContextPanel` (default) - Memoized context panel component

## Component Structure

```typescript
function App(props: AppRootProps) {
  const scene = useMemo(() => getSceneApp(), []);
  const config = useMemo(() => getConfigWithDefaults(props.meta.jsonData || {}), [props.meta.jsonData]);

  // Set global config for module-level utilities
  useEffect(() => {
    (window as any).__pathfinderPluginConfig = config;
  }, [config]);

  // Initialize plugin lifecycle
  useEffect(() => {
    onPluginStart();
  }, []);

  return (
    <PathfinderFeatureProvider>
      <PluginPropsContext.Provider value={props}>
        <PluginErrorBoundary>
          <scene.Component model={scene} />
        </PluginErrorBoundary>
      </PluginPropsContext.Provider>
    </PathfinderFeatureProvider>
  );
}
```

## Error Boundary Implementation

The `PluginErrorBoundary` class component:

- Catches errors in the component tree using `componentDidCatch`
- Updates state with error information
- Renders `ErrorFallback` component when errors occur
- Provides recovery mechanisms (retry and refresh)
- Logs errors for debugging

## Scene Integration

The app creates a scene hierarchy:

```
SceneApp
└── docsPage (SceneAppPage)
    └── EmbeddedScene
        └── SceneFlexLayout
            └── CombinedLearningJourneyPanel
                ├── Context Panel (recommendations)
                ├── My Learning Tab
                └── Content Tabs (dynamic)
```

## Usage Context

This component serves as the bridge between Grafana's plugin system and the custom documentation features. It:

1. **Receives Plugin Props**: Gets configuration and metadata from Grafana
2. **Initializes Error Handling**: Wraps the entire app in error boundary
3. **Enables Feature Flags**: Provides OpenFeature context for flag evaluation
4. **Initializes Scenes**: Sets up the scene-based state management
5. **Provides Context**: Makes plugin props available throughout the component tree
6. **Handles Routing**: Manages navigation within the plugin
7. **Manages Configuration**: Initializes and distributes plugin configuration
8. **Lifecycle Management**: Triggers plugin initialization tasks

## Error Recovery

When errors occur, users see:

- Clear error message explaining what happened
- Error details (error message) for debugging
- "Try Again" button to reset error boundary
- "Refresh Page" button to reload the entire plugin

This ensures users never see a white screen and always have a path to recovery.

## Configuration Flow

1. Plugin props received from Grafana
2. Configuration merged with defaults
3. Global config set on window object for utilities
4. Config distributed via context to components
5. Plugin initialization triggered via `onPluginStart()`
