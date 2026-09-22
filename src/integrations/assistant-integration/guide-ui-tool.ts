import { createTool, type InlineToolRunnable } from '@grafana/assistant';
import { config, locationService } from '@grafana/runtime';
import { resolveSelectorForVersion } from '../../lib/dom/selector-resolver-core';
import { isElementVisible } from '../../lib/dom/element-validator';
import { querySelectorAllEnhanced } from '../../lib/dom/enhanced-selector';

const MODE = '{grafana:components.DataSource.Prometheus.queryEditor.editorToggle}';
const CODE = `${MODE} {grafana:components.RadioButton.option:code} + label`;
const QUERY = '{grafana:components.QueryField.container}';

export function inspectGuideSelectors(selectors: string[]) {
  return selectors.map((selector) => {
    let resolutionError = false;
    const resolved = resolveSelectorForVersion(selector, config.buildInfo.version || 'latest', () => {
      resolutionError = true;
    });
    if (resolutionError) {
      return { selector, status: 'unsupported-selector', visibleMatches: 0 };
    }
    const matches = querySelectorAllEnhanced(resolved).elements.filter(
      (element) =>
        !element.closest(
          '[data-testid="docs-panel-container"], [data-testid="block-editor-container"], [role="dialog"]'
        ) &&
        element.getClientRects().length > 0 &&
        isElementVisible(element)
    );
    return {
      selector,
      status: matches.length === 1 ? 'unique-visible-match' : matches.length === 0 ? 'not-visible-here' : 'ambiguous',
      visibleMatches: matches.length,
    };
  });
}

export function createGuideUiTool(onInspect: () => void, isActive: () => boolean): InlineToolRunnable {
  let calls = 0;
  return createTool(
    async (input: { selectors?: string[] }) => {
      if (!isActive()) {
        return 'Customization was cancelled.';
      }
      if (calls >= 4) {
        return 'UI inspection limit reached. Do not claim unobserved steps have been verified.';
      }
      calls += 1;
      onInspect();
      return JSON.stringify({
        currentPath: locationService.getLocation().pathname,
        scope:
          'Read-only current-page check. No actions were run. A missing target may require navigation, Code mode, or opening a control first. This is not full-guide verification. Scope ambiguous matches to one query row before using them.',
        selectors: inspectGuideSelectors(input.selectors ?? []),
        prometheusQuery: {
          prerequisites:
            'Open the panel or Explore query editor and select the intended Prometheus data source first. Use separate actions for each state transition.',
          steps: [
            {
              type: 'interactive',
              action: 'button',
              targetstate: 'true',
              reftarget: CODE,
              content: 'Switch the Prometheus query editor to Code.',
              requirements: ['min-version:13.2.0', 'exists-reftarget'],
            },
            {
              type: 'code-block',
              reftarget: QUERY,
              language: 'promql',
              content: 'Insert the Prometheus query.',
              requirements: ['exists-reftarget'],
            },
          ],
          instructions:
            "Keep targetstate true on the visible Code label so Pathfinder drives its associated radio control and safely handles an already-selected Code mode. Supply the code field from the selected data source metadata. code-block uses Pathfinder's Monaco-aware Insert action; do not fill the builder metric dropdown or a generic page textarea. The mode selector requires Grafana 13.2+. These are candidate actions, not a verified walkthrough. Retain a separate Run queries action from the source only if it still matches; a missing run control needs inspection, not a made-up registry key.",
          currentPageChecks: inspectGuideSelectors([CODE, `${QUERY} textarea`]),
        },
      });
    },
    {
      name: 'inspect_pathfinder_ui',
      description:
        'Check proposed Pathfinder selectors against the visible Grafana page and get the Prometheus Code-to-Monaco insertion sequence. Read-only: never navigates, clicks, reads field values, executes queries, or saves resources. Call when adapting interactive query steps. Missing or ambiguous matches are not verified.',
      inputSchema: {
        type: 'object',
        properties: { selectors: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 500 } } },
        additionalProperties: false,
      },
      validate: (input: unknown) => {
        if (!input || typeof input !== 'object' || Array.isArray(input)) {
          throw new Error('Expected an object with an optional selectors array.');
        }
        const selectors = 'selectors' in input ? input.selectors : [];
        if (
          !Array.isArray(selectors) ||
          selectors.length > 8 ||
          selectors.some((value) => typeof value !== 'string' || value.length > 500)
        ) {
          throw new Error('Provide at most eight selectors, each at most 500 characters.');
        }
        return { selectors: selectors as string[] };
      },
    }
  );
}
