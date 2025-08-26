# HelpFooter Component

A modular footer component that provides quick access to Grafana help resources and displays version information.

## Features

- **Help Buttons Grid**: 2-column grid layout with 6 help buttons
  - Documentation (links to Grafana documentation)
  - Support (links to Grafana support page)
  - Community (links to Grafana community forum)
  - Enterprise (links to Grafana enterprise info)
  - Download (links to Grafana downloads)
  - Keyboard Shortcuts (triggers native shortcuts modal)

- **Version Display**: Shows current Grafana version and commit hash
- **Grafana Design System**: Uses secondary small button styling for consistency
- **Accessibility**: Proper focus states and keyboard navigation
- **Responsive**: Grid layout adapts to container width

## Usage

```tsx
import { HelpFooter } from '../HelpFooter';

// Basic usage
<HelpFooter />

// With custom className
<HelpFooter className="custom-footer-class" />
```

## Styling

The component uses Grafana's secondary button style (small size) and follows the design system patterns. Styling is handled in `src/styles/help-footer.styles.ts` using the `createSecondaryButton` utility from `button-utils.ts`.

## Keyboard Shortcuts Implementation

The component currently includes a **simplified keyboard shortcuts modal** as a placeholder. To integrate Grafana's full HelpModal:

1. **Copy the full HelpModal implementation** from `public/app/core/components/help/HelpModal.tsx` in the Grafana repository
2. **Replace the placeholder modal** in `HelpFooter.tsx` with the full implementation
3. **Import required dependencies** like `@grafana/i18n` and any missing utilities

### Current Implementation

```tsx
// Simple placeholder modal with basic shortcuts
<Modal title="Keyboard Shortcuts" isOpen={isOpen} onDismiss={onClose}>
  {/* Simplified shortcuts display */}
</Modal>
```

### Full Implementation (to replace)

```tsx
// Import the complete HelpModal from Grafana core
import { HelpModal } from './path/to/HelpModal';

// Use in component
{
  isHelpModalOpen && <HelpModal onDismiss={handleCloseHelpModal} />;
}
```

## Files

- `HelpFooter.tsx` - Main component with modal state management
- `../../styles/help-footer.styles.ts` - Emotion CSS styles using secondary button utility
- `index.ts` - Barrel export
- `README.md` - This documentation
