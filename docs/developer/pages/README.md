# Pages Directory

Contains Grafana Scenes page definitions that handle app routing and scene composition.

## Files

### `docsPage.ts` ⭐ **Main Documentation Page**

**Purpose**: Primary page definition for the documentation app using Grafana Scenes
**Role**:

- Defines the main route and scene structure for the plugin
- Sets up the embedded scene layout for documentation components
- Handles the plugin's main app page routing

**Key Features**:

- **Scene App Page**: Creates a `SceneAppPage` for integration with Grafana's routing
- **Embedded Scene**: Uses `EmbeddedScene` for self-contained plugin UI
- **Flex Layout**: Implements responsive layout with `SceneFlexLayout`
- **Component Integration**: Embeds the main `CombinedLearningJourneyPanel`

**Scene Hierarchy**:

```typescript
SceneAppPage ('Documentation')
└── EmbeddedScene
    └── SceneFlexLayout
        └── SceneFlexItem (100% width, 600px height)
            └── CombinedLearningJourneyPanel
```

**Configuration**:

- **Title**: "Documentation" - displayed in Grafana's navigation
- **URL Pattern**: Uses `prefixRoute(ROUTES.Context)` for consistent routing
- **Dimensions**: Full width, 600px height for optimal content display

**Routing Integration**:

```typescript
export const docsPage = new SceneAppPage({
  title: 'Documentation',
  url: prefixRoute(ROUTES.Context),
  routePath: prefixRoute(ROUTES.Context),
  getScene: contextScene,
});
```

**Used By**:

- `src/components/App/App.tsx` - Imported and used in the main SceneApp
- Grafana's scene routing system - Handles navigation to the plugin

**Dependencies**:

- `@grafana/scenes` - SceneAppPage, EmbeddedScene, SceneFlexLayout, SceneFlexItem
- `src/utils/utils.routing` - For route prefixing with plugin base URL
- `src/constants` - Route constants (ROUTES.Context)
- `src/components/docs-panel/docs-panel` - Main panel component

**Scene Factory Function**:

```typescript
function contextScene() {
  return new EmbeddedScene({
    body: new SceneFlexLayout({
      children: [
        new SceneFlexItem({
          width: '100%',
          height: 600,
          body: new CombinedLearningJourneyPanel(),
        }),
      ],
    }),
  });
}
```

## Grafana Scenes Integration

### Why Scenes?

- **State Management**: Centralized state handling for complex apps
- **Routing**: Integrates with Grafana's navigation system
- **Performance**: Optimized rendering and updates
- **Consistency**: Follows Grafana's app development patterns

### Scene Benefits

- **Isolation**: EmbeddedScene provides self-contained environment
- **Responsiveness**: FlexLayout adapts to different screen sizes
- **Integration**: Seamless integration with Grafana's UI framework
- **State Persistence**: Automatic state management across navigation

### Route Management

The page uses the plugin's routing utilities:

- **Base URL**: Automatically prefixed with plugin identifier
- **Consistent Paths**: Uses constants for route definitions
- **Navigation**: Integrates with Grafana's location service

## Extension Points

This page definition enables:

- **Main App Access**: Primary entry point for the plugin's full interface
- **Sidebar Integration**: Referenced by sidebar extensions in `module.tsx`
- **Deep Linking**: Direct URLs to plugin functionality
- **State Sharing**: Scene state accessible across the app

The page serves as the foundation for the plugin's user interface, providing a robust, scalable structure for complex documentation features.
