# Testing and Advanced Examples

This guide provides comprehensive testing strategies and advanced examples for interactive tutorial elements, including edge cases, error scenarios, and complex workflows.

## Testing Strategies

### Unit Testing Interactive Elements

#### Testing Individual Actions
```html
<!-- Test basic button action -->
<li class="interactive" 
    data-targetaction="button" 
    data-reftarget="Test Button"
    data-requirements="exists-reftarget"
    data-hint="Simple button click test">
  Test button clicking functionality
</li>

<!-- Test form filling -->
<li class="interactive" 
    data-targetaction="formfill" 
    data-reftarget="input[data-testid='test-input']"
    data-targetvalue="test value"
    data-requirements="exists-reftarget"
    data-verify="exists-reftarget">
  Test form filling with verification
</li>

<!-- Test navigation -->
<li class="interactive" 
    data-targetaction="navigate" 
    data-reftarget="/test-page"
    data-verify="on-page:/test-page">
  Test navigation functionality
</li>
```

#### Testing Requirements System
```html
<!-- Test permission requirements -->
<li class="interactive" 
    data-targetaction="button" 
    data-reftarget="Admin Action"
    data-requirements="is-admin,exists-reftarget"
    data-skippable="true"
    data-hint="Tests admin permission checking">
  Test admin-only functionality
</li>

<!-- Test data source requirements -->
<li class="interactive" 
    data-targetaction="formfill" 
    data-reftarget="textarea[data-testid='query-editor']"
    data-targetvalue="up"
    data-requirements="has-datasource:prometheus,exists-reftarget"
    data-hint="Tests data source dependency checking">
  Test data source requirement validation
</li>

<!-- Test complex requirements -->
<li class="interactive" 
    data-targetaction="button" 
    data-reftarget="Complex Action"
    data-requirements="navmenu-open,on-page:/dashboard,has-role:editor,exists-reftarget"
    data-hint="Tests multiple requirement combination">
  Test complex requirement combinations
</li>
```

### Integration Testing Workflows

#### Test Complete Section Flow
```html
<span id="integration-test-section" 
      class="interactive" 
      data-targetaction="sequence" 
      data-reftarget="span#integration-test-section"
      data-objectives="has-dashboard-named:Test Dashboard">
  
  <h3>Integration Test: Complete Dashboard Creation</h3>
  
  <ul>
    <!-- Test navigation with requirements -->
    <li class="interactive" 
        data-targetaction="navigate" 
        data-reftarget="/dashboard/new"
        data-requirements="has-datasources,navmenu-open"
        data-verify="on-page:/dashboard/new">
      Navigate to dashboard creation
    </li>

    <!-- Test multistep workflow -->
    <li class="interactive" 
        data-targetaction="multistep"
        data-requirements="on-page:/dashboard/new">
      
      <span class="interactive" 
            data-targetaction="button" 
            data-reftarget="Add visualization"
            data-requirements="exists-reftarget"></span>
      
      <span class="interactive" 
            data-targetaction="button" 
            data-reftarget="prometheus"
            data-requirements="has-datasource:prometheus"></span>
      
      Test multistep: add visualization and select data source
    </li>

    <!-- Test form filling with verification -->
    <li class="interactive" 
        data-targetaction="formfill" 
        data-reftarget="input[data-testid='dashboard-title']"
        data-targetvalue="Test Dashboard"
        data-requirements="exists-reftarget"
        data-verify="has-dashboard-named:Test Dashboard">
      Test dashboard title setting with verification
    </li>

    <!-- Test save action -->
    <li class="interactive" 
        data-targetaction="button" 
        data-reftarget="Save dashboard"
        data-requirements="exists-reftarget">
      Test dashboard save functionality
    </li>
  </ul>
</span>
```

## Edge Case Examples

### Permission Edge Cases

#### Mixed Permission Workflows
```html
<!-- Admin-preferred with user fallback -->
<span id="plugin-management-workflow" 
      class="interactive" 
      data-targetaction="sequence" 
      data-reftarget="span#plugin-management-workflow">
  
  <h3>Plugin Management (Permission-Aware)</h3>
  
  <ul>
    <!-- Admin path -->
    <li class="interactive" 
        data-targetaction="navigate" 
        data-reftarget="/admin/plugins"
        data-requirements="is-admin,navmenu-open"
        data-skippable="true"
        data-hint="Full plugin management for administrators"
        data-verify="on-page:/admin/plugins">
      Access full plugin management (admin only)
    </li>

    <!-- User alternative -->
    <li class="interactive" 
        data-targetaction="navigate" 
        data-reftarget="/plugins"
        data-requirements="has-role:viewer,navmenu-open"
        data-verify="on-page:/plugins">
      Browse plugin catalog (all users)
    </li>

    <!-- Explain difference -->
    <li class="interactive" 
        data-targetaction="highlight" 
        data-reftarget="div[data-testid='plugin-list']"
        data-requirements="exists-reftarget"
        data-doit="false">
      <span class="interactive-comment">
        The <strong>plugin interface</strong> shows different options based on your permissions. 
        <code>Administrators</code> can install and configure plugins, while <code>regular users</code> 
        can browse and use already-installed plugins. Contact your admin to request new plugins.
      </span>
      Notice the permission-based interface differences
    </li>
  </ul>
</span>
```

#### Role-Based Feature Access
```html
<span id="role-based-features" 
      class="interactive" 
      data-targetaction="sequence" 
      data-reftarget="span#role-based-features">
  
  <h3>Features by User Role</h3>
  
  <ul>
    <!-- Viewer capabilities -->
    <li class="interactive" 
        data-targetaction="highlight" 
        data-reftarget="div[data-testid='dashboard-list']"
        data-requirements="has-role:viewer"
        data-doit="false">
      <span class="interactive-comment">
        As a <strong>Viewer</strong>, you can browse dashboards, explore data, 
        and view alerts. You cannot modify dashboards or system configuration, 
        but you have full access to <em>observability insights</em>.
      </span>
      Viewer role: Browse and explore data
    </li>

    <!-- Editor capabilities -->
    <li class="interactive" 
        data-targetaction="button" 
        data-reftarget="Create dashboard"
        data-requirements="has-role:editor,exists-reftarget"
        data-skippable="true"
        data-hint="Dashboard creation requires editor permissions or higher">
      Editor role: Create and modify dashboards
    </li>

    <!-- Admin capabilities -->
    <li class="interactive" 
        data-targetaction="navigate" 
        data-reftarget="/admin/users"
        data-requirements="is-admin,navmenu-open"
        data-skippable="true"
        data-hint="User management requires admin privileges"
        data-verify="on-page:/admin/users">
      Admin role: Manage users and system settings
    </li>
  </ul>
</span>
```

### Data Source Edge Cases

#### Multiple Data Source Types
```html
<span id="multi-datasource-workflow" 
      class="interactive" 
      data-targetaction="sequence" 
      data-reftarget="span#multi-datasource-workflow">
  
  <h3>Working with Multiple Data Sources</h3>
  
  <ul>
    <!-- Prometheus for metrics -->
    <li class="interactive" 
        data-targetaction="formfill" 
        data-reftarget="textarea[data-testid='query-editor']"
        data-targetvalue="rate(http_requests_total[5m])"
        data-requirements="has-datasource:type:prometheus,on-page:/explore,exists-reftarget"
        data-hint="Requires Prometheus data source for metrics">
      Query request rate from Prometheus
    </li>

    <!-- Loki for logs -->
    <li class="interactive" 
        data-targetaction="button" 
        data-reftarget="loki"
        data-requirements="has-datasource:type:loki,exists-reftarget"
        data-skippable="true"
        data-hint="Switch to Loki for log queries - skip if not available">
      Switch to Loki data source for logs
    </li>

    <!-- Log query -->
    <li class="interactive" 
        data-targetaction="formfill" 
        data-reftarget="textarea[data-testid='query-editor']"
        data-targetvalue='{job="grafana"} |= "error"'
        data-requirements="has-datasource:type:loki,exists-reftarget"
        data-skippable="true"
        data-hint="LogQL query for error logs">
      Query error logs from Loki
    </li>

    <!-- Fallback for missing data sources -->
    <li class="interactive" 
        data-targetaction="highlight" 
        data-reftarget="div[data-testid='no-data-message']"
        data-requirements="!has-datasources"
        data-doit="false">
      <span class="interactive-comment">
        No data sources are configured yet. You'll need to set up <strong>data sources</strong> 
        like <code>Prometheus</code> for metrics or <code>Loki</code> for logs before you can 
        create meaningful dashboards and alerts.
      </span>
      Notice the data source setup requirement
    </li>
  </ul>
</span>
```

#### Data Source Configuration Variations
```html
<span id="datasource-config-variations" 
      class="interactive" 
      data-targetaction="sequence" 
      data-reftarget="span#datasource-config-variations">
  
  <h3>Data Source Configuration Patterns</h3>
  
  <ul>
    <!-- Standard HTTP configuration -->
    <li class="interactive" 
        data-targetaction="formfill" 
        data-reftarget="input[id='connection-url']"
        data-targetvalue="http://prometheus:9090"
        data-requirements="exists-reftarget,on-page:/connections/datasources/prometheus">
      Configure standard HTTP connection
    </li>

    <!-- HTTPS with authentication -->
    <li class="interactive" 
        data-targetaction="formfill" 
        data-reftarget="input[id='connection-url']"
        data-targetvalue="https://prometheus.company.com"
        data-requirements="exists-reftarget"
        data-hint="HTTPS URL for production environments">
      Configure HTTPS connection for production
    </li>

    <!-- Authentication configuration -->
    <li class="interactive" 
        data-targetaction="formfill" 
        data-reftarget="input[id='basic-auth-username']"
        data-targetvalue="monitoring-user"
        data-requirements="exists-reftarget"
        data-skippable="true"
        data-hint="Basic auth - skip if using other authentication">
      Set authentication username (if required)
    </li>

    <!-- Custom headers -->
    <li class="interactive" 
        data-targetaction="formfill" 
        data-reftarget="textarea[data-testid='custom-headers']"
        data-targetvalue="X-API-Key: your-api-key"
        data-requirements="exists-reftarget"
        data-skippable="true"
        data-hint="Custom headers for API authentication">
      Add custom headers (if needed)
    </li>
  </ul>
</span>
```

### Complex Query Examples

#### Progressive Query Complexity
```html
<span id="progressive-query-learning" 
      class="interactive" 
      data-targetaction="sequence" 
      data-reftarget="span#progressive-query-learning"
      data-requirements="has-datasource:prometheus,on-page:/explore">
  
  <h3>Progressive PromQL Learning</h3>
  
  <ul>
    <!-- Basic query -->
    <li class="interactive" 
        data-targetaction="formfill" 
        data-reftarget="textarea[data-testid='query-editor']"
        data-targetvalue="up"
        data-requirements="exists-reftarget">
      <span class="interactive-comment">
        <code>up</code> is the most basic Prometheus query. It returns <strong>1</strong> 
        for healthy targets and <strong>0</strong> for unhealthy ones. Every Prometheus 
        instance has this metric, making it perfect for <em>connectivity testing</em>.
      </span>
      Start with the basic "up" query
    </li>

    <!-- Rate calculation -->
    <li class="interactive" 
        data-targetaction="formfill" 
        data-reftarget="textarea[data-testid='query-editor']"
        data-targetvalue="rate(prometheus_http_requests_total[5m])"
        data-requirements="exists-reftarget">
      <span class="interactive-comment">
        The <strong>rate() function</strong> calculates per-second rates for counter metrics. 
        This query shows how many <code>HTTP requests per second</code> Prometheus itself 
        is handling. The <code>[5m]</code> range vector averages over 5 minutes for <em>stable results</em>.
      </span>
      Calculate request rate over time
    </li>

    <!-- Aggregation -->
    <li class="interactive" 
        data-targetaction="formfill" 
        data-reftarget="textarea[data-testid='query-editor']"
        data-targetvalue="sum(rate(prometheus_http_requests_total[5m])) by (handler)"
        data-requirements="exists-reftarget">
      <span class="interactive-comment">
        <strong>Aggregation functions</strong> like <code>sum()</code> combine multiple series. 
        The <code>by (handler)</code> clause groups results by the handler label, 
        showing which <em>API endpoints</em> receive the most traffic.
      </span>
      Aggregate request rates by handler
    </li>

    <!-- Complex calculation -->
    <li class="interactive" 
        data-targetaction="formfill" 
        data-reftarget="textarea[data-testid='query-editor']"
        data-targetvalue="histogram_quantile(0.95, sum(rate(prometheus_http_request_duration_seconds_bucket[5m])) by (le, handler))"
        data-requirements="exists-reftarget,has-feature:expressions"
        data-skippable="true"
        data-hint="Advanced percentile calculation - skip if expressions not enabled">
      Calculate 95th percentile response time (advanced)
    </li>

    <!-- Execute and examine results -->
    <li class="interactive" 
        data-targetaction="button" 
        data-reftarget="Run query"
        data-requirements="exists-reftarget">
      Execute query to see results
    </li>
  </ul>
</span>
```

#### Query Error Handling
```html
<span id="query-error-handling" 
      class="interactive" 
      data-targetaction="sequence" 
      data-reftarget="span#query-error-handling"
      data-requirements="has-datasource:prometheus,on-page:/explore">
  
  <h3>Understanding and Fixing Query Errors</h3>
  
  <ul>
    <!-- Intentionally broken query -->
    <li class="interactive" 
        data-targetaction="formfill" 
        data-reftarget="textarea[data-testid='query-editor']"
        data-targetvalue="invalid_metric_name"
        data-requirements="exists-reftarget"
        data-hint="This query will fail to demonstrate error handling">
      Enter an invalid query to see error handling
    </li>

    <!-- Execute to see error -->
    <li class="interactive" 
        data-targetaction="button" 
        data-reftarget="Run query"
        data-requirements="exists-reftarget">
      Run query to trigger error message
    </li>

    <!-- Explain error display -->
    <li class="interactive" 
        data-targetaction="highlight" 
        data-reftarget="div[data-testid='query-error']"
        data-requirements="exists-reftarget"
        data-doit="false">
      <span class="interactive-comment">
        <strong>Query errors</strong> appear in this red error box. Common issues include 
        <code>unknown metric names</code>, <code>syntax errors</code>, or <code>missing labels</code>. 
        The error message helps you understand what went wrong and how to fix it.
      </span>
      Examine how query errors are displayed
    </li>

    <!-- Fix the query -->
    <li class="interactive" 
        data-targetaction="formfill" 
        data-reftarget="textarea[data-testid='query-editor']"
        data-targetvalue="up"
        data-requirements="exists-reftarget">
      Fix the query with a valid metric name
    </li>

    <!-- Verify fix -->
    <li class="interactive" 
        data-targetaction="button" 
        data-reftarget="Run query"
        data-requirements="exists-reftarget">
      Run the corrected query
    </li>
  </ul>
</span>
```

### Browser and Environment Testing

#### Cross-Browser Compatibility Tests
```html
<span id="browser-compatibility-test" 
      class="interactive" 
      data-targetaction="sequence" 
      data-reftarget="span#browser-compatibility-test">
  
  <h3>Cross-Browser Compatibility</h3>
  
  <ul>
    <!-- Test button text matching across browsers -->
    <li class="interactive" 
        data-targetaction="button" 
        data-reftarget="Save"
        data-requirements="exists-reftarget"
        data-hint="Tests button text matching in different browsers">
      Test button text matching (cross-browser)
    </li>

    <!-- Test CSS selector reliability -->
    <li class="interactive" 
        data-targetaction="highlight" 
        data-reftarget="button[data-testid='test-button']"
        data-requirements="exists-reftarget"
        data-hint="Tests data-testid selector stability">
      Test stable selector across browsers
    </li>

    <!-- Test form interaction -->
    <li class="interactive" 
        data-targetaction="formfill" 
        data-reftarget="input[type='text']"
        data-targetvalue="test input"
        data-requirements="exists-reftarget"
        data-hint="Tests form filling across different browsers">
      Test form filling compatibility
    </li>

    <!-- Test navigation -->
    <li class="interactive" 
        data-targetaction="navigate" 
        data-reftarget="/dashboards"
        data-verify="on-page:/dashboards"
        data-hint="Tests navigation across browsers">
      Test navigation compatibility
    </li>
  </ul>
</span>
```

#### Mobile and Tablet Testing
```html
<span id="mobile-compatibility-test" 
      class="interactive" 
      data-targetaction="sequence" 
      data-reftarget="span#mobile-compatibility-test">
  
  <h3>Mobile Device Compatibility</h3>
  
  <ul>
    <!-- Mobile navigation -->
    <li class="interactive" 
        data-targetaction="highlight" 
        data-reftarget="button[data-testid='mobile-menu-toggle']"
        data-requirements="exists-reftarget"
        data-skippable="true"
        data-hint="Mobile devices may use different navigation structure">
      Test mobile navigation menu
    </li>

    <!-- Touch-friendly interactions -->
    <li class="interactive" 
        data-targetaction="button" 
        data-reftarget="Large Button"
        data-requirements="exists-reftarget"
        data-hint="Tests touch-friendly button interactions">
      Test touch-friendly button interaction
    </li>

    <!-- Responsive layout -->
    <li class="interactive" 
        data-targetaction="highlight" 
        data-reftarget="div[data-testid='responsive-panel']"
        data-requirements="exists-reftarget"
        data-doit="false">
      <span class="interactive-comment">
        <strong>Responsive panels</strong> adapt to different screen sizes. 
        On mobile devices, panels stack vertically and controls may be 
        reorganized for <em>touch-friendly interaction</em>.
      </span>
      Notice responsive design adaptations
    </li>
  </ul>
</span>
```

### Performance and Load Testing

#### High-Latency Environment Testing
```html
<span id="performance-test" 
      class="interactive" 
      data-targetaction="sequence" 
      data-reftarget="span#performance-test">
  
  <h3>Performance and Latency Handling</h3>
  
  <ul>
    <!-- Slow operation with timeout -->
    <li class="interactive" 
        data-targetaction="button" 
        data-reftarget="Load large dataset"
        data-requirements="exists-reftarget"
        data-skippable="true"
        data-hint="May timeout in high-latency environments">
      Test slow operation handling
    </li>

    <!-- Network-dependent verification -->
    <li class="interactive" 
        data-targetaction="button" 
        data-reftarget="Test connection"
        data-requirements="exists-reftarget"
        data-verify="has-datasource:test-source"
        data-skippable="true"
        data-hint="Network connectivity test - skip if offline">
      Test network-dependent verification
    </li>

    <!-- Graceful degradation -->
    <li class="interactive" 
        data-targetaction="highlight" 
        data-reftarget="div[data-testid='offline-indicator']"
        data-requirements="exists-reftarget"
        data-doit="false">
      <span class="interactive-comment">
        When network connectivity is poor, Grafana shows <strong>offline indicators</strong> 
        and <strong>cached data warnings</strong>. Interactive tutorials gracefully handle 
        these scenarios by making network-dependent steps <em>skippable</em>.
      </span>
      Notice offline/connectivity indicators
    </li>
  </ul>
</span>
```

## Advanced Workflow Examples

### Complex Multi-Step Workflows

#### Complete Monitoring Stack Setup
```html
<span id="complete-monitoring-stack" 
      class="interactive" 
      data-targetaction="sequence" 
      data-reftarget="span#complete-monitoring-stack"
      data-requirements="is-admin">
  
  <h2>Complete Monitoring Stack Setup</h2>
  <p>Set up a full observability stack with metrics, logs, and alerting.</p>
  
  <ul>
    <!-- Phase 1: Prometheus setup -->
    <li class="interactive" 
        data-targetaction="multistep"
        data-objectives="has-datasource:type:prometheus"
        data-hint="Sets up Prometheus for metrics collection">
      
      <span class="interactive" 
            data-targetaction="navigate" 
            data-reftarget="/connections/datasources"
            data-requirements="navmenu-open"></span>
      
      <span class="interactive" 
            data-targetaction="button" 
            data-reftarget="Add new data source"
            data-requirements="exists-reftarget"></span>
      
      <span class="interactive" 
            data-targetaction="highlight" 
            data-reftarget="a[href='/connections/datasources/prometheus']"
            data-requirements="exists-reftarget"></span>
      
      <span class="interactive" 
            data-targetaction="formfill" 
            data-reftarget="input[id='basic-settings-name']"
            data-targetvalue="prometheus-monitoring"
            data-requirements="exists-reftarget"></span>
      
      <span class="interactive" 
            data-targetaction="formfill" 
            data-reftarget="input[id='connection-url']"
            data-targetvalue="http://prometheus:9090"
            data-requirements="exists-reftarget"></span>
      
      <span class="interactive" 
            data-targetaction="button" 
            data-reftarget="Save & test"
            data-requirements="exists-reftarget"></span>
      
      Set up Prometheus data source for metrics
    </li>

    <!-- Phase 2: Loki setup -->
    <li class="interactive" 
        data-targetaction="multistep"
        data-objectives="has-datasource:type:loki"
        data-hint="Sets up Loki for log aggregation">
      
      <span class="interactive" 
            data-targetaction="navigate" 
            data-reftarget="/connections/datasources"
            data-requirements="navmenu-open"></span>
      
      <span class="interactive" 
            data-targetaction="button" 
            data-reftarget="Add new data source"
            data-requirements="exists-reftarget"></span>
      
      <span class="interactive" 
            data-targetaction="highlight" 
            data-reftarget="a[href='/connections/datasources/loki']"
            data-requirements="exists-reftarget"></span>
      
      <span class="interactive" 
            data-targetaction="formfill" 
            data-reftarget="input[id='basic-settings-name']"
            data-targetvalue="loki-logs"
            data-requirements="exists-reftarget"></span>
      
      <span class="interactive" 
            data-targetaction="formfill" 
            data-reftarget="input[id='connection-url']"
            data-targetvalue="http://loki:3100"
            data-requirements="exists-reftarget"></span>
      
      <span class="interactive" 
            data-targetaction="button" 
            data-reftarget="Save & test"
            data-requirements="exists-reftarget"></span>
      
      Set up Loki data source for logs
    </li>

    <!-- Phase 3: Comprehensive dashboard -->
    <li class="interactive" 
        data-targetaction="navigate" 
        data-reftarget="/dashboard/new"
        data-requirements="navmenu-open"
        data-verify="on-page:/dashboard/new">
      Create comprehensive monitoring dashboard
    </li>

    <!-- Add metrics panel -->
    <li class="interactive" 
        data-targetaction="multistep"
        data-requirements="on-page:/dashboard/new"
        data-hint="Creates CPU monitoring panel">
      
      <span class="interactive" 
            data-targetaction="button" 
            data-reftarget="Add visualization"
            data-requirements="exists-reftarget"></span>
      
      <span class="interactive" 
            data-targetaction="button" 
            data-reftarget="prometheus-monitoring"
            data-requirements="has-datasource:prometheus-monitoring"></span>
      
      <span class="interactive" 
            data-targetaction="formfill" 
            data-reftarget="textarea[data-testid='query-editor']"
            data-targetvalue="100 - (avg(rate(node_cpu_seconds_total{mode='idle'}[5m])) * 100)"
            data-requirements="exists-reftarget"></span>
      
      <span class="interactive" 
            data-targetaction="formfill" 
            data-reftarget="input[data-testid='Panel editor option pane field input Title']"
            data-targetvalue="CPU Usage"
            data-requirements="exists-reftarget"></span>
      
      Add CPU monitoring panel
    </li>

    <!-- Add logs panel -->
    <li class="interactive" 
        data-targetaction="multistep"
        data-requirements="on-page:/dashboard"
        data-hint="Creates log monitoring panel">
      
      <span class="interactive" 
            data-targetaction="button" 
            data-reftarget="Add panel"
            data-requirements="exists-reftarget"></span>
      
      <span class="interactive" 
            data-targetaction="button" 
            data-reftarget="Add visualization"
            data-requirements="exists-reftarget"></span>
      
      <span class="interactive" 
            data-targetaction="button" 
            data-reftarget="loki-logs"
            data-requirements="has-datasource:loki-logs"></span>
      
      <span class="interactive" 
            data-targetaction="formfill" 
            data-reftarget="textarea[data-testid='query-editor']"
            data-targetvalue='{job="grafana"} |= "error"'
            data-requirements="exists-reftarget"></span>
      
      <span class="interactive" 
            data-targetaction="highlight" 
            data-reftarget="div[aria-label='Plugin visualization item Logs']"
            data-requirements="exists-reftarget"></span>
      
      <span class="interactive" 
            data-targetaction="formfill" 
            data-reftarget="input[data-testid='Panel editor option pane field input Title']"
            data-targetvalue="Error Logs"
            data-requirements="exists-reftarget"></span>
      
      Add error log monitoring panel
    </li>

    <!-- Save complete dashboard -->
    <li class="interactive" 
        data-targetaction="multistep"
        data-requirements="on-page:/dashboard">
      
      <span class="interactive" 
            data-targetaction="button" 
            data-reftarget="Save dashboard"
            data-requirements="exists-reftarget"></span>
      
      <span class="interactive" 
            data-targetaction="formfill" 
            data-reftarget="input[aria-label='Save dashboard title field']"
            data-targetvalue="Complete Monitoring Stack"
            data-requirements="exists-reftarget"></span>
      
      <span class="interactive" 
            data-targetaction="button" 
            data-reftarget="Save"
            data-requirements="exists-reftarget"></span>
      
      Save the complete monitoring dashboard
    </li>
  </ul>
</span>
```

### Error Recovery and Fallback Patterns

#### Network Connectivity Issues
```html
<span id="network-error-recovery" 
      class="interactive" 
      data-targetaction="sequence" 
      data-reftarget="span#network-error-recovery">
  
  <h3>Network Error Recovery</h3>
  
  <ul>
    <!-- Primary network-dependent action -->
    <li class="interactive" 
        data-targetaction="button" 
        data-reftarget="Test connection"
        data-requirements="exists-reftarget"
        data-verify="has-datasource:test-connection"
        data-skippable="true"
        data-hint="Skip if experiencing network connectivity issues">
      Test data source connection (may fail with network issues)
    </li>

    <!-- Fallback explanation -->
    <li class="interactive" 
        data-targetaction="highlight" 
        data-reftarget="div[data-testid='connection-status']"
        data-requirements="exists-reftarget"
        data-doit="false">
      <span class="interactive-comment">
        If connection testing fails, check your <strong>network connectivity</strong>, 
        <strong>firewall settings</strong>, and <strong>server availability</strong>. 
        You can configure the data source and test connectivity later when 
        network issues are resolved.
      </span>
      Understand connection troubleshooting
    </li>

    <!-- Alternative offline workflow -->
    <li class="interactive" 
        data-targetaction="formfill" 
        data-reftarget="input[data-testid='offline-config']"
        data-targetvalue="offline-mode"
        data-requirements="exists-reftarget"
        data-skippable="true"
        data-hint="Offline configuration for testing without live connection">
      Configure for offline testing (if needed)
    </li>
  </ul>
</span>
```

#### Plugin Dependency Fallbacks
```html
<span id="plugin-dependency-fallback" 
      class="interactive" 
      data-targetaction="sequence" 
      data-reftarget="span#plugin-dependency-fallback">
  
  <h3>Plugin Dependency Handling</h3>
  
  <ul>
    <!-- Plugin-dependent feature -->
    <li class="interactive" 
        data-targetaction="navigate" 
        data-reftarget="/a/custom-app/"
        data-requirements="has-plugin:custom-app"
        data-skippable="true"
        data-hint="Requires custom app plugin - skip if not installed">
      Use custom app plugin features
    </li>

    <!-- Standard alternative -->
    <li class="interactive" 
        data-targetaction="navigate" 
        data-reftarget="/dashboards"
        data-requirements="navmenu-open"
        data-verify="on-page:/dashboards">
      Use standard Grafana dashboards instead
    </li>

    <!-- Explanation of differences -->
    <li class="interactive" 
        data-targetaction="highlight" 
        data-reftarget="div[data-testid='standard-interface']"
        data-requirements="exists-reftarget"
        data-doit="false">
      <span class="interactive-comment">
        <strong>Standard Grafana features</strong> provide comprehensive monitoring capabilities 
        without additional plugins. While plugins can add <code>specialized visualizations</code> 
        or <code>custom data sources</code>, the core Grafana experience offers 
        everything needed for <em>effective observability</em>.
      </span>
      Understand standard vs plugin-enhanced features
    </li>
  </ul>
</span>
```

## Stress Testing Examples

### Large-Scale Tutorial Testing

#### Many-Step Section
```html
<span id="large-scale-test" 
      class="interactive" 
      data-targetaction="sequence" 
      data-reftarget="span#large-scale-test"
      data-hint="Tests system performance with many steps">
  
  <h3>Large-Scale Workflow Test</h3>
  
  <ul>
    <!-- 20+ steps to test performance -->
    <li class="interactive" data-targetaction="navigate" data-reftarget="/dashboard/new" data-requirements="navmenu-open">Step 1: Navigate</li>
    <li class="interactive" data-targetaction="button" data-reftarget="Add visualization" data-requirements="exists-reftarget">Step 2: Add viz</li>
    <li class="interactive" data-targetaction="button" data-reftarget="prometheus" data-requirements="exists-reftarget">Step 3: Select DS</li>
    <li class="interactive" data-targetaction="formfill" data-reftarget="textarea" data-targetvalue="up" data-requirements="exists-reftarget">Step 4: Query</li>
    <li class="interactive" data-targetaction="formfill" data-reftarget="input[data-testid='title']" data-targetvalue="Panel 1" data-requirements="exists-reftarget">Step 5: Title</li>
    <li class="interactive" data-targetaction="button" data-reftarget="Apply" data-requirements="exists-reftarget">Step 6: Apply</li>
    
    <!-- Continue pattern for stress testing -->
    <li class="interactive" data-targetaction="button" data-reftarget="Add panel" data-requirements="exists-reftarget">Step 7: Add panel 2</li>
    <li class="interactive" data-targetaction="button" data-reftarget="Add visualization" data-requirements="exists-reftarget">Step 8: Add viz 2</li>
    <!-- ... more steps for comprehensive testing ... -->
    
    <li class="interactive" data-targetaction="button" data-reftarget="Save dashboard" data-requirements="exists-reftarget">Final: Save dashboard</li>
  </ul>
</span>
```

#### Concurrent Requirements Testing
```html
<span id="concurrent-requirements-test" 
      class="interactive" 
      data-targetaction="sequence" 
      data-reftarget="span#concurrent-requirements-test">
  
  <h3>Concurrent Requirements Validation</h3>
  
  <ul>
    <!-- Multiple expensive requirements -->
    <li class="interactive" 
        data-targetaction="button" 
        data-reftarget="Complex Action"
        data-requirements="has-datasource:prometheus,has-datasource:loki,has-plugin:custom-plugin,is-admin,on-page:/dashboard,exists-reftarget"
        data-hint="Tests multiple concurrent requirement checks">
      Test multiple concurrent requirements
    </li>

    <!-- API-heavy requirements -->
    <li class="interactive" 
        data-targetaction="button" 
        data-reftarget="API Heavy Action"
        data-requirements="has-dashboard-named:Test1,has-dashboard-named:Test2,has-dashboard-named:Test3"
        data-skippable="true"
        data-hint="Tests multiple API-dependent requirements">
      Test API-heavy requirement checking
    </li>
  </ul>
</span>
```

## Accessibility Testing Examples

### Screen Reader Compatibility
```html
<span id="accessibility-test" 
      class="interactive" 
      data-targetaction="sequence" 
      data-reftarget="span#accessibility-test">
  
  <h3>Accessibility and Screen Reader Testing</h3>
  
  <ul>
    <!-- ARIA-based selection -->
    <li class="interactive" 
        data-targetaction="highlight" 
        data-reftarget="button[aria-label='Save dashboard']"
        data-requirements="exists-reftarget"
        data-hint="Uses ARIA label for screen reader compatibility">
      Test ARIA-based element selection
    </li>

    <!-- Role-based selection -->
    <li class="interactive" 
        data-targetaction="formfill" 
        data-reftarget="input[role='combobox']"
        data-targetvalue="test value"
        data-requirements="exists-reftarget"
        data-hint="Uses semantic role for accessibility">
      Test role-based form interaction
    </li>

    <!-- Keyboard navigation -->
    <li class="interactive" 
        data-targetaction="highlight" 
        data-reftarget="button[tabindex='0']"
        data-requirements="exists-reftarget"
        data-hint="Ensures element is keyboard accessible">
      Test keyboard navigation compatibility
    </li>
  </ul>
</span>
```

### High Contrast Theme Testing
```html
<span id="high-contrast-test" 
      class="interactive" 
      data-targetaction="sequence" 
      data-reftarget="span#high-contrast-test">
  
  <h3>High Contrast Theme Compatibility</h3>
  
  <ul>
    <!-- Test visual feedback in high contrast -->
    <li class="interactive" 
        data-targetaction="highlight" 
        data-reftarget="button[data-testid='contrast-test']"
        data-requirements="exists-reftarget"
        data-doit="false">
      <span class="interactive-comment">
        <strong>Interactive highlighting</strong> adapts to high contrast themes 
        using <code>theme-aware colors</code> and <code>enhanced borders</code> 
        to ensure visibility for users with <em>visual accessibility needs</em>.
      </span>
      Test highlighting in high contrast mode
    </li>

    <!-- Test comment visibility -->
    <li class="interactive" 
        data-targetaction="highlight" 
        data-reftarget="div[data-testid='comment-test']"
        data-requirements="exists-reftarget"
        data-doit="false">
      <span class="interactive-comment">
        Interactive <strong>comment boxes</strong> use high contrast borders 
        and theme-appropriate colors to maintain readability in all 
        accessibility modes while preserving visual appeal.
      </span>
      Test comment visibility in high contrast
    </li>
  </ul>
</span>
```

## Debugging and Validation Tools

### Development Testing Utilities
```html
<span id="debug-utilities" 
      class="interactive" 
      data-targetaction="sequence" 
      data-reftarget="span#debug-utilities">
  
  <h3>Tutorial Debugging Tools</h3>
  
  <ul>
    <!-- Test selector validation -->
    <li class="interactive" 
        data-targetaction="highlight" 
        data-reftarget="button[data-testid='debug-selector']"
        data-requirements="exists-reftarget"
        data-hint="Validates selector works correctly">
      Test selector validation
    </li>

    <!-- Test requirement debugging -->
    <li class="interactive" 
        data-targetaction="button" 
        data-reftarget="Debug Requirements"
        data-requirements="debug-mode-enabled,exists-reftarget"
        data-skippable="true"
        data-hint="Tests requirement debugging capabilities">
      Test requirement debugging (skip if debug mode not enabled)
    </li>

    <!-- Test error simulation -->
    <li class="interactive" 
        data-targetaction="button" 
        data-reftarget="Simulate Error"
        data-requirements="exists-reftarget"
        data-hint="Intentionally triggers error for testing error handling">
      Test error handling simulation
    </li>
  </ul>
</span>
```

### Performance Benchmarking
```html
<span id="performance-benchmark" 
      class="interactive" 
      data-targetaction="sequence" 
      data-reftarget="span#performance-benchmark">
  
  <h3>Performance Benchmarking</h3>
  
  <ul>
    <!-- Fast selector test -->
    <li class="interactive" 
        data-targetaction="highlight" 
        data-reftarget="#fast-id-selector"
        data-requirements="exists-reftarget"
        data-hint="Tests fastest selector type (ID-based)">
      Test ID-based selector performance
    </li>

    <!-- Moderate selector test -->
    <li class="interactive" 
        data-targetaction="highlight" 
        data-reftarget="button[data-testid='moderate-selector']"
        data-requirements="exists-reftarget"
        data-hint="Tests moderate performance selector">
      Test data-testid selector performance
    </li>

    <!-- Complex selector test (avoid in production) -->
    <li class="interactive" 
        data-targetaction="highlight" 
        data-reftarget="div.complex .nested .selector"
        data-requirements="exists-reftarget"
        data-skippable="true"
        data-hint="Tests complex selector - avoid in production tutorials">
      Test complex selector (demonstration only)
    </li>
  </ul>
</span>
```

## Quality Assurance Examples

### Comprehensive Testing Checklist

#### Functional Testing Suite
```html
<span id="functional-testing-suite" 
      class="interactive" 
      data-targetaction="sequence" 
      data-reftarget="span#functional-testing-suite">
  
  <h3>Functional Testing Suite</h3>
  
  <ul>
    <!-- Test all action types -->
    <li class="interactive" data-targetaction="button" data-reftarget="Button Test" data-requirements="exists-reftarget">Test button action</li>
    <li class="interactive" data-targetaction="highlight" data-reftarget="div[data-testid='highlight-test']" data-requirements="exists-reftarget">Test highlight action</li>
    <li class="interactive" data-targetaction="formfill" data-reftarget="input[data-testid='form-test']" data-targetvalue="test" data-requirements="exists-reftarget">Test formfill action</li>
    <li class="interactive" data-targetaction="navigate" data-reftarget="/test-page" data-verify="on-page:/test-page">Test navigate action</li>
    
    <!-- Test requirements types -->
    <li class="interactive" data-targetaction="button" data-reftarget="Admin Test" data-requirements="is-admin" data-skippable="true">Test admin requirement</li>
    <li class="interactive" data-targetaction="button" data-reftarget="DS Test" data-requirements="has-datasources" data-skippable="true">Test datasource requirement</li>
    <li class="interactive" data-targetaction="button" data-reftarget="Page Test" data-requirements="on-page:/current" data-skippable="true">Test page requirement</li>
    
    <!-- Test objectives -->
    <li class="interactive" data-targetaction="button" data-reftarget="Objective Test" data-objectives="on-page:/current" data-requirements="exists-reftarget">Test objective auto-completion</li>
    
    <!-- Test show-only mode -->
    <li class="interactive" data-targetaction="highlight" data-reftarget="div[data-testid='show-only-test']" data-doit="false" data-requirements="exists-reftarget">
      <span class="interactive-comment">Testing <strong>show-only mode</strong> with interactive comments.</span>
      Test show-only mode
    </li>
    
    <!-- Test multistep -->
    <li class="interactive" data-targetaction="multistep" data-requirements="exists-reftarget">
      <span class="interactive" data-targetaction="button" data-reftarget="Step 1" data-requirements="exists-reftarget"></span>
      <span class="interactive" data-targetaction="button" data-reftarget="Step 2" data-requirements="exists-reftarget"></span>
      Test multistep execution
    </li>
  </ul>
</span>
```

#### Error Condition Testing
```html
<span id="error-condition-testing" 
      class="interactive" 
      data-targetaction="sequence" 
      data-reftarget="span#error-condition-testing">
  
  <h3>Error Condition Testing</h3>
  
  <ul>
    <!-- Test missing element -->
    <li class="interactive" 
        data-targetaction="button" 
        data-reftarget="Non-existent Button"
        data-requirements="exists-reftarget"
        data-skippable="true"
        data-hint="Tests handling of missing elements">
      Test missing element handling
    </li>

    <!-- Test failed requirements -->
    <li class="interactive" 
        data-targetaction="button" 
        data-reftarget="Impossible Action"
        data-requirements="impossible-requirement"
        data-skippable="true"
        data-hint="Tests requirement failure handling">
      Test requirement failure handling
    </li>

    <!-- Test network timeout -->
    <li class="interactive" 
        data-targetaction="button" 
        data-reftarget="Slow Network Action"
        data-requirements="network-dependent-check"
        data-skippable="true"
        data-hint="Tests network timeout handling">
      Test network timeout scenarios
    </li>
  </ul>
</span>
```

## Best Practices Validation

### Code Quality Examples

#### Excellent Interactive Element
```html
<!-- This demonstrates all best practices -->
<li class="interactive" 
    data-targetaction="formfill" 
    data-reftarget="input[data-testid='prometheus-url']"
    data-targetvalue="http://prometheus:9090"
    data-requirements="exists-reftarget,on-page:/connections/datasources/prometheus,is-admin"
    data-objectives="has-datasource:prometheus"
    data-verify="has-datasource:prometheus"
    data-hint="Sets Prometheus server URL - auto-completes if already configured"
    data-skippable="false">
  
  <span class="interactive-comment">
    The <strong>Prometheus URL</strong> tells Grafana where to find your metrics server. 
    Use <code>http://prometheus:9090</code> for local development or your actual 
    Prometheus server URL for production. The standard port is <code>9090</code>.
  </span>
  
  Enter your Prometheus server URL
</li>
```

**Why this is excellent:**
- ✅ Stable selector using `data-testid`
- ✅ Comprehensive requirements covering all dependencies
- ✅ Objectives for smart auto-completion
- ✅ Verification to confirm action succeeded
- ✅ Helpful hint explaining the purpose
- ✅ Rich interactive comment with context
- ✅ Clear, action-oriented description

#### Poor Interactive Element (Anti-Example)
```html
<!-- This demonstrates what NOT to do -->
<li class="interactive" 
    data-targetaction="highlight" 
    data-reftarget=".css-abc123 > div:nth-child(3) > button.btn-primary">
  Click the button
</li>
```

**Why this is poor:**
- ❌ Brittle CSS class selector
- ❌ No requirements checking
- ❌ No context or explanation
- ❌ Vague description
- ❌ No error handling
- ❌ No verification

### Tutorial Structure Validation

#### Well-Structured Tutorial
```html
<h1>Clear Tutorial Title</h1>
<p>Introduction explaining learning objectives and prerequisites</p>

<!-- Logical section progression -->
<h2>Section 1: Foundation Setup</h2>
<span id="foundation" data-targetaction="sequence" data-objectives="foundation-complete">
  <!-- Basic setup steps -->
</span>

<h2>Section 2: Core Implementation</h2>
<span id="implementation" data-targetaction="sequence" data-requirements="section-completed:foundation">
  <!-- Implementation steps -->
</span>

<h2>Section 3: Advanced Features</h2>
<span id="advanced" data-targetaction="sequence" data-requirements="section-completed:implementation">
  <!-- Advanced steps -->
</span>

<h2>🎉 Congratulations!</h2>
<p>Summary of achievements and next steps</p>
```

This comprehensive testing and examples guide ensures interactive tutorials are robust, accessible, and provide excellent user experiences across all scenarios.

