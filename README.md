# Grafana Docs Plugin

![Dynamic JSON Badge](https://img.shields.io/badge/dynamic/json?logo=grafana&query=$.version&url=https://grafana.com/api/plugins/grafana-grafanadocsplugin-app&label=Marketplace&prefix=v&color=F47A20)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

A documentation plugin that provides contextual help and quick access to Grafana resources directly within the Grafana interface.

## Overview

The Grafana Docs Plugin enhances your Grafana experience by providing:

- **Context-Aware Documentation** - Automatically displays relevant documentation based on your current page
- **Tabbed Interface** - Open multiple documentation pages simultaneously with a browser-like tab system
- **Smart Link Handling** - Seamlessly navigate between documentation pages without leaving Grafana
- **Global Sidebar Access** - Available on every Grafana page through the sidebar extension


## Features

### 🎯 Context-Aware Help
The plugin automatically detects what page you're on and shows relevant documentation:
- Dashboard pages → Dashboard documentation
- Explore → Explore documentation  
- Alerting → Alerting documentation
- Data Sources → Data source configuration guides
- And more...

### 📑 Tabbed Interface
- Open multiple documentation pages in tabs
- Browser-like navigation with keyboard shortcuts
- Easy tab management with close buttons
- Persistent tab state during your session

### 🔗 Smart Navigation
- Internal links open within the plugin
- External links open in new browser tabs
- Anchor link support for same-page navigation
- Automatic URL resolution for relative links

## Usage

### Accessing the Documentation Panel

The documentation panel is available in the Grafana top navigation bar.

### Navigation Controls

- **➕ New Tab**: Create a new documentation tab
- **🔗 Open Source**: Open the current page's source in your browser
- **🗑️ Clear Cache**: Refresh all cached documentation
- **🔄 Refresh Context**: Update the current page context

### Keyboard Shortcuts

- `Ctrl/Cmd + T`: Open new tab
- `Ctrl/Cmd + W`: Close current tab
- `Ctrl/Cmd + Tab`: Switch between tabs
- `Escape`: Close image zoom overlay

### Smart Link Handling

The plugin automatically handles different types of links:
- **Documentation links** → Open in new tab within the plugin
- **External links** → Open in new browser tab
- **Anchor links** → Navigate within the current page
- **Relative links** → Resolve and open appropriately

## Configuration

### API Settings (Optional)

For enhanced functionality, you can configure API settings:

1. Go to **Administration** → **Plugins** → **Grafana Docs Plugin**
2. Click **Config**
3. Enter your API settings:
   - **API URL**: Custom documentation API endpoint
   - **API Key**: Authentication key for private documentation

### Supported Documentation Sources

The plugin works with:
- Official Grafana documentation (grafana.com/docs)
- Custom documentation endpoints
- Local documentation servers
- Any HTML-based documentation site

## Development

### Prerequisites

- Node.js 18+ and npm
- Grafana 11.0.0 or later
- Git

### Setup

```bash
# Clone the repository
git clone https://github.com/grafana/grafana-docs-plugin.git
cd grafana-docs-plugin

# Build the plugin
npm run build

# Run development server
GRAFANA_IMAGE=jayclifford349/grafana-oss GRAFANA_VERSION=docs npm run server
```


### Project Structure

```
src/
├── components/
│   ├── App/                 # Main app component
│   ├── AppConfig/           # Plugin configuration
│   └── docs-panel/          # Core documentation panel
├── pages/                   # Scene-based pages
├── utils/                   # Utility functions
│   ├── docs-fetcher.ts      # Documentation fetching logic
│   ├── docs.utils.ts        # Panel utilities
│   └── documentation.utils.tsx # Content utilities
├── img/                     # Assets
├── constants.ts             # App constants
├── module.tsx               # Plugin entry point
└── plugin.json              # Plugin metadata
```

### Key Technologies

- **React** - UI framework
- **Grafana Scenes** - Scene-based architecture
- **TypeScript** - Type safety
- **Emotion** - CSS-in-JS styling
- **Grafana UI** - Component library

## API Reference

### DocsPanel Class

The main panel component with the following methods:

```typescript
class DocsPanel {
  // Create a new documentation tab
  createNewTab(routePath: string, title?: string, makeActive?: boolean): Promise<string>
  
  // Load content for a specific tab
  loadTabContent(tabId: string, routePath: string): Promise<void>
  
  // Close a tab
  closeTab(tabId: string): void
  
  // Set active tab
  setActiveTab(tabId: string): void
  
  // Open internal documentation link
  openInternalLink(url: string): Promise<void>
  
  // Clear documentation cache
  clearCache(): void
  
  // Refresh page context
  refreshContext(): void
}
```

### Documentation Fetcher

```typescript
// Get documentation for a route
getDocsForRoute(routePath: string): Promise<DocsContent | null>

// Detect documentation context
detectDocsContext(currentPath: string): DocsRoute | null

// Clear cached documentation
clearDocsCache(): void
```

## Troubleshooting

### Common Issues

**Documentation not loading**
- Check your internet connection
- Clear the plugin cache using the 🗑️ button
- Verify the documentation URL is accessible

**Images not displaying**
- Images are automatically optimized for the sidebar
- Click on images to view them in full size
- Some images may be blocked by CORS policies

**Links not working**
- Internal documentation links should open within the plugin
- External links open in new browser tabs
- Report any broken links as issues


## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.
