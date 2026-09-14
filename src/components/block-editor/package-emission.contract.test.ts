/**
 * Tripwire for the package boundary of the block editor.
 *
 * Standalone JSON exports are intentionally content-only. A repository-bound
 * package, however, needs `manifest.json` beside `content.json` so discovery
 * and stats checks can see it. Keep those two cases explicit while the public
 * GitHub handoff is redesigned for multi-file packages (#1693).
 */

import * as fs from 'fs';
import * as path from 'path';

const SRC_ROOT = path.resolve(__dirname, '..', '..');

type PackageEmissionKind = 'content-only' | 'incomplete-package' | 'complete-package';

interface ExportSurface {
  id: string;
  label?: string;
  callbacks: readonly string[];
  file: string;
  marker: string;
  kind: PackageEmissionKind;
}

const EXPORT_SURFACES: readonly ExportSurface[] = [
  {
    id: 'copy-json',
    label: 'Copy JSON',
    callbacks: ['onCopy'],
    file: 'components/block-editor/hooks/useGuideOperations.ts',
    marker: 'const handleCopy',
    kind: 'content-only',
  },
  {
    id: 'download-json',
    label: 'Download JSON',
    callbacks: ['onDownload'],
    file: 'components/block-editor/hooks/useGuideOperations.ts',
    marker: 'const handleDownload',
    kind: 'content-only',
  },
  {
    id: 'create-github-pr',
    label: 'Create GitHub PR',
    callbacks: ['onOpenGitHubPR'],
    file: 'components/block-editor/utils/github-pr.ts',
    marker: 'export async function prepareGitHubPR',
    kind: 'incomplete-package',
  },
  {
    id: 'backend-save',
    callbacks: ['onSaveDraft', 'onPostToBackend'],
    file: 'components/block-editor/hooks/useBackendGuides.ts',
    marker: 'manifest: deriveManifest',
    kind: 'complete-package',
  },
];

const KNOWN_CONTENT_ONLY: Readonly<Record<string, string>> = {
  'copy-json':
    'A clipboard export is a standalone content artifact; it does not claim to be a repository package (#1693).',
  'download-json':
    'A downloaded JSON file is a standalone content artifact; it does not claim to be a repository package (#1693).',
};

const KNOWN_INCOMPLETE_PACKAGES: Readonly<Record<string, string>> = {
  'create-github-pr':
    'The current single-file GitHub handoff is the known #1693 gap; keep it visible until the multi-file handoff is redesigned.',
};

function read(relativePath: string): string {
  return fs.readFileSync(path.join(SRC_ROOT, relativePath), 'utf8');
}

function visibleExportLabels(): string[] {
  const source = read('components/block-editor/header/HeaderKebab.tsx');
  return [...source.matchAll(/<Menu\.Item[^>]*label="([^"]+)"[^>]*onClick=\{[^}]+\}/g)]
    .map((match) => match[1]!)
    .filter((label) => EXPORT_SURFACES.some((surface) => surface.label === label));
}

function exportCallbacks(): string[] {
  const source = [
    read('components/block-editor/header/HeaderKebab.tsx'),
    read('components/block-editor/header/SaveActions.tsx'),
    read('components/block-editor/BlockEditorHeader.tsx'),
  ].join('\n');
  const callbacks = new Set<string>();
  for (const match of source.matchAll(/\bon[A-Z][A-Za-z0-9]*\b/g)) {
    const callback = match[0]!;
    if (/^on(?:Copy|Download|OpenGitHubPR|SaveDraft|PostToBackend|Publish|Export)/.test(callback)) {
      callbacks.add(callback);
    }
  }
  return [...callbacks].sort();
}

describe('block-editor package emission contract', () => {
  it.each(EXPORT_SURFACES)('$id remains wired at its source boundary', (surface) => {
    expect(read(surface.file)).toContain(surface.marker);
  });

  it('keeps every visible content export in the surface inventory', () => {
    const visible = visibleExportLabels();
    const expected = EXPORT_SURFACES.flatMap((surface) => (surface.label ? [surface.label] : []));

    expect(visible).toEqual(expected);
  });

  it('fails closed when a new guide-emission callback is added', () => {
    const expected = [...new Set(EXPORT_SURFACES.flatMap((surface) => surface.callbacks))].sort();
    expect(exportCallbacks()).toEqual(expected);
  });

  it('keeps intentional content-only exports in a reasoned baseline', () => {
    const contentOnly = EXPORT_SURFACES.filter((surface) => surface.kind === 'content-only').map(({ id }) => id);
    expect(contentOnly).toEqual(Object.keys(KNOWN_CONTENT_ONLY).sort());

    for (const [id, reason] of Object.entries(KNOWN_CONTENT_ONLY)) {
      expect(reason.trim()).not.toBe('');
      expect(EXPORT_SURFACES.some((surface) => surface.id === id)).toBe(true);
    }
  });

  it('keeps incomplete repository packages explicitly visible', () => {
    const incomplete = EXPORT_SURFACES.filter((surface) => surface.kind === 'incomplete-package').map(({ id }) => id);
    expect(incomplete).toEqual(Object.keys(KNOWN_INCOMPLETE_PACKAGES).sort());

    for (const [id, reason] of Object.entries(KNOWN_INCOMPLETE_PACKAGES)) {
      expect(reason.trim()).not.toBe('');
      expect(EXPORT_SURFACES.some((surface) => surface.id === id)).toBe(true);
    }
  });

  it('keeps the incomplete-package baseline live until the handoff changes', () => {
    const source = read('components/block-editor/utils/github-pr.ts');

    expect(source).toContain("const CONTENT_FILENAME = 'content.json';");
    expect(source).not.toContain('manifest');
  });

  it('keeps the backend save path as the complete-package positive case', () => {
    const source = read('components/block-editor/hooks/useBackendGuides.ts');

    expect(source).toContain('manifest: deriveManifest');
    expect(source).toContain('const k8sResource =');
    expect(source).toContain('spec: preservedSpec');
  });

  it('does not let the content-only baseline drift into a package claim', () => {
    const source = read('components/block-editor/hooks/useGuideOperations.ts');

    expect(source).toContain('const json = JSON.stringify(guide, null, 2);');
    expect(source).not.toContain('deriveManifest');
  });
});
