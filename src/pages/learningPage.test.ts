import { ROUTES } from '../constants';
import { prefixRoute } from '../utils/utils.routing';

describe('Learning route', () => {
  it('ROUTES.Learning exists and equals "learning"', () => {
    expect(ROUTES.Learning).toBe('learning');
  });

  it('prefixRoute produces correct path', () => {
    const result = prefixRoute(ROUTES.Learning);
    expect(result).toContain('/learning');
  });
});
