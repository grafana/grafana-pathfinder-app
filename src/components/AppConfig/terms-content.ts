// Static Terms and Conditions content for the Docs Plugin
// This can be moved to an external API later if needed

export const TERMS_AND_CONDITIONS_CONTENT = `
# Context-Aware Recommendations

**When enabled, contextual data from your Grafana instance will be sent to Grafana's hosted recommendation service to provide personalized documentation recommendations.**

## Data Collection and Usage

When you enable the recommender features, the following contextual information may be collected and sent to Grafana's hosted recommendation service:

### Information Collected
- **Current page path and URL** - To understand which Grafana feature you're using
- **Data source types** - To recommend relevant data source documentation
- **Dashboard information** - Including dashboard titles, tags, and folder information when viewing dashboards
- **Visualization types** - When creating or editing panels
- **User role** - Your organizational role (e.g., Admin, Editor, Viewer)
- **Grafana instance type** - Whether you're using Grafana Cloud or Open Source
- **User identifier** - A hashed identifier for personalization (no personal information)

### How Data is Used
- **Personalized Recommendations** - To provide contextually relevant documentation and learning journeys
- **Service Improvement** - To improve the quality and relevance of recommendations
- **Analytics** - To understand which recommendations are most helpful to users

### Data Security
- All data is transmitted securely using HTTPS
- User identifiers are anonymized and hashed
- No sensitive data such as dashboard content, query details, or personal information is collected
- Data is used only for the purposes described above

### Your Control
- You can disable the recommender service at any time in the plugin configuration
- When disabled, only bundled examples and documentation will be shown
- No contextual data will be sent to Grafana's hosted services when the recommender is disabled
- You retain full control over what data is shared

## Changes to Data Usage

We may update this data usage information from time to time. When we do, we will notify you through the plugin interface.

## Effective Date

This data usage applies when the recommender service is enabled and will cease when you disable the feature or uninstall the plugin.

---

**You can enable or disable this feature at any time using the toggle above.**
`;
