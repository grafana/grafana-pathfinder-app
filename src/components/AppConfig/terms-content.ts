// Static Terms and Conditions content for the Docs Plugin
// This can be moved to an external API later if needed

export const TERMS_AND_CONDITIONS_CONTENT = `
<h2>Context-aware recommendations</h2>
<p><strong>When enabled, contextual data from your Grafana instance will be sent to Grafana's hosted recommendation service to provide personalized documentation recommendations.</strong></p>

<h3>Data collection and usage</h3>
<p>When you enable the recommender feature, the following contextual information may be collected and sent to Grafana's hosted recommendation service:</p>

<h4>Information collected</h4>
<ul>
<li><strong>Current page path and URL</strong> - to identify which Grafana feature you are using</li>
<li><strong>Data source types</strong> - to recommend relevant data source documentation</li>
<li><strong>Dashboard information</strong> - including dashboard titles, tags, and folder information when viewing dashboards. This information is processed only by the plugin’s internal interactive service and is not transmitted to the hosted recommendation service</li>
<li><strong>Visualization types</strong> - when creating or editing panels</li>
<li><strong>User role</strong> - your organizational role (for example, admin, editor, or viewer)</li>
<li><strong>Grafana instance type</strong> - whether you are using Grafana Cloud or Grafana Open Source</li>
<li><strong>User identifier</strong> - for Grafana Cloud, a non-sensitive identifier used for personalization. For Grafana Open Source, no user identifier is collected</li>
</ul>

<h4>How data is used</h4>
<ul>
<li><strong>Personalized recommendations</strong> - to provide documentation and learning journeys that are contextually relevant</li>
<li><strong>Service improvement</strong> - to enhance the quality and accuracy of recommendations</li>
<li><strong>Analytics</strong> - to evaluate which recommendations are most useful to users</li>
</ul>

<h4>Data security</h4>
<ul>
<li>All data is transmitted securely using HTTPS</li>
<li>No sensitive information such as dashboard content, query details, or personal data is collected</li>
<li>Data is used only for the purposes described in this notice</li>
</ul>

<h4>Your control</h4>
<ul>
<li>You can disable the recommender feature at any time in the plugin configuration</li>
<li>When disabled, only bundled examples and documentation will be displayed</li>
<li>No contextual data will be sent to Grafana's hosted services when the recommender is disabled</li>
</ul>

<h3>Changes to data usage</h3>
<p>We may update this notice from time to time. Any material updates will be communicated through the plugin interface.</p>

<h3>Effective date</h3>
<p>This data usage applies while the recommender feature is enabled and ends when you disable the feature or uninstall the plugin.</p>

<hr/>

<p><strong>You can enable or disable this feature at any time using the toggle above.</strong></p>
`;
