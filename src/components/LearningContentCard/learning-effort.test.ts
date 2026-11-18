import { catalogModuleCountText, learningEffort } from './learning-effort';
import type { CatalogPackage } from '../../types/package-catalog.types';

jest.mock('@grafana/i18n', () => ({
  t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values?.[key] ?? '')),
}));

describe('learningEffort', () => {
  it('counts the modules in the default sequence of a tracked path', () => {
    const manifest = {
      milestones: ['setup', 'agents'],
      tracks: [
        { trackId: 'metrics', label: 'Metrics', guides: ['setup', 'agents', 'm-1', 'm-2'] },
        { trackId: 'logs', label: 'Logs', guides: ['setup', 'agents', 'l-1', 'l-2'] },
      ],
    };

    expect(learningEffort(manifest, 'path')).toBe('2 modules');
  });

  it('uses the first available track for paths that only define tracks', () => {
    expect(learningEffort({ tracks: [{ trackId: 'ops', label: 'Ops', guides: ['a'] }] }, 'path')).toBe('1 module');
    expect(learningEffort({ milestones: ['a', 'b', 'c'], estimatedMinutes: 30 }, 'path')).toBe(
      '3 modules · About 30 min'
    );
    expect(learningEffort({ milestones: [] }, 'path')).toBe('0 modules');
    expect(learningEffort({}, 'path')).toBe('');
  });
});

it('uses the default sequence in the catalog and can count loaded modules for a URL-based path', () => {
  const path: CatalogPackage = { id: 'path', key: 'path', title: 'Path', format: 'path', source: 'grafana', url: '' };
  expect(catalogModuleCountText(path, 3)).toBe('3 modules');
  expect(catalogModuleCountText({ ...path, format: 'guide' }, 3)).toBeUndefined();
  expect(
    catalogModuleCountText({
      ...path,
      memberIds: ['base', 'alt'],
      packageInfo: { packageId: 'path', packageManifest: { milestones: ['base'] } },
    })
  ).toBe('1 module');
});
