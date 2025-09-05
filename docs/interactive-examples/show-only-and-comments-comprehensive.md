# Show-Only Mode and Interactive Comments - Comprehensive Guide

This guide covers two powerful features for creating engaging, educational interactive tutorials: **show-only mode** with `data-doit='false'` and **contextual comment boxes** with `<span class="interactive-comment">`.

## Show-Only Mode (`data-doit='false'`)

### Purpose and Philosophy

Show-only mode creates **educational interactions** that focus on **recognition and understanding** rather than execution. This supports learning objectives around:

- **Interface Familiarity**: Helping users recognize important UI elements
- **Concept Explanation**: Teaching what things do before teaching how to use them
- **Guided Tours**: Creating orientation experiences without state changes
- **Progressive Disclosure**: Building understanding before hands-on interaction

### How It Works

When `data-doit='false'` is set on an interactive element:

1. **Single Button**: Only "Show me" button appears (no "Do it" button)
2. **Auto-Completion**: Step automatically completes after showing the element
3. **No State Changes**: Application state remains unchanged
4. **Educational Focus**: Emphasis on observation and learning rather than action

### Behavior by Action Type

#### highlight + Show-Only
- **Show**: Scrolls to element, highlights with visual feedback, displays comment if present
- **Completion**: Marks step complete after highlight duration
- **Use Case**: Pointing out important interface elements

```html
<li class="interactive"
    data-targetaction="highlight"
    data-reftarget="div[data-testid='dashboard-panel']:first-of-type"
    data-doit="false"
    data-requirements="on-page:/dashboard">
  <span class="interactive-comment">
    This <strong>panel</strong> displays real-time data from your configured data sources. 
    You can customize the <code>visualization type</code>, <code>time range</code>, and 
    <code>refresh interval</code> to match your monitoring needs.
  </span>
  Examine your first dashboard panel
</li>
```

#### button + Show-Only
- **Show**: Locates and highlights button without clicking
- **Completion**: Marks step complete after highlighting
- **Use Case**: Showing where important buttons are located

```html
<li class="interactive"
    data-targetaction="button"
    data-reftarget="Add panel"
    data-doit="false"
    data-requirements="on-page:/dashboard">
  <span class="interactive-comment">
    The <strong>Add panel</strong> button is your gateway to creating visualizations. 
    Click it to start building <code>time series</code>, <code>stat panels</code>, 
    <code>tables</code>, and more.
  </span>
  Notice the Add panel button for creating visualizations
</li>
```

#### formfill + Show-Only
- **Show**: Locates and highlights form field without filling
- **Completion**: Marks step complete after highlighting
- **Use Case**: Explaining what form fields do

```html
<li class="interactive"
    data-targetaction="formfill"
    data-reftarget="input[data-testid='dashboard-title']"
    data-targetvalue="My Dashboard"
    data-doit="false"
    data-requirements="on-page:/dashboard/new">
  <span class="interactive-comment">
    The <strong>dashboard title</strong> field sets the name that appears in your 
    dashboard list. Choose descriptive names like <code>Production Monitoring</code> 
    or <code>Application Metrics</code> for easy identification.
  </span>
  Look at the dashboard title field
</li>
```

#### navigate + Show-Only
- **Show**: Provides visual indication of navigation intent
- **Completion**: Marks step complete without navigating
- **Use Case**: Explaining navigation options without changing pages

```html
<li class="interactive"
    data-targetaction="navigate"
    data-reftarget="/explore"
    data-doit="false">
  <span class="interactive-comment">
    <strong>Explore</strong> is Grafana's ad-hoc query interface. Use it for 
    <code>troubleshooting incidents</code>, <code>testing queries</code>, and 
    <code>data investigation</code> without creating permanent dashboards.
  </span>
  Learn about the Explore section
</li>
```

### When to Use Show-Only Mode

#### ✅ Good Use Cases
- **Orientation Tours**: "Here's where you'll find the main features"
- **Interface Education**: "This panel shows your CPU usage metrics"
- **Concept Introduction**: "The query editor is where you write PromQL"
- **Feature Discovery**: "Notice the visualization picker in the top right"
- **Context Building**: "This dashboard shows production system health"

#### ❌ Avoid Show-Only For
- **Critical Actions**: Steps that must be completed for tutorial progression
- **State Changes**: Actions that need to modify system state
- **Practice Opportunities**: Where users should practice the actual interaction
- **Verification Steps**: Where you need to confirm something was done correctly

### Progressive Tutorial Design

Combine show-only with regular actions for effective learning progression:

```html
<!-- 1. Introduction (show-only) -->
<li class="interactive"
    data-targetaction="highlight"
    data-reftarget="button[data-testid='add-panel-button']"
    data-doit="false">
  <span class="interactive-comment">
    The <strong>Add panel</strong> button creates new visualizations on your dashboard.
  </span>
  First, let's see where the Add panel button is located
</li>

<!-- 2. Practice (regular action) -->
<li class="interactive"
    data-targetaction="button"
    data-reftarget="Add panel"
    data-requirements="exists-reftarget">
  Now click the Add panel button to create your first visualization
</li>
```

## Interactive Comments (`<span class="interactive-comment">`)

### Purpose and Design

Interactive comments provide **rich, contextual explanations** that appear as floating comment boxes during element highlighting. They transform simple highlighting into engaging, informative experiences.

### Visual Design Features

#### Styling and Branding
- **Orange Glow Border**: Distinctive orange border for attention (`rgba(255, 136, 0, 0.5)`)
- **Grafana Logo**: Official Grafana logo for brand consistency
- **Theme Integration**: Uses Grafana theme colors for text and background
- **Professional Appearance**: Polished design that matches Grafana's UI standards

#### Positioning and Animation
- **Smart Positioning**: Automatically positions left, right, or below target element
- **Responsive Layout**: Adapts to available screen space
- **Directional Arrows**: Visual arrows point to highlighted elements
- **Smooth Animations**: Fade in/out transitions for polished experience
- **Z-Index Management**: Appears above other UI elements without blocking interaction

### Content Guidelines

#### HTML Formatting Support
Interactive comments support rich HTML formatting:

```html
<span class="interactive-comment">
  The <strong>query editor</strong> accepts <code>PromQL</code> queries for 
  <em>real-time</em> metric analysis. Common functions include:
  <code>rate()</code>, <code>sum()</code>, and <code>avg()</code>.
</span>
```

#### Formatting Standards
- **UI Elements**: Use `<strong>` for button names, panel titles, menu items
- **Technical Terms**: Use `<code>` for commands, functions, file names, technical concepts
- **Emphasis**: Use `<em>` for conceptual emphasis and important points
- **Lists**: Avoid complex HTML - keep content focused and concise

#### Content Best Practices
- **Length Limit**: Keep under 250 characters for optimal user experience
- **Focus on Context**: Explain WHY something is important, not just WHAT it is
- **User Perspective**: Write from the user's viewpoint ("This helps you...")
- **Actionable Insights**: Provide information that helps users understand the bigger picture

### Implementation Details

#### HTML Structure
```html
<li class="interactive" data-targetaction="highlight" data-reftarget="selector">
  <span class="interactive-comment">
    Rich HTML content with <strong>formatting</strong> and <code>code examples</code>
  </span>
  Human-readable step description
</li>
```

#### Processing Flow
1. **Extraction**: HTML parser finds and extracts comment content
2. **CSS Hiding**: Comment span is hidden via CSS (`display: none`)
3. **Content Storage**: HTML content stored as `targetComment` prop
4. **Runtime Display**: Content rendered as floating comment box during highlighting
5. **Cleanup**: Comment box removed after highlight duration

#### Technical Features
- **HTML Preservation**: Full HTML formatting preserved through processing pipeline
- **CSS Integration**: Comments inherit Grafana theme variables
- **Event Handling**: Comments don't interfere with interactive element events
- **Memory Management**: Comment boxes are properly cleaned up after display

### Comprehensive Examples

#### Basic Educational Comments
```html
<!-- Simple explanation -->
<li class="interactive"
    data-targetaction="highlight"
    data-reftarget="nav[data-testid='navigation']"
    data-doit="false">
  <span class="interactive-comment">
    The <strong>navigation menu</strong> provides access to all major Grafana sections.
  </span>
  Explore the main navigation menu
</li>

<!-- Technical explanation -->
<li class="interactive"
    data-targetaction="highlight"
    data-reftarget="textarea[data-testid='query-editor']"
    data-doit="false">
  <span class="interactive-comment">
    This <strong>query editor</strong> uses <code>Monaco</code> for syntax highlighting 
    and auto-completion. It supports <em>multiple query languages</em> depending on 
    your data source.
  </span>
  Examine the query editor interface
</li>
```

#### Complex Contextual Comments
```html
<!-- Detailed feature explanation -->
<li class="interactive"
    data-targetaction="highlight"
    data-reftarget="div[data-testid='visualization-picker']"
    data-doit="false">
  <span class="interactive-comment">
    Grafana offers <strong>many visualization types</strong>: <em>Time series</em> for trends, 
    <em>Bar charts</em> for comparisons, <em>Heatmaps</em> for distributions, 
    <em>Tables</em> for raw data, and <em>Stat</em> for single values. 
    Choose based on your <code>data story</code>!
  </span>
  Notice the variety of visualization options available
</li>

<!-- Process explanation -->
<li class="interactive"
    data-targetaction="highlight"
    data-reftarget="div[data-testid='panel-options']"
    data-doit="false">
  <span class="interactive-comment">
    <strong>Panel options</strong> control how your data appears. Adjust 
    <code>colors</code>, <code>legends</code>, <code>axes</code>, and <code>thresholds</code> 
    to create <em>meaningful visualizations</em> that tell your data's story clearly.
  </span>
  Explore the panel customization options
</li>
```

#### Comments with Action Context
```html
<!-- Explains what will happen next -->
<li class="interactive"
    data-targetaction="button"
    data-reftarget="Save & test"
    data-requirements="exists-reftarget">
  <span class="interactive-comment">
    <strong>Save & test</strong> creates your data source and verifies the connection. 
    If successful, you'll see a <code>green success message</code>. If it fails, 
    check your <code>URL</code> and <code>authentication settings</code>.
  </span>
  Save the data source and test the connection
</li>
```

### Advanced Comment Patterns

#### Multi-Element Explanations
```html
<li class="interactive"
    data-targetaction="highlight"
    data-reftarget="div[data-testid='dashboard-header']"
    data-doit="false">
  <span class="interactive-comment">
    The <strong>dashboard header</strong> contains essential controls: 
    <code>time range picker</code> (top right), <code>refresh settings</code> (auto-refresh), 
    <code>share options</code> (collaborate with team), and <code>settings</code> (customize dashboard).
  </span>
  Study the dashboard header controls
</li>
```

#### Workflow Context Comments
```html
<li class="interactive"
    data-targetaction="formfill"
    data-reftarget="textarea[data-testid='query-editor']"
    data-targetvalue="rate(http_requests_total[5m])"
    data-requirements="has-datasource:prometheus">
  <span class="interactive-comment">
    This <strong>PromQL query</strong> calculates the per-second rate of HTTP requests 
    over a 5-minute window. The <code>rate()</code> function is perfect for 
    <em>counter metrics</em> that always increase.
  </span>
  Enter a rate query to track request volume
</li>
```

#### Problem-Solution Comments
```html
<li class="interactive"
    data-targetaction="highlight"
    data-reftarget="button[data-testid='refresh-button']"
    data-doit="false">
  <span class="interactive-comment">
    The <strong>refresh button</strong> re-runs your query to fetch the latest data. 
    Use this when your <code>auto-refresh</code> is disabled or when you want to 
    see <em>immediate updates</em> after changing query parameters.
  </span>
  Locate the refresh button for manual data updates
</li>
```

## Combining Features for Maximum Impact

### Educational Sequences

Create powerful learning experiences by combining show-only mode with regular actions:

```html
<span id="learn-and-practice-queries"
      class="interactive"
      data-targetaction="sequence"
      data-reftarget="span#learn-and-practice-queries"
      data-requirements="has-datasource:prometheus">
  
  <h3>Learn and Practice PromQL Queries</h3>
  
  <ul>
    <!-- 1. Educational introduction (show-only) -->
    <li class="interactive"
        data-targetaction="highlight"
        data-reftarget="textarea[data-testid='query-editor']"
        data-doit="false"
        data-requirements="on-page:/explore">
      <span class="interactive-comment">
        The <strong>query editor</strong> is where you write <code>PromQL</code> queries. 
        It provides <em>syntax highlighting</em>, <em>auto-completion</em>, and 
        <em>error detection</em> to help you write effective queries.
      </span>
      First, let's examine the query editor interface
    </li>
    
    <!-- 2. Guided example (show-only) -->
    <li class="interactive"
        data-targetaction="formfill"
        data-reftarget="textarea[data-testid='query-editor']"
        data-targetvalue="up"
        data-doit="false"
        data-requirements="exists-reftarget">
      <span class="interactive-comment">
        <code>up</code> is a fundamental <strong>PromQL query</strong> that shows which 
        targets are currently being scraped. It returns <code>1</code> for healthy 
        targets and <code>0</code> for unhealthy ones.
      </span>
      See how a basic "up" query would look
    </li>
    
    <!-- 3. Hands-on practice (regular action) -->
    <li class="interactive"
        data-targetaction="formfill"
        data-reftarget="textarea[data-testid='query-editor']"
        data-targetvalue="up"
        data-requirements="exists-reftarget">
      Now enter the "up" query yourself
    </li>
    
    <!-- 4. Execute and observe (regular action) -->
    <li class="interactive"
        data-targetaction="button"
        data-reftarget="Run query"
        data-requirements="exists-reftarget"
        data-verify="exists-reftarget">
      Run the query to see your monitoring targets
    </li>
    
    <!-- 5. Results explanation (show-only) -->
    <li class="interactive"
        data-targetaction="highlight"
        data-reftarget="div[data-testid='query-results']"
        data-doit="false"
        data-requirements="exists-reftarget">
      <span class="interactive-comment">
        The <strong>results table</strong> shows your query output. Look for the 
        <code>Value</code> column - <code>1</code> means the target is healthy, 
        <code>0</code> means it's down or unreachable.
      </span>
      Examine the query results to understand target health
    </li>
  </ul>
</span>
```

### Interface Orientation Tours

Perfect for onboarding new users to Grafana's interface:

```html
<span id="grafana-interface-tour"
      class="interactive"
      data-targetaction="sequence"
      data-reftarget="span#grafana-interface-tour">
  
  <h2>Grafana Interface Tour</h2>
  <p>Let's explore the key areas of Grafana's interface.</p>
  
  <ul>
    <li class="interactive"
        data-targetaction="highlight"
        data-reftarget="header[data-testid='grafana-app-header']"
        data-doit="false">
      <span class="interactive-comment">
        The <strong>top header</strong> contains global controls: <code>organization switcher</code>, 
        <code>user menu</code>, <code>help resources</code>, and <code>search</code>. 
        These are available from every page in Grafana.
      </span>
      Notice the top header with global navigation
    </li>
    
    <li class="interactive"
        data-targetaction="highlight"
        data-reftarget="nav[data-testid='navigation-mega-menu']"
        data-doit="false"
        data-requirements="navmenu-open">
      <span class="interactive-comment">
        The <strong>side navigation</strong> organizes Grafana's main features: 
        <code>Dashboards</code> for visualizations, <code>Explore</code> for ad-hoc queries, 
        <code>Alerting</code> for notifications, and <code>Administration</code> for settings.
      </span>
      Explore the main navigation menu
    </li>
    
    <li class="interactive"
        data-targetaction="highlight"
        data-reftarget="main[data-testid='main-content']"
        data-doit="false">
      <span class="interactive-comment">
        The <strong>main content area</strong> is where you'll spend most of your time. 
        It shows <em>dashboards</em>, <em>configuration pages</em>, <em>query interfaces</em>, 
        and all the tools you need for observability.
      </span>
      This is the main content area where your work happens
    </li>
  </ul>
</span>
```

### Feature Deep-Dives

Use show-only mode to explain complex features before hands-on interaction:

```html
<span id="understand-alerting"
      class="interactive"
      data-targetaction="sequence"
      data-reftarget="span#understand-alerting"
      data-requirements="on-page:/alerting">
  
  <h3>Understanding Grafana Alerting</h3>
  
  <ul>
    <!-- Explain the concept -->
    <li class="interactive"
        data-targetaction="highlight"
        data-reftarget="div[data-testid='alert-rules-list']"
        data-doit="false">
      <span class="interactive-comment">
        <strong>Alert rules</strong> continuously monitor your metrics and logs. 
        When conditions are met (like <code>CPU > 80%</code>), they trigger 
        <em>notifications</em> to keep your team informed of issues.
      </span>
      This is where your alert rules are listed
    </li>
    
    <!-- Show the creation process -->
    <li class="interactive"
        data-targetaction="highlight"
        data-reftarget="button[data-testid='new-alert-rule']"
        data-doit="false">
      <span class="interactive-comment">
        The <strong>New rule</strong> button starts the alert creation wizard. 
        You'll define <code>query conditions</code>, <code>evaluation frequency</code>, 
        and <code>notification channels</code> to create effective monitoring.
      </span>
      Here's how you'd create a new alert rule
    </li>
    
    <!-- Now practice -->
    <li class="interactive"
        data-targetaction="button"
        data-reftarget="New rule"
        data-requirements="exists-reftarget">
      Click New rule to create your first alert
    </li>
  </ul>
</span>
```

## Content Writing Guidelines

### Educational Comment Content

#### Structure Your Comments
1. **Element Identification**: Start with the element name in `<strong>`
2. **Purpose Explanation**: What does this element do?
3. **Context and Value**: Why is this important to the user?
4. **Technical Details**: Specific features or capabilities in `<code>`
5. **User Benefit**: How this helps achieve their goals

#### Example Structure
```html
<span class="interactive-comment">
  The <strong>[ELEMENT NAME]</strong> [PURPOSE/FUNCTION]. 
  [CONTEXT/IMPORTANCE]. Use it for <code>[TECHNICAL FEATURES]</code> 
  to <em>[USER BENEFIT]</em>.
</span>
```

#### Applied Example
```html
<span class="interactive-comment">
  The <strong>visualization picker</strong> lets you choose how to display your data. 
  Different chart types tell different stories about your metrics. 
  Use <code>time series</code> for trends, <code>stat panels</code> for current values, 
  and <code>tables</code> for detailed breakdowns to create <em>meaningful dashboards</em>.
</span>
```

### Comment Content Categories

#### Interface Explanations
Focus on helping users understand what they're looking at:

```html
<span class="interactive-comment">
  This <strong>dashboard panel</strong> displays real-time metrics from your 
  <code>Prometheus</code> data source. The <em>time series chart</em> shows 
  how values change over time, helping you spot trends and anomalies.
</span>
```

#### Feature Education
Explain capabilities and use cases:

```html
<span class="interactive-comment">
  <strong>Explore</strong> is your data investigation tool. Write <code>PromQL queries</code>, 
  search logs with <code>LogQL</code>, and analyze traces. Perfect for 
  <em>troubleshooting incidents</em> without creating permanent dashboards.
</span>
```

#### Process Guidance
Help users understand workflows:

```html
<span class="interactive-comment">
  The <strong>Save & test</strong> button validates your data source configuration 
  and saves it for use in dashboards. A <code>green success message</code> confirms 
  the connection works, while <code>red errors</code> indicate <em>configuration issues</em>.
</span>
```

#### Best Practice Tips
Share expert knowledge:

```html
<span class="interactive-comment">
  <strong>Dashboard variables</strong> make your dashboards dynamic and reusable. 
  Create variables for <code>environment</code>, <code>service</code>, or <code>region</code> 
  to build <em>flexible monitoring views</em> that work across your infrastructure.
</span>
```

## Advanced Usage Patterns

### Multi-Modal Learning
Combine different interaction modes for comprehensive learning:

```html
<!-- 1. Observe (show-only) -->
<li class="interactive" data-targetaction="highlight" data-reftarget="selector" data-doit="false">
  <span class="interactive-comment">Explanation of what this is</span>
  Observe this interface element
</li>

<!-- 2. Understand (show-only with example) -->
<li class="interactive" data-targetaction="formfill" data-reftarget="input" data-targetvalue="example" data-doit="false">
  <span class="interactive-comment">Explanation of the example value</span>
  See how you would fill this field
</li>

<!-- 3. Practice (regular action) -->
<li class="interactive" data-targetaction="formfill" data-reftarget="input" data-targetvalue="user-value">
  Now enter your own value
</li>
```

### Conditional Explanations
Provide different explanations based on system state:

```html
<!-- For users with existing setup -->
<li class="interactive"
    data-targetaction="highlight"
    data-reftarget="div[data-testid='existing-dashboards']"
    data-doit="false"
    data-objectives="has-datasources">
  <span class="interactive-comment">
    Your <strong>existing dashboards</strong> are listed here. You can <code>edit</code>, 
    <code>duplicate</code>, or <code>delete</code> them. <em>Starred dashboards</em> 
    appear in your favorites for quick access.
  </span>
  Review your existing dashboards
</li>

<!-- For new users -->
<li class="interactive"
    data-targetaction="highlight"
    data-reftarget="div[data-testid='empty-dashboard-list']"
    data-doit="false"
    data-requirements="!has-datasources">
  <span class="interactive-comment">
    This <strong>empty dashboard list</strong> is normal for new Grafana instances. 
    Once you configure <code>data sources</code> and create <code>dashboards</code>, 
    this area will show your <em>monitoring interfaces</em>.
  </span>
  This empty list will fill up as you create dashboards
</li>
```

### Error Prevention Education
Use show-only mode to teach users about potential issues:

```html
<li class="interactive"
    data-targetaction="highlight"
    data-reftarget="div[data-testid='query-error']"
    data-doit="false"
    data-requirements="exists-reftarget">
  <span class="interactive-comment">
    <strong>Query errors</strong> appear here when your <code>PromQL syntax</code> 
    is incorrect. Common issues include <em>missing metrics</em>, <em>wrong functions</em>, 
    or <em>invalid label selectors</em>. The error message helps you debug the problem.
  </span>
  Notice how query errors are displayed
</li>
```

## Technical Implementation Notes

### Comment Box Positioning Algorithm
1. **Primary Position**: Right of target element with left-pointing arrow
2. **Fallback Position**: Left of target element with right-pointing arrow  
3. **Overflow Handling**: Below target element with upward-pointing arrow
4. **Margin Calculation**: 16px margin from target element
5. **Viewport Bounds**: Ensures comment box stays within visible area

### Performance Considerations
- **DOM Impact**: Comments are hidden via CSS, not removed from DOM
- **Memory Usage**: Comment content stored in React component props
- **Rendering Cost**: Comment boxes created/destroyed on demand
- **Event Handling**: Comments don't interfere with interactive element events

### Accessibility Features
- **Screen Readers**: Comment content is available to assistive technology
- **Keyboard Navigation**: Comments don't interfere with keyboard interaction
- **High Contrast**: Comment styling adapts to high contrast themes
- **Font Scaling**: Comments respect user font size preferences

## Testing and Quality Assurance

### Comment Content Testing
- **Readability**: Comments should be clear to users at different skill levels
- **Accuracy**: Technical information should be correct and current
- **Relevance**: Comments should add value, not repeat obvious information
- **Formatting**: HTML formatting should render correctly

### Show-Only Mode Testing
- **Completion Logic**: Steps should complete automatically after showing
- **State Preservation**: Application state should remain unchanged
- **Visual Feedback**: Users should clearly understand what was demonstrated
- **Flow Integration**: Show-only steps should integrate smoothly with regular actions

### Cross-Platform Testing
- **Desktop Browsers**: Test in Chrome, Firefox, Safari, Edge
- **Tablet Devices**: Ensure comments are readable on tablet screens
- **Mobile Considerations**: Comments should be usable on mobile devices
- **Theme Compatibility**: Test in light and dark Grafana themes

## Best Practices Summary

### When to Use Show-Only Mode
✅ **Perfect For**:
- Interface orientation and tours
- Feature explanation without state changes
- Concept introduction before hands-on practice
- Complex interface element explanation
- Progressive learning sequences

❌ **Avoid For**:
- Critical tutorial steps that must be completed
- Actions that change important system state
- Practice opportunities where users need hands-on experience
- Verification steps that confirm user actions

### Writing Effective Comments
✅ **Good Comments**:
- Explain the purpose and value of interface elements
- Provide context that helps users understand the bigger picture
- Use appropriate HTML formatting for clarity
- Stay focused and concise (under 250 characters)
- Answer "why" questions, not just "what" questions

❌ **Poor Comments**:
- Simply repeat what's already visible on screen
- Use overly technical language without explanation
- Exceed reasonable length limits
- Lack formatting that aids comprehension
- Focus only on mechanics without providing context

### Integration Strategies
- **Start with Observation**: Use show-only mode to introduce concepts
- **Progress to Practice**: Follow with hands-on interactive actions
- **Provide Context**: Use comments to explain why actions matter
- **Build Confidence**: Help users understand before they act
- **Maintain Engagement**: Balance explanation with interaction

