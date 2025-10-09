// Export the HTML content as a string
// This avoids webpack configuration issues with .html files

export const scrollTestHtml = `<html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Scroll Test</title>
    </head>
    <body>
        <h1>Scroll Test!</h1>

        <span id="grafana-tour" class="interactive" data-targetaction="sequence" data-reftarget="span#grafana-tour">
            <ul>
              <li class="interactive" 
                  data-reftarget="div[role='row']:nth-match(20)"
                  data-targetaction='highlight'>
                <span class="interactive-comment">Look at me!</span>
                Look for 20th row.
              </li>

            </ul>
        </span>

        <h2>🎉 Congratulations!</h2>
        
    </body>
</html>`;
