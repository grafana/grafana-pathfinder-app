// Export the HTML content as a string
// This avoids webpack configuration issues with .html files

export const welcomeToGrafanaHtml = `<html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Welcome to Grafana</title>
    </head>
    <body>
        <h1>Welcome to Grafana!</h1>

        <p>Welcome to your Grafana journey! In this interactive tutorial, we'll take you on a tour of key locations in Grafana. By the end, you'll be familiar with:</p>
        <ul>
            <li>Navigating Grafana's main sections</li>
            <li>Understanding the key areas: Dashboards, Data Sources, Explore, and Alerting</li>
            <li>Finding your way around the interface</li>
        </ul>

        <h2>Tour of Grafana</h2>
        <p>Let's start by exploring the main areas of Grafana. We'll visit each key section so you know where everything is located.</p>

        <span id="grafana-tour" class="interactive" data-targetaction="sequence" data-reftarget="span#grafana-tour">
            <ul>
              <li class="interactive" 
                  data-requirements="navmenu-open"
                  data-reftarget="a[data-testid='data-testid Nav menu item'][href='/']"
                  data-targetaction='highlight'>
                <span class="interactive-comment">The <strong>Home</strong> page is your Grafana dashboard. It shows recent dashboards, starred dashboards, and quick access to common tasks. Think of it as your <em>mission control center</em>!</span>
                First, let's visit the <strong>Home</strong> page - your starting point in Grafana.
              </li>

              <li class="interactive" 
                  data-reftarget="a[data-testid='data-testid Nav menu item'][href='/dashboards']"
                  data-targetaction='highlight'>
                <span class="interactive-comment"><strong>Dashboards</strong> are collections of panels that display your data visualizations. You can create <code>time series charts</code>, <code>bar graphs</code>, <code>tables</code>, and more. Each dashboard can pull data from multiple data sources!</span>
                Next, <strong>Dashboards</strong> - where you'll create and manage your visualizations.
              </li>

              <li class="interactive" 
                  data-reftarget="a[data-testid='data-testid Nav menu item'][href='/explore']"
                  data-targetaction='highlight'
                  data-skipable="true">
                <span class="interactive-comment"><strong>Explore</strong> is your data investigation tool! Write <code>PromQL</code> queries, search logs with <code>LogQL</code>, and analyze traces. Perfect for troubleshooting incidents and <em>exploring your data</em> without creating dashboards.</span>
                Then <strong>Explore</strong> - perfect for ad-hoc queries and data exploration.
              </li>

              <li class="interactive" 
                  data-reftarget="a[data-testid='data-testid Nav menu item'][href='/alerting']"
                  data-targetaction='highlight'>
                <span class="interactive-comment">Set up smart <strong>Alerting</strong> rules that monitor your metrics and logs continuously. Get notified via <code>email</code>, <code>Slack</code>, <code>PagerDuty</code>, or webhooks when thresholds are breached. <em>Be proactive, not reactive!</em></span>
                <strong>Alerting</strong> - where you'll set up notifications when things go wrong.
              </li>

              <li class="interactive" 
                  data-requirements="has-permission:datasources.read"
                  data-skipable="true"
                  data-hint="Connections requires data source permissions to access"
                  data-reftarget="a[data-testid='data-testid Nav menu item'][href='/connections']"
                  data-targetaction='highlight'>
                <span class="interactive-comment"><strong>Connections</strong> lets you connect to databases like PostgreSQL, monitoring systems like Prometheus, log aggregators like Loki, cloud services like AWS CloudWatch, and <em>hundreds more</em>.</span>
                You need the Admin role to connect data sources.
                You can skip this step if you don't have permissions.
              </li>

              <li class="interactive" 
                  data-reftarget="a[data-testid='data-testid Nav menu item'][href='/admin']"
                  data-targetaction='highlight'>
                <span class="interactive-comment">The <strong>Administration</strong> section is your control center. Manage user accounts, install <code>plugins</code>, configure <code>authentication</code>, monitor system health, and adjust global settings. <em>Admin power at your fingertips!</em></span>
                Finally, <strong>Administration</strong> - for managing users, plugins, and system settings.
              </li>

              <li class="interactive" 
                  data-reftarget="a[data-testid='data-testid Nav menu item'][href='/admin/plugins']"
                  data-requirements="exists-reftarget"
                  data-targetaction='highlight'
                  data-skipable="true"
                  <span class="interactive-comment"> Plugins and data allows you to extend Grafana's functionality. You can install custom plugins from here.
                  </span>
                  Plugins extend Grafana by adding capabilities that are not available by default. For example, you can install plugins that add the ability to import data from diverse sources, that bundle data sources and panels, or that provide new visualization types for use in dashboards.
              </li>

            </ul>
        </span>

        <h2>🎉 Congratulations!</h2>
        <p>Amazing work! You've completed your welcome tour of Grafana. You now know:</p>
        <ul>
            <li>✅ Where to find Dashboards, Explore, Alerting, Connections, and Administration</li>
            <li>✅ How to navigate around Grafana's main interface</li>
            <li>✅ The key areas you'll be working with</li>
        </ul>
        
        <p><strong>You're now ready to explore Grafana!</strong> Try visiting each section to get familiar with the different features available.</p>
        
    </body>
</html>`;
