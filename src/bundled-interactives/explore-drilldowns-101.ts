// Export the HTML content as a string
// This avoids webpack configuration issues with .html files

export const exploreDrilldowns101Html = `<html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Explore Drilldowns</title>
    </head>
    <body>
        <p><strong>Prerequisite:</strong> Complete <a href="bundled:loki-grafana-101">Loki + Grafana 101 (Part 2)</a> first.</p>
        <h1>Explore Drilldowns</h1>

        <p>In this part, you'll explore the Drilldowns experience to pivot from metrics to related metrics and logs.</p>

        <h2>Section: Drilldown Metrics</h2>

        <span id="drilldown-metrics"
              class="interactive"
              data-targetaction="sequence"
              data-reftarget="span#drilldown-metrics"
              data-requirements="navmenu-open,has-datasource:prometheus,has-datasource:loki">
          <ul>
            <li class="interactive"
                data-reftarget="a[data-testid='data-testid Nav menu item'][href='/a/grafana-metricsdrilldown-app/drilldown']"
                data-targetaction='highlight'>
              Select <strong>Metrics</strong> from the left navigation menu.
            </li>

            <li class="interactive"
                data-reftarget='input[placeholder="Filter by label values"]'
                data-targetaction='formfill'
                data-targetvalue='container = "alloy"'>
              Filter by label: enter <code>container = "alloy"</code>.
            </li>

            <li class="interactive"
                data-reftarget='h2[title="alloy_component_controller_running_components"]'
                data-targetaction='highlight'>
              Highlight the <strong>alloy_component_controller_running_components</strong> metric.
            </li>

            <li class="interactive"
                data-reftarget='button[data-testid="select-action-alloy_component_controller_running_components"]'
                data-targetaction='highlight'>
              Click <strong>Select</strong> to choose the metric.
            </li>

            <li class="interactive"
                data-reftarget='button[data-testid="data-testid Tab Related metrics"]'
                data-targetaction='highlight'>
              Open the <strong>Related metrics</strong> tab.
            </li>

            <li class="interactive"
                data-reftarget='button[data-testid="data-testid Tab Related logs"]'
                data-targetaction='highlight'>
              Open the <strong>Related logs</strong> tab.
            </li>
          </ul>
        </span>

        <h2>🎉 Done!</h2>
        <p>You explored the drilldown workflow and pivoted between a metric and related signals.</p>

    </body>
</html>`;


