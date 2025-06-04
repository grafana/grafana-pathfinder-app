# Grafana Learning Journeys Plugin

![Dynamic JSON Badge](https://img.shields.io/badge/dynamic/json?logo=grafana&query=$.version&url=https://grafana.com/api/plugins/grafana-grafanadocsplugin-app&label=Marketplace&prefix=v&color=F47A20)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

A sophisticated documentation plugin that provides contextual learning journeys and intelligent help recommendations directly within the Grafana interface, designed with a decoupled architecture for easy customization and extension.

## Overview

The Grafana Learning Journeys Plugin transforms how users interact with documentation by providing:

- **🎯 Context-Aware Recommendations** - AI-powered suggestions based on current Grafana context (page, data sources, dashboard state)
- **📚 Interactive Learning Journeys** - Step-by-step guided experiences with progress tracking and milestone navigation
- **🗂️ Tabbed Interface** - Browser-like multi-tab experience for simultaneous documentation access
- **🔌 Extensible Architecture** - Decoupled design allowing easy integration with different content sources
- **📱 Responsive Design** - Optimized for sidebar integration with adaptive layouts

## Running the plugin locally

Clone the repository:
```bash
git clone https://github.com/grafana/docs-plugin.git
```

Also clone the Grafana recommender service:

```bash
git clone https://github.com/grafana/grafana-recommender.git
```

First run the recommender service:

```bash
cd grafana-recommender
docker compose up -d
```

Then build the plugin:

```bash
cd docs-plugin
npm install
npm run build
```

Spin up the development server:
> Note we currently use a custom image due to the hard coding of the side panel activiation.
```bash
GRAFANA_IMAGE=jayclifford349/grafana-oss GRAFANA_VERSION=docs2 npm run server
```

Access the plugin in Grafana at [http://localhost:3000](http://localhost:3000)

## Architecture Overview

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Grafana Core Application                     │
├─────────────────────────────────────────────────────────────────┤
│                     Plugin Extension Points                    │
│  ┌───────────────────┐    ┌─────────────────────────────────┐   │
│  │  Sidebar Component│    │       Navigation Links         │   │
│  └───────────────────┘    └─────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
            │                               │
            ▼                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Learning Journeys Plugin                    │
│                                                                 │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────┐ │
│  │  Context Panel  │    │  Journey Panel  │    │   App Core  │ │
│  │                 │    │                 │    │             │ │
│  │ • Recommendations│    │ • Tab Management│    │ • Routing   │ │
│  │ • Context Detection│  │ • Content Display│   │ • State     │ │
│  │ • User Interaction │  │ • Navigation    │    │ • Config    │ │
│  └─────────────────┘    └─────────────────┘    └─────────────┘ │
│            │                       │                     │     │
│            └───────────────────────┼─────────────────────┘     │
│                                    │                           │
└────────────────────────────────────┼───────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Data Layer (Decoupled)                    │
│                                                                 │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────┐ │
│  │  Docs Fetcher   │    │ Recommender API │    │   Cache     │ │
│  │                 │    │                 │    │             │ │
│  │ • Content Fetch │    │ • Context Analysis│   │ • In-Memory │ │
│  │ • HTML Parsing  │    │ • ML Recommendations│ │ • Persistent│ │
│  │ • URL Resolution│    │ • Journey Mapping │   │ • Invalidation│ │
│  └─────────────────┘    └─────────────────┘    └─────────────┘ │
│            │                       │                     │     │
│            └───────────────────────┼─────────────────────┘     │
│                                    │                           │
└────────────────────────────────────┼───────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                    External Data Sources                       │
│                                                                 │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────┐ │
│  │ Grafana.com Docs│    │  Custom CMS     │    │  Local Docs │ │
│  │ Learning Journeys│    │ Documentation   │    │   Files     │ │
│  └─────────────────┘    └─────────────────┘    └─────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Component Architecture

The plugin follows a modular, scene-based architecture using Grafana Scenes:

#### Core Components

1. **App Component** (`src/components/App/App.tsx`)
   - Entry point and context provider
   - Initializes the scene-based architecture
   - Manages global plugin state

2. **Combined Learning Journey Panel** (`src/components/docs-panel/docs-panel.tsx`)
   - Main orchestrator component
   - Manages tab lifecycle and navigation
   - Handles content loading and error states
   - Coordinates between recommendations and journey content

3. **Context Panel** (`src/components/docs-panel/context-panel.tsx`)
   - Analyzes current Grafana context (page, data sources, dashboard state)
   - Communicates with recommendation service
   - Displays contextual learning journey suggestions
   - Handles user interaction for journey initiation

4. **Docs Fetcher** (`src/utils/docs-fetcher.ts`)
   - **Decoupled content retrieval system**
   - Handles multiple fetching strategies (direct, proxy-based)
   - Parses and transforms HTML content
   - Manages caching and milestone extraction

## How the Plugin Operates

### 1. Initialization Flow

```
User Opens Grafana
        │
        ▼
Plugin Loads via Extension Points
        │
        ▼
Context Panel Analyzes Current State
    • Current URL/Path
    • Active Data Sources  
    • Dashboard Information
    • User Session Data
        │
        ▼
Recommendation Service Called
    • Sends context payload
    • Receives relevant journeys
    • Pre-fetches milestone information
        │
        ▼
UI Renders with Recommendations
```

### 2. User Interaction Flow

```
User Clicks "Start Journey"
        │
        ▼
New Tab Created
    • Generates unique tab ID
    • Sets initial loading state
    • Adds to tab collection
        │
        ▼
Content Fetching Initiated
    • docs-fetcher.fetchLearningJourneyContent()
    • Multiple strategy fallback system
    • HTML parsing and transformation
        │
        ▼
Content Rendered
    • Milestone progress indicator
    • Interactive content with fixed assets
    • Navigation controls
    • Video integration
        │
        ▼
User Navigates Through Milestones
    • Previous/Next milestone buttons
    • Direct milestone jumping
    • Progress tracking
    • Cache optimization
```

### 3. Data Flow Architecture

```
┌─────────────────┐    Context Analysis    ┌─────────────────┐
│  Context Panel  │ ──────────────────────→ │ Recommender API │
│                 │                        │                 │
│ • Page Detection│ ←──────────────────────  │ • ML Processing │
│ • Data Sources  │   Journey Suggestions   │ • Journey Map   │
│ • Dashboard Info│                        │ • Relevance     │
└─────────────────┘                        └─────────────────┘
        │                                           │
        │ User Selects Journey                      │
        ▼                                           │
┌─────────────────┐    Content Request     ┌─────────────────┐
│  Journey Panel  │ ──────────────────────→ │  Docs Fetcher   │
│                 │                        │                 │
│ • Tab Manager   │ ←──────────────────────  │ • Multi-Strategy│
│ • UI Renderer   │    Processed Content    │ • HTML Parser   │
│ • Navigation    │                        │ • Asset Fixer   │
└─────────────────┘                        └─────────────────┘
                                                   │
                                                   │ Raw Content
                                                   ▼
                                          ┌─────────────────┐
                                          │ Content Sources │
                                          │                 │
                                          │ • Grafana Docs  │
                                          │ • Custom CMS    │
                                          │ • Local Files   │
                                          └─────────────────┘
```

## Docs Fetcher: Decoupled Architecture

### Design Philosophy

The docs fetcher is intentionally designed as a **decoupled, pluggable system** that can be easily replaced or extended without affecting the rest of the plugin. This enables teams to:

- **Replace content sources** (switch from Grafana.com to internal docs)
- **Customize content processing** (add custom parsing logic)
- **Implement different fetching strategies** (GraphQL, REST APIs, file systems)
- **Maintain UI functionality** (all existing features continue to work)

### Interface Contracts

The decoupling is achieved through well-defined TypeScript interfaces that act as contracts:

```typescript
// Core data structures that UI components depend on
export interface LearningJourneyContent {
  title: string;              // Display title
  content: string;            // Processed HTML content  
  url: string;                // Source URL
  currentMilestone: number;   // Progress indicator
  totalMilestones: number;    // Total steps
  milestones: Milestone[];    // Navigation structure
  lastFetched: string;        // Cache metadata
  videoUrl?: string;          // Optional video content
}

export interface Milestone {
  number: number;             // Step sequence
  title: string;              // Step name
  duration: string;           // Estimated time
  url: string;                // Step URL
  isActive: boolean;          // Current step indicator
}
```

### Current Implementation

#### Multi-Strategy Fetching System

The current fetcher implements a resilient approach with multiple fallback strategies:

```typescript
export async function fetchLearningJourneyContent(url: string): Promise<LearningJourneyContent | null> {
  // Strategy 1: Direct fetch (fastest)
  // Strategy 2: CORS proxy (corsproxy.io)  
  // Strategy 3: Additional proxies (extensible)
  
  const strategies = [
    { name: 'direct', fn: () => fetchDirectFast(url) },
    { name: 'corsproxy', fn: () => fetchWithCorsproxy(url) },
    // Easy to add more strategies here
  ];
  
  // Try each strategy until one succeeds
  for (const strategy of strategies) {
    try {
      const content = await strategy.fn();
      if (content) {
        return extractLearningJourneyContent(content, url);
      }
    } catch (error) {
      // Continue to next strategy
    }
  }
  
  return null;
}
```

#### Content Processing Pipeline

```
Raw HTML Input
      │
      ▼
┌─────────────────┐
│  DOM Parsing    │ ← DOMParser creates document
└─────────────────┘
      │
      ▼
┌─────────────────┐
│ Title Extraction│ ← h1, title elements
└─────────────────┘
      │
      ▼
┌─────────────────┐
│Milestone Parsing│ ← .journey-steps navigation
└─────────────────┘
      │
      ▼
┌─────────────────┐
│Content Cleaning │ ← Remove navigation, fix assets
└─────────────────┘
      │
      ▼
┌─────────────────┐
│ Video Extraction│ ← YouTube embeds, video links
└─────────────────┘
      │
      ▼
┌─────────────────┐
│  URL Resolution │ ← Fix relative links/images
└─────────────────┘
      │
      ▼
LearningJourneyContent Output
```

### Replacing the Docs Fetcher

To integrate with a different content source, follow these steps:

#### 1. Implement the Same Interface

Create a new fetcher that returns the same data structures:

```typescript
// Example: Custom API fetcher
export async function fetchFromCustomAPI(journeyId: string): Promise<LearningJourneyContent | null> {
  try {
    const response = await fetch(`/api/v1/learning-journeys/${journeyId}`);
    const data = await response.json();
    
    // Transform your API response to match the interface
    return {
      title: data.name,
      content: data.htmlContent,
      url: data.canonicalUrl,
      currentMilestone: data.progress.current,
      totalMilestones: data.progress.total,
      milestones: data.steps.map(step => ({
        number: step.order,
        title: step.name,
        duration: step.estimatedDuration,
        url: step.url,
        isActive: step.order === data.progress.current
      })),
      lastFetched: new Date().toISOString(),
      videoUrl: data.videoUrl
    };
  } catch (error) {
    console.error('Custom API fetch failed:', error);
    return null;
  }
}
```

#### 2. Replace Function Calls

Update the import statements in the UI components:

```typescript
// In docs-panel.tsx and context-panel.tsx
// Replace:
import { fetchLearningJourneyContent } from '../../utils/docs-fetcher';

// With:
import { fetchFromCustomAPI as fetchLearningJourneyContent } from '../../utils/custom-fetcher';
```

#### 3. Maintain Navigation Helpers

Implement equivalent navigation functions:

```typescript
export function getNextMilestoneUrl(content: LearningJourneyContent): string | null {
  // Your custom logic for determining next step
  const currentIndex = content.milestones.findIndex(m => m.isActive);
  const nextMilestone = content.milestones[currentIndex + 1];
  return nextMilestone?.url || null;
}

export function getPreviousMilestoneUrl(content: LearningJourneyContent): string | null {
  // Your custom logic for determining previous step
  const currentIndex = content.milestones.findIndex(m => m.isActive);
  const prevMilestone = content.milestones[currentIndex - 1];
  return prevMilestone?.url || null;
}
```

#### 4. Custom Caching Strategy (Optional)

Implement caching that suits your data source:

```typescript
// Example: Local storage with longer TTL for API responses
const cache = new Map<string, { content: LearningJourneyContent; timestamp: number }>();
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes for API responses

export function clearCustomCache(): void {
  cache.clear();
  // Clear any additional storage
}
```

### Integration Examples

#### Database-Driven Content

```typescript
export async function fetchFromDatabase(journeySlug: string): Promise<LearningJourneyContent | null> {
  const journey = await db.learningJourneys.findBySlug(journeySlug);
  const milestones = await db.milestones.findByJourneyId(journey.id);
  
  return {
    title: journey.title,
    content: await renderMarkdownToHtml(journey.content),
    url: `/journeys/${journey.slug}`,
    currentMilestone: 0,
    totalMilestones: milestones.length,
    milestones: milestones.map(m => ({
      number: m.order,
      title: m.title,
      duration: m.duration,
      url: `/journeys/${journey.slug}/step/${m.order}`,
      isActive: false
    })),
    lastFetched: new Date().toISOString()
  };
}
```

#### File System Content

```typescript
export async function fetchFromFileSystem(filePath: string): Promise<LearningJourneyContent | null> {
  const content = await fs.readFile(filePath, 'utf-8');
  const frontMatter = parseFrontMatter(content);
  const htmlContent = await markdownToHtml(frontMatter.content);
  
  return {
    title: frontMatter.title,
    content: htmlContent,
    url: `file://${filePath}`,
    currentMilestone: frontMatter.currentStep || 0,
    totalMilestones: frontMatter.steps?.length || 1,
    milestones: frontMatter.steps || [],
    lastFetched: new Date().toISOString()
  };
}
```

### Benefits of This Architecture

1. **🔄 Easy Migration**: Switch content sources without UI changes
2. **🧪 A/B Testing**: Test different content delivery methods
3. **🔒 Security**: Implement custom authentication/authorization  
4. **⚡ Performance**: Optimize for your specific data source
5. **🎨 Customization**: Add custom content processing logic
6. **📊 Analytics**: Integrate custom tracking and metrics
7. **🌐 Localization**: Implement multi-language content delivery

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

```
src/
├── components/
│   ├── App/
│   │   └── App.tsx                    # Root component, scene initialization
│   ├── AppConfig/
│   │   └── AppConfig.tsx              # Plugin configuration UI
│   └── docs-panel/
│       ├── docs-panel.tsx             # Main journey panel with tabs
│       └── context-panel.tsx          # Recommendations and context analysis
├── pages/
│   └── docsPage.ts                    # Scene-based page definition
├── utils/
│   ├── docs-fetcher.ts                # 🔌 DECOUPLED: Content fetching system
│   ├── docs.utils.ts                  # React hooks and utilities
│   ├── utils.plugin.ts                # Plugin context management
│   └── utils.routing.ts               # URL and routing helpers
├── img/                               # Assets and icons
├── constants.ts                       # Configuration constants
├── module.tsx                         # Plugin entry point and extensions
└── plugin.json                       # Plugin metadata and capabilities
```

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

#### Content Sources

```typescript
// Supported content source configurations
const contentSources = {
  grafanaDocs: 'https://grafana.com/docs/',
  internalDocs: 'https://internal.company.com/docs/',
  localDocs: '/opt/docs/',
  cmsEndpoint: 'https://cms.company.com/api/v1/'
};
```

## API Reference

### Core Classes

#### `CombinedLearningJourneyPanel`

Main orchestrator for the tabbed journey experience:

```typescript
class CombinedLearningJourneyPanel {
  // Tab Management
  openLearningJourney(url: string, title?: string): Promise<string>
  closeTab(tabId: string): void
  setActiveTab(tabId: string): void
  
  // Content Loading
  loadTabContent(tabId: string, url: string): Promise<void>
  
  // Navigation
  navigateToNextMilestone(): Promise<void>
  navigateToPreviousMilestone(): Promise<void>
  
  // Cache Management
  clearCache(): void
  
  // State Access
  getActiveTab(): LearningJourneyTab | null
  canNavigateNext(): boolean
  canNavigatePrevious(): boolean
}
```

#### `ContextPanel`

Manages contextual recommendations:

```typescript
class ContextPanel {
  // Context Analysis
  updateContext(): Promise<void>
  refreshContext(): void
  
  // Recommendations
  fetchRecommendations(): Promise<void>
  refreshRecommendations(): void
  
  // User Actions
  openLearningJourney(url: string, title: string): void
  toggleStepsExpansion(index: number): Promise<void>
  
  // Navigation
  navigateToPath(path: string): void
}
```

### Utility Functions

#### Content Fetching (Decoupled Interface)

```typescript
// Primary content fetching function
fetchLearningJourneyContent(url: string): Promise<LearningJourneyContent | null>

// Navigation helpers
getNextMilestoneUrl(content: LearningJourneyContent): string | null
getPreviousMilestoneUrl(content: LearningJourneyContent): string | null

// Cache management
clearLearningJourneyCache(): void
clearSpecificJourneyCache(baseUrl: string): void
```

#### React Integration

```typescript
// Hooks for component integration
useContextPanel(): ContextPanel
useLearningJourneyPanel(): CombinedLearningJourneyPanel

// Ready-to-use React components
ContextPanelComponent(): React.ReactElement
LearningJourneyPanelComponent(): React.ReactElement
```

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
