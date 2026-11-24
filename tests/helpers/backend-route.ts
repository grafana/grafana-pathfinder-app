export function matchesBackendRoute(path: string) {
  const prefix = '/apis/pathfinderbackend.ext.grafana.app/v1alpha1/namespaces/';
  return (url: URL) => {
    const [namespace, route, ...segments] = url.pathname.slice(prefix.length).split('/');
    return url.pathname.startsWith(prefix) && Boolean(namespace) && route === 'backend' && segments.join('/') === path;
  };
}
