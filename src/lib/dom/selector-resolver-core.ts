import { escapeCssAttributeValue } from './css-escape';
import { toGrafanaSelectorForVersion } from './grafana-selector-core';

export type SelectorResolutionErrorHandler = (message: string, error: unknown) => void;

export function resolveSelectorForVersion(
  reftarget: string,
  grafanaVersion: string,
  onError?: SelectorResolutionErrorHandler
): string {
  if (!reftarget) {
    return reftarget;
  }

  if (reftarget.includes('{grafana:')) {
    return resolveEmbeddedGrafanaTokens(reftarget, grafanaVersion, onError);
  }

  if (reftarget.startsWith('grafana:')) {
    const { selectorPath, selectorId } = splitGrafanaPathParam(reftarget.substring(8));
    try {
      return toGrafanaSelectorForVersion(selectorPath, grafanaVersion, selectorId);
    } catch (error) {
      onError?.(`Failed to resolve Grafana selector: ${reftarget}`, error);
      return reftarget;
    }
  }

  if (reftarget.startsWith('panel:')) {
    return resolvePanelSelector(reftarget);
  }

  return reftarget;
}

function splitGrafanaPathParam(pathWithParam: string): { selectorPath: string; selectorId?: string } {
  const colonIndex = pathWithParam.indexOf(':');
  if (colonIndex !== -1 && colonIndex < pathWithParam.length - 1) {
    return {
      selectorPath: pathWithParam.substring(0, colonIndex),
      selectorId: pathWithParam.substring(colonIndex + 1),
    };
  }
  return { selectorPath: pathWithParam };
}

function resolveEmbeddedGrafanaTokens(
  reftarget: string,
  grafanaVersion: string,
  onError?: SelectorResolutionErrorHandler
): string {
  let failed = false;
  const resolved = reftarget.replace(/\{grafana:([^}]+)\}/g, (match, pathWithParam: string) => {
    const { selectorPath, selectorId } = splitGrafanaPathParam(pathWithParam);
    try {
      return toGrafanaSelectorForVersion(selectorPath, grafanaVersion, selectorId);
    } catch (error) {
      onError?.(`Failed to resolve embedded Grafana selector token: ${match}`, error);
      failed = true;
      return match;
    }
  });
  return failed ? reftarget : resolved;
}

function resolvePanelSelector(reftarget: string): string {
  const panelPart = reftarget.substring(6);
  const childSeparator = panelPart.indexOf(' > ');
  const panelTitle = childSeparator === -1 ? panelPart : panelPart.substring(0, childSeparator);
  const childSelector = childSeparator === -1 ? null : panelPart.substring(childSeparator + 3);
  const baseSelector = `[data-viz-panel-key]:has([data-testid*="Panel header ${escapeCssAttributeValue(panelTitle, '"')}"])`;
  return childSelector ? `${baseSelector} ${childSelector}` : baseSelector;
}
