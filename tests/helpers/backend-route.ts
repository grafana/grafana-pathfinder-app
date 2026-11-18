import pluginJson from '../../src/plugin.json';

export function matchesBackendRoute(path: string) {
  const legacy = `/api/plugins/${pluginJson.id}/resources/${path}`;
  const sdk = `/apis/pathfinderbackend.ext.grafana.app/v1alpha1/namespaces/default/backend/${path}`;
  return (url: URL) => url.pathname === legacy || url.pathname === sdk;
}

const guideBackendRoute = matchesBackendRoute('custom-guide');

export function matchesGuideResource(url: URL): boolean {
  return (
    guideBackendRoute(url) ||
    /^\/apis\/pathfinderbackend\.ext\.grafana\.app\/v1alpha1\/namespaces\/[^/]+\/interactiveguides(?:\/|$)/.test(
      url.pathname
    )
  );
}
