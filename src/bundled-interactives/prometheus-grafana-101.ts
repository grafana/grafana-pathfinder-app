// Export the HTML content as a string
// This avoids webpack configuration issues with .html files

export const prometheusGrafana101Html = `<html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Prometheus + Grafana 101</title>
    </head>
    <body>
        <h1>Prometheus + Grafana 101</h1>

        <p>Welcome to your Prometheus monitoring with Grafana journey! In this interactive tutorial, we'll take you on a tour of key locations in Grafana and help you set up your first Prometheus data source. By the end, you'll be familiar with:</p>
        <ul>
            <li>Navigating Grafana's main sections</li>
            <li>Understanding the key areas: Dashboards, Data Sources, Explore, and Alerting</li>
            <li>Setting up and configuring a Prometheus data source</li>
            <li>Creating your first dashboard with Prometheus metrics</li>
        </ul>

        <h2>Section 1: Set Up Your Prometheus Data Source</h2>
        <p>Now that you've seen the main areas, let's set up a Prometheus data source. Prometheus is a powerful monitoring system that's commonly used with Grafana for metrics collection and visualization.</p>

        <span id="setup-datasource" 
            class="interactive" 
            data-targetaction="sequence" 
            data-reftarget="span#setup-datasource"
            data-requirements="navmenu-open"
            data-objectives="has-datasource:prometheus"> 
            <ul>
              <li class="interactive" 
                  data-requirements="navmenu-open,exists-reftarget"
                  data-reftarget="a[data-testid='data-testid Nav menu item'][href='/connections/add-new-connection']"
                  data-targetaction='highlight'>
                <span class="interactive-comment">The <strong>Add new connection</strong> option is where you start adding data sources. This is your central hub for connecting Grafana to various data backends like <code>Prometheus</code>, <code>Loki</code>, <code>InfluxDB</code>, and more.</span>
                Click <strong>Add new connection</strong> in the Connections menu to add data sources.
              </li>

              <li class="interactive" 
                  data-reftarget="input[type='text']"
                  data-targetaction='formfill' 
                  data-targetvalue='Prometheus'>
                Search for <strong>Prometheus</strong> in the search bar - this is a popular monitoring system data source.
              </li>

              <li class="interactive" 
                  data-reftarget="a[href='/connections/datasources/prometheus']"
                  data-targetaction='highlight'>
                Click on the <strong>Prometheus</strong> option that appears.
              </li>

              <li class="interactive"
                  data-reftarget="Add new data source"
                  data-targetaction='button'>
                Click <strong>Add new data source</strong> to create your Prometheus connection.
              </li>

              <li class="interactive"
                  data-reftarget="input[id='basic-settings-name']"
                  data-targetaction='formfill' 
                  data-targetvalue='prometheus-datasource'>
                Name your data source <strong>prometheus-datasource</strong> so you can easily find it later.
              </li>

              <li class="interactive"
                  data-reftarget="input[id='connection-url']"
                  data-targetaction='formfill' 
                  data-targetvalue='http://prometheus:9090'>
                <span class="interactive-comment">This URL <code>http://prometheus:9090</code> is the default endpoint for Prometheus servers. Port <strong>9090</strong> is the standard Prometheus port.</span>
                Set the <strong>URL</strong> to <strong>http://prometheus:9090</strong> to connect to your Prometheus server.
              </li>

              <li class="interactive"
                  data-targetaction="guided"
                  data-step-timeout="45000"
                  data-skippable="true">
                <span class="interactive" 
                      data-targetaction="hover"
                      data-reftarget='.gf-form:has([data-testid="data-testid prometheus type"]) label > svg[tabindex="0"]'
                      data-requirements="exists-reftarget">
                  <span class="interactive-comment">The <strong>Performance</strong> section contains advanced settings that control how Grafana optimizes queries to your Prometheus server. Hovering over the information icon reveals detailed explanations about each setting.</span>
                </span>
                <span class="interactive"
                      data-targetaction="highlight"
                      data-reftarget='[data-testid="data-testid prometheus type"]'>
                  <span class="interactive-comment">The <strong>Prometheus type</strong> dropdown lets you specify whether you're connecting to a standard Prometheus server or a compatible service like Cortex or Thanos, which helps Grafana optimize query behavior accordingly.</span>
                </span>
                <span class="interactive"
                      data-targetaction="button"
                      data-reftarget="Save & test">
                  <span class="interactive-comment">Click <strong>Save & test</strong> to create your data source and verify the connection is working.</span>
                </span>
                
                Explore Prometheus configuration settings and save your data source.
              </li>
            </ul>
        </span>

        <h2>Section 2: Create Your First Dashboard</h2>
        <p>Now let's put your new Prometheus data source to work! We'll create a dashboard and add your first visualization using the "prometheus-datasource" you just set up.</p>

        <span id="create-dashboard" 
              class='interactive' 
              data-targetaction='sequence' 
              data-reftarget="span#create-dashboard"
              data-requirements="has-datasource:prometheus">
            <ul>
              <li class="interactive" 
                  data-requirements="section-completed:section-setup-datasource"
                  data-reftarget="a[data-testid='data-testid Nav menu item'][href='/dashboards']"
                  data-targetaction='highlight'>
                Click <strong>Dashboards</strong> in the left-side menu.
              </li>

              <li class="interactive" data-targetaction="multistep">
                <span class="interactive" data-targetaction="button" data-reftarget="New"></span>
                <span class="interactive" data-targetaction="highlight" data-reftarget="a[href='/dashboard/new']"></span>
                Click the <strong>New</strong> button, then select <strong>New dashboard</strong>.
              </li>

              <li class="interactive" data-targetaction="multistep">
                <span class="interactive" data-targetaction="button" data-reftarget="Add visualization"></span>
                <span class="interactive" data-targetaction="button" data-reftarget="prometheus-datasource"></span>
                Click <strong>Add visualization</strong>, then select your <strong>prometheus-datasource</strong>.
              </li>

              <li class="interactive" 
                  data-reftarget='div[data-testid="QueryEditorModeToggle"] label[for^="option-code-radiogroup"]'
                  data-targetaction='highlight'>
                Switch to <strong>Code</strong> mode by clicking the raw query toggle to write PromQL directly.
              </li>

              <li class="interactive" 
                  data-reftarget='textarea.inputarea'
                  data-targetaction='formfill' 
                  data-targetvalue='avg(alloy_component_controller_running_components{})'>
                <span class="interactive-comment">This is <strong>PromQL</strong> (Prometheus Query Language)! The <code>avg()</code> function calculates the average value, and <code>alloy_component_controller_running_components{}</code> is a metric that tracks running components. The empty <code>{}</code> means we're not filtering by labels.</span>
                Enter this PromQL query:
                <pre>avg(alloy_component_controller_running_components{})</pre>
              </li>

              <li class="interactive" 
                  data-reftarget='Refresh'
                  data-targetaction='button'>
                <span class="interactive-comment">The <strong>Refresh</strong> button is used to execute the query and see your Prometheus data.</span>
                Click the <strong>Refresh</strong> button to execute the query and see your Prometheus data.
              </li>

              <li class="interactive" data-targetaction="multistep">
                <span class="interactive"
                  data-reftarget='button[data-testid="data-testid toggle-viz-picker"]'
                  data-targetaction="highlight">
                  <span class="interactive-comment">Grafana offers <strong>many visualization types</strong>: <em>Time series</em> for trends, <em>Bar charts</em> for comparisons, <em>Heatmaps</em> for distributions, <em>Tables</em> for raw data, and <em>Stat</em> for single values. Choose based on your data story!</span>
                </span>
                <span class="interactive"
                  data-reftarget='div[aria-label="Plugin visualization item Stat"]'
                  data-targetaction="highlight"></span>
                Click on the <strong>Visualization type</strong>, then select <strong>Stat</strong> to create a simple number display.
              </li>

              <li class="interactive"
                  data-reftarget='input[data-testid="data-testid Panel editor option pane field input Title"]'
                  data-targetaction='formfill' 
                  data-targetvalue='Number of running components'>
                <span class="interactive-comment">The <strong>Title</strong> is the name of the panel. It's used to identify the panel in the dashboard.</span>
                In the panel options, change the <strong>Title</strong> to <strong>Number of running components</strong>.
              </li>

              <li class="interactive" data-targetaction="multistep">
                <span class="interactive" data-reftarget="Save Dashboard" data-targetaction="button"></span>
                <span class="interactive" data-reftarget='input[aria-label="Save dashboard title field"]' 
                  data-targetaction="formfill" data-targetvalue="Alloy Self Monitoring"></span>
                <span class="interactive" data-reftarget="Save" data-targetaction="button"></span>
                Click <strong>Save Dashboard</strong>, name it <strong>Alloy Self Monitoring</strong>, and click <strong>Save</strong>.
              </li>
            </ul>
        </span>

        <h2>🎉 Congratulations!</h2>
        <p>Amazing work! You've completed your comprehensive Prometheus + Grafana 101 tutorial and created your first dashboard with a custom visualization. You now know:</p>
        <ul>
            <li>✅ How to create and configure a Prometheus data source</li>
            <li>✅ How to set up the Prometheus server URL (http://prometheus:9090)</li>
            <li>✅ How to switch to Code mode for writing raw PromQL queries</li>
            <li>✅ How to write and execute PromQL queries (like rate calculations)</li>
            <li>✅ How to create a new dashboard and add visualizations</li>
            <li>✅ How to select visualization types and customize panel titles</li>
            <li>✅ You have a complete dashboard called "my first dashboard" with a Stat visualization showing Prometheus metrics</li>
        </ul>
        
        <p><strong>Next:</strong> Continue with <a href="bundled:loki-grafana-101">Loki + Grafana 101</a> to add logs alongside your metrics using Loki.</p>
        
    </body>
</html>`;
