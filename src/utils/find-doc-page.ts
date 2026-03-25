import { isGrafanaDocsUrl, isInteractiveLearningUrl } from '../security';

export interface DocPage {
  type: 'docs-page' | 'learning-journey';
  url: string;
  title: string;
  /** Optional target page path for deep link redirect (e.g., /explore) */
  targetPage?: string;
}

/**
 * Finds a docs page or learning-journey rule matching the param (url).
 *
 * Extracted from module.tsx so that the require() / require.context() calls
 * for bundled JSON data land in a lazy chunk instead of the entry point.
 */
export function findDocPage(param: string): DocPage | null {
  if (!param || param.trim() === '') {
    return null;
  }

  // Case: Custom guide stored in the Pathfinder backend (App Platform CRD)
  if (param.startsWith('api:')) {
    const resourceName = param.slice(4).trim();
    if (!resourceName) {
      return null;
    }
    return {
      type: 'docs-page',
      url: `backend-guide:${resourceName}`,
      title: resourceName,
    };
  }

  // Case 1: Bundled interactive
  if (param.startsWith('bundled:')) {
    try {
      const indexData = require('../bundled-interactives/index.json');
      const interactiveId = param.replace('bundled:', '');
      const interactive = indexData?.interactives?.find((item: any) => item.id === interactiveId);

      if (interactive) {
        return {
          type: 'docs-page',
          url: param,
          title: interactive.title || interactive.id,
          targetPage: Array.isArray(interactive.url) ? interactive.url[0] : undefined,
        };
      }
    } catch (e) {
      console.warn('Failed to load bundled interactives index', e);
    }
  }

  // Case 2: Interactive Learning URL
  if (param.includes('interactive-learning.grafana')) {
    let url = param;
    if (!url.startsWith('http')) {
      url = 'https://' + url;
    }

    // SECURITY: Use validated interactive learning URL check
    if (!isInteractiveLearningUrl(url)) {
      console.warn('Security: Rejected non-interactive-learning URL:', url);
      return null;
    }

    const parts = url.split('/');
    const title = parts[parts.length - 1] || 'Interactive tutorial';

    return {
      type: 'docs-page',
      url: url,
      title: title,
    };
  }

  // Case 3: Check Static Links for curated content (Grafana.com docs)
  try {
    const staticLinksContext = (require as any).context('../bundled-interactives/static-links', false, /\.json$/);
    const allFilePaths = staticLinksContext.keys();

    for (const filePath of allFilePaths) {
      const staticData = staticLinksContext(filePath);
      if (staticData && staticData.rules && Array.isArray(staticData.rules)) {
        const rule = staticData.rules.find(
          (r: { type: string; url: string; title: string }) =>
            (r.type === 'docs-page' || r.type === 'learning-journey') && r.url === `https://grafana.com${param}`
        );
        if (rule) {
          return rule;
        }
      }
    }
  } catch (error) {
    console.error('Failed to load static links:', error);
  }

  // Case 4: Any Grafana docs URL (fallback for non-curated content)
  const isPathOnly =
    param.startsWith('/docs/') ||
    param.startsWith('/tutorials/') ||
    param.startsWith('/docs/learning-journeys/') ||
    param.startsWith('/docs/learning-paths/');
  const isFullGrafanaUrl = param.startsWith('https://grafana.com/') || param.startsWith('https://docs.grafana.com/');

  if (isPathOnly || isFullGrafanaUrl) {
    const fullUrl = param.startsWith('https://') ? param : `https://grafana.com${param}`;

    // SECURITY: Validate using isGrafanaDocsUrl which checks:
    // 1. Hostname is in ALLOWED_GRAFANA_DOCS_HOSTNAMES (prevents subdomain hijacking)
    // 2. Protocol is https (prevents protocol injection)
    // 3. Path contains valid docs paths (prevents arbitrary URL injection)
    if (!isGrafanaDocsUrl(fullUrl)) {
      console.warn('Security: Rejected non-Grafana docs URL:', fullUrl);
      return null;
    }

    const pathSegments = param
      .replace(/^https:\/\/[^/]+/, '')
      .split('/')
      .filter(Boolean);
    const titleSegments = pathSegments.slice(1);

    const product = titleSegments[0] || 'Grafana';

    const meaningfulSegments = titleSegments.filter(
      (seg) => !['latest', 'next'].includes(seg) && !/^v?\d+(\.\d+)*$/.test(seg)
    );
    const pageTitle = meaningfulSegments[meaningfulSegments.length - 1] || 'Documentation';

    const formatTitle = (str: string): string => str.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

    const title = `${formatTitle(pageTitle)} - ${formatTitle(product)} Docs`;

    return {
      type: 'docs-page',
      url: fullUrl,
      title: title,
    };
  }

  return null;
}
