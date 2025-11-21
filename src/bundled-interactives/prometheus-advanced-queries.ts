// Export the HTML content as a string
// Advanced PromQL queries tutorial with assistant-customizable examples

export const prometheusAdvancedQueriesHtml = `<html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Advanced Prometheus Queries</title>
    </head>
    <body>
        <div class="admonition admonition-note">
            <blockquote>
                <p class="title text-uppercase">Prerequisites</p>
                <p>This tutorial builds on <a href="bundled:prometheus-grafana-101">Prometheus + Grafana 101</a>. You should have:</p>
                <ul>
                    <li>✅ Completed the Prometheus + Grafana 101 tutorial</li>
                    <li>✅ A working Prometheus data source configured</li>
                    <li>✅ Basic understanding of PromQL syntax</li>
                    <li>✅ Familiarity with the Explore tab</li>
                </ul>
                <p><strong>💡 Assistant Customization:</strong> This tutorial uses queries you can customize with Grafana Assistant to match your specific datasources and metrics!</p>
            </blockquote>
        </div>

        <h1>Advanced Prometheus Queries</h1>

        <p>Welcome to advanced PromQL! In this guide, we'll explore powerful query patterns that help you extract deeper insights from your metrics. Each query example can be customized using Grafana Assistant to work with your specific environment.</p>

        <h2>Section 1: Advanced Aggregations and Grouping</h2>
        <p>Master the art of aggregating metrics across multiple dimensions and time ranges.</p>

        <li class="interactive" 
            data-targetaction='multistep'
            data-requirements='on-page:/explore,has-datasource:prometheus'
            >
            <span class="interactive" data-targetaction='highlight' data-reftarget='grafana:components.DataSourcePicker.inputV2' data-requirements='exists-reftarget'></span>
            <span class="interactive" data-targetaction='button' data-reftarget='prometheus' data-requirements='exists-reftarget'></span>
            <span class="interactive-comment">
                This tutorial uses Prometheus as the data source. If you completed the Prometheus + Grafana 101 tutorial, you should already have a Prometheus datasource configured. If not, you can select any available Prometheus datasource in your instance.
            </span>
            Select your <strong>Prometheus</strong> data source from the picker.
        </li>

        <li class="interactive" 
            data-reftarget='div[data-testid="QueryEditorModeToggle"] label[for^="option-code-radiogroup"]'
            data-targetaction='highlight'
            data-requirements='exists-reftarget'>
          Make sure you're in <strong>Code</strong> mode to write PromQL queries directly.
        </li>

        <h3>Multi-Dimensional Grouping</h3>
        <p>Group metrics by multiple labels to create detailed breakdowns:</p>
        
        <li class="interactive"
            data-reftarget='textarea.inputarea'
            data-targetaction='formfill'
            data-targetvalue='@@CLEAR@@ sum(rate(prometheus_http_requests_total[5m])) by (job, instance, handler)'
            data-requirements='exists-reftarget'>
          Try this multi-dimensional grouping query:
          <pre><assistant data-assistant-id="query-multi-group" data-assistant-type="query">sum(rate(prometheus_http_requests_total[5m])) by (job, instance, handler)</assistant></pre>
        </li>
        
        <p>This query calculates the request rate per second, grouped by job, instance, and handler (endpoint). The <code>rate()</code> function handles counter resets, and <code>sum()</code> aggregates across other labels.</p>

        <h3>Top-K Results</h3>
        <p>Find the highest or lowest values using <code>topk()</code> and <code>bottomk()</code>:</p>
        
        <li class="interactive"
            data-reftarget='textarea.inputarea'
            data-targetaction='formfill'
            data-targetvalue='@@CLEAR@@ topk(5, sum(rate(prometheus_http_requests_total[5m])) by (handler))'
            data-requirements='exists-reftarget'>
          Find the top 5 endpoints by request rate:
          <pre><assistant data-assistant-id="query-topk" data-assistant-type="query">topk(5, sum(rate(prometheus_http_requests_total[5m])) by (handler))</assistant></pre>
        </li>
        
        <p>This identifies the 5 handlers (API endpoints) receiving the most requests. Perfect for finding hotspots in your Prometheus server.</p>

        <h3>Without and By - Advanced Label Selection</h3>
        <p>Use <code>without</code> to exclude specific labels from grouping:</p>
        
        <li class="interactive"
            data-reftarget='textarea.inputarea'
            data-targetaction='formfill'
            data-targetvalue='@@CLEAR@@ sum(rate(prometheus_http_requests_total[5m])) without (instance)'
            data-requirements='exists-reftarget'>
          Aggregate across instances using <code>without</code>:
          <pre><assistant data-assistant-id="query-without" data-assistant-type="query">sum(rate(prometheus_http_requests_total[5m])) without (instance)</assistant></pre>
        </li>
        
        <p>This aggregates across all instances, keeping only job and other labels. Useful when you care about service-level metrics but not individual instances.</p>

        <h2>Section 2: Label Matching and Filtering</h2>
        <p>Learn powerful techniques for filtering and matching metrics based on labels.</p>

        <h3>Regular Expression Matching</h3>
        <p>Use regex to match multiple label values:</p>
        
        <li class="interactive"
            data-reftarget='textarea.inputarea'
            data-targetaction='formfill'
            data-targetvalue='@@CLEAR@@ prometheus_http_requests_total{code=~"5..", handler!~"/|/-/.*"}'
            data-requirements='exists-reftarget'>
          Filter using regex patterns:
          <pre><assistant data-assistant-id="query-regex" data-assistant-type="query">prometheus_http_requests_total{code=~"5..", handler!~"/|/-/.*"}</assistant></pre>
        </li>
        
        <p>This matches all 5xx status codes (<code>=~</code>) and excludes root and health check handlers (<code>!~</code>). The <code>=~</code> operator allows regex patterns for flexible label matching.</p>

        <h3>Label Joins with On and Ignoring</h3>
        <p>Combine metrics from different time series:</p>
        
        <li class="interactive"
            data-reftarget='textarea.inputarea'
            data-targetaction='formfill'
            data-targetvalue='@@CLEAR@@ rate(prometheus_http_requests_total[5m]) * on(instance) group_left(version) alloy_build_info'
            data-requirements='exists-reftarget'>
          Join metrics using label matching:
          <pre><assistant data-assistant-id="query-label-join" data-assistant-type="query">rate(prometheus_http_requests_total[5m])
  * on(instance) group_left(version)
  alloy_build_info</assistant></pre>
        </li>
        
        <p>This enriches request rate data with version information from Alloy build info. The <code>on(instance)</code> clause specifies the matching label, and <code>group_left</code> brings labels from the right side.</p>

        <h2>Section 3: Time-Based Analysis</h2>
        <p>Unlock the power of time-based calculations and comparisons.</p>

        <h3>Over-Time Aggregations</h3>
        <p>Calculate statistics over a time range:</p>
        
        <li class="interactive"
            data-reftarget='textarea.inputarea'
            data-targetaction='formfill'
            data-targetvalue='@@CLEAR@@ max_over_time(rate(process_cpu_seconds_total[5m])[1h:1m])'
            data-requirements='exists-reftarget'>
          Calculate maximum CPU rate over time:
          <pre><assistant data-assistant-id="query-overtime" data-assistant-type="query">max_over_time(rate(process_cpu_seconds_total[5m])[1h:1m])</assistant></pre>
        </li>
        
        <p>This finds the maximum CPU rate in the last hour for each process. Other functions: <code>min_over_time</code>, <code>avg_over_time</code>, <code>stddev_over_time</code>.</p>

        <h3>Derivatives and Rates</h3>
        <p>Calculate change rates for gauges and counters:</p>
        
        <li class="interactive"
            data-reftarget='textarea.inputarea'
            data-targetaction='formfill'
            data-targetvalue='@@CLEAR@@ deriv(process_resident_memory_bytes[5m])'
            data-requirements='exists-reftarget'>
          Calculate derivative for gauge metrics:
          <pre><assistant data-assistant-id="query-deriv" data-assistant-type="query">deriv(process_resident_memory_bytes[5m])</assistant></pre>
        </li>
        
        <p>The <code>deriv()</code> function calculates how fast a gauge is changing per second. Unlike <code>rate()</code>, this works for gauges that can go up or down (like memory usage).</p>

        <h3>Offset Modifier</h3>
        <p>Compare current values with past values:</p>
        
        <li class="interactive"
            data-reftarget='textarea.inputarea'
            data-targetaction='formfill'
            data-targetvalue='@@CLEAR@@ (rate(prometheus_http_requests_total[5m]) - rate(prometheus_http_requests_total[5m] offset 1h)) / rate(prometheus_http_requests_total[5m] offset 1h) * 100'
            data-requirements='exists-reftarget'>
          Compare current vs 1 hour ago:
          <pre><assistant data-assistant-id="query-offset" data-assistant-type="query">(
  rate(prometheus_http_requests_total[5m])
  -
  rate(prometheus_http_requests_total[5m] offset 1h)
) / rate(prometheus_http_requests_total[5m] offset 1h) * 100</assistant></pre>
        </li>
        
        <p>This calculates the percentage change in request rate compared to 1 hour ago. The <code>offset</code> modifier shifts the time window backward.</p>

        <h2>Section 4: Arithmetic and Binary Operations</h2>
        <p>Combine metrics using mathematical operations.</p>

        <h3>Error Rate Calculation</h3>
        <p>Calculate the percentage of failed requests:</p>
        
        <li class="interactive"
            data-reftarget='textarea.inputarea'
            data-targetaction='formfill'
            data-targetvalue='@@CLEAR@@ sum(rate(prometheus_http_requests_total{code=~"5.."}[5m])) by (job) / sum(rate(prometheus_http_requests_total[5m])) by (job) * 100'
            data-requirements='exists-reftarget'>
          Calculate error rate percentage:
          <pre><assistant data-assistant-id="query-error-rate" data-assistant-type="query">sum(rate(prometheus_http_requests_total{code=~"5.."}[5m])) by (job)
  /
sum(rate(prometheus_http_requests_total[5m])) by (job)
  * 100</assistant></pre>
        </li>
        
        <p>This divides error requests by total requests and multiplies by 100 to get a percentage. Perfect for SLO tracking.</p>

        <h3>Resource Utilization Ratios</h3>
        <p>Calculate utilization as a percentage:</p>
        
        <li class="interactive"
            data-reftarget='textarea.inputarea'
            data-targetaction='formfill'
            data-targetvalue='@@CLEAR@@ (process_resident_memory_bytes / process_virtual_memory_max_bytes) * 100'
            data-requirements='exists-reftarget'>
          Calculate memory utilization percentage:
          <pre><assistant data-assistant-id="query-utilization" data-assistant-type="query">(
  process_resident_memory_bytes
  /
  process_virtual_memory_max_bytes
) * 100</assistant></pre>
        </li>
        
        <p>This calculates process memory utilization percentage. The formula: (resident/max) * 100 shows how much of the available memory is in use.</p>

        <h3>Clamping Values</h3>
        <p>Limit values to a specific range:</p>
        
        <li class="interactive"
            data-reftarget='textarea.inputarea'
            data-targetaction='formfill'
            data-targetvalue='@@CLEAR@@ clamp_max(clamp_min(prediction_value, 0), 100)'
            data-requirements='exists-reftarget'>
          Clamp values between 0 and 100:
          <pre><assistant data-assistant-id="query-clamp" data-assistant-type="query">clamp_max(clamp_min(prediction_value, 0), 100)</assistant></pre>
        </li>
        
        <p>The <code>clamp_min</code> and <code>clamp_max</code> functions ensure values stay within bounds (0-100 in this case).</p>

        <h2>Section 5: Histogram and Summary Metrics</h2>
        <p>Work with distribution metrics for advanced percentile analysis.</p>

        <h3>Quantile Calculation</h3>
        <p>Calculate the 95th percentile from a histogram:</p>
        
        <li class="interactive"
            data-reftarget='textarea.inputarea'
            data-targetaction='formfill'
            data-targetvalue='@@CLEAR@@ histogram_quantile(0.95, sum(rate(go_gc_duration_seconds_bucket[5m])) by (le, job))'
            data-requirements='exists-reftarget'>
          Calculate 95th percentile GC duration:
          <pre><assistant data-assistant-id="query-quantile" data-assistant-type="query">histogram_quantile(0.95,
  sum(rate(go_gc_duration_seconds_bucket[5m])) by (le, job)
)</assistant></pre>
        </li>
        
        <p>This calculates the 95th percentile of garbage collection duration. The <code>le</code> label (less than or equal) is required for histogram buckets.</p>

        <h3>Histogram Average</h3>
        <p>Calculate the average from histogram buckets:</p>
        
        <li class="interactive"
            data-reftarget='textarea.inputarea'
            data-targetaction='formfill'
            data-targetvalue='@@CLEAR@@ sum(rate(go_gc_duration_seconds_sum[5m])) / sum(rate(go_gc_duration_seconds_count[5m]))'
            data-requirements='exists-reftarget'>
          Calculate average from histogram:
          <pre><assistant data-assistant-id="query-hist-avg" data-assistant-type="query">sum(rate(go_gc_duration_seconds_sum[5m]))
  /
sum(rate(go_gc_duration_seconds_count[5m]))</assistant></pre>
        </li>
        
        <p>Histograms expose <code>_sum</code> (total duration) and <code>_count</code> (number of observations). Dividing them gives the average GC duration.</p>

        <h3>Multiple Quantiles</h3>
        <p>Compare different percentiles:</p>
        
        <li class="interactive"
            data-reftarget='textarea.inputarea'
            data-targetaction='formfill'
            data-targetvalue='@@CLEAR@@ histogram_quantile(0.50, sum(rate(go_gc_duration_seconds_bucket[5m])) by (le)) or histogram_quantile(0.90, sum(rate(go_gc_duration_seconds_bucket[5m])) by (le)) or histogram_quantile(0.99, sum(rate(go_gc_duration_seconds_bucket[5m])) by (le))'
            data-requirements='exists-reftarget'>
          Show p50, p90, and p99 GC durations:
          <pre><assistant data-assistant-id="query-multi-quantile" data-assistant-type="query">histogram_quantile(0.50, sum(rate(go_gc_duration_seconds_bucket[5m])) by (le))
or
histogram_quantile(0.90, sum(rate(go_gc_duration_seconds_bucket[5m])) by (le))
or
histogram_quantile(0.99, sum(rate(go_gc_duration_seconds_bucket[5m])) by (le))</assistant></pre>
        </li>
        
        <p>The <code>or</code> operator combines multiple queries. This shows p50, p90, and p99 garbage collection durations in one graph.</p>

        <h2>Section 6: Predictive and Statistical Functions</h2>
        <p>Use statistical functions for forecasting and anomaly detection.</p>

        <h3>Linear Prediction</h3>
        <p>Predict future values based on past trends:</p>
        
        <li class="interactive"
            data-reftarget='textarea.inputarea'
            data-targetaction='formfill'
            data-targetvalue='@@CLEAR@@ predict_linear(process_resident_memory_bytes[1h], 4 * 3600)'
            data-requirements='exists-reftarget'>
          Predict memory usage 4 hours ahead:
          <pre><assistant data-assistant-id="query-predict" data-assistant-type="query">predict_linear(process_resident_memory_bytes[1h], 4 * 3600)</assistant></pre>
        </li>
        
        <p>This predicts resident memory usage 4 hours from now based on the last hour's trend. Useful for capacity planning and memory leak detection alerts.</p>

        <h3>Holt-Winters Smoothing</h3>
        <p>Smooth seasonal data and predict values:</p>
        
        <li class="interactive"
            data-reftarget='textarea.inputarea'
            data-targetaction='formfill'
            data-targetvalue='@@CLEAR@@ holt_winters(prometheus_http_requests_total[1h], 0.5, 0.5)'
            data-requirements='exists-reftarget'>
          Apply Holt-Winters smoothing:
          <pre><assistant data-assistant-id="query-holt-winters" data-assistant-type="query">holt_winters(prometheus_http_requests_total[1h], 0.5, 0.5)</assistant></pre>
        </li>
        
        <p>The <code>holt_winters()</code> function smooths seasonal metrics. The two parameters control smoothing factors (0-1).</p>

        <h3>Standard Deviation</h3>
        <p>Detect anomalies using standard deviation:</p>
        
        <li class="interactive"
            data-reftarget='textarea.inputarea'
            data-targetaction='formfill'
            data-targetvalue='@@CLEAR@@ abs(rate(prometheus_http_requests_total[5m]) - avg_over_time(rate(prometheus_http_requests_total[5m])[1h:5m])) > (2 * stddev_over_time(rate(prometheus_http_requests_total[5m])[1h:5m]))'
            data-requirements='exists-reftarget'>
          Detect anomalies with standard deviation:
          <pre><assistant data-assistant-id="query-stddev" data-assistant-type="query">abs(
  rate(prometheus_http_requests_total[5m])
  -
  avg_over_time(rate(prometheus_http_requests_total[5m])[1h:5m])
) > (2 * stddev_over_time(rate(prometheus_http_requests_total[5m])[1h:5m]))</assistant></pre>
        </li>
        
        <p>This detects when the current rate is more than 2 standard deviations from the 1-hour average. Classic anomaly detection pattern.</p>

        <h2>Section 7: Subqueries and Complex Aggregations</h2>
        <p>Master subqueries for advanced time-series analysis.</p>

        <h3>Rolling Average</h3>
        <p>Calculate a moving average using subqueries:</p>
        
        <li class="interactive"
            data-reftarget='textarea.inputarea'
            data-targetaction='formfill'
            data-targetvalue='@@CLEAR@@ avg_over_time(rate(prometheus_http_requests_total[5m])[30m:1m])'
            data-requirements='exists-reftarget'>
          Calculate 30-minute rolling average:
          <pre><assistant data-assistant-id="query-subquery-avg" data-assistant-type="query">avg_over_time(
  rate(prometheus_http_requests_total[5m])[30m:1m]
)</assistant></pre>
        </li>
        
        <p>This calculates a 30-minute rolling average of the 5-minute rate. The syntax <code>[30m:1m]</code> means "evaluate over 30 minutes with 1-minute resolution".</p>

        <h3>Rate of Change Detection</h3>
        <p>Detect sudden spikes or drops:</p>
        
        <li class="interactive"
            data-reftarget='textarea.inputarea'
            data-targetaction='formfill'
            data-targetvalue='@@CLEAR@@ abs(delta(rate(prometheus_http_requests_total[5m])[10m:1m])) > 10'
            data-requirements='exists-reftarget'>
          Detect sudden rate changes:
          <pre><assistant data-assistant-id="query-change-detect" data-assistant-type="query">abs(
  delta(rate(prometheus_http_requests_total[5m])[10m:1m])
) > 10</assistant></pre>
        </li>
        
        <p>This detects when the request rate changes by more than 10 requests/sec within a 10-minute window.</p>

        <h3>Aggregation of Rates</h3>
        <p>Aggregate already-calculated rates:</p>
        
        <li class="interactive"
            data-reftarget='textarea.inputarea'
            data-targetaction='formfill'
            data-targetvalue='@@CLEAR@@ sum(rate(prometheus_http_requests_total[5m])[1h:]) > 100'
            data-requirements='exists-reftarget'>
          Aggregate rates with threshold:
          <pre><assistant data-assistant-id="query-agg-rates" data-assistant-type="query">sum(
  rate(prometheus_http_requests_total[5m])[1h:]
) > 100</assistant></pre>
        </li>
        
        <p>This sums the rates over the last hour and checks if the total exceeds a threshold.</p>

        <h2>Section 8: Recording Rules Patterns</h2>
        <p>Learn patterns commonly used in recording rules for pre-computation.</p>

        <h3>Service-Level Aggregation</h3>
        <p>Pre-aggregate metrics at the service level:</p>
        
        <li class="interactive"
            data-reftarget='textarea.inputarea'
            data-targetaction='formfill'
            data-targetvalue='@@CLEAR@@ sum(rate(prometheus_http_requests_total[5m])) by (job, code)'
            data-requirements='exists-reftarget'>
          Aggregate at service level:
          <pre><assistant data-assistant-id="query-recording-svc" data-assistant-type="query">sum(rate(prometheus_http_requests_total[5m])) by (job, code)</assistant></pre>
        </li>
        
        <p>Recording rules often aggregate high-cardinality metrics (like per-instance) into lower-cardinality service-level metrics.</p>

        <h3>SLI Calculation</h3>
        <p>Calculate Service Level Indicators:</p>
        
        <li class="interactive"
            data-reftarget='textarea.inputarea'
            data-targetaction='formfill'
            data-targetvalue='@@CLEAR@@ sum(rate(prometheus_http_requests_total{code=~"2.."}[5m])) / sum(rate(prometheus_http_requests_total[5m]))'
            data-requirements='exists-reftarget'>
          Calculate success rate SLI:
          <pre><assistant data-assistant-id="query-sli" data-assistant-type="query">sum(rate(prometheus_http_requests_total{code=~"2.."}[5m]))
  /
sum(rate(prometheus_http_requests_total[5m]))</assistant></pre>
        </li>
        
        <p>This calculates the success rate (SLI) as successful requests divided by total requests. Perfect for recording rule.</p>

        <h2>Section 9: Alert Query Patterns</h2>
        <p>Queries designed for effective alerting rules.</p>

        <h3>Burn Rate Alert</h3>
        <p>Multi-window burn rate for SLO alerting:</p>
        
        <li class="interactive"
            data-reftarget='textarea.inputarea'
            data-targetaction='formfill'
            data-targetvalue='@@CLEAR@@ ((1 - sum(rate(prometheus_http_requests_total{code=~"2.."}[1h])) / sum(rate(prometheus_http_requests_total[1h]))) > (14.4 * 0.001) and (1 - sum(rate(prometheus_http_requests_total{code=~"2.."}[5m])) / sum(rate(prometheus_http_requests_total[5m]))) > (14.4 * 0.001))'
            data-requirements='exists-reftarget'>
          Multi-window burn rate for SLO:
          <pre><assistant data-assistant-id="query-burn-rate" data-assistant-type="query">(
  (1 - sum(rate(prometheus_http_requests_total{code=~"2.."}[1h])) / sum(rate(prometheus_http_requests_total[1h]))) > (14.4 * 0.001)
  and
  (1 - sum(rate(prometheus_http_requests_total{code=~"2.."}[5m])) / sum(rate(prometheus_http_requests_total[5m]))) > (14.4 * 0.001)
)</assistant></pre>
        </li>
        
        <p>Multi-window multi-burn-rate alert: checks both long window (1h) and short window (5m). This is Google's SRE pattern for SLO alerting.</p>

        <h3>For Duration Pattern</h3>
        <p>Check if a condition persists:</p>
        
        <li class="interactive"
            data-reftarget='textarea.inputarea'
            data-targetaction='formfill'
            data-targetvalue='@@CLEAR@@ avg(rate(prometheus_http_requests_total[5m])) by (instance) < 1'
            data-requirements='exists-reftarget'>
          Check for low traffic condition:
          <pre><assistant data-assistant-id="query-for-duration" data-assistant-type="query">avg(rate(prometheus_http_requests_total[5m])) by (instance) < 1</assistant></pre>
        </li>
        
        <p>Use this with Prometheus alerting's <code>for: 5m</code> clause to only alert if the condition persists for 5 minutes, reducing flapping.</p>

        <h3>Absent Metric Alert</h3>
        <p>Detect when metrics stop being reported:</p>
        
        <li class="interactive"
            data-reftarget='textarea.inputarea'
            data-targetaction='formfill'
            data-targetvalue='@@CLEAR@@ absent(up{job="prometheus"})'
            data-requirements='exists-reftarget'>
          Detect missing metrics:
          <pre><assistant data-assistant-id="query-absent" data-assistant-type="query">absent(up{job="prometheus"})</assistant></pre>
        </li>
        
        <p>The <code>absent()</code> function returns 1 if no time series match the selector. Critical for detecting monitoring gaps.</p>

        <h2>Section 10: Performance Optimization Patterns</h2>
        <p>Write efficient queries that scale with your data volume.</p>

        <h3>Limit Label Cardinality</h3>
        <p>Aggregate early to reduce label combinations:</p>
        
        <li class="interactive"
            data-reftarget='textarea.inputarea'
            data-targetaction='formfill'
            data-targetvalue='@@CLEAR@@ sum(rate(prometheus_http_requests_total[5m])) by (job, code)'
            data-requirements='exists-reftarget'>
          Optimize query cardinality:
          <pre><assistant data-assistant-id="query-optimize-cardinality" data-assistant-type="query">sum(rate(prometheus_http_requests_total[5m])) by (job, code)</assistant></pre>
        </li>
        
        <p>Instead of querying all label combinations, aggregate by only the labels you need. This reduces query load.</p>

        <h3>Use Recording Rules for Expensive Queries</h3>
        <p>Pre-compute complex aggregations:</p>
        
        <li class="interactive"
            data-reftarget='textarea.inputarea'
            data-targetaction='formfill'
            data-targetvalue='@@CLEAR@@ histogram_quantile(0.99, sum(rate(go_gc_duration_seconds_bucket[5m])) by (le, job, instance))'
            data-requirements='exists-reftarget'>
          Complex query for recording rules:
          <pre><assistant data-assistant-id="query-expensive" data-assistant-type="query">histogram_quantile(0.99,
  sum(rate(go_gc_duration_seconds_bucket[5m])) by (le, job, instance)
)</assistant></pre>
        </li>
        
        <p>If this query is used in multiple dashboards or alerts, create a recording rule to pre-compute it every 30 seconds.</p>

        <h3>Limit Time Range</h3>
        <p>Use appropriate time ranges for your metrics:</p>
        
        <li class="interactive"
            data-reftarget='textarea.inputarea'
            data-targetaction='formfill'
            data-targetvalue='@@CLEAR@@ rate(prometheus_http_requests_total[2m])'
            data-requirements='exists-reftarget'>
          Use efficient time ranges:
          <pre><assistant data-assistant-id="query-time-range" data-assistant-type="query">rate(prometheus_http_requests_total[2m])</assistant></pre>
        </li>
        
        <p>For high-frequency metrics (scraped every 10-15s), a 2-5 minute window is sufficient. Longer windows add computation cost.</p>

        <h2>🎉 Congratulations!</h2>
        <p>You've mastered advanced PromQL! You now know:</p>
        <ul>
            <li>✅ Multi-dimensional aggregation with <code>by</code>, <code>without</code>, <code>topk</code></li>
            <li>✅ Advanced label matching with regex (<code>=~</code>, <code>!~</code>)</li>
            <li>✅ Label joins using <code>on</code>, <code>ignoring</code>, and <code>group_left/right</code></li>
            <li>✅ Time-based analysis with <code>offset</code>, <code>over_time</code> functions</li>
            <li>✅ Binary operations for error rates and utilization calculations</li>
            <li>✅ Histogram analysis with <code>histogram_quantile</code></li>
            <li>✅ Predictive functions: <code>predict_linear</code>, <code>holt_winters</code></li>
            <li>✅ Subqueries for rolling aggregations</li>
            <li>✅ Recording rule and alert patterns</li>
            <li>✅ Performance optimization techniques</li>
        </ul>
        
        <p><strong>💡 Pro Tip:</strong> Use the Grafana Assistant to customize any of these queries for your specific metrics, datasources, and use cases. Just hover over any query and click "Customize with Assistant"!</p>
        
        <p><strong>Next Steps:</strong></p>
        <ul>
            <li>Apply these patterns to your own metrics</li>
            <li>Create recording rules for frequently used queries</li>
            <li>Build comprehensive dashboards using these advanced patterns</li>
            <li>Set up SLO-based alerting using burn rate calculations</li>
            <li>Explore <a href="https://prometheus.io/docs/prometheus/latest/querying/functions/" target="_blank">all PromQL functions</a> in the official docs</li>
        </ul>
        
    </body>
</html>`;
