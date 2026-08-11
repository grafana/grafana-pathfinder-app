import { renderHook } from '@testing-library/react';

import { useCustomGuideCatalogueOnOpen } from './useCustomGuideCatalogueOnOpen';
import { fetchCustomGuideRepository } from '../../../lib/custom-guide-repository-client';

jest.mock('../../../lib/custom-guide-repository-client', () => ({
  fetchCustomGuideRepository: jest.fn().mockResolvedValue([]),
}));

jest.mock('@grafana/runtime', () => ({
  config: { namespace: 'stacks-42' },
}));

const fetchMock = fetchCustomGuideRepository as jest.MockedFunction<typeof fetchCustomGuideRepository>;

describe('useCustomGuideCatalogueOnOpen', () => {
  beforeEach(() => {
    fetchMock.mockClear();
  });

  it('fetches the catalogue for the current namespace when the panel opens', () => {
    renderHook(() => useCustomGuideCatalogueOnOpen());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('stacks-42');
  });

  it('does not refetch on re-render', () => {
    const { rerender } = renderHook(() => useCustomGuideCatalogueOnOpen());
    rerender();
    rerender();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not throw when the fetch rejects', async () => {
    fetchMock.mockRejectedValueOnce(new Error('proxy unavailable'));

    expect(() => renderHook(() => useCustomGuideCatalogueOnOpen())).not.toThrow();
    await Promise.resolve();
  });
});
