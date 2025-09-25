// Terms and conditions

export const TERMS_AND_CONDITIONS_CONTENT = `
<h2>Context-aware recommendations</h2>
<p>When enabled, Grafana Pathfinder sends contextual data from your Grafana instance to the recommendation service which returns personalized documentation recommendations.</p>

<h3>Data collection and usage</h3>
<p>When you enable the context-aware recommendations, Grafana Pathfinder collects the following information:</p>

<ul>
<li><strong>Current page path and URL</strong> - to identify which Grafana feature you're using.</li>
<li><strong>A list of the types of installed data sources</strong> - to recommend relevant data source documentation.</li>
<li><strong>Dashboard information</strong> - including dashboard titles, tags, and folder information when you're viewing dashboards. Grafana Pathfinder processes this information locally and doesn't send it to the recommendation service</li>
<li><strong>Visualization types</strong> - when creating or editing panels.</li>
<li><strong>User role</strong> - your organizational role, such as Admin, Editor, or Viewer.</li>
<li><strong>Grafana instance type</strong> - whether you are using Grafana Cloud, Grafana Enterprise, or open source Grafana.</li>
<li><strong>User identifier and email</strong> - for Grafana Cloud, a hashed user identifier and email address used for personalization. For open source Grafana, only a generic identifier ('oss-user') and email ('oss-user@example.com') are used. All user data is hashed using SHA-256 before transmission for privacy protection.</li>
</ul>

<h3>How Grafana uses your data</h3>
<ul>
<li><strong>Personalized recommendations</strong> - to provide documentation and learning journeys that are contextually relevant</li>
<li><strong>Service improvement</strong> - to enhance the quality and accuracy of recommendations</li>
<li><strong>Analytics</strong> - to evaluate which recommendations are most useful to users</li>
</ul>

<h3>Data security</h3>
<ul>
<li>Grafana Pathfinder transmits all data securely using HTTPS.</li>
<li>All user identifiers and email addresses are hashed using SHA-256 before transmission to protect your privacy.</li>
<li>Grafana Pathfinder doesn't collect any sensitive information such as dashboard content, query details, or other personal data.</li>
<li>Grafana only uses the data for the purposes described in this notice.</li>
</ul>

<h3>Your control</h3>
<ul>
<li>You can disable the context-aware recommendations feature at any time in the plugin configuration.</li>
<li>When disabled, Grafana Pathfinder only displays bundled examples and documentation.</li>
<li>When disabled, Grafana Pathfinder won't send any data to the recommendation service.</li>
</ul>

<h3>Changes to data usage</h3>
<p>This notice is subject to change with updates to the plugin.</p>

<h3>Effective date</h3>
<p>This data usage applies whenever you enable context-aware recommendations ends when you disable the feature or uninstall the plugin.</p>
<hr/>

<p><strong>You can enable or disable this feature at any time using the following toggle.</strong></p>
`;
