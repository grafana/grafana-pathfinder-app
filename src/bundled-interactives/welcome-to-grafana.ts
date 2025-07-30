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

        <p>Welcome to your Grafana journey! In this interactive tutorial, we'll take you on a tour of key locations in Grafana and help you set up your first data source. By the end, you'll be familiar with:</p>
        <ul>
            <li>Navigating Grafana's main sections</li>
            <li>Understanding the key areas: Dashboards, Data Sources, Explore, and Alerting</li>
            <li>Setting up your first data source for practice</li>
        </ul>

        <h2>Section 1: Tour of Grafana</h2>
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

        <h2>Section 2: Set Up Your First Data Source</h2>
        <p>Now that you've seen the main areas, let's set up a practice data source using Grafana's built-in TestData DB. This will give you sample data to work with as you learn.</p>

        <span id="setup-datasource" 
            class="interactive" 
            data-targetaction="sequence" 
            data-reftarget="span#setup-datasource"
            data-requirements="navmenu-open"
            data-objectives="has-datasource:testdata"> 
            <ul>
              <li class="interactive" 
                  data-reftarget="a[data-testid='data-testid Nav menu item'][href='/connections']"
                  data-targetaction='highlight'>
                Click on <strong>Connections</strong> in the left menu to manage data sources.
              </li>

              <li class="interactive" 
                  data-reftarget="input[type='text']"
                  data-targetaction='formfill' 
                  data-targetvalue='TestData'>
                Search for <strong>TestData</strong> in the search bar - this is Grafana's built-in data source for practice.
              </li>

              <li class="interactive" 
                  data-reftarget="a[href='/connections/datasources/grafana-testdata-datasource']"
                  data-targetaction='highlight'>
                Click on the <strong>TestData DB</strong> option that appears.
              </li>

              <li class="interactive"
                  data-reftarget="Add new data source"
                  data-targetaction='button'>
                Click <strong>Add new data source</strong> to create your first connection.
              </li>

              <li class="interactive"
                  data-reftarget="input[id='basic-settings-name']"
                  data-targetaction='formfill' 
                  data-targetvalue='welcome-datasource'>
                Name your data source <strong>welcome-datasource</strong> so you can easily find it later.
              </li>

              <li class="interactive"
                  data-reftarget="Save & test"
                  data-targetaction="button">
                Click <strong>Save & test</strong> to create your data source and verify it's working.
              </li>
            </ul>
        </span>

        <h2>Section 3: Create Your First Dashboard</h2>
        <p>Now let's put your new data source to work! We'll create a dashboard and add your first visualization using the "welcome-datasource" you just set up.</p>

        <span id="create-dashboard" 
              class='interactive' 
              data-targetaction='sequence' 
              data-reftarget="span#create-dashboard"
              data-requirements="has-datasource:testdata">
            <ul>
              <li class="interactive" 
                  data-reftarget="a[data-testid='data-testid Nav menu item'][href='/dashboards']"
                  data-targetaction='highlight'>
                Click <strong>Dashboards</strong> in the left-side menu.
              </li>

              <li class="interactive" data-targetaction="multistep">
                <span class="interactive" data-targetaction="button" data-reftarget="New"></span>
                <span class="interactive" data-targetaction="button" data-reftarget="a[href='/dashboard/new']"></span>
                Click the <strong>New</strong> button, then select <strong>New dashboard</strong>.
              </li>

              <li class="interactive" data-targetaction="multistep">
                <span class="interactive" data-targetaction="button" data-reftarget="Add visualization"></span>
                <span class="interactive" data-targetaction="button" data-reftarget="welcome-datasource"></span>
                Click <strong>Add visualization</strong>, then select your <strong>welcome-datasource</strong>.
              </li>

              <li class="interactive" data-targetaction="multistep">
                <span class="interactive"
                  data-reftarget='button[data-testid="data-testid toggle-viz-picker"]'
                  data-targetaction="highlight"></span>
                <span class="interactive"
                  data-reftarget='div[aria-label="Plugin visualization item Stat"]'
                  data-targetaction="highlight"></span>
                Click on the <strong>Visualization type</strong>, then select <strong>Stat</strong> to create a simple number display.
              </li>

              <li class="interactive"
                  data-reftarget='input[data-testid="data-testid Panel editor option pane field input Title"]'
                  data-targetaction='formfill' 
                  data-targetvalue='my first visualization'>
                In the panel options, change the <strong>Title</strong> to <strong>my first visualization</strong>.
              </li>

              <li class="interactive" data-targetaction="multistep">
                <span class="interactive" data-reftarget="Save Dashboard" data-targetaction="button"></span>
                <span class="interactive" data-reftarget='input[aria-label="Save dashboard title field"]' 
                  data-targetaction="formfill" data-targetvalue="my first dashboard"></span>
                <span class="interactive" data-reftarget="Save" data-targetaction="button"></span>
                Click <strong>Save Dashboard</strong>, name it <strong>my first dashboard</strong>, and click <strong>Save</strong>.
              </li>
            </ul>
        </span>

        <h2>🎉 Congratulations!</h2>
        <p>Amazing work! You've completed your comprehensive welcome tour of Grafana and created your first dashboard with a custom visualization. You now know:</p>
        <ul>
            <li>✅ Where to find Dashboards, Explore, Alerting, Connections, and Administration</li>
            <li>✅ How to create and configure a data source</li>
            <li>✅ How to create a new dashboard and add visualizations</li>
            <li>✅ How to select visualization types and customize panel titles</li>
            <li>✅ You have a complete dashboard called "my first dashboard" with a Stat visualization</li>
        </ul>
        
        <p><strong>You're now ready to explore Grafana!</strong> Try creating more visualizations, exploring different chart types, or setting up alerts for your data.</p>
        
    </body>
</html>`;
