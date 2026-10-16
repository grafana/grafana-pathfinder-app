import {
  cancelCatalogActivation,
  consumeCatalogActivation,
  getCatalogActivation,
  getCatalogView,
  requestCatalogActivation,
  subscribeCatalogView,
  updateCatalogView,
} from './package-browser';

it('consumes only the latest Browse request for the requesting user and organization', () => {
  requestCatalogActivation('org-a:user-a');
  const older = getCatalogActivation('org-a:user-a')!;
  requestCatalogActivation('org-a:user-a');
  const latest = getCatalogActivation('org-a:user-a')!;
  expect(consumeCatalogActivation('org-a:user-a', older)).toBe(false);
  expect(consumeCatalogActivation('org-a:user-a', latest)).toBe(true);
  expect(consumeCatalogActivation('org-a:user-a', latest)).toBe(false);
  requestCatalogActivation('org-a:user-a');
  expect(getCatalogActivation('org-b:user-b')).toBeNull();
  expect(getCatalogActivation('org-a:user-a')).toBeNull();
});

it('cancels a pending Browse request when a newer destination is chosen', () => {
  requestCatalogActivation('org-a:user-a');
  cancelCatalogActivation();
  expect(getCatalogActivation('org-a:user-a')).toBeNull();
});

it('isolates the view from a different user or organization', () => {
  updateCatalogView('org-a:user-a', { query: 'private guide', expandedKeys: ['app-platform:private'] });
  expect(getCatalogView('org-b:user-b')).toMatchObject({ query: '', expandedKeys: [] });
  updateCatalogView('org-b:user-b', { query: 'metrics' });
  expect(getCatalogView('org-a:user-a')).toMatchObject({ query: '', expandedKeys: [] });
});

it('remembers scroll position without rerendering the catalog on every scroll', () => {
  const listener = jest.fn();
  const unsubscribe = subscribeCatalogView(listener);
  updateCatalogView('scroll-test', { scrollTop: 420 }, false);
  expect(getCatalogView('scroll-test').scrollTop).toBe(420);
  expect(listener).not.toHaveBeenCalled();
  updateCatalogView('scroll-test', { query: 'metrics' });
  expect(listener).toHaveBeenCalledTimes(1);
  unsubscribe();
});
