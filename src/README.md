<!-- This README file is going to be the one displayed on the Grafana.com website for your plugin. Uncomment and replace the content here before publishing.

Remove any remaining comments before publishing as these may be displayed on Grafana.com -->

# Grafana Docs Plugin - Source Code

This directory contains the complete source code for the Grafana Docs Plugin, which provides contextual documentation recommendations and interactive learning journeys within Grafana.

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
- **Data Fetching**: `docs-fetcher.ts`, `single-docs-fetcher.ts`, `context-data-fetcher.ts`
- **React Hooks**: `*.hook.ts` files for separated concerns
- **Context Analysis**: `context-analysis.ts`, `context-panel.hook.ts`
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
- `useContextPanel()` - Context analysis and recommendations

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
