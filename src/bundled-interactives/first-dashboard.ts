// Export the HTML content as a string
// This avoids webpack configuration issues with .html files

export const firstDashboardHtml = `<html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Create a Dashboard of Grafana News</title>
    </head>
    <body>
        <h1>Create your first dashboard</h1>
        
        <p>Welcome! In this tutorial, you'll learn how to create your first Grafana dashboard by following Jack and Jill on their hiking adventure. You'll start by exploring sample data in Explore, then transform that data into a beautiful visualization on a dashboard.</p>
        
        <p>By the end of this tutorial, you'll understand how to query data, add labels to organize your metrics, and create meaningful visualizations that tell a story with your data.</p>
        
        <h2>Explore your data</h2>
        
        <p>Before building a dashboard, it's a good practice to explore your data first. Think of Explore as your data playground - it's where you can experiment with queries, understand what your data looks like, and test different approaches without committing to a dashboard.</p>
        
        <p>Let's start by tracking Jack and Jill's hiking altitude using sample data from Grafana's built-in TestData source.</p>

        <span id="tutorial-section"
              class="interactive"
              data-targetaction="sequence"
              data-reftarget="span#tutorial-section">
            <ul>
            <li class="interactive"
                data-targetaction='highlight'
                data-reftarget='a[data-testid="data-testid Nav menu item"][href="/explore"]'>
                <span class="interactive-comment">
                    Explore is Grafana's investigation workspace. Unlike dashboards which display predefined visualizations, Explore lets you freely query your data sources and see results immediately. This makes it perfect for experimenting and understanding your data before committing to a dashboard design.
                </span>
                Navigate to <strong>Explore</strong> to begin querying data.
            </li>

            <li class="interactive" data-targetaction='multistep'>
                <span class="interactive" data-targetaction='highlight' data-reftarget='input[data-testid="data-testid Select a data source"]'></span>
                <span class="interactive" data-targetaction='highlight' data-reftarget='button:contains("gdev-testdata defaultTestData")'></span>
                <span class="interactive-comment">
                    In real-world scenarios, you'd connect to data sources like Prometheus for metrics, Loki for logs, or databases like PostgreSQL. For learning purposes, Grafana includes TestData - a built-in data source that generates realistic sample data without requiring any external setup. This lets you practice building dashboards right away.
                </span>
                Select the <strong>TestData</strong> data source to work with sample data.
            </li>

            <li class="interactive"
                data-targetaction='formfill'
                data-reftarget='input[id="test-data-scenario-select-A"]'
                data-targetvalue='Random Walk'>
                <span class="interactive-comment">
                    Random Walk generates time series data that changes randomly over time, similar to how real metrics behave. Imagine tracking Jack's altitude as he climbs up and down hills - it goes up and down, but with natural variation. This type of data is perfect for simulating real-world metrics like CPU usage, temperature readings, or in our case, hiking altitude.
                </span>
                Choose <strong>Random Walk</strong> to simulate Jack's hiking altitude data.
            </li>

            <li class="interactive"
                data-targetaction='formfill'
                data-reftarget='input[id="labels-A"]'
                data-targetvalue='walker=jack'>
                <span class="interactive-comment">
                    Labels are key-value pairs that add context to your data. Think of them as tags that help you identify and filter your metrics. In our hiking story, we'll use labels to distinguish between Jack and Jill's individual altitude measurements. This is exactly how you'd use labels in production - to distinguish between different servers, applications, or users.
                </span>
                Add the label <strong>walker=jack</strong> to identify Jack's hiking data.
            </li>

            <li class="interactive"
                data-targetaction='highlight'
                data-reftarget='button:contains("Add query")'>
                <span class="interactive-comment">
                    Now let's add Jill's hiking data! In Grafana, you can display multiple queries on the same graph to compare and contrast data. This is incredibly powerful - imagine comparing CPU usage across different servers, or in our case, comparing Jack and Jill's hiking altitudes to see who climbed higher.
                </span>
                Click <strong>Add query</strong> to create a second data series for Jill.
            </li>

            <li class="interactive"
                data-targetaction='formfill'
                data-reftarget='input[id="labels-B"]'
                data-targetvalue='walker=jill'>
                <span class="interactive-comment">
                    Now we'll add Jill's label to the second query. By using the same label key (<code>walker</code>) but different values (<code>jack</code> vs <code>jill</code>), Grafana can automatically differentiate between the two data series in visualizations. This labeling strategy is a best practice in observability - it keeps your data organized and queryable.
                </span>
                Add the label <strong>walker=jill</strong> to identify Jill's hiking data.
            </li>

            </ul>
        </span>

        <h2>Create a dashboard</h2>
        
        <p>Great work! You've explored Jack and Jill's hiking data and set up two labeled queries. Now comes the exciting part - transforming this raw data into a permanent, shareable dashboard.</p>
        
        <p>Dashboards are where your data comes to life. Unlike the temporary workspace of Explore, dashboards provide persistent visualizations that you and your team can reference anytime. Let's create your first one!</p>

        <span id="dashboard-section"
              class="interactive"
              data-targetaction="sequence"
              data-reftarget="span#dashboard-section">
            <ul>
            <li class="interactive" data-targetaction='multistep'>
                <span class="interactive" data-targetaction='highlight' data-reftarget='button[aria-label="Add"]'></span>
                <span class="interactive" data-targetaction='highlight' data-reftarget='button:contains("Add to dashboard")'></span>
                <span class="interactive" data-targetaction='highlight' data-reftarget='button:contains("Open dashboard")'></span>
                <span class="interactive-comment">
                    One of Grafana's best features is the seamless transition from Explore to dashboards. Instead of manually recreating your queries, you can send them directly from Explore to a new or existing dashboard. This workflow saves time and ensures your carefully crafted queries make it to your dashboard exactly as you tested them.
                </span>
                Use the <strong>Add</strong> button to send your queries to a new dashboard.
            </li>

            <li class="interactive" data-targetaction='multistep'>
                <span class="interactive" data-targetaction='highlight' data-reftarget='button[data-testid="data-testid Panel menu New Panel"]'></span>
                <span class="interactive" data-targetaction='highlight' data-reftarget='a[data-testid="data-testid Panel menu item Edit"]'></span>
                <span class="interactive-comment">
                    Welcome to your new dashboard! The panel editor is where the magic happens. Each visualization on a dashboard is called a "panel," and the panel editor gives you complete control over how your data looks and behaves. Let's customize this panel to better tell Jack and Jill's hiking story.
                </span>
                Open the panel editor to customize your visualization.
            </li>

            <li class="interactive" data-targetaction='multistep'>
                <span class="interactive" data-targetaction='highlight' data-reftarget='button[data-testid="data-testid toggle-viz-picker"]'></span>
                <span class="interactive" data-targetaction='highlight' data-reftarget='div[data-testid="Plugin visualization item Bar chart"]'></span>
                <span class="interactive-comment">
                    Choosing the right visualization is key to telling your data's story. Time series graphs show trends over time, stat panels display single values, tables show raw data, and bar charts compare values side by side. For comparing Jack and Jill's final altitudes, a bar chart makes the difference instantly clear - you can see at a glance who climbed higher!
                </span>
                Change the visualization to <strong>Bar chart</strong> to compare altitudes.
            </li>

            <li class="interactive"
                data-targetaction='formfill'
                data-reftarget='input[data-testid="data-testid Panel editor option pane field input Title"]'
                data-targetvalue='Jack and Jill Walk Altitude'>
                <span class="interactive-comment">
                    A good panel title transforms raw data into a story. Instead of generic names like "Query A" or "Metric 1," use descriptive titles that immediately convey what the data represents. This is especially important when sharing dashboards with teammates who might not know the context. Your future self will thank you too!
                </span>
                Give your panel a clear title: <strong>Jack and Jill Walk Altitude</strong>.
            </li>

            <li class="interactive"
                data-targetaction='highlight'
                data-reftarget='input[id="barchart-unit"]'
                data-targetvalue='ALT'
                data-doit='false'
                >
                <span class="interactive-comment">
                    Units give meaning to numbers. Is that value 42 seconds, bytes, requests, or meters? Without units, numbers are just numbers. Grafana can automatically format values based on their units - bytes become KB/MB/GB, seconds become ms/s/m, and so on. This polish makes your dashboards professional and removes ambiguity.
                </span>
                We can give our walking data meaning by setting a unit.
            </li>
                <li class="interactive" data-targetaction="multistep">
                <span class="interactive" data-reftarget="Save Dashboard" data-targetaction="button"></span>
                <span class="interactive" data-reftarget='input[aria-label="Save dashboard title field"]' 
                  data-targetaction="formfill" data-targetvalue="Walking Adventure"></span>
                <span class="interactive" data-reftarget="Save" data-targetaction="button"></span>
                Click <strong>Save Dashboard</strong>, name it <strong>Walking Adventure</strong>, and click <strong>Save</strong>.
              </li>
            </ul>
        </span>

        <h2>🎉 Congratulations!</h2>
        
        <p>You've just created your first Grafana dashboard! Let's recap what you learned:</p>
        
        <ul>
            <li><strong>Explore first, dashboard later</strong> - Use Explore to experiment with queries before committing them to dashboards.</li>
            <li><strong>Labels organize your data</strong> - Key-value pairs like <code>walker=jack</code> help you identify and filter time series data.</li>
            <li><strong>Multiple queries tell richer stories</strong> - Comparing data series reveals patterns and insights you'd miss looking at them individually.</li>
            <li><strong>Visualization choice matters</strong> - Bar charts for comparisons, time series for trends, tables for raw data - pick the right tool for your story.</li>
            <li><strong>Polish makes perfect</strong> - Clear titles and proper units transform raw data into professional, understandable dashboards.</li>
        </ul>
        
        <h3>What's next?</h3>
        
        <p>Now that you understand the basics, you're ready to explore more:</p>
        
        <ul>
            <li><strong>Try different visualizations</strong> - Change your bar chart to a time series graph to see Jack and Jill's altitude over time.</li>
            <li><strong>Add more panels</strong> - Dashboards can contain many panels. Try adding another panel to show different aspects of the data.</li>
            <li><strong>Connect real data sources</strong> - The principles you learned with TestData apply to real sources like Prometheus, Loki, or databases.</li>
            <li><strong>Explore transformations</strong> - Learn how to calculate rates, aggregate data, and perform advanced data manipulation.</li>
        </ul>
        
        <p>Remember: every expert started exactly where you are now. The journey from first dashboard to complex monitoring systems is just a series of small steps, and you've taken the first one!</p>

    </body>
</html>`;
