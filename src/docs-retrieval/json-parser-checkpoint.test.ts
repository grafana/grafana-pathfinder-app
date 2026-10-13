import { parseJsonGuide } from './json-parser';
import { parseAndValidateGuide } from '../components/block-editor/utils/block-import';

jest.mock('@grafana/runtime', () => ({ config: { bootData: { user: null }, buildInfo: { version: '13.0.0' } } }));
jest.mock('@grafana/data', () => ({ renderMarkdown: (md: string) => `<p>${md}</p>` }));

it('preserves checkpoints from authoring import through runtime section conversion', () => {
  const checkpoint = {
    checks: [{ requirement: 'on-page:/playlists' }, { target: '#options', state: 'expanded' }],
    manualRecovery: 'Return to the playlist form, then check again.',
  };
  const json = JSON.stringify({
    id: 'checkpoint',
    title: 'Checkpoint',
    blocks: [
      {
        type: 'section',
        id: 'configure',
        checkpoint,
        blocks: [{ type: 'markdown', content: 'Configure the options.' }],
      },
    ],
  });
  const imported = parseAndValidateGuide(json);
  expect(imported.isValid).toBe(true);
  expect(imported.guide?.blocks[0]).toMatchObject({ checkpoint });
  const parsed = parseJsonGuide(JSON.stringify(imported.guide));
  expect(parsed.isValid).toBe(true);
  expect(parsed.data?.elements.find((e) => e.type === 'interactive-section')?.props.checkpoint).toEqual(checkpoint);
});
