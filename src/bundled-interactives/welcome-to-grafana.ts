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

        <span id="grafana-tour" class="interactive" data-requirements="navmenu-open" data-targetaction="sequence" data-reftarget="span#grafana-tour">
            <ul>
              <li class="interactive" 
                  data-requirements="navmenu-open"
                  data-reftarget="a[data-testid='data-testid Nav menu item'][href='/']"
                  data-targetaction='highlight'>
                First, let's visit the <strong>Home</strong> page - your starting point in Grafana.
              </li>

              <li class="interactive" 
                  data-reftarget="a[data-testid='data-testid Nav menu item'][href='/dashboards']"
                  data-targetaction='highlight'>
                Next, <strong>Dashboards</strong> - where you'll create and manage your visualizations.
              </li>

              <li class="interactive" 
                  data-reftarget="a[data-testid='data-testid Nav menu item'][href='/explore']"
                  data-targetaction='highlight'>
                Then <strong>Explore</strong> - perfect for ad-hoc queries and data exploration.
              </li>

              <li class="interactive" 
                  data-reftarget="a[data-testid='data-testid Nav menu item'][href='/alerting']"
                  data-targetaction='highlight'>
                <strong>Alerting</strong> - where you'll set up notifications when things go wrong.
              </li>

              <li class="interactive" 
                  data-reftarget="a[data-testid='data-testid Nav menu item'][href='/connections']"
                  data-targetaction='highlight'>
                <strong>Connections</strong> - the heart of Grafana where you connect to your data sources.
              </li>

              <li class="interactive" 
                  data-reftarget="a[data-testid='data-testid Nav menu item'][href='/admin']"
                  data-targetaction='highlight'>
                Finally, <strong>Administration</strong> - for managing users, plugins, and system settings.
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
