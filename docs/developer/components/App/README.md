# App Component

The root application component that initializes the plugin and handles top-level routing and state management.

## Files

### `App.tsx`

**Purpose**: Main application entry point and routing setup
**Role**:

- Initializes Grafana Scenes for the plugin
- Sets up routing to documentation pages
- Provides plugin props context to child components
- Creates the main scene app structure

**Key Features**:

- **Scene App Creation**: Creates a `SceneApp` with the docs page route
- **Context Provider**: Wraps the app with `PluginPropsContext` for accessing plugin props
- **Memoized Components**: Includes `MemoizedContextPanel` for performance optimization

**Used By**:

- `src/module.tsx` - Imported as the main app component
- Plugin extensions for sidebar integration

**Dependencies**:

- `@grafana/data` - For `AppRootProps` type
- `@grafana/scenes` - For `SceneApp` state management
- `src/pages/docsPage` - The main docs page scene
- `src/components/App/ContextPanel` - Memoized context panel component
- `src/utils/utils.plugin` - For plugin props context

**Exports**:

- `App` (default) - Main application component
- `MemoizedContextPanel` - Memoized context panel for extensions

## Component Structure

```typescript
function App(props: AppRootProps) {
  const scene = useMemo(() => getSceneApp(), []);

  return (
    <PluginPropsContext.Provider value={props}>
      <scene.Component model={scene} />
    </PluginPropsContext.Provider>
  );
}
```

## Scene Integration

The app creates a scene hierarchy:

```
SceneApp
└── docsPage (SceneAppPage)
    └── EmbeddedScene
        └── SceneFlexLayout
            └── CombinedLearningJourneyPanel
```

## Usage Context

This component serves as the bridge between Grafana's plugin system and the custom documentation features. It:

1. **Receives Plugin Props**: Gets configuration and metadata from Grafana
2. **Initializes Scenes**: Sets up the scene-based state management
3. **Provides Context**: Makes plugin props available throughout the component tree
4. **Handles Routing**: Manages navigation within the plugin

The memoized scene creation ensures optimal performance by preventing unnecessary re-initialization on re-renders.
