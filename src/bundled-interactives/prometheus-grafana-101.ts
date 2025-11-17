// Export the HTML content as a string
// This avoids webpack configuration issues with .html files

export const prometheusGrafana101Html = `<html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Prometheus + Grafana 101</title>
    </head>
    <body>
        <div class="admonition admonition-note">
            <blockquote>
                <p class="title text-uppercase">Prerequisites</p>
                <p>This tutorial requires a local development environment with Grafana, Prometheus, and Grafana Alloy running.</p>
                <p>To set up the required environment, refer to the <a href="https://github.com/grafana/alloy-scenarios/tree/main/self-monitoring" target="_blank">Grafana Alloy self-monitoring scenario</a> which includes a Docker Compose setup with all necessary services.</p>
                <p><strong>You'll need:</strong></p>
                <ul>
                    <li>Docker and Docker Compose installed</li>
                    <li>Grafana Alloy running with self-monitoring enabled</li>
                    <li>Prometheus receiving metrics from Alloy</li>
                </ul>
            </blockquote>
        </div>

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
                  data-step-timeout="45000">
                <span class="interactive" 
                      data-targetaction="hover"
                      data-reftarget='.gf-form:has([data-testid="data-testid prometheus type"]) label > svg[tabindex="0"]'
                      data-requirements="exists-reftarget">
                  <span class="interactive-comment">The <strong>Performance</strong> section contains advanced settings that control how Grafana optimizes queries to your Prometheus server. Hovering over the information icon reveals detailed explanations about each setting.</span>
                </span>
                <span class="interactive"
                      data-targetaction="highlight"
                      data-reftarget='grafana:components.DataSource.Prometheus.configPage.prometheusType'
                      data-skippable="true">
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
                  data-reftarget='grafana:components.PanelEditor.toggleVizPicker'
                  data-targetaction="highlight">
                  <span class="interactive-comment">Grafana offers <strong>many visualization types</strong>: <em>Time series</em> for trends, <em>Bar charts</em> for comparisons, <em>Heatmaps</em> for distributions, <em>Tables</em> for raw data, and <em>Stat</em> for single values. Choose based on your data story!</span>
                </span>
                <span class="interactive"
                  data-reftarget='div[aria-label="Plugin visualization item Stat"]'
                  data-targetaction="highlight"></span>
                Click on the <strong>Visualization type</strong>, then select <strong>Stat</strong> to create a simple number display.
              </li>

              <li class="interactive"
                  data-reftarget='grafana:components.PanelEditor.OptionsPane.fieldInput:Title'
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

        <h2>Section 3: Explore Your Metrics</h2>
        <p>The Explore tab is your playground for querying and analyzing data. It's perfect for ad-hoc queries, investigating issues, and experimenting with PromQL before adding panels to dashboards. Let's explore some common Prometheus queries!</p>

        <span id="explore-metrics" 
              class='interactive' 
              data-targetaction='sequence' 
              data-reftarget="span#explore-metrics"
              data-requirements="has-datasource:prometheus">
            <ul>
              <li class="interactive" 
                  data-reftarget="a[data-testid='data-testid Nav menu item'][href='/explore']"
                  data-targetaction='highlight'>
                <span class="interactive-comment">The <strong>Explore</strong> tab is designed for ad-hoc querying and investigation. Unlike dashboards which are built for ongoing monitoring, Explore is where you experiment with queries, troubleshoot issues, and discover insights in your data.</span>
                Click <strong>Explore</strong> in the left-side menu to start querying your data.
              </li>

              <li class="interactive" data-targetaction="multistep">
                <span class="interactive" data-targetaction="highlight" data-reftarget='grafana:components.DataSourcePicker.inputV2'></span>
                <span class="interactive" data-targetaction="button" data-reftarget='prometheus'></span>
                 Open the data source picker and select <strong>Prometheus</strong>.
              </li>

              <li class="interactive" 
                  data-reftarget='div[data-testid="QueryEditorModeToggle"] label[for^="option-code-radiogroup"]'
                  data-targetaction='highlight'>
                Switch to <strong>Code</strong> mode to write PromQL queries directly.
              </li>

              <li class="interactive" 
                  data-reftarget='textarea.inputarea'
                  data-targetaction='formfill' 
                  data-targetvalue='up'>
                <span class="interactive-comment">The <code>up</code> metric is a fundamental Prometheus metric that shows which targets are currently being scraped successfully. A value of <strong>1</strong> means the target is up, <strong>0</strong> means it's down.</span>
                Enter the query:
                <pre>up</pre>
              </li>

              <li class="interactive" 
                  data-reftarget='grafana:components.RefreshPicker.runButtonV2'
                  data-targetaction='highlight'>
                <span class="interactive-comment">Click <strong>Run query</strong> to execute your PromQL and see the results. Explore shows both a graph visualization and a table view of your metrics.</span>
                Click <strong>Run query</strong> to see which targets are being monitored.
              </li>

              <li class="interactive" 
                  data-reftarget='textarea.inputarea'
                  data-targetaction='formfill' 
                  data-targetvalue='@@CLEAR@@ sum(up) by (job)'>
                <span class="interactive-comment">This query uses <code>sum()</code> to aggregate the <code>up</code> metric and <code>by (job)</code> to group results by the job label. This shows you how many instances are up for each job type in your Prometheus setup.</span>
                Clear the previous query and enter a new one to count targets by job:
                <pre>sum(up) by (job)</pre>
              </li>

              <li class="interactive" 
                  data-reftarget='grafana:components.RefreshPicker.runButtonV2'
                  data-targetaction='highlight'>
                Execute the query to see targets grouped by job.
              </li>

              <li class="interactive" 
                  data-reftarget='textarea.inputarea'
                  data-targetaction='formfill' 
                  data-targetvalue='@@CLEAR@@ rate(prometheus_http_requests_total[5m])'>
                <span class="interactive-comment">The <code>rate()</code> function calculates the per-second rate of increase over a time window. Here, <code>[5m]</code> means "over the last 5 minutes". This is essential for understanding trends in counter metrics.</span>
                Clear and try a rate query to see HTTP request rates:
                <pre>rate(prometheus_http_requests_total[5m])</pre>
              </li>

              <li class="interactive" 
                  data-reftarget='grafana:components.RefreshPicker.runButtonV2'
                  data-targetaction='highlight'>
                Run the query to visualize request rates over time.
              </li>

              <li class="interactive" 
                  data-reftarget='textarea.inputarea'
                  data-targetaction='formfill' 
                  data-targetvalue='@@CLEAR@@ prometheus_build_info'>
                <span class="interactive-comment">The <code>prometheus_build_info</code> metric provides metadata about your Prometheus server, including version, branch, and Go version. It's a useful info metric with labels containing build details.</span>
                Clear and query Prometheus build information:
                <pre>prometheus_build_info</pre>
              </li>

              <li class="interactive" 
                  data-reftarget='grafana:components.RefreshPicker.runButtonV2'
                  data-targetaction='highlight'>
                <span class="interactive-comment">Info metrics like this one typically have a constant value of <strong>1</strong>, but their labels contain the valuable information about the system.</span>
                Execute to see your Prometheus version and build details.
              </li>

              <li class="interactive" data-targetaction="multistep">
                <span class="interactive" 
                    data-reftarget='grafana:components.TimePicker.openButton'
                    data-targetaction="highlight">
                  <span class="interactive-comment">The <strong>time range picker</strong> lets you focus on specific time windows. You can use relative ranges like "Last 5 minutes" or absolute ranges. This is crucial for investigating incidents or comparing different time periods.</span>
                </span>
                <span class="interactive" 
                    data-reftarget='label:contains("Last 30 minutes")'
                    data-targetaction="highlight">
                  <span class="interactive-comment">Try different time ranges to see how your metrics change over time. Shorter ranges give more detail, longer ranges show trends.</span>
                </span>
                Explore the <strong>time range picker</strong> to adjust your query window.
              </li>
            </ul>
        </span>

        <h2>🎉 Congratulations!</h2>
        <p>Amazing work! You've completed your comprehensive Prometheus + Grafana 101 tutorial. You now know:</p>
        <ul>
            <li>✅ How to create and configure a Prometheus data source</li>
            <li>✅ How to set up the Prometheus server URL (http://prometheus:9090)</li>
            <li>✅ How to create a new dashboard and add visualizations</li>
            <li>✅ How to write and execute PromQL queries using Code mode</li>
            <li>✅ How to use the Explore tab for ad-hoc querying and investigation</li>
            <li>✅ Essential PromQL functions like <code>sum()</code>, <code>rate()</code>, and <code>by</code> grouping</li>
            <li>✅ How to work with fundamental Prometheus metrics like <code>up</code> and build info</li>
            <li>✅ How to navigate time ranges for analyzing different periods</li>
        </ul>
        
        <p><strong>Key PromQL Patterns You Learned:</strong></p>
        <ul>
            <li><code>up</code> - Monitor target health</li>
            <li><code>sum() by (label)</code> - Aggregate and group metrics</li>
            <li><code>rate(metric[5m])</code> - Calculate per-second rates over time windows</li>
            <li><code>prometheus_build_info</code> - Access system metadata through info metrics</li>
        </ul>
        
        <p><strong>Next Steps:</strong> Continue with <a href="bundled:loki-grafana-101">Loki + Grafana 101</a> to add logs alongside your metrics, or dive deeper into PromQL to create more sophisticated queries and alerting rules!</p>
        
    </body>
</html>`;
