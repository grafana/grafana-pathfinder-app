# FeedbackButton Component

A reusable feedback button component that opens a Google Forms feedback form in a new window.

## Usage

```tsx
import { FeedbackButton } from '../FeedbackButton/FeedbackButton';

// Basic usage
<FeedbackButton />

// With custom className
<FeedbackButton className="custom-styles" />
```

## Features

- **Left-aligned**: Button is positioned to the left side of its container
- **Small size**: Compact button with minimal padding to save vertical space
- **Speech bubble icon**: Includes the specified SVG icon
- **Analytics tracking**: Reports user interactions via `UserInteraction.GeneralPluginFeedbackButton`
- **Accessibility**: Proper ARIA labels and keyboard navigation support
- **Theme integration**: Uses Grafana's design system colors and spacing

## Props

- `className?: string` - Optional CSS class name for custom styling

## Styling

The component uses emotion CSS-in-JS with Grafana's theme system. Styles are defined in `src/styles/feedback-button.styles.ts`.

## Analytics

When clicked, the button reports an interaction with:

- `type`: `UserInteraction.GeneralPluginFeedbackButton`
- `interaction_location`: `'feedback_button'`
- `panel_type`: `'combined_learning_journey'`

## External Link

Opens the Google Forms feedback form in a new window:
`https://docs.google.com/forms/d/e/1FAIpQLSdBvntoRShjQKEOOnRn4_3AWXomKYq03IBwoEaexlwcyjFe5Q/viewform?usp=header`
