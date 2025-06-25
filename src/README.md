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
- `App/` - Main application component and routing
- `AppConfig/` - Plugin configuration interface
- `docs-panel/` - Core documentation panel components

### `/constants` - Configuration & Constants
- `constants.ts` - Main plugin configuration and API endpoints
- `selectors.ts` - Type-safe CSS selectors and configuration constants

### `/img` - Assets
- Static image assets (logos, icons)

### `/pages` - Scene Pages
- Grafana Scenes page definitions for app routing

### `/styles` - Organized Styling
- `docs-panel.styles.ts` - Main component styling functions
- `content-html.styles.ts` - Content-specific HTML styling

### `/utils` - Business Logic & Utilities
Organized by functionality:
- **Data Fetching**: `docs-fetcher.ts`, `single-docs-fetcher.ts`
- **React Hooks**: `*.hook.ts` files for separated concerns
- **Utilities**: Configuration, routing, and component helpers

## Key Files

### Entry Points
- `module.tsx` - Plugin entry point and extensions registration
- `plugin.json` - Plugin metadata and configuration

### Core Components
- `components/docs-panel/docs-panel.tsx` - Main documentation panel (post-refactor)
- `components/docs-panel/context-panel.tsx` - Context-aware recommendations

### Configuration
- `constants.ts` - Central configuration management
- `constants/selectors.ts` - UI selectors and constants

## Development Patterns

### Component Organization
- Main components in `/components` with co-located sub-components
- Clean separation between UI logic and business logic
- Grafana Scenes for state management and routing

### Styling Strategy
- CSS-in-JS with Emotion
- Theme-aware styling using Grafana's design system
- Organized style functions in `/styles` directory

### State Management
- Grafana Scenes for application state
- React hooks for component-level state
- Context API for plugin-wide configuration

### Code Organization Post-Refactor
The codebase was extensively refactored to improve maintainability:
- **Before**: ~3,500 line monolithic component
- **After**: Organized into focused, reusable modules
- **Separation**: UI, business logic, styling, and utilities clearly separated

This organization makes the codebase more maintainable, testable, and easier for new developers to understand.
