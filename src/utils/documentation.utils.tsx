import React from 'react';

/**
 * Documentation content for different Grafana pages
 * Returns contextual help based on the current page path
 */
export function getPageDocumentation(pluginPath: string): React.ReactNode {
  const pathLower = pluginPath.toLowerCase();
  
  if (pathLower.includes('home') || pathLower === '' || pathLower.includes('grafana-grafanadocsplugin-app')) {
    return <HomePageDocumentation />;
  }
  
  if (pathLower.includes('dashboard') || pathLower.includes('d/')) {
    return <DashboardPageDocumentation />;
  }
  
  if (pathLower.includes('explore')) {
    return <ExplorePageDocumentation />;
  }
  
  if (pathLower.includes('alerting')) {
    return <AlertingPageDocumentation />;
  }
  
  return <DefaultPageDocumentation pluginPath={pluginPath} />;
}

function HomePageDocumentation() {
  return (
    <div>
      <p><strong>Grafana Docs Plugin</strong></p>
      <p>This is the main page of the Grafana Documentation Plugin. This plugin provides:</p>
      <ul>
        <li><strong>Global Documentation Access</strong> - Available on every Grafana page</li>
        <li><strong>Context-Aware Help</strong> - Shows relevant information based on current page</li>
        <li><strong>Quick Links</strong> - Direct access to Grafana documentation and resources</li>
        <li><strong>Page Context Information</strong> - Shows current URL, path segments, and navigation details</li>
      </ul>
      <p>The documentation panel is available in the sidebar across all Grafana pages.</p>
    </div>
  );
}

function DashboardPageDocumentation() {
  return (
    <div>
      <p><strong>Dashboard Page</strong></p>
      <p>You're currently viewing a Grafana dashboard. Here you can:</p>
      <ul>
        <li>View and interact with panels and visualizations</li>
        <li>Edit dashboard settings and layout</li>
        <li>Add new panels and queries</li>
        <li>Set time ranges and refresh intervals</li>
      </ul>
    </div>
  );
}

function ExplorePageDocumentation() {
  return (
    <div>
      <p><strong>Explore Page</strong></p>
      <p>Grafana Explore allows you to:</p>
      <ul>
        <li>Query your data sources directly</li>
        <li>Build and test queries</li>
        <li>Analyze logs and metrics</li>
        <li>Create ad-hoc visualizations</li>
      </ul>
    </div>
  );
}

function AlertingPageDocumentation() {
  return (
    <div>
      <p><strong>Alerting</strong></p>
      <p>Grafana Alerting helps you:</p>
      <ul>
        <li>Create and manage alert rules</li>
        <li>Configure notification channels</li>
        <li>Monitor alert states and history</li>
        <li>Set up alert policies and routing</li>
      </ul>
    </div>
  );
}

function DefaultPageDocumentation({ pluginPath }: { pluginPath: string }) {
  return (
    <div>
      <p><strong>Grafana Page</strong></p>
      <p>You're currently on a Grafana page. Use this documentation panel to get contextual help and quick access to resources.</p>
      <p>Current path: <code>{pluginPath}</code></p>
    </div>
  );
} 