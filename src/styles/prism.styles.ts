import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';

/**
 * Custom Prism.js theme that matches the existing SCSS color scheme
 * Based on the _prism.scss file colors
 */
export const getPrismStyles = (theme: GrafanaTheme2) => css`
  /* Generated with http://k88hudson.github.io/syntax-highlighting-theme-generator/www */
  /* http://k88hudson.github.io/react-markdocs */
  /**
 * @author k88hudson
 *
 * Based on prism.js default theme for JavaScript, CSS and HTML
 * Based on dabblet (http://dabblet.com)
 * @author Lea Verou
 */
  /*********************************************************
* General
*/

  // common for inline code and code blocks
  pre,
  code {
    direction: ltr;
    text-align: left;
    text-shadow: none;

    -moz-tab-size: 4;
    -o-tab-size: 4;
    tab-size: 4;
    -webkit-hyphens: none;
    -moz-hyphens: none;
    -ms-hyphens: none;
    hyphens: none;
  }

  pre {
    font-family: Consolas, Monaco, 'Andale Mono', 'Ubuntu Mono', monospace;
  }

  // inline code changes font family except in headings
  :not(h1, h2, h3, h4, h5, h6) > code {
    font-family: Consolas, Monaco, 'Andale Mono', 'Ubuntu Mono', monospace;
  }

  // inline code
  :not(pre) > code {
    color: #e9ecef;
    background: #f8f9fa;
    padding: 0.1rem 0.2rem;
    border-radius: 4px;
  }

  // inline code changes font-size except in headings and code blocks
  :not(h1, h2, h3, h4, h5, h6, pre) > code {
    font-size: 0.8em;
    line-height: 0.8em;
  }

  a > code {
    color: #0066cc;
    text-decoration: underline;
    line-height: 1.5;
  }

  pre[lang=''] {
    border-radius: 8px;
  }

  // code blocks (with or without language className)
  pre {
    color: #ffffff;
    background: #1e1e1e;
    position: relative;
    white-space: pre;
    word-spacing: normal;
    word-break: normal;
    border-radius: 8px;
    padding: 1rem;
    margin: 0.5rem 0;
    overflow: auto;
    font-size: 0.9em;
    line-height: 1.8;

    code {
      color: #e9ecef;
      background: none;
    }
  }

  // language-specific styles
  pre.language-yaml,
  code.language-yaml {
    ul {
      li {
        &::marker {
          content: '-';
        }

        code {
          tab-size: 3;
          span:not(:first-child) {
            tab-size: 4;
          }
        }
      }
    }
  }

  /*********************************************************
* Tokens
  styles to accomodate Javacript syntax.
  consider optimizing it for bash/shell and YAML syntaxes
*/
  .namespace {
    opacity: 0.7;
  }
  .token.comment,
  .token.prolog,
  .token.doctype,
  .token.cdata,
  .token.operator,
  .token.entity,
  .token.url,
  .language-css .token.string,
  .style .token.string {
    color: #9292a5;
    background: none;
  }
  .token.property,
  .token.function,
  .token.tag,
  .token.boolean,
  .token.number,
  .token.constant,
  .token.symbol,
  .token.deleted,
  .token.punctuation {
    color: #ffffff;
  }
  .token.tag {
    margin: 0;
    padding: 0;
    background: none;
    //font-size: 14px;
  }
  .token.selector,
  .token.attr-name,
  .token.string,
  .token.char,
  .token.builtin,
  .token.inserted {
    color: #fb9d5a;
  }
  .token.atrule,
  .token.attr-value,
  .token.keyword {
    color: #66adff;
  }
  .token.number,
  .token.regex,
  .token.important,
  .token.variable {
    color: #fbc55a;
  }
  .token.important,
  .token.bold {
    font-weight: bold;
  }
  .token.italic {
    font-style: italic;
  }
  .token.entity {
    cursor: help;
  }
  /*********************************************************
* Line highlighting
*/
  pre[data-line] {
    position: relative;
  }
  pre[class*='language-'] > code[class*='language-'] {
    position: relative;
    z-index: 1;
    text-shadow: 0 0;
  }
  .line-highlight {
    position: absolute;
    left: 0;
    right: 0;
    padding: inherit 0;
    margin-top: 1em;
    background: rgba(255, 255, 255, 0.1);
    box-shadow: inset 5px 0 0 #0066cc;
    z-index: 0;
    pointer-events: none;
    line-height: inherit;
    white-space: pre;
  }

  .line-highlight:before,
  .line-highlight[data-end]:after {
    content: attr(data-start);
    position: absolute;
    top: 0.4em;
    left: 0.6em;
    min-width: 1em;
    padding: 0 0.5em;
    background-color: hsla(24, 20%, 50%, 0.4);
    color: hsl(24, 20%, 95%);
    font: bold 65%/1.5 sans-serif;
    text-align: center;
    vertical-align: 0.3em;
    border-radius: 999px;
    text-shadow: none;
    box-shadow: 0 1px white;
  }

  .line-highlight[data-end]:after {
    content: attr(data-end);
    top: auto;
    bottom: 0.4em;
  }

  .line-numbers .line-highlight:before,
  .line-numbers .line-highlight:after {
    content: none;
  }

  pre[class*='language-'].line-numbers {
    position: relative;
    padding-left: 3.8em;
    counter-reset: linenumber;
  }

  pre[class*='language-'].line-numbers > code {
    position: relative;
    white-space: inherit;
  }

  .line-numbers .line-numbers-rows {
    position: absolute;
    pointer-events: none;
    top: 0;
    font-size: 100%;
    left: -3.8em;
    width: 3em; /* works for line-numbers below 1000 lines */
    letter-spacing: -1px;
    border-right: 1px solid #999;

    -webkit-user-select: none;
    -moz-user-select: none;
    -ms-user-select: none;
    user-select: none;
  }

  .line-numbers-rows > span {
    pointer-events: none;
    display: block;
    counter-increment: linenumber;
  }

  .line-numbers-rows > span:before {
    content: counter(linenumber);
    color: #999;
    display: block;
    padding-right: 0.8em;
    text-align: right;
  }
`;
