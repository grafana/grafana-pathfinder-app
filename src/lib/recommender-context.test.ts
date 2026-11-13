import { currentPlatform } from './platform';
import { getRecommenderStackContext } from './recommender-context';

jest.mock('./platform', () => ({ currentPlatform: jest.fn() }));

it('uses the same generic source as recommendations for self-managed instances', () => {
  jest.mocked(currentPlatform).mockReturnValue('oss');
  expect(getRecommenderStackContext('private.example.com')).toEqual({ platform: 'oss', source: 'oss-source' });
});

it('preserves the existing public demo source exception', () => {
  jest.mocked(currentPlatform).mockReturnValue('oss');
  expect(getRecommenderStackContext('play.grafana.org')).toEqual({ platform: 'oss', source: 'play.grafana.org' });
});

it('uses the stack hostname for Cloud, without user identity or page context', () => {
  jest.mocked(currentPlatform).mockReturnValue('cloud');
  expect(getRecommenderStackContext('private.grafana.net')).toEqual({
    platform: 'cloud',
    source: 'private.grafana.net',
  });
});
