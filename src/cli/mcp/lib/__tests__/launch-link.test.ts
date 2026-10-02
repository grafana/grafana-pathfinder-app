import { buildLaunchLink } from '../launch-link';

const BASE = 'https://interactive-learning.grafana.net/packages/';
const doc = (id: string) => encodeURIComponent(`${BASE}${id}/content.json`);

describe('buildLaunchLink', () => {
  it('links a guide with only the doc parameter', () => {
    expect(buildLaunchLink({ baseUrl: BASE, entryPath: 'first-dashboard/', type: 'guide' })).toEqual({
      cdnContentUrl: `${BASE}first-dashboard/content.json`,
      launchPath: `/a/grafana-pathfinder-app?doc=${doc('first-dashboard')}`,
    });
  });

  it.each(['path', 'journey'])('adds type=learning-journey for a %s', (type) => {
    expect(buildLaunchLink({ baseUrl: BASE, entryPath: 'kubernetes-lp/', type })?.launchPath).toBe(
      `/a/grafana-pathfinder-app?doc=${doc('kubernetes-lp')}&type=learning-journey`
    );
  });

  it('appends panelMode after type and builds launchUrl from a trimmed origin', () => {
    expect(
      buildLaunchLink({
        baseUrl: BASE,
        entryPath: 'kubernetes-lp',
        type: 'path',
        panelMode: 'floating',
        instanceUrl: ' https://stack1.grafana.net// ',
      })
    ).toEqual({
      cdnContentUrl: `${BASE}kubernetes-lp/content.json`,
      launchPath: `/a/grafana-pathfinder-app?doc=${doc('kubernetes-lp')}&type=learning-journey&panelMode=floating`,
      launchUrl: `https://stack1.grafana.net/a/grafana-pathfinder-app?doc=${doc('kubernetes-lp')}&type=learning-journey&panelMode=floating`,
    });
  });

  it('omits launchUrl for a blank instanceUrl', () => {
    expect(buildLaunchLink({ baseUrl: BASE, entryPath: 'x', instanceUrl: '  ' })).not.toHaveProperty('launchUrl');
  });

  it('returns null when the content URL cannot be built', () => {
    expect(buildLaunchLink({ baseUrl: BASE, entryPath: '/' })).toBeNull();
  });
});
