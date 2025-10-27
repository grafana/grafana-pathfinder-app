// Export the HTML content as a string
// This avoids webpack configuration issues with .html files

export const lokiGrafana101Html = `<html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Loki + Grafana 101</title>
    </head>
    <body>
        <p><strong>Prerequisite:</strong> Complete <a href="bundled:prometheus-grafana-101">Prometheus + Grafana 101</a> first.</p>
        <h1>Loki + Grafana 101</h1>

        <p>This tutorial continues from <a href="bundled:prometheus-grafana-101">Prometheus + Grafana 101</a>. You'll configure a Loki data source and add a Loki panel to the dashboard you created previously.</p>
        <ul>
            <li>Configure a Loki data source (loki:3100)</li>
            <li>Add a logs panel to the existing "Alloy Self Monitoring" dashboard</li>
        </ul>

        <h2>Section 1: Set Up Your Loki Data Source</h2>
        <p>We'll configure Loki as a data source so you can visualize logs alongside your metrics.</p>

        <span id="setup-datasource" 
            class="interactive" 
            data-targetaction="sequence" 
            data-reftarget="span#setup-datasource"
            data-requirements="navmenu-open,has-datasource:prometheus" 
            <ul>
              <li class="interactive" 
                  data-requirements="navmenu-open,exists-reftarget"
                  data-reftarget="a[data-testid='data-testid Nav menu item'][href='/connections/add-new-connection']"
                  data-targetaction='highlight'>
                <span class="interactive-comment">The <strong>Add new connection</strong> option is where you start adding data sources. You'll use this to add Loki alongside your existing Prometheus data source.</span>
                Click <strong>Add new connection</strong> in the Connections menu to add data sources.
              </li>

              <li class="interactive" 
                  data-reftarget="input[type='text']"
                  data-targetaction='formfill' 
                  data-targetvalue='Loki'>
                <span class="interactive-comment">Loki is Grafana's log aggregation system, designed to work alongside Prometheus for a complete observability solution.</span>
                Search for <strong>Loki</strong> in the search bar.
              </li>

              <li class="interactive" 
                  data-reftarget="a[href='/connections/datasources/loki']"
                  data-targetaction='highlight'>
                Click on the <strong>Loki</strong> option that appears.
              </li>

              <li class="interactive"
                  data-reftarget="Add new data source"
                  data-targetaction='button'>
                Click <strong>Add new data source</strong> to create your Loki connection.
              </li>

              <li class="interactive"
                  data-reftarget="input[id='basic-settings-name']"
                  data-targetaction='formfill' 
                  data-targetvalue='loki-datasource'>
                Name your data source <strong>loki-datasource</strong> so you can easily find it later.
              </li>

              <li class="interactive"
                  data-reftarget="input[id='connection-url']"
                  data-targetaction='formfill' 
                  data-targetvalue='http://loki:3100'>
                <span class="interactive-comment">This URL <code>http://loki:3100</code> is the default endpoint for Loki servers. Port <strong>3100</strong> is the standard Loki port.</span>
                Set the <strong>URL</strong> to <strong>http://loki:3100</strong> to connect to your Loki server.
              </li>

              <li class="interactive"
                  data-reftarget="Save & test"
                  data-targetaction="button">
                Click <strong>Save & test</strong> to create your data source and verify the connection is working.
              </li>
            </ul>
        </span>

        <h2>Section 2: Add Loki Panel to Existing Dashboard</h2>
        <p>Next, add a logs panel to the <strong>Alloy Self Monitoring</strong> dashboard you created previously.</p>

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

              <li class="interactive" 
                  data-reftarget='input[placeholder="Search for dashboards and folders"]'
                  data-targetaction='formfill' 
                  data-targetvalue='Alloy Self Monitoring'
                  data-requirements='has-dashboard-named:Alloy Self Monitoring'>
                Search for the <strong>Alloy Self Monitoring</strong> dashboard.
              </li>

              <li class="interactive" 
                  data-reftarget='a[title="Alloy Self Monitoring"]'
                  data-targetaction='highlight'>
                Open the <strong>Alloy Self Monitoring</strong> dashboard.
              </li>

              <li class="interactive"
                  data-reftarget='button[data-testid="data-testid Edit dashboard button"]'
                  data-targetaction='highlight'>
                Click <strong>Edit</strong> to edit the dashboard.
              </li>

              <li class="interactive" data-targetaction="multistep">
                <span class="interactive" data-targetaction="highlight" data-reftarget='button[data-testid="data-testid Add button"]'></span>
                <span class="interactive" data-targetaction="highlight" data-reftarget='button[data-testid="data-testid Add new visualization menu item"]'></span>
                Use <strong>Add</strong> → <strong>Visualization</strong> to create a new panel.
              </li>

              <li class="interactive" data-targetaction="multistep">
                <span class="interactive" data-targetaction="highlight" data-reftarget='input#data-source-picker'></span>
                <span class="interactive" data-targetaction="button" data-reftarget='loki-datasource'></span>
                Open the data source picker and select <strong>loki-datasource</strong>.
              </li>

              <li class="interactive" 
                  data-reftarget='div[data-testid="QueryEditorModeToggle"] label[for^="option-code-radiogroup"]'
                  data-targetaction='highlight'>
                <span class="interactive-comment">Code mode lets you write raw <strong>LogQL</strong> queries directly, similar to how PromQL works for Prometheus. This gives you full control over your log queries.</span>
                Switch to <strong>Code</strong> mode by clicking the raw query toggle to write LogQL directly.
              </li>

              <li class="interactive" 
                  data-reftarget='textarea.inputarea'
                  data-targetaction='formfill' 
                  data-targetvalue='{container="alloy"}'>
                <span class="interactive-comment">This is <strong>LogQL</strong> (Loki Query Language)! The query <code>{container="alloy"}</code> filters logs from containers named "alloy". The curly braces <code>{}</code> are used for label matching in Loki.</span>
                Enter this LogQL query:
                <pre>{container="alloy"}</pre>
              </li>

              <li class="interactive" 
                  data-reftarget='Refresh'
                  data-targetaction='button'>
                <span class="interactive-comment">The <strong>Refresh</strong> button executes your LogQL query and displays the log results from your Loki data source.</span>
                Click the <strong>Refresh</strong> button to execute the query and see your logs.
              </li>

              <li class="interactive" data-targetaction="multistep">
                <span class="interactive"
                  data-reftarget='button[data-testid="data-testid toggle-viz-picker"]'
                  data-targetaction="highlight">
                  <span class="interactive-comment">The <strong>Logs</strong> visualization is specifically designed for displaying log data with features like log level highlighting, filtering, and live tailing.</span>
                </span>
                <span class="interactive" data-reftarget='div[aria-label="Plugin visualization item Logs"]' data-targetaction="highlight"></span>
                Change the <strong>Visualization type</strong> to <strong>Logs</strong>.
              </li>

              <li class="interactive"
                  data-reftarget='input[data-testid="data-testid Panel editor option pane field input Title"]'
                  data-targetaction='formfill' 
                  data-targetvalue='Alloy Logs'>
                <span class="interactive-comment">The <strong>Title</strong> is the name of the panel. It helps identify what logs you're viewing in the dashboard.</span>
                In the panel options, change the <strong>Title</strong> to <strong>Alloy Logs</strong>.
              </li>

              <li class="interactive" data-targetaction="multistep">
                <span class="interactive" data-reftarget="Save Dashboard" data-targetaction="button"></span>
                <span class="interactive" data-reftarget="Save" data-targetaction="button"></span>
                Click <strong>Save Dashboard</strong> to persist your changes.
              </li>
            </ul>
        </span>

        <h2>🎉 Great job!</h2>
        <p>You now have Loki configured and a logs panel added to your existing dashboard. Consider exploring alerting for logs or drilling down between metrics and logs.</p>
        <ul>
            <li>✅ Configured the Loki data source (http://loki:3100)</li>
            <li>✅ Built a Logs visualization on the existing dashboard</li>
        </ul>
    </body>
</html>`;
