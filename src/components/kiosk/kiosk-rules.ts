/**
 * Kiosk mode rule types, bundled defaults, and CDN fetch logic.
 */

export interface KioskRule {
  title: string;
  url: string;
  description: string;
  type: string;
}

interface KioskRulesResponse {
  rules: KioskRule[];
}

/**
 * Bundled default rules used as fallback when CDN fetch fails or no URL is configured.
 */
export const BUNDLED_KIOSK_RULES: KioskRule[] = [
  {
    title: 'Tour of Grafana Visualizations',
    url: 'https://interactive-learning.grafana.net/guides/tour-of-visualizations',
    description: "A quick tour of Grafana's visualization types\u2014when to use each one, with live examples.",
    type: 'interactive',
  },
  {
    title: 'Interactive Guide: Explore Drilldowns 101',
    url: 'https://interactive-learning.grafana.net/guides/explore-drilldowns-101',
    description: 'Hands-on guide: Explore drilldowns in Grafana.',
    type: 'interactive',
  },
  {
    title: 'Interactive Guide: Your First Dashboard',
    url: 'https://interactive-learning.grafana.net/guides/first-dashboard',
    description: 'Hands-on guide: Build your first Grafana dashboard.',
    type: 'interactive',
  },
  {
    title: 'Interactive Guide: Welcome to Grafana Play',
    url: 'https://interactive-learning.grafana.net/guides/welcome-to-play/main-page',
    description: 'Comprehensive walkthrough of Grafana Play features and capabilities.',
    type: 'interactive',
  },
  {
    title: 'Interactive Guide: Alerting 101',
    url: 'https://interactive-learning.grafana.net/guides/alerting-101',
    description: 'Hands-on guide: Learn how to create and test alerts in Grafana.',
    type: 'interactive',
  },
  {
    title: 'Interactive Guide: IRM Setup and Configuration',
    url: 'https://interactive-learning.grafana.net/guides/irm-configuration',
    description:
      'Hands-on guide: Set up Grafana IRM for on-call notifications, including schedules and escalation chains.',
    type: 'interactive',
  },
  {
    title: 'How to set up your first Synthetic Monitoring check',
    url: 'https://interactive-learning.grafana.net/guides/sm-setting-up-your-first-check',
    description: 'Hands-on guide: Create and configure HTTP checks in Grafana Cloud Synthetic Monitoring.',
    type: 'interactive',
  },
  {
    title: 'Interactive Guide: CPU Usage in Kubernetes',
    url: 'https://interactive-learning.grafana.net/guides/k8s-cpu',
    description: 'Hands-on guide: Explore CPU usage in Kubernetes Monitoring, from namespaces to containers.',
    type: 'interactive',
  },
  {
    title: 'Interactive Guide: Memory Usage in Kubernetes',
    url: 'https://interactive-learning.grafana.net/guides/k8s-mem',
    description: 'Hands-on guide: Explore memory usage in Kubernetes Monitoring, from namespaces to containers.',
    type: 'interactive',
  },
  {
    title: 'Interactive Guide: Enable Block Editor',
    url: 'https://interactive-learning.grafana.net/guides/enable-block-editor',
    description: 'Hands-on guide: Learn how to enable the Block Editor for first-time authors.',
    type: 'interactive',
  },
  {
    title: 'Connect a metrics data source to Grafana Cloud',
    url: 'https://interactive-learning.grafana.net/guides/connect-metrics-data/content.json',
    description: 'Hands-on guide: Learn how to connect a metrics data source to Grafana Cloud.',
    type: 'interactive',
  },
  {
    title: 'Introduction to data transformations',
    url: 'https://interactive-learning.grafana.net/guides/find-transformations/content.json',
    description: 'Hands-on guide: Learn how to use data transformations in Grafana.',
    type: 'interactive',
  },
  {
    title: 'Reduce log volume using Adaptive Logs recommendations',
    url: 'https://interactive-learning.grafana.net/guides/reduce-log-volume-adaptive-logs/content.json',
    description: 'Hands-on guide: Reduce log volume safely with Adaptive Logs.',
    type: 'interactive',
  },
  {
    title: 'Reduce metrics volume using Adaptive Metrics recommendations',
    url: 'https://interactive-learning.grafana.net/guides/adaptive-metrics-recommendations/content.json',
    description: 'Hands-on guide: Reduce metrics volume safely with Adaptive Metrics.',
    type: 'interactive',
  },
  {
    title: 'Welcome to Testing & Synthetics!',
    url: 'https://interactive-learning.grafana.net/guides/test-sm-overview-tutorial',
    description: 'Hands-on guide: Navigate Testing & Synthetics; Understanding K6 and Synthetic Monitoring.',
    type: 'interactive',
  },
  {
    title: 'Understanding the Four Golden Signals of Observability',
    url: 'https://interactive-learning.grafana.net/guides/understanding-the-four-golden-signals-of-observability',
    description:
      'Learn about the Four Golden Signals \u2014 Latency, Traffic, Errors, and Saturation \u2014 with interactive examples.',
    type: 'interactive',
  },
  {
    title: 'Explore SQL Expressions with The Traitors UK Dashboard',
    url: 'https://interactive-learning.grafana.net/guides/play-traitors-uk-tour/content.json',
    description:
      'A guided tour of the Traitors UK Series 4 dashboard, exploring how SQL expressions transform raw data into rich visualizations.',
    type: 'interactive',
  },
  {
    title: 'Fleet Management: Onboard Your First Collector',
    url: 'https://interactive-learning.grafana.net/guides/fleet-management-onboarding/content.json',
    description: 'Hands-on guide: Deploy and connect a Grafana Alloy collector to Fleet Management.',
    type: 'interactive',
  },
  {
    title: 'Tour the UK Carbon Intensity Dashboard',
    url: 'https://interactive-learning.grafana.net/guides/play-carbon-intensity/content.json',
    description: 'Explore live UK carbon intensity data with the Infinity data source and JQ expressions.',
    type: 'interactive',
  },
];

function isValidRule(item: unknown): item is KioskRule {
  if (!item || typeof item !== 'object') {
    return false;
  }
  const obj = item as Record<string, unknown>;
  return typeof obj.title === 'string' && typeof obj.url === 'string' && typeof obj.description === 'string';
}

/**
 * Fetch kiosk rules from a CDN URL.
 * Falls back to bundled defaults on any error.
 */
export async function fetchKioskRules(url: string): Promise<KioskRule[]> {
  if (!url) {
    return BUNDLED_KIOSK_RULES;
  }

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) {
      console.warn(`[KioskMode] Failed to fetch rules (${response.status}), using defaults`);
      return BUNDLED_KIOSK_RULES;
    }

    const data: KioskRulesResponse = await response.json();
    const rules = Array.isArray(data?.rules) ? data.rules : Array.isArray(data) ? data : [];
    const valid = rules.filter(isValidRule);

    if (valid.length === 0) {
      console.warn('[KioskMode] No valid rules in response, using defaults');
      return BUNDLED_KIOSK_RULES;
    }

    return valid;
  } catch (error) {
    console.warn('[KioskMode] Failed to fetch rules, using defaults:', error);
    return BUNDLED_KIOSK_RULES;
  }
}
