# Styles Directory

Organized CSS-in-JS styling with Grafana theme integration, extracted from the main components for better maintainability.

## Files Overview

### `docs-panel.styles.ts` ⭐ **Component Styling**
**Purpose**: Main styling functions for the documentation panel components
**Role**: 
- Provides theme-aware styling for all UI components
- Organizes styles into logical groups for maintainability
- Supports both light and dark Grafana themes
- Includes global modal styles for image lightbox

**Key Style Groups**:

#### Container Styles (`getContainerStyles`)
- Main panel container layout and positioning
- Background colors and borders
- Responsive height and width calculations

#### Top Bar Styles (`getTopBarStyles`)
- Header area with title and action buttons
- App icon styling and layout
- Title text and content organization

#### Tab Styles (`getTabStyles`)
- Tab bar layout and scrolling behavior
- Individual tab styling and states
- Active tab highlighting
- Close button styling
- Loading states and animations

#### Content Styles (`getContentStyles`)
- Content area layout for different content types
- Journey vs docs content distinction
- Content metadata display
- Loading and error state styling

#### Milestone Styles (`getMilestoneStyles`)
- Progress indicators for learning journeys
- Navigation button styling
- Progress bar animations
- Milestone counter display

#### Global Modal Styles (`addGlobalModalStyles`)
- Image lightbox modal styling
- Backdrop and container positioning
- Responsive sizing and theming
- Close button and header styling

**Theme Integration**:
```typescript
export const getStyles = (theme: GrafanaTheme2) => ({
  ...getContainerStyles(theme),
  ...getTopBarStyles(theme),
  ...getTabStyles(theme),
  ...getContentStyles(theme),
  ...getMilestoneStyles(theme),
});
```

**Used By**:
- `src/components/docs-panel/docs-panel.tsx` - Main component styling
- `src/utils/link-handler.hook.ts` - Image lightbox modal creation

---

### `content-html.styles.ts` ⭐ **Content Styling**
**Purpose**: Specialized styling for rendered HTML content from documentation sources
**Role**: 
- Styles for learning journey and docs content
- HTML element styling (headings, paragraphs, lists, etc.)
- Interactive element styling (code blocks, images, etc.)
- Responsive and accessible design patterns

**Key Style Functions**:

#### `journeyContentHtml(theme: GrafanaTheme2)`
- Comprehensive styling for learning journey content
- Code block styling with copy buttons
- Image styling with lightbox cursors
- Interactive element styling
- Admonition (note/warning/tip) styling
- Collapsible section styling
- Table responsive design
- Bottom navigation styling

#### `docsContentHtml(theme: GrafanaTheme2)`
- Styling for standalone documentation pages
- Similar features to journey content but optimized for docs
- Streamlined styling without journey-specific elements

**Content Features Styled**:

#### Typography
- Responsive heading hierarchy
- Paragraph spacing and line height
- List styling and indentation

#### Code Elements
- Syntax highlighted code blocks
- Inline code styling
- Copy button positioning and animation
- Scrollbar customization

#### Interactive Elements
- Image hover effects and lightbox cursors
- Button styling for journey actions
- Link styling with hover states
- Collapsible section animations

#### Media Elements
- Responsive image sizing
- Video iframe responsive wrappers
- Image lightbox integration

#### Special Content
- Admonition styling (NOTE, WARNING, TIP)
- Table responsive design
- Journey navigation elements
- Side journey and related journey sections

**Responsive Design**:
- Mobile-first responsive breakpoints
- Flexible image and video sizing
- Optimal reading width constraints
- Touch-friendly interactive elements

**Used By**:
- `src/components/docs-panel/docs-panel.tsx` - Applied to content areas
- `src/utils/content-processing.hook.ts` - Classes referenced for processing

## Design System Integration

### Grafana Theme Support
Both style files integrate deeply with Grafana's theming:
- **Color Tokens**: Uses `theme.colors.*` for consistent theming
- **Typography**: Follows `theme.typography.*` scale and fonts
- **Spacing**: Uses `theme.spacing()` for consistent spacing
- **Shadows**: Applies `theme.shadows.*` for depth
- **Border Radius**: Uses `theme.shape.radius.*` for consistency

### Accessibility Features
- **Color Contrast**: Ensures WCAG compliance with theme colors
- **Focus States**: Clear focus indicators for keyboard navigation
- **Screen Reader**: Semantic markup support
- **Touch Targets**: Adequate sizing for touch interactions

### Performance Considerations
- **CSS-in-JS**: Emotion for optimized runtime styling
- **Theme Memoization**: Efficient theme-based style computation
- **Minimal Recomputation**: Styles computed only when theme changes

## Organization Benefits

### Before Refactor
- Styles embedded inline in massive component files
- Difficult to maintain and update
- No clear organization or grouping

### After Refactor ✅
- **Logical Grouping**: Styles organized by function and component area
- **Reusability**: Functions can be used across components
- **Maintainability**: Easy to find and update specific styling
- **Testing**: Styles can be tested independently
- **Theme Consistency**: Centralized theme integration

This organization makes the styling more maintainable, consistent, and easier for designers and developers to work with. 