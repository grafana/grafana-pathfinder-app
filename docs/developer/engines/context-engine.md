# Context Engine

The Context Engine (`src/context-engine/`) analyzes the user's current Grafana state and provides context-aware documentation recommendations.

## Overview

The Context Engine continuously monitors the user's activity in Grafana (current page, datasources, dashboards, etc.) and generates personalized documentation recommendations based on what they're working on.

## Architecture

### Core Components

- **`context.service.ts`** - Context data fetching and tag generation
- **`context.hook.ts`** - React hook for context panel
- **`context.init.ts`** - Service initialization

## Main Service

### `ContextService`

**Location**: `src/context-engine/context.service.ts`

**Purpose**: Fetches context data and generates recommendations

**Key Features**:
- Analyzes current Grafana state
- Generates context tags
- Fetches recommendations from ML service
- Provides fallback recommendations

**Context Data Collected**:
- Current page path and URL
- Active datasources
- Dashboard information
- Visualization types
- User role and permissions
- Grafana version and platform

## Main Hook

### `useContextPanel()`

**Location**: `src/context-engine/context.hook.ts`

**Purpose**: React hook for context panel component

**Key Features**:
- Monitors location changes
- Debounces context updates
- Manages recommendation state
- Handles errors gracefully

**Usage**:
```typescript
import { useContextPanel } from '../context-engine';

const ContextPanel = () => {
  const { contextData, isLoading } = useContextPanel({
    onOpenLearningJourney: handleOpenJourney,
    onOpenDocsPage: handleOpenDocs,
  });
  
  // Render recommendations
};
```

## Context Detection

The engine detects context through multiple sources:

1. **Location Service** - Monitors URL changes
2. **EchoSrv Events** - Listens to Grafana analytics events
3. **Backend APIs** - Fetches datasource and dashboard data
4. **DOM Analysis** - Analyzes current page state

## Tag Generation

Context tags are generated from:
- Page paths (e.g., `/dashboard`, `/datasources`)
- Datasource types (e.g., `prometheus`, `loki`)
- Visualization types (e.g., `graph`, `table`)
- User actions (e.g., `creating-dashboard`, `configuring-alert`)

Tags are sent to the recommendation service to find relevant content.

## Recommendation Flow

1. **Context Collection** - Gather current Grafana state
2. **Tag Generation** - Create semantic tags from context
3. **API Request** - Send tags to recommendation service
4. **Fallback Handling** - Use bundled recommendations if service unavailable
5. **Display** - Show recommendations in context panel

## Timeout Management

The engine uses `src/utils/timeout-manager.ts` for:
- Debouncing context updates (500ms)
- Preventing rapid-fire API calls
- Managing timeout cleanup

## Event Buffering

EchoSrv events are buffered to handle:
- Plugin close/reopen scenarios
- Missed events during plugin downtime
- Initialization from recent events

## Integration

The Context Engine integrates with:

- **Content Fetcher** (`docs-retrieval/content-fetcher.ts`) - Fetches recommended content
- **Docs Panel** (`components/docs-panel/docs-panel.tsx`) - Opens recommended content
- **Timeout Manager** (`utils/timeout-manager.ts`) - Manages debouncing

## Configuration

Context detection can be configured via plugin settings:
- Enable/disable context-aware recommendations
- Configure recommendation service URL
- Set data usage preferences

## See Also

- `docs/developer/components/docs-panel/README.md` - Context panel component
- `docs/developer/ARCHITECTURE.md` - Overall architecture
- `src/types/context.types.ts` - Type definitions

