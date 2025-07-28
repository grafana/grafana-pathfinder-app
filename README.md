# Grafana Learning Journeys Plugin

![Dynamic JSON Badge](https://img.shields.io/badge/dynamic/json?logo=grafana&query=$.version&url=https://grafana.com/api/plugins/grafana-grafanadocsplugin-app&label=Marketplace&prefix=v&color=F47A20)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

A documentation plugin that provides contextual learning journeys directly within the Grafana interface.

## Overview

The Grafana Learning Journeys Plugin transforms how users interact with documentation by providing:

- **🎯 Context-Aware Recommendations** - suggestions based on current Grafana context (page, data sources, dashboard state)
- **📚 Interactive Learning Journeys** - Step-by-step guided experiences with progress tracking and milestone navigation
- **🗂️ Tabbed Interface** - Browser-like multi-tab experience for simultaneous documentation access
- **🔌 Extensible Architecture** - Decoupled design allowing easy integration with different content sources
- **📱 Responsive Design** - Optimized for sidebar integration with adaptive layouts
- **🚀 Auto-Launch Tutorials** - Automatically open specific tutorials on Grafana startup for demo scenarios

## Architecture

For a comprehensive overview of the plugin's architecture, design patterns, and system organization, see **[ARCHITECTURE.md](./ARCHITECTURE.md)**.

## Auto-Launch Tutorial Feature

Perfect for demo scenarios! The plugin can automatically open a specific tutorial when Grafana starts by setting an environment variable:

```bash
# Docker Compose example
GF_PLUGINS_GRAFANA_GRAFANADOCSPLUGIN_APP_TUTORIAL_URL=https://grafana.com/docs/learning-journeys/linux-server-integration/

# Docker run example  
docker run -d -p 3000:3000 \
  -e GF_PLUGINS_GRAFANA_GRAFANADOCSPLUGIN_APP_TUTORIAL_URL=https://grafana.com/docs/learning-journeys/linux-server-integration/ \
  grafana/grafana:latest
```

📖 **[Complete Auto-Launch Documentation](./AUTO_LAUNCH_TUTORIAL.md)** - Detailed setup guide with examples for Docker, Kubernetes, and more.

## Running the plugin locally

Clone the repository:
```bash
git clone https://github.com/grafana/docs-plugin.git
```

Then build the plugin:

```bash
cd docs-plugin
npm install
npm run build
```

Spin up the development server:
> Note we are currently using main until the next release of Grafana.
```bash
GRAFANA_IMAGE=grafana GRAFANA_VERSION=main npm run server
```

Access the plugin in Grafana at [http://localhost:3000](http://localhost:3000)

## Developer Documentation

This plugin follows a modular, well-documented architecture. Each major component has detailed documentation:

### 📁 **Core Architecture**
- **[Source Overview](src/README.md)** - Complete source code organization and patterns
- **[Component Architecture](src/components/README.md)** - UI component organization and relationships

### 🧩 **Components**
- **[App Component](src/components/App/README.md)** - Root application setup and scene integration
- **[App Configuration](src/components/AppConfig/README.md)** - Admin settings and plugin configuration
- **[Documentation Panel](src/components/docs-panel/README.md)** - Main docs functionality and tabbed interface

### 🔧 **System Architecture**
- **[Pages & Routing](src/pages/README.md)** - Scene-based routing and navigation
- **[Utilities & Hooks](src/utils/README.md)** - Business logic, data fetching, and React hooks
- **[Styling System](src/styles/README.md)** - CSS-in-JS organization and theming
- **[Constants & Configuration](src/constants/README.md)** - Centralized configuration and selectors

### 🎨 **Assets**
- **[Image Assets](src/img/README.md)** - Plugin logos and visual assets

## Development Setup

### Prerequisites

- **Node.js 18+** and npm
- **Grafana 11.0.0** or later  
- **Git**
- **Docker** (for development environment)

### Quick Start

```bash
# Clone the repository
git clone https://github.com/grafana/grafana-docs-plugin.git
cd grafana-docs-plugin

# Install dependencies
npm install

# Build the plugin
npm run build

# Start development environment with Grafana
GRAFANA_IMAGE=jayclifford349/grafana-oss GRAFANA_VERSION=docs npm run server
```

### Development Environment

The plugin includes a complete development setup:

```bash
# Development build with watch mode
npm run dev

# Run tests
npm run test

# Lint code
npm run lint

# Type checking
npm run typecheck

# Build for production
npm run build
```

### Project Structure Deep Dive

For a comprehensive understanding of the project structure, see:

- **[Source Organization](src/README.md)** - Complete overview of the `/src` directory
- **[Component Structure](src/components/README.md)** - UI components and their relationships
- **[Business Logic](src/utils/README.md)** - Hooks, utilities, and data fetching
- **[Styling System](src/styles/README.md)** - CSS-in-JS organization and theming

### Key Technologies

- **⚛️ React** - UI framework with hooks and context
- **🎭 Grafana Scenes** - Scene-based architecture for complex UIs
- **📘 TypeScript** - Full type safety and IntelliSense
- **💅 Emotion** - CSS-in-JS with theme integration
- **🎨 Grafana UI** - Consistent component library
- **🔗 Extension Points** - Grafana plugin integration system

### Configuration Options

#### API Integration

```typescript
// Configure external recommendation service
export const RECOMMENDER_SERVICE_URL = 'http://localhost:8080';

// Custom documentation endpoints
const customEndpoints = {
  apiUrl: 'https://docs.company.com/api',
  apiKey: 'your-secret-key'
};
```

For detailed configuration options, see the [App Configuration README](src/components/AppConfig/README.md).

## API Reference

### Core Classes

For detailed API documentation, see:
- **[Documentation Panel API](src/components/docs-panel/README.md)** - Main panel functionality
- **[Utilities API](src/utils/README.md)** - Business logic and data fetching hooks
- **[Configuration API](src/components/AppConfig/README.md)** - Plugin configuration

## Troubleshooting

### Common Issues

#### Content Loading Problems

```typescript
// Debug content fetching
console.log('Fetching strategies attempted:', strategies);
console.log('Final content result:', content);

// Check network connectivity
fetch(url).then(response => console.log('Direct access:', response.status));
```

#### Recommendation Service Issues

```typescript
// Verify service connectivity
const healthCheck = await fetch(`${RECOMMENDER_SERVICE_URL}/health`);
console.log('Recommender service status:', healthCheck.status);

// Debug context payload
console.log('Context sent to recommender:', payload);
```

#### Cache Issues

```typescript
// Clear all caches manually
clearLearningJourneyCache();
localStorage.clear();
window.location.reload();
```

### Performance Optimization

#### Bundle Size Analysis

```bash
# Analyze bundle composition
npm run build:analyze

# Check for duplicate dependencies
npm run dedupe
```

#### Content Loading Optimization

```typescript
// Implement progressive loading
const preloadNextMilestone = async (content: LearningJourneyContent) => {
  const nextUrl = getNextMilestoneUrl(content);
  if (nextUrl) {
    // Pre-fetch in background
    fetchLearningJourneyContent(nextUrl);
  }
};
```

For more troubleshooting information, see the component-specific documentation linked above.

### Debugging Tips

#### Enable Verbose Logging

```typescript
// Add to console for detailed logging
localStorage.setItem('docs-plugin-debug', 'true');

// Monitor scene state changes
console.log('Scene state:', sceneObject.state);
```

#### Network Request Debugging

```typescript
// Monitor all fetch requests
const originalFetch = window.fetch;
window.fetch = (...args) => {
  console.log('Fetch request:', args);
  return originalFetch(...args);
};
```

## Contributing

### Code Style

- **TypeScript**: Strict mode enabled
- **React**: Functional components with hooks
- **Styling**: Emotion CSS-in-JS with Grafana theme
- **Testing**: Jest + React Testing Library

### Submission Guidelines

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Test** your changes thoroughly
4. **Commit** with conventional commit messages
5. **Push** to your branch (`git push origin feature/amazing-feature`)
6. **Open** a Pull Request

### Development Workflow

```bash
# 1. Set up development environment
npm install
npm run dev

# 2. Make changes and test
npm run test
npm run typecheck
npm run lint

# 3. Build and verify
npm run build
npm run server # Test in Grafana

# 4. Submit changes
git add .
git commit -m "feat: add custom content source support"
git push origin feature/custom-content
```

## License

This project is licensed under the **Apache License 2.0** - see the [LICENSE](LICENSE) file for details.

---

## Quick Links

- 📖 **[Grafana Plugin Development](https://grafana.com/developers/plugin-tools/)**
- 🎭 **[Grafana Scenes Documentation](https://grafana.github.io/scenes/)**
- ⚛️ **[React Best Practices](https://react.dev/learn)**
- 📘 **[TypeScript Handbook](https://www.typescriptlang.org/docs/)**
