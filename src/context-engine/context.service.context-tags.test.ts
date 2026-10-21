import { ContextService } from './context.service';

type GenerateTagsFn = (
  pathSegments: string[],
  searchParams: Record<string, string>,
  dataSources: [],
  dashboardInfo: null
) => string[];

const generateTags = (path: string) =>
  (ContextService as unknown as { generateContextTags: GenerateTagsFn }).generateContextTags(
    path.split('/').filter(Boolean),
    {},
    [],
    null
  );

describe('ContextService.generateContextTags', () => {
  it('sends the dashboard entity tag from the dashboards listing', () => {
    expect(generateTags('/dashboards')).toEqual(['dashboard:view']);
  });
});
