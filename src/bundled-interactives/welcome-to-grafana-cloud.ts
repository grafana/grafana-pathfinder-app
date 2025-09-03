// Export the HTML content as a string
// This avoids webpack configuration issues with .html files

export const welcomeToGrafanaCloudHtml = `<html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Welcome to Grafana</title>
    </head>
    <body>
        <h1>Welcome to Grafana!</h1>

        <p>Welcome to your Grafana Cloud journey! In this interactive tutorial, we'll take you on a tour of key locations in Grafana Cloud. By the end, you'll be familiar with:</p>
        <ul>
            <li>Navigating Grafana Cloud's main sections</li>
            <li>Understanding the key areas: Dashboards, Data Sources, Explore, and Alerting</li>
            <li>Finding your way around the interface</li>
        </ul>

        <h2>Tour of Grafana Cloud</h2>
        <p>Let's start by exploring the main areas of Grafana. We'll visit each key section so you know where everything is located.</p>

        <span id="grafana-tour" class="interactive" data-targetaction="sequence" data-reftarget="span#grafana-tour">
            <ul>
              <li class="interactive" 
                  data-requirements="navmenu-open"
                  data-reftarget="a[data-testid='data-testid Nav menu item'][href='/a/grafana-setupguide-app/home']"
                  data-targetaction='highlight'
                <span class="interactive-comment">The <strong>Home</strong> page in Grafana Cloud is your central hub. It shows your cloud instance overview, recent activity, and quick access to getting started guides. Perfect <em>starting point</em> for your observability journey!</span>
                First, let's visit the <strong>Home</strong> page - your starting point in Grafana.
              </li>

              <li class="interactive" 
                  data-reftarget="a[data-testid='data-testid Nav menu item'][href='/dashboards']"
                  data-targetaction='highlight'
                <span class="interactive-comment">In Grafana Cloud, <strong>Dashboards</strong> can display data from multiple cloud services simultaneously. Create <code>time series</code> from Prometheus, <code>logs panels</code> from Loki, and <code>traces</code> from Tempo - all in one view!</span>
                Next, <strong>Dashboards</strong> - where you'll create and manage your visualizations.
              </li>

              <li class="interactive" 
                  data-reftarget="a[data-testid='data-testid Nav menu item'][href='/explore']"
                  data-targetaction='highlight'
                  data-skipable="true"
                <span class="interactive-comment"><strong>Explore</strong> is your data playground! Query logs with <code>LogQL</code>, run <code>PromQL</code> queries against metrics, and investigate traces with <code>TraceQL</code>. Perfect for troubleshooting and <em>data discovery</em>.</span>
                Then <strong>Explore</strong> - perfect for ad-hoc queries and data exploration.
              </li>

              <li class="interactive" 
                  data-reftarget="a[data-testid='data-testid Nav menu item'][href='/alerts-and-incidents']"
                  data-targetaction='highlight'
                <span class="interactive-comment">Grafana Cloud's <strong>Alerting</strong> system can monitor your metrics, logs, and traces simultaneously. Set up <code>Slack</code>, <code>PagerDuty</code>, or <code>email</code> notifications. Get alerted before your users notice issues!</span>
                <strong>Alerting</strong> - where you'll set up notifications when things go wrong.
              </li>

              <li class="interactive" 
                  data-reftarget="a[data-testid='data-testid Nav menu item'][href='/connections']"
                  data-targetaction='highlight'
                  data-skipable="true"
                <span class="interactive-comment">Grafana Cloud comes with <strong>pre-configured data sources</strong>! Your <code>Prometheus</code>, <code>Loki</code>, and <code>Tempo</code> instances are already connected. You can also add external sources like <code>AWS</code>, <code>GCP</code>, or your own infrastructure.</span>
                <strong>Connections</strong> - the heart of Grafana where you connect to your data sources.
              </li>

              <li class="interactive" 
                  data-reftarget="a[data-testid='data-testid Nav menu item'][href='/admin']"
                  data-targetaction='highlight'
                <span class="interactive-comment">Cloud <strong>Administration</strong> gives you control over team management, <code>API keys</code>, usage analytics, and billing. Manage your entire cloud stack from here - <em>powerful stuff</em>!</span>
                Finally, <strong>Administration</strong> - for managing users, plugins, and system settings.
              </li>
            </ul>
        </span>



        <h2>🎉 Congratulations!</h2>
        <p>Amazing work! You've completed your welcome tour of Grafana Cloud. You now know:</p>
        <ul>
            <li>✅ Where to find Dashboards, Explore, Alerting, Connections, and Administration</li>
            <li>✅ How to navigate around Grafana Cloud's main interface</li>
            <li>✅ The key areas you'll be working with</li>
        </ul>
        
        <p><strong>You're now ready to explore Grafana Cloud!</strong> Try visiting each section to get familiar with the different features available.</p>
        
    </body>
</html>`;
