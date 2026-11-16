# HelpFooter Component

A modular footer component that provides quick access to Grafana help resources and displays version information.

## Features

- **Help Links**: borderless text links, wrapped and centered
  - Documentation (links to Grafana documentation)
  - Support (links to Grafana support page)
  - Community (links to Grafana community forum)
  - Enterprise (links to Grafana enterprise info)
  - Download (links to Grafana downloads)
  - Keyboard Shortcuts (triggers native shortcuts modal)

- **Version Display**: Shows current Grafana version and commit hash
- **Accessibility**: Proper focus states and keyboard navigation
- **Responsive**: Links wrap to the container width

## Usage

```tsx
import { HelpFooter } from '../HelpFooter';

// Basic usage
<HelpFooter />

// With custom className
<HelpFooter className="custom-footer-class" />
```

## Styling

Styling is handled in `src/styles/help-footer.styles.ts`.

## Keyboard Shortcuts Implementation

The links come from Grafana's help nav item (`useHelpNavItem`). An item without a URL, such as Keyboard Shortcuts, renders as a `Button` that calls the nav item's own `onClick`, so Grafana opens its native shortcuts modal. The component holds no modal state.

## Files

- `HelpFooter.tsx` - Main component that renders the help nav item links
- `../../styles/help-footer.styles.ts` - Emotion CSS styles
- `index.ts` - Barrel export
- `README.md` - This documentation
