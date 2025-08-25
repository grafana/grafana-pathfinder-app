// Static Terms and Conditions content for the Docs Plugin
// This can be moved to an external API later if needed

export const TERMS_AND_CONDITIONS_CONTENT = `
<h2>Context-Aware Recommendations</h2>
<p><strong>When enabled, contextual data from your Grafana instance will be sent to Grafana's hosted recommendation service to provide personalized documentation recommendations.</strong></p>

<h3>Data Collection and Usage</h3>
<p>When you enable the recommender features, the following contextual information may be collected and sent to Grafana's hosted recommendation service:</p>

<h4>Information Collected</h4>
<ul>
<li><strong>Current page path and URL</strong> - To understand which Grafana feature you're using</li>
<li><strong>Data source types</strong> - To recommend relevant data source documentation</li>
<li><strong>Dashboard information</strong> - Including dashboard titles, tags, and folder information when viewing dashboards</li>
<li><strong>Visualization types</strong> - When creating or editing panels</li>
<li><strong>User role</strong> - Your organizational role (e.g., Admin, Editor, Viewer)</li>
<li><strong>Grafana instance type</strong> - Whether you're using Grafana Cloud or Open Source</li>
<li><strong>User identifier</strong> - A hashed identifier for personalization (no personal information)</li>
</ul>

<h4>How Data is Used</h4>
<ul>
<li><strong>Personalized Recommendations</strong> - To provide contextually relevant documentation and learning journeys</li>
<li><strong>Service Improvement</strong> - To improve the quality and relevance of recommendations</li>
<li><strong>Analytics</strong> - To understand which recommendations are most helpful to users</li>
</ul>

<h4>Data Security</h4>
<ul>
<li>All data is transmitted securely using HTTPS</li>
<li>User identifiers are anonymized and hashed</li>
<li>No sensitive data such as dashboard content, query details, or personal information is collected</li>
<li>Data is used only for the purposes described above</li>
</ul>

<h4>Your Control</h4>
<ul>
<li>You can disable the recommender service at any time in the plugin configuration</li>
<li>When disabled, only bundled examples and documentation will be shown</li>
<li>No contextual data will be sent to Grafana's hosted services when the recommender is disabled</li>
<li>You retain full control over what data is shared</li>
</ul>

<h3>Changes to Data Usage</h3>
<p>We may update this data usage information from time to time. When we do, we will notify you through the plugin interface.</p>

<h3>Effective Date</h3>
<p>This data usage applies when the recommender service is enabled and will cease when you disable the feature or uninstall the plugin.</p>

<hr/>

<p><strong>You can enable or disable this feature at any time using the toggle above.</strong></p>
`;
