import pluginJson from '../../src/plugin.json';

export function matchesBackendRoute(path: string) {
  const legacy = `/api/plugins/${pluginJson.id}/resources/${path}`;
  const prefix = '/apis/pathfinderbackend.ext.grafana.app/v1alpha1/namespaces/';
  return (url: URL) => {
    if (url.pathname === legacy) {
      return true;
    }
    const [namespace, route, ...segments] = url.pathname.slice(prefix.length).split('/');
    return url.pathname.startsWith(prefix) && Boolean(namespace) && route === 'backend' && segments.join('/') === path;
  };
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
