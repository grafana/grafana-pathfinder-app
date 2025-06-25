# Image Assets Directory

Contains static image assets used throughout the plugin interface.

## Files

### `logo.svg` ⭐ **Plugin Logo**
**Purpose**: Main plugin logo and icon used in various UI contexts
**Role**: 
- Plugin branding and visual identity
- Icon for plugin listings and interfaces
- Visual element in documentation panels

**Design Details**:
- **Format**: SVG (vector graphics for scalability)
- **Style**: Book icon with question mark overlay
- **Colors**: Themed colors matching Grafana's design system
- **Dimensions**: 100x100 viewBox (scalable)

**Visual Elements**:
- **Book Base**: Blue book cover with pages and spine
- **Interactive Icon**: Question mark in circle overlay
- **Shadow**: Subtle drop shadow for depth
- **Bookmark**: Orange accent bookmark ribbon

**Usage Context**:
- **Plugin Catalog**: Displayed in Grafana's plugin marketplace
- **Plugin Pages**: Used as plugin identifier in admin interfaces
- **Component Headers**: Shows in documentation panel title bars
- **Extensions**: Icon for sidebar extensions and navigation

**Used By**:
- `src/plugin.json` - Referenced as plugin logo in metadata
- `src/components/docs-panel/docs-panel.tsx` - Title bar icon
- Grafana plugin system - Automatically displayed in plugin listings
- Documentation and marketing materials

**Technical Specifications**:
```svg
<!-- Responsive design with viewBox -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <!-- CSS styling with theme-aware colors -->
  <defs>
    <style>
      .book-cover { fill: #3865ab; }
      .book-spine { fill: #2c4d7a; }
      .book-pages { fill: #f8f9fa; }
      .book-accent { fill: #84aff1; }
      .book-bookmark { fill: #ff9830; }
    </style>
  </defs>
  <!-- SVG content -->
</svg>
```

**Benefits**:
- **Scalable**: Vector format works at any size
- **Lightweight**: Small file size for fast loading
- **Theme Appropriate**: Colors complement Grafana's design
- **Memorable**: Distinctive design representing documentation/help

**Design Principles**:
- **Clear Symbolism**: Book = documentation, ? = help/questions
- **Professional**: Clean, modern aesthetic suitable for enterprise UI
- **Accessibility**: Good contrast and recognizable shapes
- **Brand Consistency**: Aligns with documentation and learning themes

This logo serves as the visual identity for the plugin and helps users quickly identify and access documentation features within the Grafana interface. 