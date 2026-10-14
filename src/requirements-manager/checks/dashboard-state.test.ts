import { locationService } from '@grafana/runtime';
import { dashboardStateCheck, restoreDashboardState } from './dashboard-state';
import { dispatchFix } from '../fix-registry';

jest.mock('@grafana/runtime', () => ({ locationService: { getLocation: jest.fn(), partial: jest.fn() } }));

const group = 'dashboard-group-by:canvvlh:filter:job';
const absent = 'dashboard-filter-absent:canvvlh:filter:job';

function page(search = '?var-filter=') {
  (locationService.getLocation as jest.Mock).mockReturnValue({ pathname: '/d/canvvlh/filter-variables', search });
}

function controls({ grouped = false, filtered = false } = {}) {
  document.body.innerHTML = `<div data-testid="data-testid dashboard controls"><div data-testid="data-testid template variable">
    <label data-testid="data-testid Dashboard template variables submenu Label filter">filter</label>
    <input placeholder="+ key" role="combobox" />
    ${grouped ? '<div role="button" aria-label="Group by job">job</div>' : ''}
    ${filtered ? '<button aria-label="Remove filter with key job">Remove</button>' : ''}
  </div></div>`;
}

beforeEach(() => {
  jest.clearAllMocks();
  page();
  controls();
});

it('offers grouping recovery without treating historical completion as current readiness', async () => {
  expect(await dashboardStateCheck(group)).toMatchObject({ pass: false, canFix: true, fixType: 'dashboard-state' });
});

it('accepts an already removed filter only on the expected loaded dashboard', async () => {
  expect(await dashboardStateCheck(absent)).toMatchObject({ pass: true });
  document.body.replaceChildren();
  expect(await dashboardStateCheck(absent)).toMatchObject({ pass: false, verdict: 'unavailable' });
  controls();
  (locationService.getLocation as jest.Mock).mockReturnValue({ pathname: '/d/canvvlh-other', search: '?var-filter=' });
  expect(await dashboardStateCheck(absent)).toMatchObject({ pass: false });
});

it('does not infer filter absence from a missing button while URL state still contains the filter', async () => {
  page('?var-filter=job%7C%3D%7Capi&var-filter=job%7CgroupBy');
  expect(await dashboardStateCheck(absent)).toMatchObject({ pass: false });
});

it('does not infer filter absence from an empty URL while a default filter is rendered', async () => {
  controls({ filtered: true });
  expect(await dashboardStateCheck(absent)).toMatchObject({ pass: false });
});

it('requires the grouping pill to render before declaring recovery successful', async () => {
  page('?var-filter=job%7CgroupBy');
  expect(await dashboardStateCheck(group)).toMatchObject({ pass: false, verdict: 'unavailable', canFix: false });
  controls({ grouped: true });
  expect(await dashboardStateCheck(group)).toMatchObject({ pass: true });
});

it('accepts visible default grouping without a URL override, and restores grouping the URL dropped', async () => {
  controls({ grouped: true });
  page('');
  expect(await dashboardStateCheck(group)).toMatchObject({ pass: true });
  expect(restoreDashboardState(group)).toBe(false);
  expect(locationService.partial).not.toHaveBeenCalled();
  page('?var-filter=');
  expect(await dashboardStateCheck(group)).toMatchObject({ pass: false, canFix: true });
  expect(restoreDashboardState(group)).toBe(true);
  expect(locationService.partial).toHaveBeenCalledWith({ 'var-filter': ['job|groupBy'] });
});

it('offers to return to the guide dashboard from another one', async () => {
  (locationService.getLocation as jest.Mock).mockReturnValue({ pathname: '/d/other/board', search: '' });
  expect(await dashboardStateCheck(group)).toMatchObject({
    pass: false,
    canFix: true,
    fixType: 'location',
    targetHref: '/d/canvvlh',
  });
});

it('preserves other filters and grouping, and uses the latest state at restore time', () => {
  page('?var-filter=cluster%7C%3D%7Cprod&var-filter=service%7CgroupBy&from=now-1h');
  expect(restoreDashboardState(group)).toBe(true);
  expect(locationService.partial).toHaveBeenCalledWith({
    'var-filter': ['cluster|=|prod', 'service|groupBy', 'job|groupBy'],
  });
});

it('never restores on another dashboard', () => {
  (locationService.getLocation as jest.Mock).mockReturnValue({ pathname: '/explore', search: '?var-filter=' });
  expect(restoreDashboardState(group)).toBe(false);
  expect(locationService.partial).not.toHaveBeenCalled();
});

it('refuses to replace filters or groups that are not represented in the URL', () => {
  controls({ filtered: true });
  expect(restoreDashboardState(group)).toBe(false);
  expect(locationService.partial).not.toHaveBeenCalled();
});

it('does not accept hidden or ambiguous variable controls as a checkpoint', async () => {
  document.querySelector('input')!.hidden = true;
  expect(await dashboardStateCheck(absent)).toMatchObject({ pass: false, verdict: 'unavailable' });
  controls();
  document.body.appendChild(document.body.firstElementChild!.cloneNode(true));
  expect(await dashboardStateCheck(absent)).toMatchObject({ pass: false, verdict: 'unavailable' });
});

it('rejects malformed authored conditions', async () => {
  expect(await dashboardStateCheck('dashboard-group-by:canvvlh:filter:job:extra')).toMatchObject({
    pass: false,
    verdict: 'invalid',
  });
});

it('restores filter absence without removing grouping or unrelated filters, and is idempotent', () => {
  page('?var-filter=job%7CgroupBy&var-filter=job%7C%3D%7Capi&var-filter=cluster%7C%3D%7Cprod');
  controls({ grouped: true, filtered: true });
  expect(restoreDashboardState(absent)).toBe(true);
  expect(locationService.partial).toHaveBeenCalledWith({ 'var-filter': ['job|groupBy', 'cluster|=|prod'] });
  jest.clearAllMocks();
  page('?var-filter=job%7CgroupBy&var-filter=cluster%7C%3D%7Cprod');
  controls({ grouped: true });
  expect(restoreDashboardState(absent)).toBe(true);
  expect(locationService.partial).not.toHaveBeenCalled();
});

it('dispatches section recovery against current state without requiring a navigation manager', async () => {
  const context = {
    fixType: 'dashboard-state',
    requirements: [group, absent],
    stepId: 'filter-out',
    navigationManager: null,
    fixNavigationRequirements: jest.fn(),
  };
  expect(await dispatchFix(context)).toEqual({ ok: true });
  expect(locationService.partial).toHaveBeenCalledWith({ 'var-filter': ['job|groupBy'] });
  jest.clearAllMocks();
  (locationService.getLocation as jest.Mock).mockReturnValue({ pathname: '/explore', search: '' });
  expect(await dispatchFix(context)).toMatchObject({ ok: false });
  expect(locationService.partial).not.toHaveBeenCalled();
});
