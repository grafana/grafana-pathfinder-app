import { currentPlatform } from './platform';

export function getRecommenderStackContext(hostname = window.location.hostname) {
  const platform = currentPlatform();
  return {
    platform,
    source: platform === 'cloud' || hostname === 'play.grafana.org' ? hostname : 'oss-source',
  };
}
