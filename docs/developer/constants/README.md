# Constants Directory

Centralized configuration and constant values used throughout the plugin.

## Files

### `selectors.ts` ⭐ **UI Selectors & Configuration**

**Purpose**: Type-safe constants for CSS selectors, configuration values, and UI behavior
**Role**:

- Provides consistent selector strings for DOM manipulation
- Centralizes configuration constants to avoid magic numbers
- Ensures type safety for commonly used values

**Key Exports**:

#### Code Block Selectors

```typescript
CODE_BLOCK_SELECTORS: string[]
```

- Selectors for identifying code blocks that need copy buttons
- Used by content processing hooks

#### Interactive Element Selectors

```typescript
INTERACTIVE_SELECTORS: {
  JOURNEY_START: string;
  SIDE_JOURNEY_LINK: string;
  RELATED_JOURNEY_LINK: string;
  COLLAPSIBLE_SECTION: string;
  // ... more selectors
}
```

- CSS selectors for interactive elements in documentation
- Used by link handlers and content processing

#### Copy Button Configuration

```typescript
COPY_BUTTON_SELECTORS: {
  EXISTING_BUTTONS: string;
  CODE_COPY_BUTTON: string;
  INLINE_CODE_COPY_BUTTON: string;
}
```

- Selectors for copy button functionality
- Used by content processing to add/remove copy buttons

#### Image Lightbox Constants

```typescript
IMAGE_LIGHTBOX: {
  MODAL_CLASS: string;
  BACKDROP_CLASS: string;
  CONTAINER_CLASS: string;
  // ... more classes
}
```

- CSS class names for image lightbox modal
- Used by link handler for creating lightbox modals

#### Tab Configuration

```typescript
TAB_CONFIG: {
  RECOMMENDATIONS_ID: string;
  ID_PREFIX: string;
  MIN_WIDTH: string;
  MAX_WIDTH: string;
}
```

- Configuration for tab behavior and styling
- Used by docs panel for tab management

#### Other Constants

- `INTERACTIVE_EVENT_TYPES` - Custom event types for interactive elements
- `CODE_COPY_CONFIG` - Copy button sizing and timing configuration
- `INTERACTIVE_CONFIG` - Interactive element behavior settings
- `URL_PATTERNS` - Common URL patterns and bases

**Used By**:

- `src/utils/content-processing.hook.ts` - Code block and UI element processing
- `src/utils/link-handler.hook.ts` - Interactive link handling
- `src/components/docs-panel/docs-panel.tsx` - Tab configuration
- `src/styles/*.styles.ts` - Styling functions

**Benefits**:

- **Type Safety**: Prevents typos in selector strings
- **Maintainability**: Single place to update selectors and config
- **Consistency**: Ensures consistent values across components
- **Documentation**: Self-documenting constant names

---

## Parent Directory Constants

### `constants.ts` (in parent `/src` directory)

**Purpose**: Main plugin configuration, API endpoints, and service management
**Role**:

- Plugin-wide configuration values
- API endpoint management
- Authentication configuration
- Global configuration service

**Key Features**:

- Default API URLs for recommendation and docs services
- Configuration service for runtime settings
- Authentication credential management
- Backward compatibility exports

**Used By**: All components requiring API access or configuration

## Design Pattern

The constants are organized in two levels:

1. **Main Constants** (`../constants.ts`) - Plugin-wide configuration
2. **UI Constants** (`selectors.ts`) - Component-specific selectors and UI config

This separation keeps business configuration separate from UI implementation details while maintaining easy access to both.
