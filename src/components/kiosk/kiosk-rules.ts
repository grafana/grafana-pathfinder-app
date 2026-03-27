/**
 * Kiosk mode rule types, bundled defaults, and CDN fetch logic.
 */

export interface KioskRule {
  title: string;
  url: string;
  description: string;
  type: string;
  /** Grafana instance to open the guide on. Defaults to current origin if omitted. */
  targetUrl?: string;
}

export interface KioskRulesResponse {
  /** HTML banner rendered at the top of the kiosk overlay */
  banner?: string;
  rules: KioskRule[];
}

export interface KioskData {
  banner: string;
  rules: KioskRule[];
}

/**
 * Default HTML banner themed for GrafanaCON.
 */
const DEFAULT_BANNER = `
<div style="display:flex;align-items:center;gap:32px;padding:32px 40px;border-radius:16px;background:linear-gradient(135deg,#1a0533 0%,#2d1b69 50%,#f55f3e 100%);border:1px solid rgba(245,95,62,0.3);margin-bottom:8px;overflow:hidden;">
  <img src="https://a-us.storyblok.com/f/1022730/370x168/3b714f67ef/grafanacon-stack-logo-2026.svg" alt="GrafanaCON 2026" style="height:120px;flex-shrink:0;" />
  <div style="flex:1;min-width:0;">
    <h2 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#fff;letter-spacing:-0.01em;">Welcome to the Interactive Learning Booth</h2>
    <p style="margin:0;font-size:15px;color:rgba(255,255,255,0.75);line-height:1.6;">Choose a hands-on guide below to explore Grafana features at your own pace. Each guide opens in a new tab with step-by-step interactive instructions.</p>
  </div>
</div>
`;

/**
 * Bundled default rules used as fallback when CDN fetch fails or no URL is configured.
 */
export const BUNDLED_KIOSK_RULES: KioskRule[] = [
  {
    title: 'Tour of Grafana Visualizations',
    url: 'https://interactive-learning.grafana.net/guides/tour-of-visualizations',
    description: "A quick tour of Grafana's visualization types\u2014when to use each one, with live examples.",
    type: 'interactive',
    targetUrl: 'https://play.grafana.org',
  },
  {
    title: 'Interactive Guide: Explore Drilldowns 101',
    url: 'https://interactive-learning.grafana.net/guides/explore-drilldowns-101',
    description: 'Hands-on guide: Explore drilldowns in Grafana.',
    type: 'interactive',
    targetUrl: 'https://play.grafana.org',
  },
  {
    title: 'Interactive Guide: Your First Dashboard',
    url: 'https://interactive-learning.grafana.net/guides/first-dashboard',
    description: 'Hands-on guide: Build your first Grafana dashboard.',
    type: 'interactive',
    targetUrl: 'https://play.grafana.org',
  },
  {
    title: 'Interactive Guide: Welcome to Grafana Play',
    url: 'https://interactive-learning.grafana.net/guides/welcome-to-play/main-page',
    description: 'Comprehensive walkthrough of Grafana Play features and capabilities.',
    type: 'interactive',
    targetUrl: 'https://play.grafana.org',
  },
  {
    title: 'Interactive Guide: Alerting 101',
    url: 'https://interactive-learning.grafana.net/guides/alerting-101',
    description: 'Hands-on guide: Learn how to create and test alerts in Grafana.',
    type: 'interactive',
    targetUrl: 'https://play.grafana.org',
  },
  {
    title: 'Interactive Guide: IRM Setup and Configuration',
    url: 'https://interactive-learning.grafana.net/guides/irm-configuration',
    description:
      'Hands-on guide: Set up Grafana IRM for on-call notifications, including schedules and escalation chains.',
    type: 'interactive',
    targetUrl: 'https://play.grafana.org',
  },
  {
    title: 'How to set up your first Synthetic Monitoring check',
    url: 'https://interactive-learning.grafana.net/guides/sm-setting-up-your-first-check',
    description: 'Hands-on guide: Create and configure HTTP checks in Grafana Cloud Synthetic Monitoring.',
    type: 'interactive',
    targetUrl: 'https://play.grafana.org',
  },
  {
    title: 'Interactive Guide: CPU Usage in Kubernetes',
    url: 'https://interactive-learning.grafana.net/guides/k8s-cpu',
    description: 'Hands-on guide: Explore CPU usage in Kubernetes Monitoring, from namespaces to containers.',
    type: 'interactive',
    targetUrl: 'https://play.grafana.org',
  },
  {
    title: 'Interactive Guide: Memory Usage in Kubernetes',
    url: 'https://interactive-learning.grafana.net/guides/k8s-mem',
    description: 'Hands-on guide: Explore memory usage in Kubernetes Monitoring, from namespaces to containers.',
    type: 'interactive',
    targetUrl: 'https://play.grafana.org',
  },
  {
    title: 'Interactive Guide: Enable Block Editor',
    url: 'https://interactive-learning.grafana.net/guides/enable-block-editor',
    description: 'Hands-on guide: Learn how to enable the Block Editor for first-time authors.',
    type: 'interactive',
    targetUrl: 'https://play.grafana.org',
  },
  {
    title: 'Connect a metrics data source to Grafana Cloud',
    url: 'https://interactive-learning.grafana.net/guides/connect-metrics-data/content.json',
    description: 'Hands-on guide: Learn how to connect a metrics data source to Grafana Cloud.',
    type: 'interactive',
    targetUrl: 'https://play.grafana.org',
  },
  {
    title: 'Introduction to data transformations',
    url: 'https://interactive-learning.grafana.net/guides/find-transformations/content.json',
    description: 'Hands-on guide: Learn how to use data transformations in Grafana.',
    type: 'interactive',
    targetUrl: 'https://play.grafana.org',
  },
  {
    title: 'Reduce log volume using Adaptive Logs recommendations',
    url: 'https://interactive-learning.grafana.net/guides/reduce-log-volume-adaptive-logs/content.json',
    description: 'Hands-on guide: Reduce log volume safely with Adaptive Logs.',
    type: 'interactive',
    targetUrl: 'https://play.grafana.org',
  },
  {
    title: 'Reduce metrics volume using Adaptive Metrics recommendations',
    url: 'https://interactive-learning.grafana.net/guides/adaptive-metrics-recommendations/content.json',
    description: 'Hands-on guide: Reduce metrics volume safely with Adaptive Metrics.',
    type: 'interactive',
    targetUrl: 'https://play.grafana.org',
  },
  {
    title: 'Welcome to Testing & Synthetics!',
    url: 'https://interactive-learning.grafana.net/guides/test-sm-overview-tutorial',
    description: 'Hands-on guide: Navigate Testing & Synthetics; Understanding K6 and Synthetic Monitoring.',
    type: 'interactive',
    targetUrl: 'https://play.grafana.org',
  },
  {
    title: 'Understanding the Four Golden Signals of Observability',
    url: 'https://interactive-learning.grafana.net/guides/understanding-the-four-golden-signals-of-observability',
    description:
      'Learn about the Four Golden Signals \u2014 Latency, Traffic, Errors, and Saturation \u2014 with interactive examples.',
    type: 'interactive',
    targetUrl: 'https://play.grafana.org',
  },
  {
    title: 'Explore SQL Expressions with The Traitors UK Dashboard',
    url: 'https://interactive-learning.grafana.net/guides/play-traitors-uk-tour/content.json',
    description:
      'A guided tour of the Traitors UK Series 4 dashboard, exploring how SQL expressions transform raw data into rich visualizations.',
    type: 'interactive',
    targetUrl: 'https://play.grafana.org',
  },
  {
    title: 'Fleet Management: Onboard Your First Collector',
    url: 'https://interactive-learning.grafana.net/guides/fleet-management-onboarding/content.json',
    description: 'Hands-on guide: Deploy and connect a Grafana Alloy collector to Fleet Management.',
    type: 'interactive',
    targetUrl: 'https://play.grafana.org',
  },
  {
    title: 'Tour the UK Carbon Intensity Dashboard',
    url: 'https://interactive-learning.grafana.net/guides/play-carbon-intensity/content.json',
    description: 'Explore live UK carbon intensity data with the Infinity data source and JQ expressions.',
    type: 'interactive',
    targetUrl: 'https://play.grafana.org',
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
 * Fetch kiosk data (banner + rules) from a CDN URL.
 * Falls back to bundled defaults on any error.
 */
export async function fetchKioskData(url: string): Promise<KioskData> {
  const defaults: KioskData = { banner: DEFAULT_BANNER, rules: BUNDLED_KIOSK_RULES };

  if (!url) {
    return defaults;
  }

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) {
      console.warn(`[KioskMode] Failed to fetch rules (${response.status}), using defaults`);
      return defaults;
    }

    const data: KioskRulesResponse = await response.json();
    const rules = Array.isArray(data?.rules) ? data.rules : Array.isArray(data) ? data : [];
    const valid = rules.filter(isValidRule);

    if (valid.length === 0) {
      console.warn('[KioskMode] No valid rules in response, using defaults');
      return defaults;
    }

    return {
      banner: typeof data?.banner === 'string' ? data.banner : DEFAULT_BANNER,
      rules: valid,
    };
  } catch (error) {
    console.warn('[KioskMode] Failed to fetch rules, using defaults:', error);
    return defaults;
  }
}
