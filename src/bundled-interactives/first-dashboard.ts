// Export the HTML content as a string
// This avoids webpack configuration issues with .html files

export const firstDashboardHtml = `<html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Create a Dashboard of Grafana News</title>
    </head>
    <body>
        <h1>Make your First Dashboard</h1>

        <p>In this tutorial, we'll make your first dashboard, of Grafana news.  To do this, we'll learn the following
            parts of Grafana in sequence:
         <ul>
             <li>Installing plugins to get access to data (in our case, RSS feeds)</li>
             <li>Creating data sources, so we have something to visualize</li>
             <li>Creating a dashboard that uses that datasource</li>
             <li>Setting up basic Alerting</li>
         </ul>
        </p>

        <h2>Step 1: Install a plugin</h2>

        <p>We'll use the <em>Business News</em> plugin.</p>

        <span id="install-plugin" class="interactive" data-objectives="has-plugin:volkovlabs-rss-datasource" data-requirements="navmenu-open" data-targetaction="sequence" data-reftarget="span#install-plugin"> 
            <ul>
              <!--
              <li class="interactive" data-targetaction="multistep">
                <span class="interactive" data-requirements="navmenu-open"
                  data-reftarget="a[data-testid='data-testid Nav menu item'][href='/admin/plugins']"
                  data-targetaction="highlight"></span>
                <span class="interactive" data-reftarget="a[href='/plugins']" data-targetaction="highlight"></span>
                <span class="interactive" data-reftarget="input[type='text']" data-targetaction="formfill" data-targetvalue="Business News"></span>
                Do a 3 Step Dance Just Because
              </li>
              -->
            
              <li class="interactive" data-requirements="navmenu-open"
                  data-reftarget="a[data-testid='data-testid Nav menu item'][href='/admin/plugins']"
                  data-targetaction='highlight'>
                Click Administration &gt; Plugins &amp; Data in the left-side menu.</li>

              <li class="interactive" data-reftarget="a[href='/plugins']" data-targetaction='highlight'>
                  Click the Plugins button
              </li>

              <li class="interactive" data-reftarget="input[type='text']" data-targetaction='formfill' data-targetvalue='Business News'>
                 Use the search bar to search for "Business News" (the plugin we'll be using)
              </li>

              <li class="interactive" data-reftarget="a[href='/plugins/volkovlabs-rss-datasource']" data-targetaction='highlight'>
                Click the Business News button that appears.
              </li>

              <li 
                  class='interactive' 
                  data-hint="You'll need to be logged in, and an administrator"
                  data-requirements="is-admin"
                  data-skipable="true"
                  data-reftarget='Install' 
                  data-targetaction='button'
                  data-verify="has-plugin:volkovlabs-rss-datasource">
                Click the Install Button (requires admin privileges - can be skipped if you don't have access)
              </li>
            </ul>
        </span>    
        
        <h2>Step 2: Create a Datasource</h2>

        <p>A datasource lets us specify which feed we want to use, so we can query it in a dashboard.</p>

        <span id="create-datasource" 
            class="interactive" 
            data-targetaction="sequence" 
            data-reftarget="span#create-datasource"
            data-requirements="navmenu-open,has-plugin:volkovlabs-rss-datasource"
            data-objectives="has-datasource:volkovlabs-rss-datasource"> 
            <ul>
              <!-- Highlight a menu item and click it -->
              <li class="interactive" 
                  data-reftarget="a[data-testid='data-testid Nav menu item'][href='/connections']"
                  data-targetaction='highlight'>
                Click Connections in the left-side menu.</li>
              <li class="interactive" data-reftarget="input[type='text']"
                data-targetaction='formfill' data-targetvalue='Business News'>
                Enter Business News in the search bar.</li>
              <li class="interactive" 
                  data-reftarget="a[href='/connections/datasources/volkovlabs-rss-datasource']"
                  data-targetaction='highlight'>
                Click Business News data source.</li>
              <li class="interactive"
                  data-reftarget="Add new data source"
                  data-targetaction='button'>
                Click Add new data source in the upper right.
              </li>
              <li class="interactive"
                  data-reftarget="input[id='basic-settings-name']"
                  data-targetaction='formfill' data-targetvalue='Reddit /r/grafana'>
                Name the data source "Reddit /r/grafana"
              </li>
              <li class="interactive"
                  data-reftarget="input[placeholder='https://feed']"
                  data-targetaction="formfill" data-targetvalue="https://www.reddit.com/r/grafana/.rss">
                Input the feed URL, which is <pre>https://www.reddit.com/r/grafana/.rss</pre>
              </li>
              <li class="interactive"
                  data-reftarget="Save & Test"
                  data-targetaction="button">
                Click "Save &amp Test" to save the data source.
              </li>
            </ul>
        </span>    
                
        <h2>Step 3: Create a Dashboard</h2>

        <p>In this section, we'll use the datasource we created to create a visualization.</p>
        
        <span id="create-dashboard" 
              class='interactive' 
              data-targetaction='sequence' 
              data-reftarget="span#create-dashboard"
              data-requirements="has-datasource:volkovlabs-rss-datasource">
            <ul>
              <li class="interactive" 
                  data-reftarget="a[data-testid='data-testid Nav menu item'][href='/dashboards']"
                  data-targetaction='highlight'>
                Click Dashboards in the left-side menu.</li>
              <li class="interactive"
                  data-reftarget="/dashboard/new"
                  data-targetaction='navigate'>
                  Click the New > Dashboard button"
              </li>

              <li class="interactive" data-targetaction="multistep">
                 <span class="interactive" data-targetaction="button" data-reftarget="Add Visualization"></span>
                 <span class="interactive" data-targetaction="button" data-reftarget="Business News"></span>
                  Click "Add Visualization", Select the Business News/Reddit /r/grafana option.
              </li>
              <!--
              <li class="interactive" data-targetaction="button" data-reftarget="Add Visualization">
                Click "Add Visualization", 
              </li>
              <li class="interactive" data-targetaction="button" data-reftarget="Business News">
                Select the Business News/Reddit /r/grafana option.
              </li>
              -->

              <li class="interactive" data-targetaction="multistep">
                <span class="interactive"
                  data-reftarget='button[data-testid="data-testid toggle-viz-picker"]'
                  data-targetaction="highlight"></span>
                <span class="interactive"
                  data-reftarget='div[aria-label="Plugin visualization item Table"]'
                  data-targetaction="highlight"></span>
                Click on the Visualization type, Search for "Table", Click Table.
              </li>

              <!--
              <li class="interactive"
                  data-reftarget='button[data-testid="data-testid toggle-viz-picker"]'
                  data-targetaction='highlight'>
                  Click on the Visualization type
              </li>
              <li>
                  Search for "Table"
              </li>
              <li class="interactive"
                  data-reftarget='div[data-test-id="Plugin visualization item Table"]'
                  data-targetaction='highlight'>
                  Click Table
              </li>
              -->

              <li class="interactive" data-targetaction="multistep">
                <span class="interactive" data-reftarget="Save Dashboard" data-targetaction="button"></span>
                <span class="interactive" data-reftarget='input[aria-label="Save dashboard title field"]' 
                  data-targetaction="formfill" data-targetvalue="Grafana News"></span>
                <span class="interactive" data-reftarget="Save" data-targetaction="button"></span>
                  Click Save Dashboard, name the dashboard "Grafana News" and click Save.
              </li>

             <!--
              <li class="interactive" data-reftarget="Save Dashboard" data-targetaction="button">
                 Click Save Dashboard
              </li>
              <li class="interactive" data-reftarget='input[aria-label="Save dashboard title field"]' 
                  data-targetaction="formfill" data-targetvalue="Grafana News">
                  Name the dashboard "Grafana News"
              </li>

              <li class="interactive" data-reftarget="Save" data-targetaction="button">
                  Click Save
              </li>
            -->
            </ul>
        </span>

        <p>That's it! You've got a basic dashboard.</p>
        
    </body>
</html>`;
