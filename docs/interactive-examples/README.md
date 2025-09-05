# Interactive Examples Documentation

This folder contains comprehensive examples and documentation for creating interactive tutorial elements in Grafana documentation. For AI-friendly structured references, see the [AI Interactive Reference](../ai-interactive-reference/) folder.

## Documentation Structure

### Core Guides (Updated and Comprehensive)
- **[Attributes and Parameters](attributes-and-parameters.md)** - Complete reference for all interactive attributes
- **[Interactive Types](interactive-types-comprehensive.md)** - Detailed guide to all action types with examples
- **[Requirements Reference](requirements-reference-comprehensive.md)** - All supported requirements and objectives
- **[Show-Only and Comments](show-only-and-comments-comprehensive.md)** - Educational features and contextual explanations
- **[Selectors and TestIDs](selectors-and-testids-comprehensive.md)** - Stable selectors for reliable tutorials

### Legacy Documentation (Original)
- **[Interactive Types](interactive-types.md)** - Basic interactive types overview
- **[Requirements Reference](requirements-reference.md)** - Basic requirements documentation
- **[Show-Only and Comments](show-only-and-comments.md)** - Basic show-only features
- **[Selectors and TestIDs](selectors-and-testids.md)** - Basic selector patterns

## AI-Friendly Reference Documentation

The [AI Interactive Reference](../ai-interactive-reference/) folder contains structured documentation optimized for AI systems:

- **[System Architecture](../ai-interactive-reference/system-architecture.mdc)** - Technical system overview
- **[Action Types Reference](../ai-interactive-reference/action-types-reference.mdc)** - Quick reference for all actions
- **[Requirements Quick Reference](../ai-interactive-reference/requirements-quick-reference.mdc)** - Essential requirements patterns
- **[Tutorial Patterns](../ai-interactive-reference/tutorial-patterns.mdc)** - Standard tutorial structures
- **[Common Workflows](../ai-interactive-reference/common-workflows.mdc)** - Reusable workflow templates
- **[Selector Library](../ai-interactive-reference/selector-library.mdc)** - Stable UI selectors
- **[Edge Cases](../ai-interactive-reference/edge-cases-and-troubleshooting.mdc)** - Handling complex scenarios
- **[Complete Example](../ai-interactive-reference/complete-example-tutorial.mdc)** - Full tutorial demonstration

## Quick Start Guide

### For Human Authors
1. Start with [Attributes and Parameters](attributes-and-parameters.md) for syntax
2. Review [Interactive Types](interactive-types-comprehensive.md) for action behaviors
3. Use [Requirements Reference](requirements-reference-comprehensive.md) for conditions
4. Check [Selectors Guide](selectors-and-testids-comprehensive.md) for stable UI targeting

### For AI Systems
1. Read [System Architecture](../ai-interactive-reference/system-architecture.mdc) for understanding
2. Use [Action Types Reference](../ai-interactive-reference/action-types-reference.mdc) for syntax
3. Apply [Tutorial Patterns](../ai-interactive-reference/tutorial-patterns.mdc) for structure
4. Reference [Selector Library](../ai-interactive-reference/selector-library.mdc) for targeting

## Key Features

### Interactive Action Types
- **highlight** - Click elements using CSS selectors
- **button** - Click buttons using visible text
- **formfill** - Fill form inputs with values
- **navigate** - Move to different pages/URLs
- **sequence** - Group steps with progress tracking
- **multistep** - Execute multiple actions atomically

### Requirements System
- **Preconditions** - Must be met before actions can execute
- **Auto-fixes** - Automatic resolution for common issues (navigation, etc.)
- **Live monitoring** - Continuous requirement validation
- **Error recovery** - Helpful messages and retry options

### Objectives System
- **Auto-completion** - Steps complete automatically when objectives already met
- **Smart skipping** - Entire sections can be bypassed if goals achieved
- **Priority handling** - Objectives always take precedence over requirements

### Educational Features
- **Show-only mode** - Demonstrate without executing (`data-doit="false"`)
- **Interactive comments** - Rich contextual explanations with HTML formatting
- **Progressive disclosure** - Build understanding before hands-on practice

### Advanced Capabilities
- **State persistence** - Section progress saved across browser sessions
- **Sequential dependencies** - Enforce step order and section prerequisites
- **Permission awareness** - Graceful handling of different user roles
- **Cross-version compatibility** - Works across different Grafana versions

## Best Practices Summary

### Essential Guidelines
- Always include `exists-reftarget` for DOM interactions
- Use `navmenu-open` for navigation menu elements
- Include page requirements for page-specific actions
- Add verification for state-changing actions
- Provide helpful hints for user guidance

### Quality Standards
- Use stable selectors (prefer `data-testid` attributes)
- Include comprehensive error handling
- Structure content progressively from simple to complex
- Make appropriate steps skippable for different user capabilities
- Test across different Grafana configurations and user roles

### Performance Considerations
- Use efficient selectors to avoid slow DOM queries
- Group related requirements to minimize API calls
- Leverage objectives for expensive state checks
- Structure workflows to minimize redundant operations

This documentation provides complete coverage of the interactive tutorial system for both human authors and AI systems.

