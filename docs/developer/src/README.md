<!-- This README file is going to be the one displayed on the Grafana.com website for your plugin. Uncomment and replace the content here before publishing.

Remove any remaining comments before publishing as these may be displayed on Grafana.com -->

# Grafana Pathfinder - Source Code

This directory contains the complete source code for Grafana Pathfinder, which provides contextual documentation recommendations and interactive learning journeys within Grafana.

## Architecture Overview

The plugin follows a clean, component-based architecture with clear separation of concerns:

- **Components**: React/Scenes components for UI rendering
- **Utils**: Business logic, data fetching, and utility functions
- **Styles**: Organized CSS-in-JS styling with theme support
- **Constants**: Configuration and selector constants
- **Pages**: Scene definitions for app routing

## Folder Structure

### `/components` - UI Components

Contains all React and Grafana Scenes components:

- `App/` - Main application component and scene initialization
- `AppConfig/` - Plugin configuration interface for admin settings
- `docs-panel/` - Core documentation panel components (recommendations and learning journeys)

### `/constants` - Configuration & Constants

- `constants.ts` - Main plugin configuration and API endpoints
- `selectors.ts` - Type-safe CSS selectors and UI configuration constants

### `/img` - Assets

- Static image assets (logos, icons)

### `/pages` - Scene Pages

- Grafana Scenes page definitions for app routing

### `/styles` - Organized Styling

Theme-aware CSS-in-JS styling organized by functionality:

- `docs-panel.styles.ts` - Main component styling functions
- `context-panel.styles.ts` - Context panel specific styling
- `content-html.styles.ts` - Content-specific HTML styling
- `interactive.styles.ts` - Interactive elements styling

### `/utils` - Business Logic & Utilities

Organized by functionality after major refactoring:

- **Data Fetching**: `docs-retrieval/` (unified system), `context/context.service.ts`
- **React Hooks**: `*.hook.ts` files for separated concerns
- **Context System**: `context/context.service.ts`, `context/context.hook.ts`
- **Utilities**: Configuration, routing, and component helpers

## Key Files

### Entry Points

- `module.tsx` - Plugin entry point and extensions registration
- `plugin.json` - Plugin metadata and configuration

### Core Components

- `components/docs-panel/docs-panel.tsx` - Main documentation panel with tabbed interface
- `components/docs-panel/context-panel.tsx` - Context-aware recommendations engine

### Configuration

- `constants.ts` - Central configuration management
- `constants/selectors.ts` - UI selectors and configuration constants

## Development Patterns

### Component Organization

- Main components in `/components` with co-located sub-components
- Clean separation between UI logic and business logic
- Grafana Scenes for state management and routing

### Styling Strategy

- CSS-in-JS with Emotion for runtime styling
- Theme-aware styling using Grafana's design system
- Organized style functions in `/styles` directory by component and functionality

### State Management

- Grafana Scenes for application state and routing
- React hooks for component-level state and business logic
- Context API for plugin-wide configuration and props

### Code Organization Post-Refactor

The codebase was extensively refactored to improve maintainability:

- **Before**: ~3,500 line monolithic component
- **After**: Organized into focused, reusable modules
- **Separation**: UI, business logic, styling, and utilities clearly separated
- **Hooks Architecture**: Business logic extracted into custom React hooks
- **Performance**: Better tree-shaking and code splitting potential

#### Refactoring Benefits

- **Maintainability**: Easy to find and modify specific functionality
- **Testability**: Individual functions and hooks can be unit tested
- **Reusability**: Hooks and utilities can be used across components
- **Performance**: Optimized bundle size and runtime performance
- **Developer Experience**: Better IntelliSense and type safety

### Hook-Based Architecture

The refactor introduced a clean hook-based architecture:

- `useInteractiveElements()` - Interactive tutorial functionality
- `useContentProcessing()` - Content enhancement and processing
- `useKeyboardShortcuts()` - Navigation shortcuts
- `useLinkClickHandler()` - Link and interaction handling
- `useContextPanel()` - Context analysis and recommendations with real-time detection

### Context System Enhancements

The context system now includes sophisticated real-time detection:

- **DOM Mutation Observation**: Watches for changes to visualization picker and datasource picker elements
- **Automatic Context Refresh**: Triggers recommendations refresh when context changes
- **Enhanced Tag Generation**: Includes both visualization type and selected datasource in context tags
- **Precise Element Detection**: Uses exact element selectors for reliable detection

This organization makes the codebase more maintainable, testable, and easier for new developers to understand.

## Tech Stack Integration

### Grafana Integration

- **Scenes**: For complex state management and routing
- **Extension Points**: Sidebar and navigation integration
- **Theme System**: Consistent styling with Grafana's design tokens
- **UI Components**: Leverages Grafana's component library

### React Patterns

- **Functional Components**: Modern React with hooks
- **Custom Hooks**: Business logic separation
- **Context API**: Plugin-wide state and configuration
- **Memoization**: Performance optimization with useMemo/useCallback

### TypeScript

- **Strict Mode**: Full type safety enabled
- **Interface Contracts**: Well-defined component and data contracts
- **Utility Types**: Leverages TypeScript's advanced type system

This architecture ensures the plugin is scalable, maintainable, and follows modern React and Grafana development best practices.

## Current Context Tags Map

Looking at the `context-analysis.ts` code, here's a comprehensive list of all the tag types that can be derived:

### **Primary Entity:Action Tags**

```
dashboard:create|edit|view|configure|delete|import|export
datasource:create|edit|view|configure|test|delete
explore:query
alert:create|edit|view|configure|delete
admin:create|edit|view|configure|delete
plugin:create|edit|view|configure
app:create|edit|view|configure
connection:create|edit|view|configure
```

### **Dashboard Context Tags**

```
dashboard-tag:{tag-name}           # e.g., dashboard-tag:monitoring
panel:create|edit|view
panel-type:{viz-type}             # e.g., panel-type:timeseries, panel-type:state-timeline
selected-datasource:{name}        # e.g., selected-datasource:prometheus, selected-datasource:gdev-testdata
```

### **Datasource Context Tags**

```
datasource-type:{type}            # e.g., datasource-type:prometheus, datasource-type:elasticsearch
available-datasource:{type}       # Only shown during create/view actions
```

### **Explore Context Tags**

```
explore:query
explore:split-view
query-type:{datasource-type}      # e.g., query-type:prometheus, query-type:elasticsearch
```

### **Alert Context Tags**

```
alert-type:alerting|recording
alert-rule:create|edit|view|configure|delete
alert-notification:create|edit|view|configure|delete
alert-group:create|edit|view|configure|delete
alert-silence:create|edit|view|configure|delete
```

### **Admin Context Tags**

```
admin-users:create|edit|view|configure|delete
admin-orgs:create|edit|view|configure|delete
admin-plugins:create|edit|view|configure|delete
admin-settings:create|edit|view|configure|delete
```

### **Plugin Context Tags**

```
plugin:app|datasource|panel
plugin-app:{plugin-id}
plugin-datasource:{plugin-id}
plugin-panel:{plugin-id}
```

### **App Context Tags**

```
app:view|configure
app-type:{short-name}             # e.g., app-type:metricsdrilldown, app-type:logs
```

### **UI Context Tags**

```
ui:tabbed
ui:fullscreen
ui:kiosk
dashboard:variables
```

## 📊 **Tag Pattern Examples**

**Dashboard editing with timeseries panel:**

```javascript
['dashboard:edit', 'panel:edit', 'panel-type:timeseries', 'selected-datasource:prometheus'];
```

**Datasource configuration:**

```javascript
['datasource:edit', 'datasource-type:prometheus'];
```

**Explore with multiple datasources:**

```javascript
['explore:query', 'explore:split-view', 'query-type:prometheus', 'query-type:elasticsearch'];
```

**Alert rule creation:**

```javascript
['alert:create', 'alert-type:alerting', 'alert-rule:create'];
```

**App usage:**

```javascript
['app:view', 'app-type:metricsdrilldown'];
```

**Panel creation with datasource selection:**

```javascript
['dashboard:edit', 'panel:create', 'panel-type:state-timeline', 'selected-datasource:gdev-testdata'];
```

## 🎯 **Total Tag Universe**

- **~15 primary entities** × **~8 actions** = **~120 entity:action combinations**
- **~25 known datasource types** for `datasource-type:` and `query-type:` tags
- **~50+ visualization types** for `panel-type:` tags
- **Dynamic datasource names** for `selected-datasource:` tags (real-time detection)
- **Hundreds of possible app types** for `app-type:` tags
- **Dynamic dashboard tags** based on user-defined dashboard tags

**Result**: The system can generate **thousands of unique, contextually relevant tags** to provide precise recommendations to users based on their current Grafana context.

### **Real-Time Context Detection**

The context system now includes real-time detection of:

- **Visualization Type**: Automatically detects the currently selected visualization type from the viz picker button
- **Selected Datasource**: Automatically detects the currently selected datasource from the datasource picker
- **Context Changes**: Triggers recommendations refresh when visualization type or datasource selection changes
