/**
 * Grafana Context Tool
 *
 * A custom tool for the inline assistant that provides full Grafana context
 * for customizing documentation, configs, and queries based on the user's environment.
 */

import { createTool, type InlineToolRunnable, type ToolInvokeOptions, type ToolOutput } from '@grafana/assistant';
import { config, locationService, getBackendSrv, getDataSourceSrv } from '@grafana/runtime';

import type { GrafanaContextArtifact, DatasourceInfo } from './types';
import { ContextService } from '../../../context-engine/context.service';

/**
 * Tool input schema - no input required
 */
const toolInputSchema = {
  type: 'object' as const,
  properties: {},
  additionalProperties: false,
};

type ToolInput = Record<string, never>;

/**
 * Get current platform
 */
const getCurrentPlatform = (): 'cloud' | 'oss' => {
  try {
    return config.bootData.settings.buildInfo.versionString.startsWith('Grafana Cloud') ? 'cloud' : 'oss';
  } catch {
    return 'oss';
  }
};

/**
 * Get Grafana version
 */
const getGrafanaVersion = (): string => {
  try {
    return config.bootData.settings.buildInfo.version || 'Unknown';
  } catch {
    return 'Unknown';
  }
};

/**
 * Get current theme
 */
const getCurrentTheme = (): 'dark' | 'light' => {
  try {
    return config.theme2.isDark ? 'dark' : 'light';
  } catch {
    return 'dark';
  }
};

/**
 * Get user role
 */
const getUserRole = (): string => {
  try {
    return config.bootData.user.orgRole || 'Viewer';
  } catch {
    return 'Viewer';
  }
};

/**
 * Get search params as a record
 */
const getSearchParams = (): Record<string, string> => {
  const urlQueryMap = locationService.getSearchObject();
  const searchParams: Record<string, string> = {};

  Object.entries(urlQueryMap).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      searchParams[key] = String(value);
    }
  });

  return searchParams;
};

/**
 * Fetch dashboard info if on a dashboard page
 */
const fetchDashboardInfo = async (
  currentPath: string
): Promise<{ uid: string; title: string; folder?: string } | undefined> => {
  try {
    const pathMatch = currentPath.match(/\/d\/([^\/]+)/);
    if (pathMatch) {
      const dashboardUid = pathMatch[1];
      const dashboardInfo = await getBackendSrv().get(`/api/dashboards/uid/${dashboardUid}`);
      return {
        uid: dashboardInfo.dashboard?.uid,
        title: dashboardInfo.dashboard?.title,
        folder: dashboardInfo.meta?.folderTitle,
      };
    }
    return undefined;
  } catch (error) {
    console.warn('[GrafanaContextTool] Failed to fetch dashboard info:', error);
    return undefined;
  }
};

/**
 * Get all datasources as simplified info
 */
const getDatasourcesInfo = (): DatasourceInfo[] => {
  try {
    const datasources = getDataSourceSrv().getList();
    return datasources.map((ds) => ({
      uid: ds.uid,
      name: ds.name,
      type: ds.type,
    }));
  } catch (error) {
    console.warn('[GrafanaContextTool] Failed to get datasources:', error);
    return [];
  }
};

/**
 * Format context for human-readable display
 */
const formatContextForDisplay = (context: GrafanaContextArtifact): string => {
  const lines: string[] = [];

  lines.push('=== Grafana Environment ===');
  lines.push(`Version: ${context.grafanaVersion}`);
  lines.push(`Platform: ${context.platform}`);
  lines.push(`Theme: ${context.theme}`);
  lines.push(`User Role: ${context.userRole}`);

  lines.push('\n=== Current Location ===');
  lines.push(`Path: ${context.currentPath}`);
  if (Object.keys(context.searchParams).length > 0) {
    lines.push(`Params: ${JSON.stringify(context.searchParams)}`);
  }

  if (context.dashboard) {
    lines.push('\n=== Current Dashboard ===');
    lines.push(`Title: ${context.dashboard.title}`);
    lines.push(`UID: ${context.dashboard.uid}`);
    if (context.dashboard.folder) {
      lines.push(`Folder: ${context.dashboard.folder}`);
    }
  }

  if (context.activeDatasourceType) {
    lines.push(`\nActive Datasource Type: ${context.activeDatasourceType}`);
  }

  if (context.activeVisualizationType) {
    lines.push(`Active Visualization: ${context.activeVisualizationType}`);
  }

  lines.push('\n=== Available Datasources ===');
  if (context.datasources.length === 0) {
    lines.push('No datasources configured');
  } else {
    // Group by type
    const byType: Record<string, string[]> = {};
    for (const ds of context.datasources) {
      if (!byType[ds.type]) {
        byType[ds.type] = [];
      }
      byType[ds.type].push(ds.name);
    }

    for (const [type, names] of Object.entries(byType)) {
      lines.push(`  ${type}: ${names.join(', ')}`);
    }
  }

  return lines.join('\n');
};

/**
 * Creates a Grafana context tool that provides full environment context.
 *
 * @param onArtifact - Optional callback to receive the structured artifact data
 * @returns An InlineToolRunnable that can be passed to useInlineAssistant
 *
 * @example
 * ```tsx
 * const gen = useInlineAssistant();
 *
 * gen.generate({
 *   prompt: 'Customize this config for my Grafana environment',
 *   tools: [createGrafanaContextTool()],
 * });
 * ```
 */
export const createGrafanaContextTool = (
  onArtifact?: (artifact: GrafanaContextArtifact) => void
): InlineToolRunnable => {
  return createTool(
    async (_input: ToolInput, _options: ToolInvokeOptions): Promise<ToolOutput> => {
      const location = locationService.getLocation();
      const currentPath = location.pathname;
      const currentUrl = `${location.pathname}${location.search}${location.hash}`;
      const searchParams = getSearchParams();

      // Fetch dashboard info if on dashboard page
      const dashboard = await fetchDashboardInfo(currentPath);

      // Get detected context from ContextService (uses EchoSrv events)
      const activeDatasourceType = ContextService.getDetectedDatasourceType() || undefined;
      const activeVisualizationType = ContextService.getDetectedVisualizationType() || undefined;

      // Build the artifact
      const artifact: GrafanaContextArtifact = {
        currentPath,
        currentUrl,
        searchParams,
        grafanaVersion: getGrafanaVersion(),
        platform: getCurrentPlatform(),
        theme: getCurrentTheme(),
        datasources: getDatasourcesInfo(),
        dashboard,
        activeDatasourceType,
        activeVisualizationType,
        userRole: getUserRole(),
      };

      // Call callback if provided
      if (onArtifact) {
        onArtifact(artifact);
      }

      // Format for display
      const displayText = formatContextForDisplay(artifact);

      return [displayText, artifact];
    },
    {
      name: 'get_grafana_context',
      description:
        "Provides full Grafana environment context including version, platform (cloud/oss), theme, current page/dashboard, available datasources, and user role. Use this tool when you need to understand the user's Grafana environment to customize documentation, configurations, or provide relevant guidance.",
      inputSchema: toolInputSchema,
      validate: (input) => input as ToolInput,
      responseFormat: 'content_and_artifact',
    }
  );
};

/**
 * Pre-built tool instance for simple use cases
 */
export const grafanaContextTool = createGrafanaContextTool();
