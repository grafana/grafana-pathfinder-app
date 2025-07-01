# Tech Context

## Technologies Used

- **Frontend**: React 18.2.0 + TypeScript 5.5.4 + Grafana Scenes 6.10.4
- **Styling**: Emotion CSS-in-JS with Grafana UI theming system
- **State Management**: Grafana Scenes for complex scene-based state
- **Bundling**: Webpack 5.94.0 with custom configuration
- **Testing**: Jest 29.5.0 + React Testing Library + Playwright for E2E
- **Runtime**: Node.js 22+ with npm 11.4.1 package management

## Development Setup

- **Build System**: Webpack with TypeScript, SWC compilation, and hot reloading
- **Dev Environment**: Docker Compose with Grafana OSS for local testing
- **Scripts**: `npm run dev` (watch mode), `npm run build` (production), `npm run server` (Docker)
- **Code Quality**: ESLint + Prettier with Grafana configs, TypeScript strict mode
- **Testing**: `npm run test` (Jest), `npm run e2e` (Playwright), `npm run typecheck`

## Technical Constraints

- **Grafana Version**: Requires Grafana 12.0.0+ for extension points compatibility
- **Plugin Architecture**: Must use Grafana's app plugin structure with `plugin.json`
- **Extension Points**: Limited to `grafana/extension-sidebar/v0-alpha` integration
- **Browser Support**: Modern browsers only (ES2020+), no IE support
- **Bundle Size**: Webpack optimization required for performance in Grafana context

## Dependencies

**Core Runtime**:
- `@grafana/data`, `@grafana/ui`, `@grafana/runtime`, `@grafana/scenes` (12.0.2)
- `react` + `react-dom` (18.2.0), `react-router-dom` (6.22.0)
- `@emotion/css` (11.10.6) for styling

**Development**:
- `typescript` (5.5.4), `webpack` + loaders, `jest` + testing utilities
- `@grafana/eslint-config`, `@playwright/test`, `@swc/core` for compilation
- `sass`, `terser-webpack-plugin` for asset processing

## Project Version & Release Management

- **Current Version**: 1.0.2 (Post-Refactoring Release)
- **License**: Apache-2.0
- **Package Manager**: npm@11.4.1 with lockfile-based dependency management
- **Release Strategy**: Semantic versioning with automated plugin signing

## Tool Usage Patterns

- **TypeScript**: Strict mode with comprehensive type definitions for all components
- **Component Architecture**: Functional components with hooks, no class components
- **Styling**: Emotion CSS-in-JS with `useStyles2` hook and Grafana theme integration
- **Testing Strategy**: Unit tests with Jest, component tests with RTL, E2E with Playwright
- **Code Organization**: Feature-based modules with clear separation of concerns (components/utils/styles)
- **Build Pipeline**: Development with watch mode, production with optimization and signing

## Post-Refactoring Architecture

- **Modular Design**: Clean separation between UI components, business logic hooks, and styling
- **Hook-Based Logic**: Business logic extracted into focused, reusable React hooks
- **Type Safety**: Comprehensive TypeScript integration with strict mode enabled
- **Performance Optimization**: Tree-shaking friendly architecture with optimized bundle splitting
- **Maintainability**: Each module has single responsibility with clear interfaces
